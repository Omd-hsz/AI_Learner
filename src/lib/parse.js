// src/lib/parse.js
// -----------------------------------------------------------------------------
// Helpers that pull structured data OUT of the model's free-text reply.
// Right now that means finding the flashcards JSON block the system prompt asks
// the model to include, e.g.:
//
//   ```json
//   {"flashcards":[{"q":"...","a":"..."}, ...]}
//   ```
// -----------------------------------------------------------------------------

// Extract the flashcards array from a lesson's markdown. Returns [] if none are
// found or the JSON is malformed (we never throw — a missing block just means
// "no cards this time").
export function extractFlashcards(markdown) {
  if (!markdown || typeof markdown !== 'string') return []

  // 1) Preferred: a fenced ```json ... ``` block containing "flashcards".
  //    The [\s\S]*? is a non-greedy "any character including newlines".
  const fenceRegex = /```json\s*([\s\S]*?)```/gi
  let match
  while ((match = fenceRegex.exec(markdown)) !== null) {
    const cards = tryParseFlashcards(match[1])
    if (cards) return cards
  }

  // 2) Fallback: a bare { "flashcards": [...] } object anywhere in the text,
  //    in case the model forgot the code fence.
  const bareRegex = /\{[^{}]*"flashcards"\s*:\s*\[[\s\S]*?\]\s*\}/
  const bare = markdown.match(bareRegex)
  if (bare) {
    const cards = tryParseFlashcards(bare[0])
    if (cards) return cards
  }

  return []
}

// Generic helper: find and parse the first JSON object in a blob of model text,
// tolerating a ```json fence or extra prose around it. Returns the parsed object
// or null. Used by the Quiz screen to read the questions JSON.
export function extractJsonObject(text) {
  if (!text || typeof text !== 'string') return null
  // First try a fenced block.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidates = []
  if (fence) candidates.push(fence[1])
  // Then the first {...} that spans the text (greedy to capture nested braces).
  const brace = text.match(/\{[\s\S]*\}/)
  if (brace) candidates.push(brace[0])
  for (const c of candidates) {
    try {
      return JSON.parse(c.trim())
    } catch {
      // try next candidate
    }
  }
  return null
}

// Try to JSON.parse a string and return a clean array of {q, a} objects.
// Returns null on any problem so the caller can keep looking.
function tryParseFlashcards(text) {
  try {
    const obj = JSON.parse(text.trim())
    if (!Array.isArray(obj.flashcards)) return null
    const cleaned = obj.flashcards
      .filter((c) => c && typeof c.q === 'string' && typeof c.a === 'string')
      .map((c) => ({ q: c.q.trim(), a: c.a.trim() }))
    return cleaned.length ? cleaned : null
  } catch {
    return null
  }
}

// Edge cases this file does NOT handle:
// - It expects valid JSON inside the block. If the model writes trailing commas
//   or comments (not valid JSON), parsing fails and we return [].
// - It only looks for the "flashcards" key; other structured blocks are ignored.
