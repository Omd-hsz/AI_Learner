// src/components/Lesson.jsx
// -----------------------------------------------------------------------------
// The lesson screen — the heart of the app. Responsibilities:
//   - Load a CACHED lesson from IndexedDB (free, offline) if we have one.
//   - Otherwise GENERATE it via the LLM, streaming the markdown as it arrives.
//   - Save the result so reopening costs no tokens.
//   - Offer: Regenerate, Mark Complete, "I'm Stuck" (hint), Ask Follow-up
//     (free text that continues the SAME conversation), and a Teach-back box
//     ("Check my understanding").
//   - Parse the flashcards JSON block and store the cards.
// -----------------------------------------------------------------------------
import { useEffect, useRef, useState } from 'react'
import { generate } from '../lib/api.js'
import { buildSystemPrompt, buildLessonRequest } from '../lib/prompts.js'
import { extractFlashcards } from '../lib/parse.js'
import { createCard } from '../lib/srs.js'
import {
  STATUS,
  getLesson,
  saveLesson,
  setProgress,
  getProgress,
  addFlashcards,
  deleteFlashcardsByTopic,
} from '../lib/db.js'
import Markdown from './Markdown.jsx'

export default function Lesson({ topic, hasKey, onNeedKey, onBack, onChanged }) {
  // The full chat history with the model. messages[0] is our "Teach me…" prompt.
  const [messages, setMessages] = useState([])
  // The main lesson body (first assistant reply) shown at the top.
  const [lessonText, setLessonText] = useState('')
  // While streaming, text accumulates here and renders live.
  const [streaming, setStreaming] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState(STATUS.NOT_STARTED)

  // Inputs for the interactive boxes.
  const [followUp, setFollowUp] = useState('')
  const [teachBack, setTeachBack] = useState('')

  // Lets us cancel an in-flight stream, and guard against React StrictMode
  // running our "load on mount" effect twice in development.
  const abortRef = useRef(null)
  const didInit = useRef(false)

  const system = buildSystemPrompt(topic)

  // Everything in `messages` after the first assistant reply = the follow-up
  // thread (hints, follow-ups, teach-back feedback).
  const firstAssistantIdx = messages.findIndex((m) => m.role === 'assistant')
  const thread =
    firstAssistantIdx >= 0 ? messages.slice(firstAssistantIdx + 1) : []

  // --- Load cached lesson (or auto-generate the first time) -----------------
  useEffect(() => {
    if (didInit.current) return
    didInit.current = true

    ;(async () => {
      const cached = await getLesson(topic.id)
      const savedStatus = await getProgress(topic.id)
      setStatus(savedStatus)

      if (cached) {
        // Restore from cache — no tokens spent.
        setMessages(cached.messages || [])
        const firstAssistant = (cached.messages || []).find(
          (m) => m.role === 'assistant'
        )
        setLessonText(cached.markdown || firstAssistant?.content || '')
      } else if (hasKey) {
        // No cache yet: generate now (this spends tokens once).
        runGeneration(false)
      }
      // If there is no cache AND no key, we show a "Generate" button instead.
    })()

    // Cleanup: if the user navigates away mid-stream, cancel the request.
    return () => abortRef.current?.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- Core: generate (or regenerate) the main lesson -----------------------
  async function runGeneration(isRegenerate) {
    if (!hasKey) {
      onNeedKey()
      return
    }
    setError('')
    setBusy(true)
    setStreaming('')
    setLessonText('')

    // A regenerate starts a fresh conversation; clears the old thread too.
    const baseMessages = [
      { role: 'user', content: buildLessonRequest(topic) },
    ]

    const controller = new AbortController()
    abortRef.current = controller

    let acc = ''
    try {
      await generate({
        kind: 'premium', // lessons use the strong model
        system,
        messages: baseMessages,
        signal: controller.signal,
        onToken: (t) => {
          acc += t
          setStreaming(acc)
        },
      })

      const assistantMsg = { role: 'assistant', content: acc }
      const full = [...baseMessages, assistantMsg]
      setMessages(full)
      setLessonText(acc)
      setStreaming('')

      // Cache the lesson so reopening is free + offline.
      await saveLesson(topic.id, { markdown: acc, messages: full })

      // Parse + store flashcards. On regenerate, replace old cards for this
      // topic so we don't pile up duplicates.
      const cards = extractFlashcards(acc)
      if (cards.length) {
        if (isRegenerate) await deleteFlashcardsByTopic(topic.id)
        await addFlashcards(cards.map((c) => createCard(topic.id, c.q, c.a)))
      }

      // Opening/generating a lesson moves it to "In progress" (unless already
      // completed).
      if (status !== STATUS.COMPLETED) {
        await setProgress(topic.id, STATUS.IN_PROGRESS)
        setStatus(STATUS.IN_PROGRESS)
      }
      onChanged?.()
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message || String(err))
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  // --- Send a follow-up turn that CONTINUES the conversation ----------------
  // Used by "I'm Stuck", "Ask Follow-up", and "Check my understanding".
  async function sendTurn(userContent, kind = 'premium') {
    if (!hasKey) {
      onNeedKey()
      return
    }
    setError('')
    setBusy(true)

    const userMsg = { role: 'user', content: userContent }
    // Show the user's message immediately, plus an empty assistant slot that we
    // fill as the reply streams in.
    const withUser = [...messages, userMsg]
    setMessages([...withUser, { role: 'assistant', content: '' }])

    const controller = new AbortController()
    abortRef.current = controller

    let acc = ''
    try {
      await generate({
        kind,
        system,
        messages: withUser, // send history WITHOUT the empty placeholder
        signal: controller.signal,
        onToken: (t) => {
          acc += t
          // Update only the last (assistant) message as it streams.
          setMessages((prev) => {
            const copy = prev.slice()
            copy[copy.length - 1] = { role: 'assistant', content: acc }
            return copy
          })
        },
      })

      const full = [...withUser, { role: 'assistant', content: acc }]
      setMessages(full)
      // Persist the extended conversation (lesson body stays the same markdown).
      await saveLesson(topic.id, { markdown: lessonText, messages: full })
      onChanged?.()
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message || String(err))
      // Roll back the empty placeholder on failure.
      setMessages(withUser)
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  // --- Button handlers ------------------------------------------------------
  function handleStuck() {
    sendTurn("I'm stuck. Give me the next hint in your hint ladder (start small).")
  }

  function handleFollowUp(e) {
    e.preventDefault()
    const text = followUp.trim()
    if (!text) return
    setFollowUp('')
    sendTurn(text)
  }

  function handleTeachBack(e) {
    e.preventDefault()
    const text = teachBack.trim()
    if (!text) return
    sendTurn(
      `Here is my teach-back explanation in my own words. Check my understanding, ` +
        `point out anything wrong or missing, and confirm what I got right:\n\n${text}`
    )
    setTeachBack('')
  }

  async function handleComplete() {
    await setProgress(topic.id, STATUS.COMPLETED)
    setStatus(STATUS.COMPLETED)
    onChanged?.()
  }

  function handleStop() {
    abortRef.current?.abort()
  }

  // --- Render ---------------------------------------------------------------
  const hasLesson = Boolean(lessonText) || Boolean(streaming)

  return (
    <div className="lesson">
      <div className="lesson-bar">
        <button className="btn-ghost" onClick={onBack}>
          ← Curriculum
        </button>
        <span className={`badge ${status === STATUS.COMPLETED ? 'badge-green' : status === STATUS.IN_PROGRESS ? 'badge-amber' : 'badge-grey'}`}>
          {status === STATUS.COMPLETED
            ? 'Completed'
            : status === STATUS.IN_PROGRESS
              ? 'In progress'
              : 'Not started'}
        </span>
      </div>

      <h1 className="lesson-title">
        #{topic.id} · {topic.title}
        {topic.foundation && <span className="foundation-tag"> ∑ foundation</span>}
      </h1>

      {error && <div className="error">⚠ {error}</div>}

      {/* If there's nothing cached and we haven't generated, offer a button. */}
      {!hasLesson && !busy && (
        <div className="empty-lesson">
          <p className="muted">No lesson cached yet for this topic.</p>
          <button className="btn-primary" onClick={() => runGeneration(false)}>
            ✨ Generate lesson
          </button>
        </div>
      )}

      {/* Main lesson body (streaming text takes priority while generating). */}
      {hasLesson && <Markdown text={streaming || lessonText} />}

      {busy && (
        <div className="streaming-note">
          <span className="spinner" /> Generating…{' '}
          <button className="btn-ghost" onClick={handleStop}>
            Stop
          </button>
        </div>
      )}

      {/* Follow-up conversation thread (hints, questions, teach-back feedback). */}
      {thread.length > 0 && (
        <div className="thread">
          <h3>Conversation</h3>
          {thread.map((m, i) => (
            <div key={i} className={`bubble bubble-${m.role}`}>
              <div className="bubble-role">
                {m.role === 'user' ? 'You' : 'Tutor'}
              </div>
              <Markdown text={m.content} />
            </div>
          ))}
        </div>
      )}

      {/* Action buttons appear once a lesson exists. */}
      {hasLesson && !busy && (
        <>
          <div className="lesson-actions">
            <button className="btn" onClick={() => runGeneration(true)}>
              🔄 Regenerate
            </button>
            <button
              className="btn"
              onClick={handleComplete}
              disabled={status === STATUS.COMPLETED}
            >
              ✓ Mark complete
            </button>
            <button className="btn" onClick={handleStuck}>
              🆘 I'm stuck
            </button>
          </div>

          {/* Ask a free-text follow-up that continues the lesson context. */}
          <form className="ask-form" onSubmit={handleFollowUp}>
            <label>Ask a follow-up</label>
            <div className="row">
              <input
                type="text"
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                placeholder="e.g. Can you give another example?"
              />
              <button className="btn-primary" type="submit">
                Send
              </button>
            </div>
          </form>

          {/* Teach-back: explain it back, get feedback. */}
          <form className="ask-form teachback" onSubmit={handleTeachBack}>
            <label>Teach-back — explain this topic in your own words</label>
            <textarea
              rows={4}
              value={teachBack}
              onChange={(e) => setTeachBack(e.target.value)}
              placeholder="Type your explanation here…"
            />
            <button className="btn-primary" type="submit">
              Check my understanding
            </button>
          </form>
        </>
      )}
    </div>
  )
}

// Edge cases this file does NOT handle:
// - If generation fails halfway, the partial text is NOT saved to cache (we only
//   save on success), so reopening will re-generate.
// - Two lessons cannot be generated at once from this screen (busy disables the
//   buttons), but opening another topic in a second tab is independent.
// - Very long conversations grow the saved `messages` array unbounded; for this
//   study app that is acceptable.
