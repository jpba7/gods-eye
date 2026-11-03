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
});

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
    this._tilesetSse = new Map();
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
    this._saved = {
      msaaSamples: scene.msaaSamples,
      fxaa: fxaa ? fxaa.enabled : undefined,
    };
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
      if (this._tilesetSse.has(tileset)) continue;
      this._tilesetSse.set(tileset, tileset.maximumScreenSpaceError);
      tileset.maximumScreenSpaceError = Math.max(
        tileset.maximumScreenSpaceError,
        PERFORMANCE_PROFILE.maximumScreenSpaceError,
      );
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
    }
    this._saved = null;
    for (const [tileset, sse] of this._tilesetSse) {
      if (!tileset.isDestroyed?.()) tileset.maximumScreenSpaceError = sse;
    }
    this._tilesetSse.clear();
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
