/**
 * renderPerformance.js — the PERFORMANCE toggle of the display controls.
 *
 * Dense 3D tiles (Google Photorealistic above all) are the heaviest thing the
 * app draws. Performance mode trades a little sharpness for frame rate:
 *
 * - **MSAA 4x → off, FXAA on.** Multisample anti-aliasing multiplies the cost
 *   of every fragment of a dense mesh; FXAA is one cheap full-screen pass that
 *   looks almost the same on photo textures.
 * - **3D tile detail.** `maximumScreenSpaceError` 16 → 32 on every 3D tileset,
 *   so far fewer (and coarser) tiles are requested, decoded and drawn. Tilesets
 *   added later (map source switch) are picked up on the next frames.
 * - **3D tile cache 1.5 GB + 1 GB overflow → 512 MB + 512 MB.** Google's
 *   defaults may hold 2.5 GB of tiles, too much for a 4–6 GB laptop GPU that
 *   also drives the browser; memory pressure there stalls every frame.
 * - **CSS pixels.** The globe already renders at CSS pixels by default;
 *   performance mode keeps it there even if something raised the resolution.
 *
 * The choice is remembered on this device. Quality mode restores each value
 * exactly as it was.
 */

const STORAGE_KEY = 'gev:render-performance:v1';
/** Frames between scans for tilesets added while performance mode is on. */
const TILESET_SCAN_INTERVAL = 60;

export const PERFORMANCE_PROFILE = Object.freeze({
  msaaSamples: 1,
  fxaa: true,
  maximumScreenSpaceError: 32,
  cacheBytes: 512 * 1024 * 1024,
  maximumCacheOverflowBytes: 512 * 1024 * 1024,
});

const TILESET_PROFILE_KEYS = Object.freeze([
  'maximumScreenSpaceError',
  'cacheBytes',
  'maximumCacheOverflowBytes',
]);

function isTileset(primitive) {
  return (
    primitive &&
    typeof primitive.maximumScreenSpaceError === 'number' &&
    primitive.tileLoad !== undefined
  );
}

/** Every 3D tileset in the scene, including nested primitive collections. */
export function collectTilesets(collection, out = []) {
  if (!collection || typeof collection.get !== 'function') return out;
  for (let i = 0; i < collection.length; i++) {
    const primitive = collection.get(i);
    if (isTileset(primitive)) out.push(primitive);
    else if (primitive && typeof primitive.get === 'function')
      collectTilesets(primitive, out);
  }
  return out;
}

function readStored(storage) {
  try {
    return storage?.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false; // unavailable storage
  }
}

function writeStored(storage, enabled) {
  try {
    storage?.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    /* unavailable storage */
  }
}

export class RenderPerformance {
  /**
   * @param {object} options
   * @param {object} options.viewer - Cesium viewer.
   * @param {HTMLElement|null} [options.button] - Toggle button, optional.
   * @param {Storage|null} [options.storage] - Where the choice is remembered.
   */
  constructor({ viewer, button = null, storage = globalThis.localStorage }) {
    this.viewer = viewer;
    this.button = button;
    this.storage = storage;
    this.enabled = false;
    this._saved = null;
    this._tilesetSaved = new Map();
    this._frames = 0;
    this._removePreUpdate = null;
    this._onClick = () => this.setEnabled(!this.enabled);
    button?.addEventListener('click', this._onClick);
    this.setEnabled(readStored(storage), { persist: false });
  }

  setEnabled(enabled, { persist = true } = {}) {
    enabled = Boolean(enabled);
    const scene = this.viewer?.scene;
    if (scene && enabled !== this.enabled) {
      if (enabled) this._apply(scene);
      else this._restore(scene);
      scene.requestRender?.();
    }
    this.enabled = enabled;
    if (persist) writeStored(this.storage, enabled);
    this._syncButton();
    return this.enabled;
  }

  _apply(scene) {
    const fxaa = scene.postProcessStages?.fxaa;
    const viewer = this.viewer;
    this._saved = {
      msaaSamples: scene.msaaSamples,
      fxaa: fxaa ? fxaa.enabled : undefined,
      resolution:
        typeof viewer?.useBrowserRecommendedResolution === 'boolean'
          ? {
              useBrowserRecommendedResolution:
                viewer.useBrowserRecommendedResolution,
              resolutionScale: viewer.resolutionScale,
            }
          : null,
    };
    if (this._saved.resolution) {
      viewer.useBrowserRecommendedResolution = true;
      viewer.resolutionScale = 1;
    }
    scene.msaaSamples = PERFORMANCE_PROFILE.msaaSamples;
    if (fxaa) fxaa.enabled = PERFORMANCE_PROFILE.fxaa;
    this._scanTilesets(scene);
    this._removePreUpdate = scene.preUpdate?.addEventListener(() => {
      if (++this._frames % TILESET_SCAN_INTERVAL === 0)
        this._scanTilesets(scene);
    });
  }

  _scanTilesets(scene) {
    for (const tileset of collectTilesets(scene.primitives)) {
      if (this._tilesetSaved.has(tileset)) continue;
      const saved = {};
      for (const key of TILESET_PROFILE_KEYS)
        if (typeof tileset[key] === 'number') saved[key] = tileset[key];
      this._tilesetSaved.set(tileset, saved);
      tileset.maximumScreenSpaceError = Math.max(
        tileset.maximumScreenSpaceError,
        PERFORMANCE_PROFILE.maximumScreenSpaceError,
      );
      // The cache only ever shrinks here: a smaller one stays as it was.
      for (const key of ['cacheBytes', 'maximumCacheOverflowBytes'])
        if (typeof tileset[key] === 'number')
          tileset[key] = Math.min(tileset[key], PERFORMANCE_PROFILE[key]);
    }
  }

  _restore(scene) {
    this._removePreUpdate?.();
    this._removePreUpdate = null;
    if (this._saved) {
      scene.msaaSamples = this._saved.msaaSamples;
      const fxaa = scene.postProcessStages?.fxaa;
      if (fxaa && this._saved.fxaa !== undefined)
        fxaa.enabled = this._saved.fxaa;
      if (this._saved.resolution)
        Object.assign(this.viewer, this._saved.resolution);
    }
    this._saved = null;
    for (const [tileset, saved] of this._tilesetSaved) {
      if (!tileset.isDestroyed?.()) Object.assign(tileset, saved);
    }
    this._tilesetSaved.clear();
  }

  _syncButton() {
    if (!this.button) return;
    this.button.classList.toggle('active', this.enabled);
    this.button.setAttribute('aria-pressed', String(this.enabled));
  }

  destroy() {
    this.button?.removeEventListener('click', this._onClick);
    this._removePreUpdate?.();
    this._removePreUpdate = null;
  }
}
