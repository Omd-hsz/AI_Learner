// src/lib/lessonGen.js
// -----------------------------------------------------------------------------
// Shared logic for generating a lesson, caching it, and saving flashcards.
// Used by both the single-topic Lesson screen and the whole-module Module screen.
// -----------------------------------------------------------------------------
import { generate } from './api.js'
import { getSettings } from './storage.js'
import { buildSystemPrompt, buildLessonRequest, translateLessonSystem } from './prompts.js'
import { extractFlashcards } from './parse.js'
import { createCard } from './srs.js'
import {
  STATUS,
  saveLesson,
  setProgress,
  getProgress,
  getProfile,
  addFlashcards,
  deleteFlashcardsByTopic,
} from './db.js'

// Generate one topic's lesson, stream tokens via onToken, cache on success.
// Returns { markdown, messages, usage }. Personalizes using the saved profile.
export async function generateAndCacheLesson(topic, { onToken, signal, isRegenerate = false, language } = {}) {
  const profile = await getProfile()
  // The chosen UI/lesson language lives in settings (localStorage), NOT in the
  // learner profile. Without this, buildSystemPrompt() sees profile.language ===
  // undefined and silently writes every lesson in English even when the user
  // picked Farsi. Merge it in so lessons are actually generated in Farsi.
  const lang = language || getSettings().language || 'en'
  const system = buildSystemPrompt(topic, { ...profile, language: lang })
  const baseMessages = [{ role: 'user', content: buildLessonRequest(topic) }]

  let acc = ''
  const { usage } = await generate({
    kind: 'premium',
    system,
    messages: baseMessages,
    signal,
    label: `lesson:${topic.id}`,
    onToken: (t) => {
      acc += t
      onToken?.(acc)
    },
  })

  const assistantMsg = { role: 'assistant', content: acc }
  const full = [...baseMessages, assistantMsg]

  await saveLesson(topic.id, { markdown: acc, messages: full, language: lang })

  const cards = extractFlashcards(acc)
  if (cards.length) {
    if (isRegenerate) await deleteFlashcardsByTopic(topic.id)
    await addFlashcards(cards.map((c) => createCard(topic.id, c.q, c.a)))
  }

  const currentStatus = await getProgress(topic.id)
  if (currentStatus !== STATUS.COMPLETED) {
    await setProgress(topic.id, STATUS.IN_PROGRESS)
  }

  return { markdown: acc, messages: full, usage }
}

// Translate an already-generated lesson into `targetLanguage` and cache it under
// that language, so switching language shows the SAME lesson (same examples,
// charts, flashcards) instead of a different freshly-generated one. Streams the
// translated markdown via onToken. Returns { markdown, messages, usage }.
//
// We do NOT re-extract flashcards here: the cards were already created when the
// lesson was first generated, and re-adding translated copies would duplicate
// the spaced-repetition deck for the topic.
export async function translateAndCacheLesson(topic, sourceMarkdown, targetLanguage, { onToken, signal } = {}) {
  const system = translateLessonSystem(targetLanguage)
  // The model translates the raw lesson markdown we send as the user message.
  let acc = ''
  const { usage } = await generate({
    kind: 'premium',
    system,
    messages: [{ role: 'user', content: sourceMarkdown }],
    signal,
    label: `translate:${topic.id}:${targetLanguage}`,
    onToken: (t) => {
      acc += t
      onToken?.(acc)
    },
  })

  // Rebuild a clean message thread so follow-up questions continue in-language.
  const full = [
    { role: 'user', content: buildLessonRequest(topic) },
    { role: 'assistant', content: acc },
  ]
  await saveLesson(topic.id, { markdown: acc, messages: full, language: targetLanguage })

  return { markdown: acc, messages: full, usage }
}

// Edge cases this file does NOT handle:
// - Partial streams on abort are not saved (caller must retry).
// - Does not call onChanged/refresh — the UI layer does that after batch runs.
