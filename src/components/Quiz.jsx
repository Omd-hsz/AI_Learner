// src/components/Quiz.jsx
// -----------------------------------------------------------------------------
// "Quiz me" — a retrieval-practice quiz over the topics you've COMPLETED.
// Retrieval practice (testing yourself) is one of the strongest ways to lock in
// memory, so we only quiz finished topics.
//
// We use the CHEAP model here (quizzes are simple and we do many of them), as
// the spec requires. The model returns multiple-choice questions as JSON; we
// render them, grade locally, and log the score to IndexedDB.
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from 'react'
import { generate } from '../lib/api.js'
import { extractJsonObject } from '../lib/parse.js'
import { STATUS, getAllProgress, addQuizScore, getAllQuizScores } from '../lib/db.js'

// A focused system prompt: we want STRICT JSON so we can parse it reliably.
const QUIZ_SYSTEM = `You are a quiz generator for retrieval practice. Write clear multiple-choice questions that test understanding (not trivia). Return ONLY valid JSON, no prose, in exactly this shape:
{"questions":[{"q":"question text","choices":["A","B","C","D"],"answer":0,"explanation":"why the answer is correct"}]}
"answer" is the 0-based index of the correct choice.`

export default function Quiz({ curriculum, hasKey, onNeedKey, onBack }) {
  const [phase, setPhase] = useState('idle') // idle | loading | active | done
  const [questions, setQuestions] = useState([])
  const [idx, setIdx] = useState(0)
  const [picked, setPicked] = useState(null) // index the user clicked
  const [score, setScore] = useState(0)
  const [error, setError] = useState('')
  const [history, setHistory] = useState([])

  // Build a list of completed topics to quiz over.
  const [completedTopics, setCompletedTopics] = useState([])

  const titleById = useMemo(() => {
    const map = {}
    curriculum?.modules.forEach((m) =>
      m.topics.forEach((t) => (map[t.id] = t.title))
    )
    return map
  }, [curriculum])

  useEffect(() => {
    ;(async () => {
      const progress = await getAllProgress()
      const done = Object.entries(progress)
        .filter(([, s]) => s === STATUS.COMPLETED)
        .map(([id]) => ({ id, title: titleById[id] || id }))
      setCompletedTopics(done)
      setHistory(await getAllQuizScores())
    })()
  }, [titleById])

  async function startQuiz() {
    if (!hasKey) return onNeedKey()
    setError('')
    setPhase('loading')

    // Tell the cheap model which topics to cover.
    const topicList = completedTopics.map((t) => `#${t.id} ${t.title}`).join('\n')
    const userMsg = {
      role: 'user',
      content: `Create 5 multiple-choice questions spread across these completed topics:\n${topicList}`,
    }

    let acc = ''
    try {
      await generate({
        kind: 'cheap', // quizzes use the cheap model
        system: QUIZ_SYSTEM,
        messages: [userMsg],
        onToken: (t) => (acc += t),
      })
      const parsed = extractJsonObject(acc)
      const qs = Array.isArray(parsed?.questions) ? parsed.questions : []
      if (!qs.length) throw new Error('The model did not return any questions. Try again.')
      setQuestions(qs)
      setIdx(0)
      setScore(0)
      setPicked(null)
      setPhase('active')
    } catch (err) {
      setError(err.message || String(err))
      setPhase('idle')
    }
  }

  function pick(choiceIdx) {
    if (picked !== null) return // already answered this question
    setPicked(choiceIdx)
    if (choiceIdx === questions[idx].answer) setScore((s) => s + 1)
  }

  async function next() {
    if (idx + 1 < questions.length) {
      setIdx(idx + 1)
      setPicked(null)
    } else {
      // Quiz finished — log the score.
      const record = {
        date: new Date().toISOString(),
        total: questions.length,
        correct: score,
        topicIds: completedTopics.map((t) => t.id),
      }
      await addQuizScore(record)
      setHistory((h) => [...h, record])
      setPhase('done')
    }
  }

  // --- Render ---------------------------------------------------------------
  const current = questions[idx]

  return (
    <div className="quiz">
      <div className="lesson-bar">
        <button className="btn-ghost" onClick={onBack}>
          ← Curriculum
        </button>
      </div>
      <h1>Quiz me</h1>

      {error && <div className="error">⚠ {error}</div>}

      {phase === 'idle' && (
        <>
          {completedTopics.length === 0 ? (
            <p className="muted">
              Complete at least one topic first, then come back to be quizzed on it.
            </p>
          ) : (
            <>
              <p>
                Ready to test yourself on{' '}
                <strong>{completedTopics.length}</strong> completed topic
                {completedTopics.length === 1 ? '' : 's'}.
              </p>
              <button className="btn-primary" onClick={startQuiz}>
                ▶ Start 5-question quiz
              </button>
            </>
          )}

          {history.length > 0 && (
            <div className="quiz-history">
              <h3>Past scores</h3>
              <ul>
                {history
                  .slice()
                  .reverse()
                  .map((h, i) => (
                    <li key={i}>
                      {new Date(h.date).toLocaleDateString()} —{' '}
                      <strong>
                        {h.correct}/{h.total}
                      </strong>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </>
      )}

      {phase === 'loading' && (
        <p className="muted">
          <span className="spinner" /> Writing your quiz…
        </p>
      )}

      {phase === 'active' && current && (
        <div className="card">
          <div className="muted">
            Question {idx + 1} of {questions.length}
          </div>
          <div className="quiz-q">{current.q}</div>
          <ul className="choices">
            {current.choices.map((choice, ci) => {
              // After answering, colour the correct one green and a wrong pick red.
              let cls = ''
              if (picked !== null) {
                if (ci === current.answer) cls = 'choice-correct'
                else if (ci === picked) cls = 'choice-wrong'
              }
              return (
                <li key={ci}>
                  <button
                    className={`choice ${cls}`}
                    onClick={() => pick(ci)}
                    disabled={picked !== null}
                  >
                    {choice}
                  </button>
                </li>
              )
            })}
          </ul>

          {picked !== null && (
            <div className="explanation">
              <strong>
                {picked === current.answer ? '✓ Correct' : '✗ Not quite'}
              </strong>
              {current.explanation && <p>{current.explanation}</p>}
              <button className="btn-primary" onClick={next}>
                {idx + 1 < questions.length ? 'Next →' : 'Finish'}
              </button>
            </div>
          )}
        </div>
      )}

      {phase === 'done' && (
        <div className="card">
          <h2>
            You scored {score} / {questions.length}
          </h2>
          <button className="btn-primary" onClick={() => setPhase('idle')}>
            Back to quiz menu
          </button>
        </div>
      )}
    </div>
  )
}

// Edge cases this file does NOT handle:
// - If the model returns malformed/empty JSON, we show an error and stay idle.
// - "answer" out of range would simply never match a pick; we trust the model's
//   index. A stricter validator could clamp/verify it.
