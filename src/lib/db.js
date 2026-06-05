// src/lib/db.js
// -----------------------------------------------------------------------------
// All on-device persistence (the data that should survive reloads and work
// offline) lives in IndexedDB. We use the tiny `idb` library because the raw
// IndexedDB API is famously clunky (callback-based, verbose); `idb` wraps it in
// clean promises. That is the one reason we add this dependency.
//
// We keep FOUR "object stores" (think: tables):
//   - lessons     : the generated markdown + full chat history per topic (cache)
//   - progress    : Not Started / In Progress / Completed per topic
//   - flashcards  : spaced-repetition cards parsed out of lessons
//   - quizScores  : a log of quiz attempts
//
// Settings (API key etc.) are NOT here — they live in localStorage (storage.js).
// -----------------------------------------------------------------------------
import { openDB } from 'idb'

const DB_NAME = 'aiLearnDB'
// v2 adds two stores: `profile` (the learner's level + notes from the placement
// test and comprehension checks) and `usage` (a log of token/cost per API call).
const DB_VERSION = 2

// Status constants so we never mistype a string like "complete" vs "completed".
export const STATUS = {
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
}

// Open (and if needed create/upgrade) the database. `idb` calls `upgrade` only
// when DB_VERSION increases or the DB does not exist yet.
function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // lessons keyed by topic id (e.g. "F3" or "12") — one cached lesson each.
      if (!db.objectStoreNames.contains('lessons')) {
        db.createObjectStore('lessons', { keyPath: 'topicId' })
      }
      // progress keyed by topic id too.
      if (!db.objectStoreNames.contains('progress')) {
        db.createObjectStore('progress', { keyPath: 'topicId' })
      }
      // flashcards get an auto-incrementing numeric id; we index by topic + due
      // date so the "due today" query is fast.
      if (!db.objectStoreNames.contains('flashcards')) {
        const store = db.createObjectStore('flashcards', {
          keyPath: 'id',
          autoIncrement: true,
        })
        store.createIndex('byTopic', 'topicId')
        store.createIndex('byDue', 'due')
      }
      // quiz attempts log.
      if (!db.objectStoreNames.contains('quizScores')) {
        db.createObjectStore('quizScores', { keyPath: 'id', autoIncrement: true })
      }
      // profile: a single record (id: 'me') with the learner's level + notes.
      if (!db.objectStoreNames.contains('profile')) {
        db.createObjectStore('profile', { keyPath: 'id' })
      }
      // usage: one row per API call (tokens + cost) so we can total spending.
      if (!db.objectStoreNames.contains('usage')) {
        db.createObjectStore('usage', { keyPath: 'id', autoIncrement: true })
      }
    },
  })
}

// ---------------------------------------------------------------------------
// PROFILE (the learner model that personalizes lessons)
// ---------------------------------------------------------------------------

const DEFAULT_PROFILE = {
  id: 'me',
  level: '', // '', 'beginner', 'intermediate', 'advanced'
  // Free-text notes the app accumulates: what the learner knows / struggles
  // with. This string is injected into the lesson prompt for personalization.
  knowledgeNotes: '',
  placementDone: false,
  recommendedTopicId: '',
}

export async function getProfile() {
  const db = await getDB()
  const row = await db.get('profile', 'me')
  return { ...DEFAULT_PROFILE, ...(row || {}) }
}

export async function saveProfile(partial) {
  const db = await getDB()
  const current = await getProfile()
  const next = { ...current, ...partial, id: 'me' }
  await db.put('profile', next)
  return next
}

// Append a short note to the learner's knowledge summary (keeps the last ~1500
// chars so the prompt does not grow without bound).
export async function appendKnowledgeNote(note) {
  const current = await getProfile()
  const combined = (current.knowledgeNotes + '\n' + note).trim()
  const trimmed = combined.length > 1500 ? combined.slice(-1500) : combined
  return saveProfile({ knowledgeNotes: trimmed })
}

// ---------------------------------------------------------------------------
// USAGE (token + cost log)
// ---------------------------------------------------------------------------

export async function addUsage(record) {
  const db = await getDB()
  await db.add('usage', record)
}

export async function getAllUsage() {
  const db = await getDB()
  return db.getAll('usage')
}

// Sum everything into one { cost, inputTokens, outputTokens, totalTokens, calls }.
export async function getUsageTotals() {
  const rows = await getAllUsage()
  const totals = { cost: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: rows.length, costKnown: true }
  for (const r of rows) {
    if (r.cost == null) totals.costKnown = false
    else totals.cost += r.cost
    totals.inputTokens += r.inputTokens || 0
    totals.outputTokens += r.outputTokens || 0
    totals.totalTokens += r.totalTokens || 0
  }
  return totals
}

export async function resetUsage() {
  const db = await getDB()
  await db.clear('usage')
}

// ---------------------------------------------------------------------------
// LESSONS (the token-saving cache)
// ---------------------------------------------------------------------------

// Save (or overwrite) a lesson for a topic. `messages` is the full chat array so
// follow-up questions can continue with context. `markdown` is the rendered body.
export async function saveLesson(topicId, { markdown, messages }) {
  const db = await getDB()
  const existing = await db.get('lessons', topicId)
  const now = Date.now()
  await db.put('lessons', {
    topicId,
    markdown,
    messages,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  })
}

export async function getLesson(topicId) {
  const db = await getDB()
  return db.get('lessons', topicId)
}

// Load cached lessons for many topic ids at once (used by the Module screen).
export async function getLessonsForTopics(topicIds) {
  const db = await getDB()
  const rows = await Promise.all(topicIds.map((id) => db.get('lessons', id)))
  const map = {}
  topicIds.forEach((id, i) => {
    if (rows[i]) map[id] = rows[i]
  })
  return map
}

export async function deleteLesson(topicId) {
  const db = await getDB()
  await db.delete('lessons', topicId)
}

// ---------------------------------------------------------------------------
// PROGRESS
// ---------------------------------------------------------------------------

export async function setProgress(topicId, status) {
  const db = await getDB()
  const existing = await db.get('progress', topicId)
  await db.put('progress', { ...(existing || {}), topicId, status, updatedAt: Date.now() })
}

export async function getProgress(topicId) {
  const db = await getDB()
  const row = await db.get('progress', topicId)
  return row?.status ?? STATUS.NOT_STARTED
}

// Store a comprehension score (0-100) for a topic without losing its status.
export async function setComprehension(topicId, scorePct) {
  const db = await getDB()
  const existing = await db.get('progress', topicId)
  await db.put('progress', {
    ...(existing || {}),
    topicId,
    status: existing?.status || STATUS.IN_PROGRESS,
    comprehension: scorePct,
    updatedAt: Date.now(),
  })
}

// Full progress record (status + comprehension + timestamps) for one topic.
export async function getProgressRecord(topicId) {
  const db = await getDB()
  return db.get('progress', topicId)
}

// Return a plain object { topicId: status } for every topic that has progress.
// Used by Home to colour all badges in one read.
export async function getAllProgress() {
  const db = await getDB()
  const all = await db.getAll('progress')
  const map = {}
  for (const row of all) map[row.topicId] = row.status
  return map
}

// ---------------------------------------------------------------------------
// FLASHCARDS
// ---------------------------------------------------------------------------

// Add many cards at once (e.g. the 3 cards parsed from a lesson). `due` and
// `stage` are set by the spaced-repetition logic in the caller (see srs.js).
export async function addFlashcards(cards) {
  const db = await getDB()
  const tx = db.transaction('flashcards', 'readwrite')
  for (const card of cards) {
    await tx.store.add(card)
  }
  await tx.done
}

export async function getAllFlashcards() {
  const db = await getDB()
  return db.getAll('flashcards')
}

export async function getFlashcardsByTopic(topicId) {
  const db = await getDB()
  return db.getAllFromIndex('flashcards', 'byTopic', topicId)
}

export async function updateFlashcard(card) {
  const db = await getDB()
  await db.put('flashcards', card)
}

// Remove every card belonging to a topic (used before re-saving on Regenerate so
// we don't accumulate duplicate cards each time a lesson is regenerated).
export async function deleteFlashcardsByTopic(topicId) {
  const db = await getDB()
  const cards = await db.getAllFromIndex('flashcards', 'byTopic', topicId)
  const tx = db.transaction('flashcards', 'readwrite')
  for (const card of cards) await tx.store.delete(card.id)
  await tx.done
}

// ---------------------------------------------------------------------------
// QUIZ SCORES
// ---------------------------------------------------------------------------

export async function addQuizScore(score) {
  const db = await getDB()
  await db.add('quizScores', score)
}

export async function getAllQuizScores() {
  const db = await getDB()
  return db.getAll('quizScores')
}

// ---------------------------------------------------------------------------
// EXPORT / IMPORT (manual backup, since the data is local-only)
// ---------------------------------------------------------------------------

// Dump every store into one plain object that can be JSON.stringify'd.
export async function exportAll() {
  const db = await getDB()
  return {
    version: DB_VERSION,
    exportedAt: new Date().toISOString(),
    lessons: await db.getAll('lessons'),
    progress: await db.getAll('progress'),
    flashcards: await db.getAll('flashcards'),
    quizScores: await db.getAll('quizScores'),
    profile: await db.getAll('profile'),
    usage: await db.getAll('usage'),
  }
}

// Replace ALL current data with the contents of an exported file. We clear each
// store first so the import is a true restore, not a merge.
export async function importAll(data) {
  const db = await getDB()
  const stores = ['lessons', 'progress', 'flashcards', 'quizScores', 'profile', 'usage']
  const tx = db.transaction(stores, 'readwrite')
  for (const name of stores) {
    await tx.objectStore(name).clear()
    const rows = data[name] || []
    for (const row of rows) {
      // flashcards/quizScores use autoIncrement keys; keeping the original id is
      // fine because the store was just cleared.
      await tx.objectStore(name).put(row)
    }
  }
  await tx.done
}

// Wipe progress + lessons + cards + profile + usage ("Reset progress").
export async function resetAllData() {
  const db = await getDB()
  const stores = ['lessons', 'progress', 'flashcards', 'quizScores', 'profile', 'usage']
  const tx = db.transaction(stores, 'readwrite')
  for (const name of stores) await tx.objectStore(name).clear()
  await tx.done
}

// Edge cases this file does NOT handle:
// - No schema migration logic beyond `upgrade` adding stores. If you change a
//   store's shape in v2 you must write migration code here.
// - importAll trusts the file shape; a malformed backup could throw mid-import.
//   The caller (Settings) wraps it in try/catch and shows an error.
// - Private-browsing modes may block IndexedDB; calls will reject and the UI
//   should surface that.
