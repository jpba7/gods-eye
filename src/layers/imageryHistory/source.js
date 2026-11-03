import { readResponseJsonCapped } from '../../sources/httpBody.js';
import { waybackTileTemplate } from './model.js';

// A portable export: no i18n here. Failures stay English data; the Layers
// panel shows them translated.
const msg = (text) => text;

/** About 200 releases of a few dozen bytes each; anything near this is not the list. */
const MAX_RESPONSE_BYTES = 256 * 1024;

/**
 * Read the Esri World Imagery Wayback release list through the local
 * `/api/wayback/releases` proxy. Tiles load browser-direct from Esri.
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - Injected fetch, for tests.
 * @param {string} [options.baseUrl='/api/wayback'] - Proxy root.
 */
export function createWaybackSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  baseUrl = '/api/wayback',
} = {}) {
  return {
    credit: 'Esri World Imagery Wayback', // i18n-ignore: product name
    /**
     * Every published release, oldest first.
     * @param {{signal?: AbortSignal}} [options]
     * @returns {Promise<{releases: Array<{id:number, date:string}>}>}
     */
    async getReleases({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(`${baseUrl}/releases`, {
        headers: { Accept: 'application/json' },
        signal,
      });
      if (!response.ok) throw new Error(`Wayback HTTP ${response.status}`);
      const payload = await readResponseJsonCapped(
        response,
        MAX_RESPONSE_BYTES,
        signal,
      );
      signal?.throwIfAborted();
      if (!Array.isArray(payload?.releases))
        throw new Error(msg('Malformed Wayback response'));
      return payload;
    },
    tileTemplate: waybackTileTemplate,
  };
}
