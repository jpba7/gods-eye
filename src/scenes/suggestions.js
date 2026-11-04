/**
 * Suggested scenes: a curated set of places that look good in Photorealistic
 * 3D Tiles, grouped by theme. Each place is authored as what the camera looks
 * at (a target point, with its height above the WGS84 ellipsoid) plus the
 * heading, pitch and distance of the view, and resolves to an ordinary scene
 * camera pose, so a place can fly, be saved as a shot or play as a tour
 * through the scene director without a mechanism of its own.
 *
 * Places that are already preset landmarks in src/cityPois.js reuse those
 * coordinates, heights and default framing instead of repeating them.
 *
 * Pure data and math: imports only i18n markers and the preset cities.
 * @module scenes/suggestions
 */
import { CITY_POIS } from '../cityPois.js';
import { msg } from '../i18n/index.js';

/** Flight to a place when it is opened, and its timing as a tour shot. */
export const SUGGESTION_FLIGHT_SEC = 3.5;
export const SUGGESTION_TOUR_SHOT_SEC = 5;
export const SUGGESTION_TOUR_HOLD_SEC = 3;
/** Scene id prefix for a theme's tour once it is added to the project. */
export const SUGGESTION_TOUR_SCENE_PREFIX = 'suggested-tour-';

const place = (id, name, blurb, view) =>
  Object.freeze({ id, name, blurb, ...view });

// Heights are ellipsoidal metres of the point the camera looks at (ground
// plus about half the landmark), not of the camera.
const THEMES = [
  {
    id: 'brazil',
    label: msg('Brazil'),
    places: [
      place(
        'christ-the-redeemer',
        msg('Christ the Redeemer'),
        msg('The statue on Corcovado, looking out over the bay to Sugarloaf.'),
        {
          target: { lat: -22.95192, lon: -43.21049, height: 724 },
          heading: 85,
          pitch: -18,
          range: 900,
        },
      ),
      place(
        'sugarloaf',
        msg('Sugarloaf Mountain'),
        msg(
          'Granite peak at the mouth of Guanabara Bay, seen across Botafogo.',
        ),
        {
          target: { lat: -22.9487, lon: -43.1566, height: 194 },
          heading: 125,
          pitch: -22,
          range: 2600,
        },
      ),
      place(
        'copacabana',
        msg('Copacabana'),
        msg('The long curve of beach from the fort to Leme.'),
        {
          target: { lat: -22.975, lon: -43.18, height: 0 },
          heading: 40,
          pitch: -28,
          range: 3200,
        },
      ),
      place(
        'iguacu-falls',
        msg('Iguaçu Falls'),
        msg("The Devil's Throat, where the river drops into a narrow gorge."),
        {
          target: { lat: -25.6935, lon: -54.4355, height: 170 },
          heading: 240,
          pitch: -30,
          range: 1500,
        },
      ),
      place(
        'avenida-paulista',
        msg('Avenida Paulista'),
        msg("São Paulo's main avenue along the ridge, lined with towers."),
        {
          target: { lat: -23.5614, lon: -46.6559, height: 865 },
          heading: 305,
          pitch: -22,
          range: 1600,
        },
      ),
      place(
        'national-congress',
        msg('National Congress, Brasília'),
        msg("Niemeyer's twin towers and domes at the head of the Esplanade."),
        {
          target: { lat: -15.7998, lon: -47.8641, height: 1086 },
          heading: 285,
          pitch: -20,
          range: 1400,
        },
      ),
    ],
  },
  {
    id: 'cities',
    label: msg('Cities'),
    places: [
      place(
        'midtown-manhattan',
        msg('Midtown Manhattan'),
        msg(
          'The Empire State Building and the grid running up to Central Park.',
        ),
        {
          landmark: ['nyc', 'Empire State Building'],
          heading: 25,
          pitch: -22,
          range: 2600,
        },
      ),
      place(
        'burj-khalifa',
        msg('Burj Khalifa'),
        msg("The world's tallest building, rising over downtown Dubai."),
        { landmark: ['dubai', 'Burj Khalifa'], pitch: -8, range: 2200 },
      ),
      place(
        'victoria-harbour',
        msg('Victoria Harbour'),
        msg("Hong Kong's towers packed between the Peak and the harbour."),
        {
          target: { lat: 22.2855, lon: 114.1577, height: 80 },
          heading: 0,
          pitch: -16,
          range: 2200,
        },
      ),
      place(
        'marina-bay',
        msg('Marina Bay'),
        msg('Marina Bay Sands and its rooftop deck, across the water.'),
        {
          target: { lat: 1.2834, lon: 103.8607, height: 117 },
          heading: 110,
          pitch: -18,
          range: 1600,
        },
      ),
      place(
        'eiffel-tower',
        msg('Eiffel Tower'),
        msg(
          'The tower from the Trocadéro side, with the Champ de Mars beyond.',
        ),
        {
          landmark: ['paris', 'Eiffel Tower'],
          heading: 135,
          pitch: -18,
          range: 1300,
        },
      ),
    ],
  },
  {
    id: 'nature',
    label: msg('Nature'),
    places: [
      place(
        'grand-canyon',
        msg('Grand Canyon'),
        msg('Layered cliffs more than a kilometre deep, from the South Rim.'),
        {
          target: { lat: 36.09, lon: -112.115, height: 1300 },
          heading: 10,
          pitch: -15,
          range: 4500,
        },
      ),
      place(
        'matterhorn',
        msg('Matterhorn'),
        msg('The pyramid-shaped Alpine peak above Zermatt.'),
        {
          target: { lat: 45.9763, lon: 7.6586, height: 4100 },
          heading: 235,
          pitch: -5,
          range: 4500,
        },
      ),
      place(
        'half-dome',
        msg('Half Dome, Yosemite'),
        msg('A sheer granite face looming over Yosemite Valley.'),
        {
          target: { lat: 37.7459, lon: -119.5332, height: 2300 },
          heading: 65,
          pitch: -10,
          range: 4000,
        },
      ),
      place(
        'mount-fuji',
        msg('Mount Fuji'),
        msg("Japan's volcanic cone, seen from the lakes to the north."),
        {
          target: { lat: 35.3606, lon: 138.7274, height: 3000 },
          heading: 180,
          pitch: -8,
          range: 16000,
        },
      ),
      place(
        'table-mountain',
        msg('Table Mountain'),
        msg('The flat-topped massif behind Cape Town and its harbour.'),
        {
          target: { lat: -33.9628, lon: 18.4098, height: 1090 },
          heading: 175,
          pitch: -18,
          range: 7000,
        },
      ),
    ],
  },
  {
    id: 'monuments',
    label: msg('Monuments'),
    places: [
      place(
        'colosseum',
        msg('Colosseum'),
        msg("Rome's great amphitheatre, with the Forum next door."),
        {
          target: { lat: 41.8902, lon: 12.4922, height: 100 },
          heading: 60,
          pitch: -28,
          range: 600,
        },
      ),
      place(
        'pyramids-of-giza',
        msg('Pyramids of Giza'),
        msg('The three great pyramids lined up on the edge of the desert.'),
        {
          target: { lat: 29.976, lon: 31.1311, height: 163 },
          heading: 40,
          pitch: -15,
          range: 2500,
        },
      ),
      place(
        'taj-mahal',
        msg('Taj Mahal'),
        msg('The white marble mausoleum at the end of its gardens.'),
        {
          target: { lat: 27.1751, lon: 78.0421, height: 145 },
          heading: 0,
          pitch: -15,
          range: 800,
        },
      ),
      place(
        'machu-picchu',
        msg('Machu Picchu'),
        msg('The Inca citadel on its ridge, with Huayna Picchu behind.'),
        {
          target: { lat: -13.1631, lon: -72.545, height: 2470 },
          heading: 320,
          pitch: -28,
          range: 1100,
        },
      ),
      place(
        'sagrada-familia',
        msg('Sagrada Família'),
        msg("Gaudí's basilica and its cluster of spires in Barcelona."),
        {
          target: { lat: 41.4036, lon: 2.1744, height: 172 },
          heading: 225,
          pitch: -22,
          range: 700,
        },
      ),
    ],
  },
  {
    id: 'curiosities',
    label: msg('Curiosities'),
    places: [
      place(
        'aircraft-boneyard',
        msg('Aircraft boneyard'),
        msg(
          'Thousands of retired planes parked in rows in the Arizona desert.',
        ),
        {
          target: { lat: 32.15, lon: -110.836, height: 822 },
          heading: 120,
          pitch: -40,
          range: 2500,
        },
      ),
      place(
        'palm-jumeirah',
        msg('Palm Jumeirah'),
        msg('An artificial island in the shape of a palm tree, off Dubai.'),
        { landmark: ['dubai', 'Palm Jumeirah'], pitch: -45, range: 14000 },
      ),
      place(
        'mont-saint-michel',
        msg('Mont-Saint-Michel'),
        msg('A walled abbey on a tidal island off the coast of Normandy.'),
        {
          target: { lat: 48.6361, lon: -1.5115, height: 130 },
          heading: 0,
          pitch: -15,
          range: 1500,
        },
      ),
      place(
        'bingham-canyon',
        msg('Bingham Canyon Mine'),
        msg('One of the largest open-pit mines on Earth, near Salt Lake City.'),
        {
          target: { lat: 40.523, lon: -112.15, height: 1700 },
          heading: 270,
          pitch: -30,
          range: 5000,
        },
      ),
    ],
  },
];

/** The suggestion themes, in display order. */
export const SCENE_SUGGESTION_THEMES = Object.freeze(
  THEMES.map((theme) =>
    Object.freeze({ ...theme, places: Object.freeze(theme.places) }),
  ),
);

/**
 * The point a suggestion looks at, with its default framing. Preset landmarks
 * read src/cityPois.js; their own range, heading and pitch apply unless the
 * suggestion overrides them.
 * @param {object} suggestion
 * @param {Record<string, any>} [cities]
 */
export function suggestionTarget(suggestion, cities = CITY_POIS) {
  if (!suggestion?.landmark) return suggestion;
  const [cityId, poiName] = suggestion.landmark;
  const city = cities[cityId];
  const poi = city?.pois.find((item) => item.name === poiName);
  if (!poi) throw new Error(`Unknown landmark: ${cityId}/${poiName}`);
  return {
    target: {
      lat: poi.lat,
      lon: poi.lon,
      height: (city.groundElevation || 0) + (poi.buildingHeight || 30),
    },
    heading: suggestion.heading ?? poi.heading ?? 0,
    pitch: suggestion.pitch ?? poi.pitch ?? -30,
    range: suggestion.range ?? poi.alt,
  };
}

/**
 * The scene camera pose (degrees, ellipsoidal metres) that looks at the
 * suggestion's target from its heading, pitch and range. Uses a local
 * tangent plane, which is exact enough for views a few kilometres across.
 * @param {object} suggestion
 * @returns {{lat: number, lon: number, alt: number, heading: number, pitch: number, roll: number}}
 */
export function suggestionCamera(suggestion) {
  const { target, heading, pitch, range } = suggestionTarget(suggestion);
  const radians = Math.PI / 180;
  const down = Math.abs(pitch) * radians;
  const across = range * Math.cos(down);
  const back = (heading + 180) * radians;
  const latitude = target.lat * radians;
  // Metres per degree on WGS84 at this latitude.
  const metersPerLat =
    111132.954 -
    559.822 * Math.cos(2 * latitude) +
    1.175 * Math.cos(4 * latitude);
  const metersPerLon =
    111412.84 * Math.cos(latitude) - 93.5 * Math.cos(3 * latitude);
  const round = (value, digits) => Number(value.toFixed(digits));
  return {
    lat: round(target.lat + (across * Math.cos(back)) / metersPerLat, 6),
    lon: round(target.lon + (across * Math.sin(back)) / metersPerLon, 6),
    alt: Math.round(target.height + range * Math.sin(down)),
    heading,
    pitch,
    roll: 0,
  };
}

/** @returns {object|null} The suggestion with this id. */
export function findSuggestion(id) {
  for (const theme of SCENE_SUGGESTION_THEMES)
    for (const item of theme.places) if (item.id === id) return item;
  return null;
}

/** @returns {object|null} The theme with this id. */
export function findSuggestionTheme(id) {
  return SCENE_SUGGESTION_THEMES.find((theme) => theme.id === id) || null;
}

/**
 * A raw shot (for normalizeShot) showing one suggestion.
 * @param {object} suggestion
 * @param {{title: string, visual?: object, durationSec?: number, holdSec?: number}} options
 */
export function suggestionShot(
  suggestion,
  {
    title,
    visual,
    durationSec = SUGGESTION_TOUR_SHOT_SEC,
    holdSec = SUGGESTION_TOUR_HOLD_SEC,
  },
) {
  return {
    title,
    durationSec,
    holdSec,
    camera: suggestionCamera(suggestion),
    ...(visual ? { visual } : {}),
    // Sparse on purpose: a suggestion never turns the viewer's layers on or off.
    layers: {},
  };
}
