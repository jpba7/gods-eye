import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDictation,
  getSpeechRecognition,
  joinTranscript,
  recognitionLanguage,
} from './dictation.js';

class FakeElement {
  constructor() {
    this.value = '';
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.focused = 0;
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }
  click() {
    this.listeners.click?.();
  }
  focus() {
    this.focused += 1;
  }
}

function fakeRecognitionClass() {
  const instances = [];
  class FakeRecognition {
    constructor() {
      this.started = false;
      instances.push(this);
    }
    start() {
      this.started = true;
    }
    stop() {
      this.onend?.();
    }
    abort() {
      this.aborted = true;
      this.onerror?.({ error: 'aborted' });
      this.onend?.();
    }
    emit(results, resultIndex = 0) {
      this.onresult?.({
        resultIndex,
        results: results.map(([transcript, isFinal]) =>
          Object.assign([{ transcript }], { isFinal }),
        ),
      });
    }
  }
  return { FakeRecognition, instances };
}

function setup(options = {}) {
  const input = new FakeElement();
  const button = new FakeElement();
  const { FakeRecognition, instances } = fakeRecognitionClass();
  const errors = [];
  const changes = [];
  const dictation = createDictation({
    input,
    button,
    Recognition: FakeRecognition,
    lang: 'pt-BR',
    onError: (code) => errors.push(code),
    onChange: (listening) => changes.push(listening),
    ...options,
  });
  return { input, button, dictation, instances, errors, changes };
}

test('getSpeechRecognition prefers the standard name and falls back to webkit', () => {
  function Standard() {}
  function Webkit() {}
  assert.equal(
    getSpeechRecognition({
      SpeechRecognition: Standard,
      webkitSpeechRecognition: Webkit,
    }),
    Standard,
  );
  assert.equal(
    getSpeechRecognition({ webkitSpeechRecognition: Webkit }),
    Webkit,
  );
  assert.equal(getSpeechRecognition({}), null);
});

test('recognitionLanguage maps app locales to speech languages', () => {
  assert.equal(recognitionLanguage('pt'), 'pt-BR');
  assert.equal(recognitionLanguage('en'), 'en-US');
  assert.equal(recognitionLanguage('zh-Hant'), 'zh-TW');
  assert.equal(recognitionLanguage('xx', 'nl-NL'), 'nl-NL');
});

test('joinTranscript keeps typed text and adds one space before the spoken words', () => {
  assert.equal(
    joinTranscript('me leva para', '  São Paulo '),
    'me leva para São Paulo',
  );
  assert.equal(joinTranscript('', 'olá   mundo'), 'olá mundo');
  assert.equal(joinTranscript('texto ', ''), 'texto ');
});

test('createDictation returns null without speech recognition', () => {
  assert.equal(
    createDictation({
      input: new FakeElement(),
      button: new FakeElement(),
      Recognition: null,
    }),
    null,
  );
});

test('the button toggles listening and dictated words land after the typed text', () => {
  const { input, button, dictation, instances, changes } = setup();
  input.value = 'Mostre';
  button.click();
  assert.equal(dictation.listening, true);
  assert.equal(button.dataset.listening, 'true');
  const [recognition] = instances;
  assert.equal(recognition.lang, 'pt-BR');
  assert.equal(recognition.continuous, true);
  assert.equal(recognition.interimResults, true);

  recognition.emit([['o Rio', false]]);
  assert.equal(input.value, 'Mostre o Rio');
  recognition.emit([
    ['o Rio de Janeiro', true],
    [' e os voos', false],
  ]);
  assert.equal(input.value, 'Mostre o Rio de Janeiro e os voos');
  recognition.emit(
    [
      ['o Rio de Janeiro', true],
      [' e os voos', true],
    ],
    1,
  );
  assert.equal(input.value, 'Mostre o Rio de Janeiro e os voos');

  button.click();
  assert.equal(dictation.listening, false);
  assert.equal(button.dataset.listening, 'false');
  assert.equal(input.value, 'Mostre o Rio de Janeiro e os voos');
  assert.deepEqual(changes, [false, true, false]);
});

test('cancel stops at once without reporting the abort as an error', () => {
  const { input, button, dictation, instances, errors } = setup();
  button.click();
  instances[0].emit([['meia frase', false]]);
  dictation.cancel();
  assert.equal(instances[0].aborted, true);
  assert.equal(dictation.listening, false);
  assert.deepEqual(errors, []);
  // A send clears the box afterwards; a late result must not refill it.
  input.value = '';
  instances[0].emit([['meia frase', true]]);
  assert.equal(input.value, '');
});

test('recognition errors are reported by code', () => {
  const { button, instances, errors } = setup();
  button.click();
  instances[0].onerror({ error: 'not-allowed' });
  instances[0].onend();
  assert.deepEqual(errors, ['not-allowed']);
});

test('a start that throws reports the failure and stays idle', () => {
  class Throwing {
    start() {
      throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    }
  }
  const { button, dictation, errors } = setup({ Recognition: Throwing });
  button.click();
  assert.equal(dictation.listening, false);
  assert.deepEqual(errors, ['not-allowed']);
});
