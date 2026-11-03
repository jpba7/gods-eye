import * as Cesium from 'cesium';
import { createWikiPlacesLayer } from '../../layers/wikiPlaces/index.js';
import * as picking from '../../data/pickRegistry.js';
import * as overlays from '../../overlays/worldOverlay.js';
import { isPointerFree } from '../../data/inputOwnership.js';

/** Wire Wikipedia's notable places into the application catalog. */
export function createApplicationWikiPlaces(options) {
  return createWikiPlacesLayer({
    overlayHost: {
      setEntries: overlays.setOverlayEntries,
      setVisible: overlays.setOverlaySourceVisible,
      clearSource: overlays.clearOverlaySource,
      hitTest: overlays.hitTestWorldOverlay,
    },
    openExternal: (url) => {
      const target = window.open(url, '_blank', 'noopener,noreferrer');
      if (target) target.opener = null;
    },
    screenSpaceEventHandlerFactory: (viewer) =>
      new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas),
    picking,
    pointer: { isPointerFree },
    ...options,
  });
}
