import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import {
  coalesceProxyRequest,
  readResponseJsonCapped,
} from '../common/http.js';
import { requiredFiniteQueryNumber } from '../common/query.js';
import {
  MAX_NEARBY_RADIUS_M,
  MIN_NEARBY_RADIUS_M,
  nearbyUrl,
  normalizeNearby,
  normalizeSummary,
  summaryUrl,
  validPageId,
  validWikipediaLanguage,
} from './upstream.js';
import { extractPlaceFacts, wikidataEntityUrl } from './wikidata.js';

/**
 * Wikimedia asks every API client to identify itself with a descriptive
 * User-Agent: https://foundation.wikimedia.org/wiki/Policy:User-Agent_policy
 */
export const WIKIMEDIA_USER_AGENT =
  'gods-eye-view/0.3 (+https://github.com/bilawalsidhu/gods-eye-view) explore-places';

/** Article text is CC BY-SA 4.0; the card links the article and names the licence. */
export const WIKIPEDIA_TEXT_LICENSE = 'CC BY-SA 4.0';

const NEARBY_TTL_MS = 30 * 60_000;
const NEARBY_STALE_MS = 6 * 60 * 60_000;
const SUMMARY_TTL_MS = 24 * 60 * 60_000;
const SUMMARY_STALE_MS = 7 * 24 * 60 * 60_000;
const MAX_NEARBY_CACHE = 300;
const MAX_SUMMARY_CACHE = 500;
const UPSTREAM_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** Nearby requests snap to ~500 m cells so small camera moves share a cache entry. */
const NEARBY_GRID_DEG = 0.005;
const NEARBY_RADIUS_STEP_M = 500;

function snap(value, step) {
  return Math.round(value / step) * step;
}

/** Validate and snap a nearby query; null when a field is missing or out of range. */
export function parseNearbyQuery(params) {
  const lang = validWikipediaLanguage(params.get('lang'));
  const latitude = requiredFiniteQueryNumber(params, 'latitude');
  const longitude = requiredFiniteQueryNumber(params, 'longitude');
  const radius = requiredFiniteQueryNumber(params, 'radius');
  if (!lang || ![latitude, longitude, radius].every(Number.isFinite))
    return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)
    return null;
  const radiusM = Math.min(
    MAX_NEARBY_RADIUS_M,
    Math.max(MIN_NEARBY_RADIUS_M, snap(radius, NEARBY_RADIUS_STEP_M)),
  );
  return {
    lang,
    latitude: Number(snap(latitude, NEARBY_GRID_DEG).toFixed(3)),
    longitude: Number(snap(longitude, NEARBY_GRID_DEG).toFixed(3)),
    radiusM,
  };
}

/** Validate a summary query; null when the edition or page id is not acceptable. */
export function parseSummaryQuery(params) {
  const lang = validWikipediaLanguage(params.get('lang'));
  const pageId = validPageId(params.get('pageId'));
  return lang && pageId ? { lang, pageId } : null;
}

function boundedCache(max) {
  const entries = new Map();
  return {
    get: (key) => entries.get(key),
    set(key, value) {
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > max) entries.delete(entries.keys().next().value);
    },
  };
}

/**
 * The cached, coalesced Wikipedia and Wikidata reads behind the two routes.
 * Exported apart from the middleware so tests can drive it with a fake fetch.
 */
export function createWikipediaService({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const nearbyCache = boundedCache(MAX_NEARBY_CACHE);
  const summaryCache = boundedCache(MAX_SUMMARY_CACHE);
  const inFlight = new Map();

  async function getJson(url) {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': WIKIMEDIA_USER_AGENT,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Wikimedia HTTP ${response.status}`);
    return readResponseJsonCapped(response, MAX_RESPONSE_BYTES);
  }

  async function facts(wikidataId) {
    if (!wikidataId) return null;
    try {
      const payload = await getJson(wikidataEntityUrl(wikidataId));
      const entity = payload?.entities?.[wikidataId];
      return entity && !entity.missing ? extractPlaceFacts(entity) : null;
    } catch {
      // Facts are an enrichment: the article intro still stands without them.
      return null;
    }
  }

  async function cachedRead(cache, key, ttlMs, staleMs, load) {
    const clock = now();
    const cached = cache.get(key);
    if (cached && clock - cached.cachedAt <= ttlMs)
      return { ...cached.payload, status: 'cached' };
    const request = coalesceProxyRequest(inFlight, key, async () => {
      const payload = await load();
      cache.set(key, { payload, cachedAt: now() });
      return payload;
    });
    try {
      return await request.promise;
    } catch (error) {
      if (cached && clock - cached.cachedAt <= staleMs)
        return { ...cached.payload, status: 'stale' };
      throw error;
    }
  }

  return {
    nearby(query) {
      const key = `nearby:${query.lang}:${query.latitude},${query.longitude}:${query.radiusM}`;
      return cachedRead(
        nearbyCache,
        key,
        NEARBY_TTL_MS,
        NEARBY_STALE_MS,
        async () => {
          const places = normalizeNearby(
            await getJson(nearbyUrl(query)),
            query,
          );
          if (!places)
            throw new Error('Malformed Wikipedia geosearch response');
          return {
            status: 'ready',
            lang: query.lang,
            center: { latitude: query.latitude, longitude: query.longitude },
            radiusM: query.radiusM,
            retrievedAt: new Date(now()).toISOString(),
            places,
          };
        },
      );
    },

    summary(query) {
      const key = `summary:${query.lang}:${query.pageId}`;
      return cachedRead(
        summaryCache,
        key,
        SUMMARY_TTL_MS,
        SUMMARY_STALE_MS,
        async () => {
          const article = normalizeSummary(
            await getJson(summaryUrl(query)),
            query.lang,
          );
          if (!article) {
            const error = new Error('Wikipedia article not found');
            error.code = 'NOT_FOUND';
            throw error;
          }
          return {
            status: 'ready',
            lang: query.lang,
            ...article,
            facts: await facts(article.wikidataId),
            license: WIKIPEDIA_TEXT_LICENSE,
            retrievedAt: new Date(now()).toISOString(),
          };
        },
      );
    },
  };
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

/** Vite middleware for `/api/wikipedia/nearby` and `/api/wikipedia/summary`. */
export function wikipediaProxy({ service = createWikipediaService() } = {}) {
  const limiter = makeRateLimiter({
    windowMs: 60_000,
    max: 60,
    globalMax: 180,
  });

  function route(parse, read) {
    return async (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method Not Allowed' });
        return;
      }
      if (!limiter(clientKey(req))) {
        sendJson(
          res,
          429,
          { error: 'Rate limit exceeded' },
          { 'Retry-After': '10' },
        );
        return;
      }
      const query = parse(
        new URL(req.url || '', 'http://localhost').searchParams,
      );
      if (!query) {
        sendJson(res, 400, { error: 'Invalid Wikipedia query' });
        return;
      }
      try {
        const payload = await read(query);
        sendJson(res, 200, payload, {
          'Cache-Control':
            payload.status === 'stale' ? 'no-store' : 'public, max-age=300',
        });
      } catch (error) {
        if (error?.code === 'NOT_FOUND') {
          sendJson(res, 404, { error: 'Wikipedia article not found' });
          return;
        }
        sendJson(
          res,
          503,
          { error: 'Wikipedia is temporarily unavailable' },
          { 'Cache-Control': 'no-store' },
        );
      }
    };
  }

  function install(middlewares) {
    middlewares.use(
      '/api/wikipedia/nearby',
      route(parseNearbyQuery, (query) => service.nearby(query)),
    );
    middlewares.use(
      '/api/wikipedia/summary',
      route(parseSummaryQuery, (query) => service.summary(query)),
    );
  }

  return {
    name: 'wikipedia-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}
