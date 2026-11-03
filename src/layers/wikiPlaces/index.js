import * as Cesium from 'cesium';
import { getLocale, msg } from '../../i18n/index.js';
import {
  WIKI_PLACES_ACCENT,
  WIKI_PLACES_CARD_SOURCE_ID,
  WIKI_PLACES_LABEL_COHORT_LIMIT,
  WIKI_PLACES_LABEL_COLLISION_CAPACITY,
  WIKI_PLACES_LABEL_SOURCE_ID,
  WIKI_PLACES_LAYER_ID,
  WIKI_PLACES_PICK_PREFIX,
  createPlaceLabelEntry,
  mapAnalystRecord,
  markerPixelSize,
  sameSearch,
  viewSearch,
  wikipediaLanguage,
} from './model.js';
import { buildPlaceCard } from './cards.js';
export * from './model.js';
export * from './cards.js';
export { createWikipediaPlacesSource } from './source.js';

/** Quiet time after the camera stops before the view is searched. */
const SETTLE_MS = 600;
const LABEL_HOST_OPTIONS = Object.freeze({
  cohortLimit: WIKI_PLACES_LABEL_COHORT_LIMIT,
  collisionCapacity: WIKI_PLACES_LABEL_COLLISION_CAPACITY,
  moving: false,
});
const CARD_HOST_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});

/**
 * Own the Notable places display: geotagged Wikipedia articles around the
 * view, ranked by recent page views, and a card with the selected article's
 * intro and Wikidata facts. Camera-driven: it searches when the view settles.
 */
export function createWikiPlacesLayer({
  source,
  overlayHost,
  screenSpaceEventHandlerFactory = null,
  picking = null,
  pointer = null,
  openExternal = null,
  locale = getLocale,
  setTimer = (callback, ms) => setTimeout(callback, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  if (
    typeof source?.getNearby !== 'function' ||
    typeof source?.getSummary !== 'function'
  )
    throw new TypeError('Notable places require a Wikipedia source');
  if (!overlayHost)
    throw new TypeError('Notable places require an overlay host');

  let _viewer = null;
  let _dataSource = null;
  let _enabled = false;
  let _request = null;
  let _summaryRequest = null;
  let _settleTimer = null;
  let _clickHandler = null;
  let _lastSearch = null;
  /** @type {Array<object>} */
  let _places = [];
  const _placeById = new Map();
  let _selectedId = null;
  let _selectedSummary = null;
  let _selectedFailed = false;
  let _lastUpdate = null;
  let _lastError = null;
  let _waiting = false;

  const language = () => wikipediaLanguage(locale());

  /** Ground point under the screen centre, in degrees, or null off-globe. */
  function viewCenter() {
    const scene = _viewer?.scene;
    const canvas = scene?.canvas;
    if (!scene || !canvas) return null;
    const middle = new Cesium.Cartesian2(
      canvas.clientWidth / 2,
      canvas.clientHeight / 2,
    );
    const ground =
      _viewer.camera.pickEllipsoid?.(middle, scene.globe?.ellipsoid) ?? null;
    if (!ground) return null;
    const carto = Cesium.Cartographic.fromCartesian(ground);
    return {
      lat: Cesium.Math.toDegrees(carto.latitude),
      lon: Cesium.Math.toDegrees(carto.longitude),
    };
  }

  function publishCard() {
    const place = _selectedId ? _placeById.get(_selectedId) : null;
    if (!place) {
      overlayHost.setEntries(WIKI_PLACES_CARD_SOURCE_ID, [], CARD_HOST_OPTIONS);
      return;
    }
    const card = {
      ...buildPlaceCard(place, {
        summary: _selectedSummary,
        loading: !_selectedSummary && !_selectedFailed,
        failed: _selectedFailed,
      }),
      position: Cesium.Cartesian3.fromDegrees(place.lon, place.lat),
    };
    const link = _selectedSummary?.url;
    if (link && openExternal) {
      card.activate = () => {
        openExternal(link);
        return true;
      };
    } else card.interactive = false;
    overlayHost.setEntries(
      WIKI_PLACES_CARD_SOURCE_ID,
      [card],
      CARD_HOST_OPTIONS,
    );
  }

  function highlightSelection() {
    for (const entity of _dataSource?.entities.values ?? []) {
      const selected = entity.id === `${WIKI_PLACES_PICK_PREFIX}${_selectedId}`;
      entity.point.outlineColor = selected
        ? Cesium.Color.WHITE
        : Cesium.Color.BLACK;
      entity.point.outlineWidth = selected ? 3 : 1;
    }
  }

  async function loadSummary(pageId) {
    _summaryRequest?.abort();
    const request = new AbortController();
    _summaryRequest = request;
    try {
      const summary = await source.getSummary(
        { lang: language(), pageId },
        { signal: request.signal },
      );
      if (request.signal.aborted || _selectedId !== pageId) return;
      _selectedSummary = summary;
      _selectedFailed = !summary;
    } catch {
      if (request.signal.aborted || _selectedId !== pageId) return;
      _selectedFailed = true;
    } finally {
      if (_summaryRequest === request) _summaryRequest = null;
    }
    if (_enabled) publishCard();
  }

  function select(pageId) {
    if (_selectedId === pageId && !_selectedFailed) return;
    _selectedId = pageId;
    _selectedSummary = null;
    _selectedFailed = false;
    highlightSelection();
    publishCard();
    void loadSummary(pageId);
  }

  function clearSelection() {
    _summaryRequest?.abort();
    _summaryRequest = null;
    _selectedId = null;
    _selectedSummary = null;
    _selectedFailed = false;
    highlightSelection();
    overlayHost.clearSource(WIKI_PLACES_CARD_SOURCE_ID);
  }

  function pickedPlaceId(picked) {
    const pickId = picking.resolvePickId(picked);
    if (
      typeof pickId !== 'string' ||
      !pickId.startsWith(WIKI_PLACES_PICK_PREFIX)
    )
      return null;
    const pageId = Number(pickId.slice(WIKI_PLACES_PICK_PREFIX.length));
    return _placeById.has(pageId) ? pageId : null;
  }

  function installClickHandler() {
    if (
      _clickHandler ||
      !_viewer ||
      !screenSpaceEventHandlerFactory ||
      !picking
    )
      return;
    _clickHandler = screenSpaceEventHandlerFactory(_viewer);
    _clickHandler.setInputAction((click) => {
      if (pointer && !pointer.isPointerFree()) return;
      // A click on the card opens the article and keeps the selection.
      const cardHit = overlayHost.hitTest?.(
        click.position?.x,
        click.position?.y,
        { sourceId: WIKI_PLACES_CARD_SOURCE_ID },
      );
      if (cardHit) {
        if (_selectedSummary?.url && openExternal)
          openExternal(_selectedSummary.url);
        return;
      }
      const picked = _viewer.scene.pick(click.position);
      const pageId = picked ? pickedPlaceId(picked) : null;
      if (pageId) {
        select(pageId);
        return;
      }
      // Another layer's object is not empty space: leave the card alone.
      if (picked) {
        const pickId = picking.resolvePickId(picked);
        if (pickId && picking.isOwnedByOtherLayer(layer.id, pickId)) return;
      }
      if (_selectedId) clearSelection();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function removeClickHandler() {
    _clickHandler?.destroy();
    _clickHandler = null;
  }

  function render() {
    if (!_dataSource) return;
    _dataSource.entities.removeAll();
    _placeById.clear();
    const labels = [];
    _places.forEach((place, rank) => {
      _placeById.set(place.pageId, place);
      const position = Cesium.Cartesian3.fromDegrees(place.lon, place.lat);
      _dataSource.entities.add(
        new Cesium.Entity({
          id: `${WIKI_PLACES_PICK_PREFIX}${place.pageId}`,
          position,
          point: {
            pixelSize: markerPixelSize(rank),
            color: Cesium.Color.fromCssColorString(WIKI_PLACES_ACCENT),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 1,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      );
      labels.push({ ...createPlaceLabelEntry(place, rank), position });
    });
    overlayHost.setEntries(
      WIKI_PLACES_LABEL_SOURCE_ID,
      labels,
      LABEL_HOST_OPTIONS,
    );
    // The selected place survives a refresh only if it is still listed.
    if (_selectedId && !_placeById.has(_selectedId)) clearSelection();
    else highlightSelection();
  }

  function clearPlaces() {
    _places = [];
    _placeById.clear();
    _dataSource?.entities.removeAll();
    overlayHost.clearSource(WIKI_PLACES_LABEL_SOURCE_ID);
    clearSelection();
  }

  function onCameraMoveEnd() {
    if (!_enabled) return;
    if (_settleTimer !== null) clearTimer(_settleTimer);
    _settleTimer = setTimer(() => {
      _settleTimer = null;
      void layer.update();
    }, SETTLE_MS);
  }

  const layer = {
    id: WIKI_PLACES_LAYER_ID,
    name: 'Notable places',
    icon: '◈',
    source: 'Wikipedia',
    // Camera-driven: searches run when the view settles, not on a timer.
    updateInterval: 0,

    init(viewer) {
      if (_viewer)
        throw new Error('Notable places layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource(WIKI_PLACES_LAYER_ID);
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      overlayHost.setVisible(WIKI_PLACES_LABEL_SOURCE_ID, false);
      overlayHost.setVisible(WIKI_PLACES_CARD_SOURCE_ID, false);
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(WIKI_PLACES_LABEL_SOURCE_ID, true);
      overlayHost.setVisible(WIKI_PLACES_CARD_SOURCE_ID, true);
      picking?.registerPickOwner(WIKI_PLACES_LAYER_ID, (pickedId) =>
        String(pickedId).startsWith(WIKI_PLACES_PICK_PREFIX),
      );
      _viewer?.camera.moveEnd.addEventListener(onCameraMoveEnd);
      installClickHandler();
      _lastSearch = null;
      void layer.update();
    },

    disable() {
      _enabled = false;
      _request?.abort();
      _request = null;
      if (_settleTimer !== null) clearTimer(_settleTimer);
      _settleTimer = null;
      _viewer?.camera.moveEnd.removeEventListener(onCameraMoveEnd);
      picking?.unregisterPickOwner(WIKI_PLACES_LAYER_ID);
      removeClickHandler();
      clearPlaces();
      _lastSearch = null;
      _waiting = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.setVisible(WIKI_PLACES_LABEL_SOURCE_ID, false);
      overlayHost.setVisible(WIKI_PLACES_CARD_SOURCE_ID, false);
    },

    async update() {
      if (!_enabled || !_viewer) return false;
      const search = viewSearch(
        viewCenter(),
        _viewer.camera.positionCartographic?.height,
        language(),
      );
      if (!search) {
        // Too high to search usefully: say so instead of showing stale places.
        _request?.abort();
        _request = null;
        _lastSearch = null;
        _waiting = true;
        if (_places.length) clearPlaces();
        return true;
      }
      _waiting = false;
      if (sameSearch(search, _lastSearch)) return true;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const payload = await source.getNearby(search, {
          signal: request.signal,
        });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _lastSearch = search;
        _places = payload.places;
        render();
        _lastUpdate = Date.now();
        _lastError = null;
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _lastError = error?.message || msg('Wikipedia is unavailable');
        console.warn('[Data:WikiPlaces] Search failed:', _lastError);
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy(viewer = _viewer) {
      if (_enabled) layer.disable();
      clearPlaces();
      if (_dataSource) {
        viewer?.dataSources?.remove(_dataSource, true);
        _dataSource = null;
      }
      _viewer = null;
      _lastUpdate = null;
      _lastError = null;
    },

    /** Snapshot listed places as JSON-safe records for the analyst engine. */
    getAnalystRecords(maxCount = 50) {
      if (!_enabled) return [];
      return _places
        .slice(0, Math.max(1, Math.floor(Number(maxCount) || 50)))
        .map((place, index) => mapAnalystRecord(place, index));
    },

    getStats() {
      if (_waiting)
        return {
          count: 0,
          lastUpdate: _lastUpdate,
          error: null,
          status: 'idle',
          statusMessage: msg('zoom in to see places'),
        };
      return {
        count: _places.length,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
  return layer;
}
