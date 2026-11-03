import { createImageryHistoryLayer } from '../../layers/imageryHistory/index.js';
import { createImagerySplit } from '../../ui/imagerySplit.js';
import { governorRequestRender } from '../../renderGovernor.js';
import { t } from '../../i18n/index.js';

/** Wire Esri World Imagery Wayback into the application catalog. */
export function createApplicationImageryHistory({ source }) {
  return createImageryHistoryLayer({
    source,
    requestRender: governorRequestRender,
    createSplit: ({ scene, initialValue, beforeLabel, afterLabel, onChange }) =>
      createImagerySplit({
        scene,
        parent: document.body,
        initialValue,
        id: 'imagery-history-split-line',
        handleClass: 'imagery-history-split-handle',
        cssTarget: document.documentElement,
        cssProperty: '--imagery-history-split',
        beforeLabel,
        afterLabel,
        ariaLabel: t('Past and present imagery divider'),
        formatValueText: (left, right) =>
          t('{before} {left} percent, {after} {right} percent', {
            before: beforeLabel,
            left,
            after: afterLabel,
            right,
          }),
        getViewportWidth: () =>
          Number(scene?.canvas?.clientWidth) ||
          Number(document.documentElement?.clientWidth) ||
          0,
        onChange,
        requestRender: () => governorRequestRender('imagery-history-split'),
      }),
  });
}
