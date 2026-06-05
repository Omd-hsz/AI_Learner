// src/lib/speech.js
// -----------------------------------------------------------------------------
// A thin wrapper around the browser's built-in Web Speech API. This gives us a
// FREE voice tutor (no API key, no extra cost):
//   - Text-to-Speech  via window.speechSynthesis        (read lessons aloud)
//   - Speech-to-Text  via window.SpeechRecognition       (answer/ask by voice)
//
// Why no library? The Web Speech API is built into modern browsers; wrapping it
// ourselves keeps the bundle tiny and avoids another dependency.
//
// Language support: pass a BCP-47 code like 'en-US' or 'fa-IR'. Farsi voices
// exist on iOS/macOS and some Android/Chrome setups; if none is installed the
// browser falls back to a default voice (so quality varies by device).
// -----------------------------------------------------------------------------

// Map our short app language codes to speech locale codes.
export function localeFor(language) {
  return language === 'fa' ? 'fa-IR' : 'en-US'
}

// --- Capability checks (UI hides voice buttons when unsupported) -----------
export function isTtsSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function getRecognition() {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

export function isSttSupported() {
  return getRecognition() !== null
}

// --- Text-to-Speech --------------------------------------------------------

// Strip markdown so the spoken version sounds natural (no "asterisk asterisk").
// Also drops fenced code blocks (we don't want code read character-by-character).
export function speakableText(markdown) {
  if (!markdown) return ''
  return markdown
    .replace(/```chart[\s\S]*?```/g, ' (chart shown on screen) ') // our chart blocks
    .replace(/```[\s\S]*?```/g, ' (code example shown on screen) ') // code fences
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links -> text
    .replace(/[#>*_~|]/g, ' ') // markdown punctuation
    .replace(/\n{2,}/g, '. ') // paragraph breaks -> pause
    .replace(/\s+/g, ' ')
    .trim()
}

// Pick the best installed voice for a locale (exact match, else language prefix).
function pickVoice(locale) {
  const voices = window.speechSynthesis.getVoices() || []
  const lang = locale.toLowerCase()
  const prefix = lang.split('-')[0]
  return (
    voices.find((v) => v.lang?.toLowerCase() === lang) ||
    voices.find((v) => v.lang?.toLowerCase().startsWith(prefix)) ||
    null
  )
}

// Speak text. Long text is split into sentence-sized chunks because some
// browsers silently stop on very long utterances. Returns a controller with
// stop(); callbacks: onBoundaryProgress(0..1), onEnd().
export function speak(markdown, { language = 'en', rate = 1, onEnd, onError } = {}) {
  if (!isTtsSupported()) {
    onError?.(new Error('Text-to-speech is not supported in this browser.'))
    return { stop() {} }
  }
  const synth = window.speechSynthesis
  synth.cancel() // stop anything currently speaking

  const locale = localeFor(language)
  const text = speakableText(markdown)
  // Split into chunks on sentence enders (works for both English and Persian).
  const chunks = text.match(/[^.!?؟\n]+[.!?؟]?/g) || [text]
  const voice = pickVoice(locale)

  let i = 0
  let stopped = false

  function next() {
    if (stopped || i >= chunks.length) {
      if (!stopped) onEnd?.()
      return
    }
    const u = new SpeechSynthesisUtterance(chunks[i].trim())
    u.lang = locale
    u.rate = rate
    if (voice) u.voice = voice
    u.onend = () => {
      i += 1
      next()
    }
    u.onerror = (e) => {
      // 'interrupted'/'canceled' happen on stop(); don't treat as a real error.
      if (!stopped) onError?.(e)
    }
    synth.speak(u)
  }
  next()

  return {
    stop() {
      stopped = true
      synth.cancel()
    },
  }
}

export function stopSpeaking() {
  if (isTtsSupported()) window.speechSynthesis.cancel()
}

// --- AI Text-to-Speech (realistic voice) -----------------------------------
// Reads text aloud using a REAL TTS model via the provider's /v1/audio/speech
// endpoint (see api.js synthesizeSpeech), so it sounds natural instead of the
// robotic browser voice. Works for English and Farsi (the model handles the
// language from the text itself).
//
// Long lessons are split into <=3500-char chunks (the TTS endpoint caps input
// length) and synthesized + played one after another. We synthesize the NEXT
// chunk while the current one plays so playback stays smooth. Returns a
// controller with stop(); callbacks: onEnd(), onError(err) so the caller can
// fall back to the free browser voice when the provider has no TTS model.

// Split speakable text into chunks no longer than maxLen, breaking on sentence
// boundaries so each chunk sounds complete.
function chunkForTts(text, maxLen = 3500) {
  const sentences = text.match(/[^.!?؟\n]+[.!?؟]?\s*/g) || [text]
  const chunks = []
  let cur = ''
  for (const s of sentences) {
    if (cur.length + s.length > maxLen && cur) {
      chunks.push(cur)
      cur = ''
    }
    // A single sentence longer than maxLen is pushed as-is (rare).
    cur += s
  }
  if (cur.trim()) chunks.push(cur)
  return chunks
}

export function speakAI(markdown, { language = 'en', onEnd, onError } = {}) {
  const text = speakableText(markdown)
  const chunks = chunkForTts(text)
  let stopped = false
  let audio = null

  // Run async, but return the controller synchronously so the UI can stop it.
  ;(async () => {
    try {
      // Lazy import keeps speech.js loadable without fetch (e.g. in tests).
      const { synthesizeSpeech, synthesizeSpeechGoogle } = await import('./api.js')
      const { getSettings } = await import('./storage.js')
      const s = getSettings()
      const useGoogle = (s.ttsProvider || 'google') === 'google'

      // Synthesize one chunk to an audio Blob using the chosen TTS service.
      const synth = (chunk) => {
        if (useGoogle) {
          return synthesizeSpeechGoogle({
            text: chunk,
            languageCode: language === 'fa' ? 'fa-IR' : 'en-US',
            voiceName: language === 'fa' ? s.googleVoiceFa : s.googleVoiceEn,
          })
        }
        return synthesizeSpeech({ text: chunk, voice: s.ttsVoice, model: s.ttsModel })
      }

      for (const chunk of chunks) {
        if (stopped) return
        const blob = await synth(chunk)
        if (stopped) return
        const url = URL.createObjectURL(blob)
        await new Promise((resolve, reject) => {
          audio = new Audio(url)
          audio.onended = () => {
            URL.revokeObjectURL(url)
            resolve()
          }
          audio.onerror = () => {
            URL.revokeObjectURL(url)
            reject(new Error('Audio playback failed.'))
          }
          audio.play().catch(reject)
        })
      }
      if (!stopped) onEnd?.()
    } catch (err) {
      if (!stopped) onError?.(err)
    }
  })()

  return {
    stop() {
      stopped = true
      if (audio) {
        audio.pause()
        audio.src = ''
        audio = null
      }
    },
  }
}

// --- Speech-to-Text --------------------------------------------------------

// Listen for one phrase and resolve with the recognized text. Rejects on error
// or if unsupported. Returns { promise, stop } so the UI can cancel listening.
export function listenOnce({ language = 'en' } = {}) {
  const Recognition = getRecognition()
  if (!Recognition) {
    return {
      promise: Promise.reject(new Error('Speech recognition is not supported in this browser (try Chrome).')),
      stop() {},
    }
  }
  const rec = new Recognition()
  rec.lang = localeFor(language)
  rec.interimResults = false
  rec.maxAlternatives = 1

  let settled = false
  const promise = new Promise((resolve, reject) => {
    rec.onresult = (e) => {
      settled = true
      resolve(e.results[0][0].transcript)
    }
    rec.onerror = (e) => {
      if (!settled) reject(new Error(e.error || 'recognition error'))
    }
    rec.onend = () => {
      if (!settled) reject(new Error('no-speech'))
    }
  })

  try {
    rec.start()
  } catch {
    // start() throws if called twice; ignore.
  }

  return {
    promise,
    stop() {
      try {
        rec.stop()
      } catch {
        // ignore
      }
    },
  }
}

// Edge cases this file does NOT handle:
// - Voice quality/availability depends entirely on the OS/browser (esp. Farsi).
// - speechSynthesis.getVoices() may be empty on first call until voices load;
//   speaking still works with the default voice, just maybe not the ideal one.
// - SpeechRecognition needs microphone permission and a network connection in
//   most browsers (it is cloud-backed in Chrome).
