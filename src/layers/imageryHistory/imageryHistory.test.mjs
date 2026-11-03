import assert from 'node:assert/strict';
import test from 'node:test';
import { createImageryHistoryLayer } from './index.js';
import { pickYear, waybackTileTemplate, yearlyReleases } from './model.js';
import { createWaybackSource } from './source.js';

const RELEASES = [
  { id: 10, date: '2014-02-20' },
  { id: 20, date: '2014-12-10' },
  { id: 30, date: '2019-06-01' },
  { id: 40, date: '2026-10-29' },
];

const fakeCesium = {
  SplitDirection: { LEFT: -1, NONE: 0, RIGHT: 1 },
  WebMercatorTilingScheme: class {},
  UrlTemplateImageryProvider: class {
    constructor(options) {
      this.options = options;
    }
    requestImage() {
      return Promise.resolve('tile');
    }
  },
};

function harness({ releases = RELEASES, kind = 'globe', lease = 'ok' } = {}) {
  const collection = {
    layers: [],
    addImageryProvider(provider) {
      const layer = { provider, splitDirection: 0 };
      this.layers.push(layer);
      return layer;
    },
    remove(layer) {
      this.layers = this.layers.filter((entry) => entry !== layer);
    },
  };
  const splits = [];
  const leases = [];
  const renders = [];
  let mapListener = null;
  let hostKind = kind;
  const layer = createImageryHistoryLayer({
    cesium: fakeCesium,
    source: {
      credit: 'Esri',
      getReleases: async () => ({ releases }),
      tileTemplate: waybackTileTemplate,
    },
    host: () =>
      hostKind === 'none'
        ? { collection: null, kind: 'none' }
        : { collection, kind: hostKind },
    requestRender: (reason) => renders.push(reason),
    createSplit: (options) => {
      const split = {
        options,
        destroyed: false,
        getValue: () => 0.3,
        destroy() {
          this.destroyed = true;
        },
      };
      splits.push(split);
      return split;
    },
  });
  layer.attachMapStackController({
    subscribe: (fn) => {
      mapListener = fn;
      return () => {
        mapListener = null;
      };
    },
    acquireImageryComparison: (options) => {
      if (lease === 'busy') throw new Error('held');
      const record = {
        options,
        released: false,
        ready: Promise.resolve({ status: 'ready' }),
        release() {
          this.released = true;
        },
      };
      leases.push(record);
      return record;
    },
  });
  layer.init({ scene: {} });
  return {
    layer,
    collection,
    splits,
    leases,
    renders,
    setHost: (next) => {
      hostKind = next;
      mapListener?.();
    },
    chip: (id) => layer.getRowControls().chips.find((chip) => chip.id === id),
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('one release per year: the last one published that year', () => {
  assert.deepEqual(yearlyReleases(RELEASES), [
    { year: 2014, id: 20, date: '2014-12-10' },
    { year: 2019, id: 30, date: '2019-06-01' },
    { year: 2026, id: 40, date: '2026-10-29' },
  ]);
  assert.deepEqual(yearlyReleases([{ id: 'x', date: '2014-01-01' }, null]), []);
  const years = yearlyReleases(RELEASES);
  assert.equal(pickYear(years, 2019), 2019);
  assert.equal(pickYear(years, 2015), 2014);
  assert.equal(pickYear([], 2019), null);
});

test('the tile template is Esri’s Wayback path in Cesium’s placeholders', () => {
  assert.equal(
    waybackTileTemplate(40),
    'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/40/{z}/{y}/{x}',
  );
  assert.throws(() => waybackTileTemplate('../x'), TypeError);
});

test('enabling drapes the oldest year and swipes it against today', async () => {
  const h = harness();
  await h.layer.enable();
  await settle();
  assert.equal(h.leases.length, 1);
  assert.equal(h.leases[0].options.switchPolicy, 'esri-if-photoreal');
  assert.equal(h.collection.layers.length, 1);
  const draped = h.collection.layers[0];
  assert.match(draped.provider.options.url, /\/tile\/20\/\{z\}/);
  assert.equal(draped.splitDirection, fakeCesium.SplitDirection.LEFT);
  assert.equal(h.splits.length, 1);
  assert.equal(h.splits[0].options.beforeLabel, '2014');
  assert.equal(h.layer.getStats().countLabel, '2014');
  assert.equal(h.chip('year-2014').active, true);
  assert.equal(h.chip('swipe').active, true);
  // Every landed tile asks the on-demand scene for a frame.
  await draped.provider.requestImage(0, 0, 0);
  assert.ok(h.renders.includes('imagery-history'));
});

test('a year chip swaps the imagery and the swipe chip turns it off', async () => {
  const h = harness();
  await h.layer.enable();
  h.chip('year-2019').onClick();
  assert.equal(h.collection.layers.length, 1);
  assert.match(h.collection.layers[0].provider.options.url, /\/tile\/30\//);
  assert.equal(h.splits[0].destroyed, true);
  assert.equal(h.splits.at(-1).options.beforeLabel, '2019');
  assert.equal(h.splits.at(-1).options.initialValue, 0.3);

  h.chip('swipe').onClick();
  assert.equal(h.collection.layers[0].splitDirection, 0);
  assert.equal(h.splits.at(-1).destroyed, true);
  assert.equal(h.chip('swipe').active, false);
});

test('without a globe the layer says why, and returns when the map does', async () => {
  const h = harness({ kind: 'none' });
  await h.layer.enable();
  assert.equal(h.collection.layers.length, 0);
  assert.match(h.layer.getStats().statusMessage, /globe map/);
  h.setHost('globe');
  assert.equal(h.collection.layers.length, 1);
  assert.equal(h.layer.getStats().statusMessage, undefined);
});

test('a map held by another comparison drapes without the swipe', async () => {
  const h = harness({ lease: 'busy' });
  await h.layer.enable();
  assert.equal(h.collection.layers.length, 1);
  assert.equal(h.collection.layers[0].splitDirection, 0);
  assert.equal(h.splits.length, 0);
  assert.equal(h.chip('swipe').disabled, true);
});

test('disable removes the imagery, the divider and the map lease', async () => {
  const h = harness();
  await h.layer.enable();
  h.layer.disable();
  await settle();
  assert.equal(h.collection.layers.length, 0);
  assert.equal(h.splits[0].destroyed, true);
  assert.equal(h.leases[0].released, true);
  // The list is kept: turning it back on drapes at once, same year.
  await h.layer.enable();
  assert.equal(h.collection.layers.length, 1);
  assert.equal(h.leases.length, 2);
});

test('a failed release list is reported and retried on the next enable', async () => {
  let fail = true;
  const layer = createImageryHistoryLayer({
    cesium: fakeCesium,
    source: {
      getReleases: async () => {
        if (fail) throw new Error('Wayback HTTP 503');
        return { releases: RELEASES };
      },
      tileTemplate: waybackTileTemplate,
    },
    host: () => ({ collection: null, kind: 'none' }),
  });
  layer.init({ scene: {} });
  assert.equal(await layer.enable(), false);
  assert.equal(layer.getStats().error, 'Wayback HTTP 503');
  layer.disable();
  fail = false;
  assert.equal(await layer.enable(), true);
  assert.equal(layer.getStats().error, null);
});

test('the browser source reads the local proxy', async () => {
  const urls = [];
  const source = createWaybackSource({
    fetchImpl: async (url) => {
      urls.push(url);
      return new Response(JSON.stringify({ releases: RELEASES }));
    },
  });
  assert.equal((await source.getReleases()).releases.length, 4);
  assert.deepEqual(urls, ['/api/wayback/releases']);
  const broken = createWaybackSource({
    fetchImpl: async () => new Response('{}'),
  });
  await assert.rejects(broken.getReleases(), /Malformed/);
});
