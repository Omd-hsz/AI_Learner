// src/lib/srs.js
// -----------------------------------------------------------------------------
// "SRS" = Spaced Repetition System. The idea: you remember things longer if you
// review them at growing intervals instead of cramming. We use a fixed, simple
// schedule asked for in the spec: review on day 1, 3, 7, then 16.
//
// We avoid a heavy SRS library (like ts-fsrs) on purpose — a fixed 4-step ladder
// is plenty for this app and stays beginner-readable.
// -----------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000

// Days until the NEXT review, indexed by how many times the card was recalled.
// reviews=0 -> first review 1 day after creation, then 3, then 7, then 16 days.
export const INTERVALS_DAYS = [1, 3, 7, 16]

// Make a brand-new card object ready to store in IndexedDB.
// It becomes "due" one day after it is created (the first spaced review).
export function createCard(topicId, q, a) {
  const now = Date.now()
  return {
    topicId,
    q,
    a,
    reviews: 0, // how many times recalled correctly in a row
    createdAt: now,
    due: now + INTERVALS_DAYS[0] * DAY_MS,
    lastReviewed: null,
  }
}

// A card is due when its scheduled time has arrived (or passed).
export function isDue(card, now = Date.now()) {
  return card.due <= now
}

// Filter a list of cards down to the ones due now.
export function getDueCards(cards, now = Date.now()) {
  return cards.filter((c) => isDue(c, now))
}

// Update a card after the user reviews it.
//   remembered === true  -> advance to the next, longer interval.
//   remembered === false -> reset back to the start (review again tomorrow).
// Returns a NEW card object (we don't mutate the input).
export function reviewCard(card, remembered, now = Date.now()) {
  let reviews = remembered ? card.reviews + 1 : 0

  // Clamp so we never index past the end of the intervals array. Once a card has
  // graduated past the last interval we keep reusing the longest gap (16 days).
  const idx = Math.min(reviews, INTERVALS_DAYS.length - 1)
  const nextGapDays = INTERVALS_DAYS[idx]

  return {
    ...card,
    reviews,
    lastReviewed: now,
    due: now + nextGapDays * DAY_MS,
  }
}

// Edge cases this file does NOT handle:
// - No "ease factor" / difficulty per card (real SRS like SM-2/FSRS adapt to how
//   hard each card is). This is a deliberately simple fixed ladder.
// - Timezones: "due" is a raw timestamp, so reviews are scheduled in real elapsed
//   time, not at local midnight. Good enough for a personal study app.
