import assert from 'node:assert/strict';
import test from 'node:test';
import { CITY_POIS } from '../cityPois.js';
import { mountSceneSuggestions } from '../ui/sceneSuggestions.js';
import {
  SCENE_SUGGESTION_THEMES,
  findSuggestion,
  findSuggestionTheme,
  suggestionCamera,
  suggestionShot,
  suggestionTarget,
} from './suggestions.js';

const places = SCENE_SUGGESTION_THEMES.flatMap((theme) => theme.places);

/** Great-circle-free local distance in metres; fine for a few kilometres. */
function horizontalMeters(a, b) {
  const lat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const north = (b.lat - a.lat) * 111_132;
  const east = (b.lon - a.lon) * 111_320 * Math.cos(lat);
  return { north, east, distance: Math.hypot(north, east) };
}

test('the curated list has unique places in five themes, Brazil first', () => {
  assert.deepEqual(
    SCENE_SUGGESTION_THEMES.map((theme) => theme.id),
    ['brazil', 'cities', 'nature', 'monuments', 'curiosities'],
  );
  assert.ok(places.length >= 15 && places.length <= 25, `${places.length}`);
  assert.equal(new Set(places.map((item) => item.id)).size, places.length);
  for (const item of places) {
    assert.ok(item.name && item.blurb, item.id);
    assert.equal(findSuggestion(item.id), item);
  }
  assert.equal(findSuggestion('nowhere'), null);
  assert.equal(findSuggestionTheme('brazil').places.length, 6);
});

test('every view looks down at its target from behind, at the authored range', () => {
  for (const item of places) {
    const { target, heading, pitch, range } = suggestionTarget(item);
    assert.ok(pitch < 0 && pitch >= -50, `${item.id} pitch ${pitch}`);
    const camera = suggestionCamera(item);
    assert.equal(camera.heading, heading);
    assert.equal(camera.pitch, pitch);
    assert.equal(camera.roll, 0);
    const offset = horizontalMeters(camera, target);
    const rise = camera.alt - target.height;
    const distance = Math.hypot(offset.distance, rise);
    assert.ok(Math.abs(distance - range) / range < 0.01, `${item.id} range`);
    // From the camera, the target lies along the view heading.
    const bearing =
      ((Math.atan2(offset.east, offset.north) * 180) / Math.PI + 360) % 360;
    const error = Math.abs(((bearing - heading + 540) % 360) - 180);
    assert.ok(error < 0.5, `${item.id} bearing ${bearing} vs ${heading}`);
    const look = (Math.atan2(rise, offset.distance) * 180) / Math.PI;
    assert.ok(Math.abs(look + pitch) < 0.5, `${item.id} pitch ${look}`);
  }
});

test('preset landmarks reuse src/cityPois.js and accept overrides', () => {
  const eiffel = CITY_POIS.paris.pois.find((poi) => poi.name === 'Eiffel Tower');
  const view = suggestionTarget(findSuggestion('eiffel-tower'));
  assert.equal(view.target.lat, eiffel.lat);
  assert.equal(view.target.lon, eiffel.lon);
  assert.equal(
    view.target.height,
    CITY_POIS.paris.groundElevation + eiffel.buildingHeight,
  );
  assert.equal(view.heading, 135, 'override wins');
  const burj = suggestionTarget(findSuggestion('burj-khalifa'));
  assert.equal(burj.heading, CITY_POIS.dubai.pois[0].heading, 'preset default');
  assert.throws(() =>
    suggestionTarget({ landmark: ['paris', 'Nowhere'] }),
  );
});

test('a suggestion shot is sparse in layers and carries its camera', () => {
  const item = findSuggestion('copacabana');
  const shot = suggestionShot(item, { title: 'Copacabana', visual: { style: 'noir' } });
  assert.deepEqual(shot.layers, {});
  assert.deepEqual(shot.camera, suggestionCamera(item));
  assert.equal(shot.visual.style, 'noir');
  assert.ok(shot.durationSec > 0 && shot.holdSec > 0);
});

/** Just enough DOM for the Suggestions section; clicks bubble to ancestors. */
function fakeDocument() {
  const make = (tag) => {
    const attributes = new Map();
    const listeners = [];
    const node = {
      tagName: tag.toUpperCase(),
      children: [],
      parentNode: null,
      dataset: {},
      className: '',
      setAttribute: (name, value) => attributes.set(name, String(value)),
      getAttribute: (name) => attributes.get(name) ?? null,
      addEventListener: (type, listener) => listeners.push([type, listener]),
      removeEventListener: (type, listener) => {
        const index = listeners.findIndex(
          ([kind, item]) => kind === type && item === listener,
        );
        if (index >= 0) listeners.splice(index, 1);
      },
      append(...items) {
        for (const item of items) {
          item.parentNode = node;
          node.children.push(item);
        }
      },
      insertBefore(item, before) {
        item.parentNode = node;
        const index = node.children.indexOf(before);
        node.children.splice(index < 0 ? node.children.length : index, 0, item);
      },
      remove() {
        const siblings = node.parentNode?.children;
        if (siblings) siblings.splice(siblings.indexOf(node), 1);
        node.parentNode = null;
      },
      contains(other) {
        for (let item = other; item; item = item.parentNode)
          if (item === node) return true;
        return false;
      },
      closest(selector) {
        for (let item = node; item; item = item.parentNode)
          if (selector === 'button' && item.tagName === 'BUTTON') return item;
        return null;
      },
      querySelector(selector) {
        const name = selector.replace(/^\./, '');
        const walk = (items) => {
          for (const item of items) {
            if (item.className.split(' ').includes(name)) return item;
            const found = walk(item.children);
            if (found) return found;
          }
          return null;
        };
        return walk(node.children);
      },
      click() {
        const event = { type: 'click', target: node };
        for (let item = node; item; item = item.parentNode)
          for (const [type, listener] of item.listeners)
            if (type === 'click') listener(event);
      },
      listeners,
    };
    let text = '';
    Object.defineProperty(node, 'textContent', {
      get: () => text,
      set: (value) => {
        text = value;
        node.children.length = 0;
      },
    });
    return node;
  };
  const panel = make('div');
  const inner = make('div');
  inner.className = 'scene-panel-inner';
  const controls = make('div');
  controls.className = 'scene-controls';
  inner.append(controls);
  panel.append(inner);
  return {
    inner,
    documentRef: {
      createElement: make,
      getElementById: (id) => (id === 'scene-panel' ? panel : null),
    },
  };
}

test('the Suggestions section switches themes and reports flights, saves and tours', () => {
  const { inner, documentRef } = fakeDocument();
  const calls = [];
  const dispose = mountSceneSuggestions({
    themes: SCENE_SUGGESTION_THEMES,
    documentRef,
    fly: (id) => calls.push(['fly', id]),
    save: (id) => (calls.push(['save', id]), { title: 'Saved title' }),
    tour: (id) => calls.push(['tour', id]),
  });
  const section = inner.querySelector('.scene-suggestions');
  const own = inner.querySelector('.scene-own-heading');
  assert.equal(inner.children[0], own, 'the own-scenes heading leads the controls');
  const click = (button) => button.click();
  const list = section.querySelector('.scene-suggestion-list');
  assert.equal(list.children.length, 6);
  const chips = section.querySelector('.scene-suggestion-themes').children;
  assert.equal(chips[0].getAttribute('aria-pressed'), 'true');
  click(chips[3]);
  assert.equal(chips[3].getAttribute('aria-pressed'), 'true');
  assert.equal(chips[0].getAttribute('aria-pressed'), 'false');
  assert.equal(list.children.length, 5);
  const [fly, save] = list.children[0].children;
  click(fly.children[0]);
  click(save);
  click(section.querySelector('.scene-suggestion-tour'));
  assert.deepEqual(calls, [
    ['fly', 'colosseum'],
    ['save', 'colosseum'],
    ['tour', 'monuments'],
  ]);
  assert.equal(
    section.querySelector('.scene-suggestions-status').textContent,
    '',
    'a tour clears the last save message',
  );
  dispose();
  assert.equal(inner.children.length, 1, 'dispose removes what it added');
});
