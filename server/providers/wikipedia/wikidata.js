// Read a few well-known facts from one Wikidata entity's claims. Wikidata is
// CC0, so these values need no attribution, but they are community-edited and
// may be missing, outdated or wrong; callers present them as such.

const ENTITY_PREFIX = 'http://www.wikidata.org/entity/';

/** Population. Quantity, usually several rows qualified by a point in time. */
const POPULATION = 'P1082';
/** Elevation above sea level. Quantity with a length unit. */
const ELEVATION = 'P2044';
/** Area. Quantity with an area unit. */
const AREA = 'P2046';
/** Inception (founding, construction or creation date). Time. */
const INCEPTION = 'P571';
/** Heritage designation. Item. */
const HERITAGE = 'P1435';
/** Point in time, the qualifier that dates a population count. */
const POINT_IN_TIME = 'P585';
/** UNESCO World Heritage Site. */
const WORLD_HERITAGE_SITE = 'Q9259';

/** Length units a summit or city elevation is published in, in metres. */
const LENGTH_TO_M = Object.freeze({
  Q11573: 1, // metre
  Q3710: 0.3048, // foot
  Q828224: 1000, // kilometre
});

/** Area units, in square kilometres. */
const AREA_TO_KM2 = Object.freeze({
  Q712226: 1, // square kilometre
  Q25343: 1e-6, // square metre
  Q35852: 0.01, // hectare
  Q232291: 2.589988110336, // square mile
  Q81292: 0.0040468564224, // acre
});

/** Wikidata item ids look like Q123; anything else never reaches the upstream. */
export function validWikidataId(value) {
  const id = String(value ?? '').trim();
  return /^Q[1-9][0-9]{0,11}$/.test(id) ? id : null;
}

function unitId(unit) {
  const text = String(unit ?? '');
  return text.startsWith(ENTITY_PREFIX) ? text.slice(ENTITY_PREFIX.length) : '';
}

/** Claims that still stand: preferred ones when any exist, else normal ones. */
function standingClaims(claims, property) {
  const rows = Array.isArray(claims?.[property]) ? claims[property] : [];
  const usable = rows.filter(
    (claim) =>
      claim?.rank !== 'deprecated' && claim?.mainsnak?.snaktype === 'value',
  );
  const preferred = usable.filter((claim) => claim.rank === 'preferred');
  return preferred.length ? preferred : usable;
}

/**
 * The year of a Wikidata time value, or null. Precision below "year" (decade,
 * century, millennium) is still reported as a year; BCE years are negative.
 */
export function wikidataYear(value) {
  const match = /^([+-])0*([0-9]{1,11})-/.exec(String(value?.time ?? ''));
  if (!match) return null;
  const year = Number(match[2]) * (match[1] === '-' ? -1 : 1);
  return Number.isSafeInteger(year) && year !== 0 ? year : null;
}

function quantity(claim, conversions) {
  const value = claim?.mainsnak?.datavalue?.value;
  const amount = Number(value?.amount);
  if (!Number.isFinite(amount)) return null;
  const unit = unitId(value?.unit);
  if (!conversions) return unit === '' || unit === '1' ? amount : null;
  const factor = conversions[unit];
  return Number.isFinite(factor) ? amount * factor : null;
}

function claimYear(claim, qualifier) {
  const rows = claim?.qualifiers?.[qualifier];
  if (!Array.isArray(rows)) return null;
  for (const row of rows) {
    const year = wikidataYear(row?.datavalue?.value);
    if (year !== null) return year;
  }
  return null;
}

function population(claims) {
  let best = null;
  for (const claim of standingClaims(claims, POPULATION)) {
    const value = quantity(claim, null);
    if (value === null || value < 0) continue;
    const year = claimYear(claim, POINT_IN_TIME);
    // The newest dated count wins; an undated one only fills an empty slot.
    if (!best || (year !== null && (best.year === null || year > best.year)))
      best = { value: Math.round(value), year };
  }
  return best;
}

function firstQuantity(claims, property, conversions) {
  for (const claim of standingClaims(claims, property)) {
    const value = quantity(claim, conversions);
    if (value !== null) return value;
  }
  return null;
}

function earliestYear(claims, property) {
  let earliest = null;
  for (const claim of standingClaims(claims, property)) {
    const year = wikidataYear(claim?.mainsnak?.datavalue?.value);
    if (year !== null && (earliest === null || year < earliest))
      earliest = year;
  }
  return earliest;
}

function hasItem(claims, property, itemId) {
  return standingClaims(claims, property).some(
    (claim) => claim?.mainsnak?.datavalue?.value?.id === itemId,
  );
}

/**
 * Extract the facts a place card shows from a `wbgetentities` entity. Every
 * field is null (or false) when Wikidata has no usable statement for it.
 * @param {object} entity - One entry of `wbgetentities` `entities`.
 * @returns {{population: ?{value:number, year:?number}, elevationM: ?number,
 *   areaKm2: ?number, inceptionYear: ?number, worldHeritage: boolean}}
 */
export function extractPlaceFacts(entity) {
  const claims =
    entity?.claims && typeof entity.claims === 'object' ? entity.claims : {};
  const elevation = firstQuantity(claims, ELEVATION, LENGTH_TO_M);
  const area = firstQuantity(claims, AREA, AREA_TO_KM2);
  return {
    population: population(claims),
    elevationM: elevation === null ? null : Math.round(elevation),
    areaKm2: area === null || area <= 0 ? null : Number(area.toPrecision(4)),
    inceptionYear: earliestYear(claims, INCEPTION),
    worldHeritage: hasItem(claims, HERITAGE, WORLD_HERITAGE_SITE),
  };
}

/** The Wikidata API request for one entity's claims. */
export function wikidataEntityUrl(id) {
  const url = new URL('https://www.wikidata.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'wbgetentities',
    format: 'json',
    ids: id,
    props: 'claims',
  }).toString();
  return url.href;
}
