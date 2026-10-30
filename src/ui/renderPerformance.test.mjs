import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RenderPerformance,
  PERFORMANCE_PROFILE,
  collectTilesets,
} from './renderPerformance.js';

function collection(items) {
  return { length: items.length, get: (i) => items[i] };
}

function tileset(sse = 16) {
  return { maximumScreenSpaceError: sse, tileLoad: {}, isDestroyed: () => false };
}

function makeViewer(items) {
  const listeners = new Set();
  const scene = {
    msaaSamples: 4,
    postProcessStages: { fxaa: { enabled: false } },
    primitives: collection(items),
    renders: 0,
    requestRender() {
      this.renders++;
    },
    preUpdate: {
      addEventListener(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    },
  };
  return { scene, listeners };
}

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => (data[k] = v),
  };
}

test('collectTilesets finds tilesets inside nested collections', () => {
  const a = tileset();
  const b = tileset();
  const found = collectTilesets(collection([a, { foo: 1 }, collection([b])]));
  assert.deepEqual(found, [a, b]);
});

test('performance mode lowers MSAA and tile detail, quality restores them', () => {
  const google = tileset(16);
  const viewer = makeViewer([google]);
  const storage = memoryStorage();
  const perf = new RenderPerformance({ viewer, storage });
  assert.equal(perf.enabled, false);

  perf.setEnabled(true);
  assert.equal(viewer.scene.msaaSamples, PERFORMANCE_PROFILE.msaaSamples);
  assert.equal(viewer.scene.postProcessStages.fxaa.enabled, true);
  assert.equal(google.maximumScreenSpaceError, 32);
  assert.equal(storage.data['gev:render-performance:v1'], 'on');
  assert.equal(viewer.listeners.size, 1);

  perf.setEnabled(false);
  assert.equal(viewer.scene.msaaSamples, 4);
  assert.equal(viewer.scene.postProcessStages.fxaa.enabled, false);
  assert.equal(google.maximumScreenSpaceError, 16);
  assert.equal(storage.data['gev:render-performance:v1'], 'off');
  assert.equal(viewer.listeners.size, 0);
});

test('a stored choice is applied at startup and late tilesets are picked up', () => {
  const items = [];
  const viewer = makeViewer(items);
  const perf = new RenderPerformance({
    viewer,
    storage: memoryStorage({ 'gev:render-performance:v1': 'on' }),
  });
  assert.equal(perf.enabled, true);

  const late = tileset(16);
  items.push(late);
  viewer.scene.primitives = collection(items);
  const [scan] = viewer.listeners;
  for (let i = 0; i < 60; i++) scan();
  assert.equal(late.maximumScreenSpaceError, 32);
});

test('a tileset already coarser than the profile keeps its value', () => {
  const coarse = tileset(64);
  const perf = new RenderPerformance({
    viewer: makeViewer([coarse]),
    storage: memoryStorage(),
  });
  perf.setEnabled(true);
  assert.equal(coarse.maximumScreenSpaceError, 64);
});
