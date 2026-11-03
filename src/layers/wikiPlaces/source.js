import { readResponseJsonCapped } from '../../sources/httpBody.js';

// A portable export (package.json): no i18n here. Failures stay English data;
// the Layers panel shows them translated.
const msg = (text) => text;

/** A nearby page lists at most 50 places; anything near this cap is not one. */
const MAX_RESPONSE_BYTES = 512 * 1024;

/**
 * Read nearby Wikipedia places and one place's summary through the local
 * `/api/wikipedia/*` proxy, which identifies the app to Wikimedia and caches.
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - Injected fetch, for tests.
 * @param {string} [options.baseUrl='/api/wikipedia'] - Proxy root.
 * @returns {{getNearby: Function, getSummary: Function}}
 */
export function createWikipediaPlacesSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  baseUrl = '/api/wikipedia',
} = {}) {
  async function getJson(path, params, signal) {
    signal?.throwIfAborted();
    const query = new URLSearchParams(params).toString();
    const response = await fetchImpl(`${baseUrl}/${path}?${query}`, {
      headers: { Accept: 'application/json' },
      signal,
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Wikipedia HTTP ${response.status}`);
    const payload = await readResponseJsonCapped(
      response,
      MAX_RESPONSE_BYTES,
      signal,
    );
    signal?.throwIfAborted();
    if (!payload || typeof payload !== 'object')
      throw new Error(msg('Malformed Wikipedia response'));
    return payload;
  }

  return {
    /**
     * Geotagged articles around a point, ranked by recent page views.
     * @param {{lang:string, latitude:number, longitude:number, radiusM:number}} query
     * @param {{signal?: AbortSignal}} [options]
     */
    async getNearby({ lang, latitude, longitude, radiusM }, { signal } = {}) {
      const payload = await getJson(
        'nearby',
        {
          lang,
          latitude: String(latitude),
          longitude: String(longitude),
          radius: String(radiusM),
        },
        signal,
      );
      if (!Array.isArray(payload?.places))
        throw new Error(msg('Malformed Wikipedia response'));
      return payload;
    },

    /**
     * One article's intro, link and Wikidata facts; null when it is gone.
     * @param {{lang:string, pageId:number}} query
     * @param {{signal?: AbortSignal}} [options]
     */
    getSummary({ lang, pageId }, { signal } = {}) {
      return getJson('summary', { lang, pageId: String(pageId) }, signal);
    },
  };
}
