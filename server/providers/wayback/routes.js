import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import {
  coalesceProxyRequest,
  readResponseJsonCapped,
} from '../common/http.js';
import { WAYBACK_CONFIG_URL, normalizeReleases } from './upstream.js';

/** Esri publishes a new release every few weeks; a day-old list is fresh enough. */
const TTL_MS = 24 * 60 * 60_000;
const STALE_MS = 14 * 24 * 60 * 60_000;
const UPSTREAM_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

/** Attribution Esri asks for on World Imagery, Wayback included. */
export const WAYBACK_CREDIT =
  'Esri World Imagery Wayback · Esri, Maxar, Earthstar Geographics and the GIS User Community';

/**
 * The cached, coalesced read of the release list. Exported apart from the
 * middleware so tests can drive it with a fake fetch.
 */
export function createWaybackService({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  let cached = null;
  const inFlight = new Map();

  async function load() {
    const response = await fetchImpl(WAYBACK_CONFIG_URL, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Wayback HTTP ${response.status}`);
    const releases = normalizeReleases(
      await readResponseJsonCapped(response, MAX_RESPONSE_BYTES),
    );
    if (!releases?.length) throw new Error('Malformed Wayback release list');
    return {
      status: 'ready',
      credit: WAYBACK_CREDIT,
      retrievedAt: new Date(now()).toISOString(),
      releases,
    };
  }

  return {
    async releases() {
      const clock = now();
      if (cached && clock - cached.cachedAt <= TTL_MS)
        return { ...cached.payload, status: 'cached' };
      const request = coalesceProxyRequest(inFlight, 'releases', async () => {
        const payload = await load();
        cached = { payload, cachedAt: now() };
        return payload;
      });
      try {
        return await request.promise;
      } catch (error) {
        if (cached && clock - cached.cachedAt <= STALE_MS)
          return { ...cached.payload, status: 'stale' };
        throw error;
      }
    },
  };
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

/** Vite middleware for `/api/wayback/releases`. Tiles go browser-direct to Esri. */
export function waybackProxy({ service = createWaybackService() } = {}) {
  const limiter = makeRateLimiter({
    windowMs: 60_000,
    max: 30,
    globalMax: 120,
  });

  async function handle(req, res) {
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
    try {
      const payload = await service.releases();
      sendJson(res, 200, payload, {
        'Cache-Control':
          payload.status === 'stale' ? 'no-store' : 'public, max-age=3600',
      });
    } catch {
      sendJson(
        res,
        503,
        { error: 'Esri Wayback is temporarily unavailable' },
        { 'Cache-Control': 'no-store' },
      );
    }
  }

  function install(middlewares) {
    middlewares.use('/api/wayback/releases', handle);
  }

  return {
    name: 'wayback-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}
