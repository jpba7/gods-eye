/**
 * The Suggestions section of the Scene panel: theme chips, the places of the
 * chosen theme and a tour button. Places come from src/scenes/suggestions.js;
 * flying, saving and touring are the director's, passed in as callbacks.
 * @module ui/sceneSuggestions
 */
import { t } from '../i18n/index.js';

function glyph(documentRef, name) {
  const span = documentRef.createElement('span');
  span.className = 'material-symbols-outlined scene-suggestion-icon';
  span.setAttribute('aria-hidden', 'true');
  span.textContent = name;
  return span;
}

/**
 * Mount the section at the end of the Scene panel, with a heading for the
 * panel's own controls. Returns a dispose that
 * removes it and every listener; a page without the panel gets a no-op.
 * @param {object} input
 * @param {ReadonlyArray<{id: string, label: string, places: ReadonlyArray<{id: string, name: string, blurb: string}>}>} input.themes
 * @param {(placeId: string) => unknown} input.fly
 * @param {(placeId: string) => ({title: string}|null)} input.save
 * @param {(themeId: string) => unknown} input.tour
 * @param {Document} [input.documentRef]
 * @returns {() => void}
 */
export function mountSceneSuggestions({
  themes,
  fly,
  save,
  tour,
  documentRef = globalThis.document,
}) {
  const panel = documentRef?.getElementById?.('scene-panel');
  if (typeof panel?.querySelector !== 'function' || !themes?.length)
    return () => {};
  const host = panel.querySelector('.scene-panel-inner') || panel;

  const section = documentRef.createElement('section');
  section.className = 'scene-suggestions';
  section.setAttribute('aria-labelledby', 'scene-suggestions-heading');
  const heading = documentRef.createElement('h3');
  heading.id = 'scene-suggestions-heading';
  heading.className = 'scene-section-heading';
  heading.textContent = t('Suggestions');
  const hint = documentRef.createElement('p');
  hint.className = 'scene-suggestions-hint';
  hint.textContent = t('Best viewed with the Photorealistic 3D map.');

  const chips = documentRef.createElement('div');
  chips.className = 'scene-suggestion-themes';
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', t('Suggestion themes'));
  for (const theme of themes) {
    const chip = documentRef.createElement('button');
    chip.type = 'button';
    chip.className = 'scene-suggestion-theme';
    chip.dataset.suggestionTheme = theme.id;
    chip.textContent = t(theme.label);
    chips.append(chip);
  }

  const list = documentRef.createElement('ul');
  list.className = 'scene-suggestion-list';

  const tourButton = documentRef.createElement('button');
  tourButton.type = 'button';
  tourButton.className = 'scene-suggestion-tour';
  const tourLabel = documentRef.createElement('span');
  tourButton.append(glyph(documentRef, 'play_arrow'), tourLabel);

  const status = documentRef.createElement('p');
  status.className = 'scene-suggestions-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  section.append(heading, hint, chips, list, tourButton, status);
  host.append(section);
  // Names the panel's own controls where the section is shown above them
  // (the Earth shell's Scenes drawer); hidden elsewhere by scenes.css.
  const own = documentRef.createElement('h3');
  own.className = 'scene-section-heading scene-own-heading';
  own.textContent = t('Your scenes');
  host.insertBefore(own, host.querySelector('.scene-controls'));

  let current = themes[0];
  const render = () => {
    for (const chip of chips.children)
      chip.setAttribute(
        'aria-pressed',
        String(chip.dataset.suggestionTheme === current.id),
      );
    list.textContent = '';
    for (const place of current.places) {
      const name = t(place.name);
      const item = documentRef.createElement('li');
      item.className = 'scene-suggestion';
      const go = documentRef.createElement('button');
      go.type = 'button';
      go.className = 'scene-suggestion-fly';
      go.dataset.suggestionFly = place.id;
      go.title = t('Fly to {place}', { place: name });
      const title = documentRef.createElement('span');
      title.className = 'scene-suggestion-name';
      title.textContent = name;
      const blurb = documentRef.createElement('span');
      blurb.className = 'scene-suggestion-blurb';
      blurb.textContent = t(place.blurb);
      go.append(title, blurb);
      const keep = documentRef.createElement('button');
      keep.type = 'button';
      keep.className = 'scene-suggestion-save';
      keep.dataset.suggestionSave = place.id;
      const keepLabel = t('Save {place} as a scene', { place: name });
      keep.setAttribute('aria-label', keepLabel);
      keep.title = keepLabel;
      keep.append(glyph(documentRef, 'bookmark_add'));
      item.append(go, keep);
      list.append(item);
    }
    tourLabel.textContent = t('Play tour');
    tourButton.setAttribute(
      'aria-label',
      t('Play the {theme} tour', { theme: t(current.label) }),
    );
  };
  render();

  const onClick = (event) => {
    const target = event.target?.closest?.('button');
    if (!target || !section.contains(target)) return;
    if (target.dataset.suggestionTheme) {
      current =
        themes.find((theme) => theme.id === target.dataset.suggestionTheme) ||
        current;
      status.textContent = '';
      render();
    } else if (target.dataset.suggestionFly) {
      status.textContent = '';
      fly(target.dataset.suggestionFly);
    } else if (target.dataset.suggestionSave) {
      const scene = save(target.dataset.suggestionSave);
      status.textContent = scene
        ? t('Saved as scene: {scene}', { scene: scene.title })
        : t('Could not save the scene');
    } else if (target === tourButton) {
      status.textContent = '';
      tour(current.id);
    }
  };
  section.addEventListener('click', onClick);
  return () => {
    section.removeEventListener('click', onClick);
    section.remove();
    own.remove();
  };
}
