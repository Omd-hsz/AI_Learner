// src/components/Flashcards.jsx
// -----------------------------------------------------------------------------
// The flashcard review screen. Cards are created automatically from the JSON
// block each lesson returns (see Lesson.jsx). Here the user reviews the ones
// that are DUE today, flips to see the answer, and grades themselves
// "Got it" / "Again". The spaced-repetition schedule (day 1/3/7/16) is applied
// in lib/srs.js.
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from 'react'
import { getAllFlashcards, updateFlashcard } from '../lib/db.js'
import { getDueCards, reviewCard } from '../lib/srs.js'

export default function Flashcards({ curriculum, onBack, onChanged }) {
  const [cards, setCards] = useState(null) // null = still loading
  const [idx, setIdx] = useState(0) // which due card we're on
  const [showAnswer, setShowAnswer] = useState(false)

  // Map topic id -> title so we can label each card's source.
  const titleById = useMemo(() => {
    const map = {}
    curriculum?.modules.forEach((m) =>
      m.topics.forEach((t) => (map[t.id] = t.title))
    )
    return map
  }, [curriculum])

  // Load all cards once when the screen opens.
  useEffect(() => {
    ;(async () => setCards(await getAllFlashcards()))()
  }, [])

  if (cards === null) return <p className="muted">Loading cards…</p>

  // Compute the due queue from the freshest card list.
  const due = getDueCards(cards)
  const current = due[idx]

  // Grade the current card and advance.
  async function grade(remembered) {
    const updated = reviewCard(current, remembered)
    await updateFlashcard(updated)
    // Reflect the change locally so the due list shrinks without a full reload.
    setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
    setShowAnswer(false)
    setIdx((i) => i) // keep index; the just-graded card leaves the due list,
    // so the next due card naturally takes this index.
    onChanged?.()
  }

  return (
    <div className="flashcards">
      <div className="lesson-bar">
        <button className="btn-ghost" onClick={onBack}>
          ← Curriculum
        </button>
        <span className="muted">
          {cards.length} card{cards.length === 1 ? '' : 's'} total ·{' '}
          {due.length} due
        </span>
      </div>

      <h1>Flashcards</h1>

      {cards.length === 0 && (
        <p className="muted">
          No flashcards yet. Generate a lesson — each one adds 3 cards.
        </p>
      )}

      {cards.length > 0 && due.length === 0 && (
        <p className="muted">Nothing due right now. Come back later.</p>
      )}

      {current && (
        <div className="card">
          <div className="card-source">From: {titleById[current.topicId] || current.topicId}</div>
          <div className="card-q">{current.q}</div>

          {showAnswer ? (
            <>
              <hr />
              <div className="card-a">{current.a}</div>
              <div className="card-actions">
                {/* "Again" resets the interval; "Got it" advances it. */}
                <button className="btn" onClick={() => grade(false)}>
                  Again
                </button>
                <button className="btn-primary" onClick={() => grade(true)}>
                  Got it
                </button>
              </div>
            </>
          ) : (
            <button className="btn-primary reveal" onClick={() => setShowAnswer(true)}>
              Show answer
            </button>
          )}

          <div className="muted card-progress">
            Card {Math.min(idx + 1, due.length)} of {due.length} due
          </div>
        </div>
      )}
    </div>
  )
}

// Edge cases this file does NOT handle:
// - It does not reshuffle the due queue; cards are reviewed in stored order.
// - If you grade the last due card, the queue empties and the "nothing due"
//   message shows — there is no end-of-session summary screen.
