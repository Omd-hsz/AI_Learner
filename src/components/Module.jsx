// src/components/Module.jsx
// -----------------------------------------------------------------------------
// Shows an entire module on ONE scrollable page. On open it:
//   1. Loads every cached lesson for the module's topics (instant, free).
//   2. Generates any missing lessons one-by-one (sequential, with progress).
// Each topic is a section with its full lesson markdown. Tap "Open lesson" on
// any section to jump to the interactive single-topic view (follow-ups, etc.).
// -----------------------------------------------------------------------------
import { useEffect, useRef, useState } from 'react'
import { STATUS, getLessonsForTopics, getProgress, setProgress } from '../lib/db.js'
import { generateAndCacheLesson } from '../lib/lessonGen.js'
import ProgressBar from './ProgressBar.jsx'
import Markdown from './Markdown.jsx'

const STATUS_META = {
  [STATUS.NOT_STARTED]: { label: 'Not started', cls: 'badge-grey' },
  [STATUS.IN_PROGRESS]: { label: 'In progress', cls: 'badge-amber' },
  [STATUS.COMPLETED]: { label: 'Completed', cls: 'badge-green' },
}

export default function Module({
  module,
  progress,
  hasKey,
  onNeedKey,
  onBack,
  onOpenTopic,
  onChanged,
}) {
  // Per-topic UI state: markdown text, optional streaming buffer, status badge.
  const [topics, setTopics] = useState(() =>
    module.topics.map((t) => ({
      topic: t,
      markdown: '',
      streaming: '',
      status: progress[t.id] || STATUS.NOT_STARTED,
      loaded: false,
    }))
  )
  const [batch, setBatch] = useState(null) // { index, total, title } while generating
  const [error, setError] = useState('')
  const abortRef = useRef(null)
  const didInit = useRef(false)

  const doneCount = topics.filter((t) => t.status === STATUS.COMPLETED).length
  const loadedCount = topics.filter((t) => t.loaded).length

  // --- Load cache, then generate anything still missing ---------------------
  useEffect(() => {
    if (didInit.current) return
    didInit.current = true
    loadWholeModule()
    return () => abortRef.current?.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadWholeModule() {
    setError('')
    const ids = module.topics.map((t) => t.id)
    const cached = await getLessonsForTopics(ids)

    // Hydrate from cache first.
    setTopics((prev) =>
      prev.map((row) => {
        const hit = cached[row.topic.id]
        if (!hit) return { ...row, loaded: false }
        const md =
          hit.markdown ||
          (hit.messages || []).find((m) => m.role === 'assistant')?.content ||
          ''
        return {
          ...row,
          markdown: md,
          status: progress[row.topic.id] || STATUS.NOT_STARTED,
          loaded: Boolean(md),
        }
      })
    )

    // We do NOT auto-generate every topic anymore (that wastes tokens and the
    // learner usually wants to go lesson-by-lesson). Missing topics are shown
    // with a per-topic "Open lesson" button, plus an explicit "Generate all
    // missing" button for anyone who really wants the whole module at once.
  }

  async function generateMissing(missingList, alreadyCached = {}) {
    if (!hasKey) return onNeedKey()

    const controller = new AbortController()
    abortRef.current = controller

    try {
      for (let i = 0; i < missingList.length; i++) {
        const topic = missingList[i]
        setBatch({
          index: i + 1,
          total: missingList.length,
          title: topic.title,
        })
        setTopics((prev) =>
          prev.map((row) =>
            row.topic.id === topic.id ? { ...row, streaming: '', loaded: false } : row
          )
        )

        const result = await generateAndCacheLesson(topic, {
          signal: controller.signal,
          onToken: (acc) => {
            setTopics((prev) =>
              prev.map((row) =>
                row.topic.id === topic.id ? { ...row, streaming: acc } : row
              )
            )
          },
        })

        const savedStatus = await getProgress(topic.id)
        setTopics((prev) =>
          prev.map((row) =>
            row.topic.id === topic.id
              ? {
                  ...row,
                  markdown: result.markdown,
                  streaming: '',
                  status: savedStatus,
                  loaded: true,
                }
              : row
          )
        )
        onChanged?.()
      }
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message || String(err))
    } finally {
      setBatch(null)
      abortRef.current = null
    }
  }

  async function handleGenerateAll() {
    const missing = topics.filter((t) => !t.loaded).map((t) => t.topic)
    if (!missing.length) return
    await generateMissing(missing)
  }

  function handleStop() {
    abortRef.current?.abort()
    setBatch(null)
  }

  async function markComplete(topicId) {
    await setProgress(topicId, STATUS.COMPLETED)
    setTopics((prev) =>
      prev.map((row) =>
        row.topic.id === topicId ? { ...row, status: STATUS.COMPLETED } : row
      )
    )
    onChanged?.()
  }

  const missingCount = topics.filter((t) => !t.loaded && !t.streaming).length

  return (
    <div className="module-view">
      <div className="lesson-bar">
        <button className="btn-ghost" onClick={onBack}>
          ← Curriculum
        </button>
        <span className="muted small">
          {loadedCount} / {module.topics.length} loaded
        </span>
      </div>

      <h1 className="lesson-title">{module.title}</h1>
      <ProgressBar completed={doneCount} total={module.topics.length} label="Module" />

      {batch && (
        <div className="batch-banner">
          <span className="spinner" />
          Generating lesson {batch.index} of {batch.total}:{' '}
          <em>{batch.title}</em>
          <button className="btn-ghost" onClick={handleStop}>
            Stop
          </button>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {!batch && missingCount > 0 && (
        <div className="module-actions">
          <p className="muted">
            {missingCount} topic{missingCount === 1 ? '' : 's'} not cached yet.
          </p>
          <button className="btn-primary" onClick={handleGenerateAll}>
            Generate all missing
          </button>
        </div>
      )}

      <div className="module-lessons">
        {topics.map((row) => {
          const meta = STATUS_META[row.status]
          const text = row.streaming || row.markdown
          return (
            <article
              key={row.topic.id}
              id={`topic-${row.topic.id}`}
              className="module-lesson-section"
            >
              <header className="module-lesson-head">
                <div>
                  <h2>
                    #{row.topic.id} · {row.topic.title}
                    {row.topic.foundation && (
                      <span className="foundation-tag"> ∑</span>
                    )}
                  </h2>
                  <span className={`badge ${meta.cls}`}>{meta.label}</span>
                </div>
                <div className="module-lesson-btns">
                  {row.loaded && row.status !== STATUS.COMPLETED && (
                    <button className="btn" onClick={() => markComplete(row.topic.id)}>
                      Mark complete
                    </button>
                  )}
                  <button className="btn" onClick={() => onOpenTopic(row.topic)}>
                    Open lesson
                  </button>
                </div>
              </header>

              {!text && !batch && (
                <p className="muted">Not generated yet.</p>
              )}

              {row.streaming && !row.markdown && (
                <p className="muted streaming-note">
                  <span className="spinner" /> Writing…
                </p>
              )}

              {text && <Markdown text={text} />}

              {row.loaded && <hr className="section-divider" />}
            </article>
          )
        })}
      </div>
    </div>
  )
}

// Edge cases this file does NOT handle:
// - Generating 14 foundation topics in one go can take a long time and cost
//   many tokens; we stop on first error and leave later topics uncached.
// - Parallel generation is intentionally avoided to reduce rate-limit errors.
