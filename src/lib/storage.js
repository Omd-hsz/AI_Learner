// src/lib/storage.js
// -----------------------------------------------------------------------------
// Small wrapper around the browser's localStorage for SETTINGS only:
//   - the user's API key
//   - which provider (anthropic / openai)
//   - optional custom model overrides
//
// Why localStorage (and not IndexedDB) for these?
//   localStorage is the simplest key/value store and these values are tiny and
//   read on almost every screen. IndexedDB is overkill for a handful of strings.
//
// SECURITY NOTE: the API key lives ONLY in this browser's localStorage. It is
// sent over the network only when we call the LLM provider directly. It is never
// uploaded to any server we control (there is no server).
// -----------------------------------------------------------------------------

// One namespaced key keeps all our settings together and avoids clashing with
// anything else on the page.
const SETTINGS_KEY = 'aiLearn.settings'

// The defaults used until the user changes anything in Settings.
const DEFAULT_SETTINGS = {
  apiKey: '',
  provider: 'litellm', // Divar LiteLLM proxy (OpenAI-compatible)
  // Empty string means "use the provider's built-in default model".
  premiumModel: '',
  cheapModel: '',
  // UI + lesson language: 'en' (English) or 'fa' (Persian/Farsi).
  language: 'en',
  // Voice tutor.
  voiceEnabled: true,
  voiceRate: 1, // speaking speed (0.5 slow … 2 fast)
  // Realistic AI voice: when on, lessons are read aloud by a real TTS service
  // instead of the robotic built-in browser voice. Falls back to the browser
  // voice automatically if the service is unavailable.
  aiVoice: true,
  // Which TTS service:
  //  'gemini' — Google AI Studio (Gemini API) TTS. FREE, no credit card needed;
  //             just an AI Studio key. Supports Persian. The recommended default.
  //  'google' — Google Cloud Text-to-Speech. Higher quality/limits but needs a
  //             Google Cloud billing account (credit card).
  //  'proxy'  — the chat provider's OpenAI-compatible /v1/audio/speech (only
  //             works if the proxy exposes a TTS model; the Divar one does NOT).
  ttsProvider: 'gemini',
  // Gemini (AI Studio) TTS: a free AI Studio API key + a prebuilt voice name.
  // The model auto-detects the language from the text, so one voice covers both
  // English and Farsi. Voices: Kore, Puck, Zephyr, Charon, Fenrir, Aoede, …
  geminiTtsKey: '',
  geminiVoice: 'Kore',
  // Google Cloud TTS: a Google Cloud API key (needs billing) + per-language
  // voice names. Empty voice name => Google auto-selects one.
  googleTtsKey: '',
  googleVoiceEn: 'en-US-Neural2-C', // realistic English neural voice
  googleVoiceFa: 'fa-IR-Standard-A', // Persian (Google has Standard fa-IR voices)
  // Proxy TTS (only if your chat provider has an OpenAI-style TTS model):
  ttsModel: 'gpt-4o-mini-tts',
  ttsVoice: 'alloy', // alloy | echo | fable | onyx | nova | shimmer
}

// Read the whole settings object. Always returns a complete object (defaults
// merged in) so callers never have to check for missing fields.
export function getSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    // If localStorage is disabled or the JSON is corrupt, fall back to defaults
    // rather than crashing the app.
    return { ...DEFAULT_SETTINGS }
  }
}

// Merge-and-save a partial settings update, e.g. saveSettings({ apiKey: 'sk-...' }).
export function saveSettings(partial) {
  const next = { ...getSettings(), ...partial }
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
  return next
}

// Convenience helpers used in a few components.
export function getApiKey() {
  return getSettings().apiKey
}

export function hasApiKey() {
  return Boolean(getSettings().apiKey)
}

// Edge cases this file does NOT handle:
// - It does not encrypt the API key. localStorage is plain text readable by any
//   script on this origin. That is an accepted trade-off for a key-cap'd dev key.
// - It does not sync across devices (by design — this app is local-first).
