/** Pure model for the Imagery through time layer: no Cesium, no i18n, no network. */

export const IMAGERY_HISTORY_LAYER_ID = 'imagery-history';
/** Owner name the map-stack comparison lease and pointer messages use. */
export const IMAGERY_HISTORY_OWNER = 'imagery-history';
/** Deepest Wayback level the layer asks for (about 0.3 m per pixel). */
export const WAYBACK_MAX_LEVEL = 19;
/** Where the swipe divider starts, as a share of the view width. */
export const DEFAULT_SPLIT = 0.5;

const TILE_ROOT =
  'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/';
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The Cesium URL template of one Wayback release. Esri's own template reads
 * `{level}/{row}/{col}`, which is Cesium's `{z}/{y}/{x}`.
 * @param {number} id - A release id from `/api/wayback/releases`.
 */
export function waybackTileTemplate(id) {
  const release = Number(id);
  if (!Number.isSafeInteger(release) || release <= 0)
    throw new TypeError(`Invalid Wayback release: ${id}`);
  return `${TILE_ROOT}${release}/{z}/{y}/{x}`;
}

/**
 * One release per calendar year: the last one Esri published that year, so
 * each chip shows the basemap as it stood at the end of that year (or, for the
 * current year, the newest release). Oldest year first.
 * @param {Array<{id:number, date:string}>} releases
 * @returns {Array<{year:number, id:number, date:string}>}
 */
export function yearlyReleases(releases) {
  const byYear = new Map();
  for (const release of Array.isArray(releases) ? releases : []) {
    const match = DAY.exec(String(release?.date ?? ''));
    const id = Number(release?.id);
    if (!match || !Number.isSafeInteger(id) || id <= 0) continue;
    const year = Number(match[1]);
    const current = byYear.get(year);
    if (!current || release.date > current.date)
      byYear.set(year, { year, id, date: release.date });
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

/**
 * The year to show: the chosen one when it is still offered, else the oldest,
 * which is the starkest contrast with today's basemap.
 * @param {Array<{year:number}>} years
 * @param {?number} chosen
 */
export function pickYear(years, chosen) {
  if (!years.length) return null;
  return years.some((entry) => entry.year === chosen) ? chosen : years[0].year;
}
