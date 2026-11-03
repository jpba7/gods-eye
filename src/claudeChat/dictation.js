/**
 * Dictation for the Claude chat: a microphone button that types what you say
 * into the message box, so a message can be spoken, typed, or both.
 *
 * It uses the browser's Web Speech API (SpeechRecognition), so it needs no
 * key and no server code. Chrome and Edge support it; the audio is
 * transcribed by the browser vendor's speech service, so it needs internet.
 * Where the API is missing (Firefox, for one), the button is not shown and
 * the chat stays text only.
 *
 * Nothing is sent on its own: the transcript lands in the textarea, where it
 * can be corrected before pressing Enter.
 */

/** App locale → the speech recognition language (BCP 47). */
const RECOGNITION_LANGUAGES = Object.freeze({
  en: 'en-US',
  pt: 'pt-BR',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
  ja: 'ja-JP',
  ru: 'ru-RU',
  uk: 'uk-UA',
  'zh-CN': 'zh-CN',
  'zh-Hant': 'zh-TW',
});

/** The SpeechRecognition constructor this browser offers, or null. */
export function getSpeechRecognition(win = globalThis) {
  return win?.SpeechRecognition || win?.webkitSpeechRecognition || null;
}

/** Recognition language for an app locale; falls back to the browser's. */
export function recognitionLanguage(
  locale,
  fallback = globalThis.navigator?.language,
) {
  return RECOGNITION_LANGUAGES[locale] || fallback || 'en-US';
}

/**
 * Join the text typed before dictation with the words heard so far, with a
 * single space between them.
 */
export function joinTranscript(prefix, spoken) {
  const head = String(prefix || '').replace(/\s+$/, '');
  const tail = String(spoken || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!tail) return String(prefix || '');
  return head ? `${head} ${tail}` : tail;
}

/**
 * Wire dictation to a textarea and a toggle button.
 *
 * `onError(code)` gets the SpeechRecognition error code ('not-allowed',
 * 'no-speech', 'network', 'audio-capture', ...). Returns null when the
 * browser has no speech recognition.
 */
export function createDictation({
  input,
  button,
  Recognition = getSpeechRecognition(),
  lang = () => recognitionLanguage(undefined),
  onError = () => {},
  onChange = () => {},
} = {}) {
  if (!Recognition || !input || !button) return null;

  let recognition = null;
  let prefix = '';
  let finalText = '';

  function render(interim = '') {
    input.value = joinTranscript(prefix, `${finalText} ${interim}`);
    // Keep the caret and the view at the end of what is being dictated.
    input.selectionStart = input.selectionEnd = input.value.length;
    input.scrollTop = input.scrollHeight;
  }

  function setListening(listening) {
    button.dataset.listening = String(listening);
    button.setAttribute('aria-pressed', String(listening));
    onChange(listening);
  }

  function start() {
    if (recognition) return;
    prefix = input.value;
    finalText = '';
    const current = new Recognition();
    recognition = current;
    current.lang = typeof lang === 'function' ? lang() : lang;
    current.continuous = true;
    current.interimResults = true;
    current.maxAlternatives = 1;
    current.onresult = (event) => {
      if (recognition !== current) return;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript || '';
        if (result.isFinal) finalText = `${finalText} ${text}`;
        else interim = `${interim} ${text}`;
      }
      render(interim);
    };
    current.onerror = (event) => {
      if (recognition !== current) return;
      // 'aborted' is our own stop(); not worth a message.
      if (event?.error && event.error !== 'aborted') onError(event.error);
    };
    current.onend = () => {
      if (recognition !== current) return;
      recognition = null;
      render();
      setListening(false);
      input.focus();
    };
    try {
      current.start();
      setListening(true);
    } catch (error) {
      recognition = null;
      onError(
        error?.name === 'NotAllowedError' ? 'not-allowed' : 'start-failed',
      );
    }
  }

  /** Stop listening and keep what was heard (the last words still arrive). */
  function stop() {
    recognition?.stop();
  }

  /** Stop at once and drop words not yet final, e.g. when the message is sent. */
  function cancel() {
    const current = recognition;
    if (!current) return;
    recognition = null;
    current.abort();
    setListening(false);
  }

  button.addEventListener('click', () => (recognition ? stop() : start()));
  setListening(false);

  return {
    start,
    stop,
    cancel,
    get listening() {
      return recognition !== null;
    },
  };
}
