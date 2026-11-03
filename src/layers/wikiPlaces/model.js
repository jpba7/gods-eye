/** Pure model for the Notable places layer: no Cesium types, no i18n. */

export const WIKI_PLACES_LAYER_ID = 'wiki-places';
export const WIKI_PLACES_LABEL_SOURCE_ID = 'wiki-places';
export const WIKI_PLACES_CARD_SOURCE_ID = 'wiki-places-card';
export const WIKI_PLACES_PICK_PREFIX = 'wiki-places:';
export const WIKI_PLACES_LABEL_COHORT_LIMIT = 24;
export const WIKI_PLACES_LABEL_COLLISION_CAPACITY = 16;
export const WIKI_PLACES_ACCENT = '#7fd8ff';

/**
 * Above this camera height the search circle (10 km at most) would cover a
 * small dot of the view and read as "nothing here", so the layer waits.
 */
export const MAX_SEARCH_ALTITUDE_M = 60_000;
export const MIN_SEARCH_RADIUS_M = 1_000;
export const MAX_SEARCH_RADIUS_M = 10_000;
/** The proxy snaps requests to ~500 m cells; smaller moves are the same query. */
const SAME_QUERY_DEG = 0.005;

/** Wikipedia editions this layer reads, keyed by the app locale. */
const EDITION_BY_LOCALE = Object.freeze({
  en: 'en',
  de: 'de',
  es: 'es',
  fr: 'fr',
  it: 'it',
  ja: 'ja',
  pt: 'pt',
  ru: 'ru',
  uk: 'uk',
  'zh-CN': 'zh',
  'zh-Hant': 'zh',
});

/** The Wikipedia edition for an app locale; English when there is none. */
export function wikipediaLanguage(locale) {
  return EDITION_BY_LOCALE[locale] ?? 'en';
}

/**
 * The search for a view: centred on the ground under the screen centre, with a
 * radius that grows with camera height. Null above the search ceiling or when
 * the centre is not on the globe.
 * @param {{lat:number, lon:number}|null} center - Degrees.
 * @param {number} heightM - Camera height above the ellipsoid.
 * @param {string} lang - Wikipedia edition.
 */
export function viewSearch(center, heightM, lang) {
  if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lon))
    return null;
  if (!Number.isFinite(heightM) || heightM > MAX_SEARCH_ALTITUDE_M) return null;
  return {
    lang,
    latitude: center.lat,
    longitude: center.lon,
    radiusM: Math.round(
      Math.min(
        MAX_SEARCH_RADIUS_M,
        Math.max(MIN_SEARCH_RADIUS_M, Math.max(0, heightM) * 0.7),
      ),
    ),
  };
}

/** Whether two searches would be answered by the same proxy cache entry. */
export function sameSearch(a, b) {
  if (!a || !b) return false;
  return (
    a.lang === b.lang &&
    Math.abs(a.latitude - b.latitude) < SAME_QUERY_DEG &&
    Math.abs(a.longitude - b.longitude) < SAME_QUERY_DEG &&
    Math.abs(a.radiusM - b.radiusM) < 500
  );
}

/**
 * Marker size for a place by its rank in the response (0 = most viewed):
 * the top few read at a glance, the long tail stays small.
 */
export function markerPixelSize(rank) {
  if (rank < 3) return 13;
  if (rank < 10) return 10;
  return 7;
}

/**
 * Break text into lines of at most `width` characters on word boundaries,
 * keeping at most `maxLines` (the last one ends in an ellipsis when cut).
 */
export function wrapText(text, width = 52, maxLines = 4) {
  const words = String(text ?? '')
    .split(/\s+/)
    .filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const piece = word.length > width ? `${word.slice(0, width - 1)}…` : word;
    if (!line) line = piece;
    else if (line.length + 1 + piece.length <= width) line += ` ${piece}`;
    else {
      lines.push(line);
      line = piece;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  else if (line && lines.length === maxLines) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] =
      last.length + 1 <= width ? `${last}…` : `${last.slice(0, width - 1)}…`;
  }
  return lines;
}

/**
 * Ambient label for one place. More-viewed places win the label budget.
 * @param {{pageId:number, title:string}} place
 * @param {number} rank - 0 = most viewed.
 */
export function createPlaceLabelEntry(place, rank) {
  return {
    id: String(place.pageId),
    variant: 'label',
    title: place.title,
    accent: WIKI_PLACES_ACCENT,
    priority: 1_000_000 - rank,
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 12,
    verticalOnly: true,
    placement: 'above',
  };
}

/** JSON-safe places for the analyst query engine. */
export function mapAnalystRecord(place, index) {
  return {
    id: place.pageId,
    index,
    title: place.title,
    description: place.description || null,
    lat: place.lat,
    lon: place.lon,
    pageViews30d: place.views,
    wikidataId: place.wikidataId || null,
  };
}
