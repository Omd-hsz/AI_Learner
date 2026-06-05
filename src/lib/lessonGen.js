// src/lib/lessonGen.js
// -----------------------------------------------------------------------------
// Shared logic for generating a lesson, caching it, and saving flashcards.
// Used by both the single-topic Lesson screen and the whole-module Module screen.
// -----------------------------------------------------------------------------
import { generate } from './api.js'
import { getSettings } from './storage.js'
import { buildSystemPrompt, buildLessonRequest } from './prompts.js'
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
export async function generateAndCacheLesson(topic, { onToken, signal, isRegenerate = false } = {}) {
  const profile = await getProfile()
  // The chosen UI/lesson language lives in settings (localStorage), NOT in the
  // learner profile. Without this, buildSystemPrompt() sees profile.language ===
  // undefined and silently writes every lesson in English even when the user
  // picked Farsi. Merge it in so lessons are actually generated in Farsi.
  const system = buildSystemPrompt(topic, { ...profile, language: getSettings().language })
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

  await saveLesson(topic.id, { markdown: acc, messages: full })

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

// Edge cases this file does NOT handle:
// - Partial streams on abort are not saved (caller must retry).
// - Does not call onChanged/refresh — the UI layer does that after batch runs.
