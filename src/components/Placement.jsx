// src/components/Placement.jsx
// -----------------------------------------------------------------------------
// The placement test. Before loading any lessons, this asks a short 4-option
// diagnostic quiz spanning the whole course (easy→hard). From the answers it:
//   - estimates the learner's LEVEL (beginner / intermediate / advanced)
//   - recommends WHERE TO START (the earliest topic they got wrong)
//   - writes a short knowledge summary into the profile so later lessons are
//     personalized
// It uses the CHEAP model and shows the cost at the end.
// -----------------------------------------------------------------------------
import { useMemo, useState } from 'react'
import { generate } from '../lib/api.js'
import { extractJsonObject } from '../lib/parse.js'
import { placementSystem, buildPlacementRequest } from '../lib/prompts.js'
import { saveProfile } from '../lib/db.js'
import { t } from '../lib/i18n.js'
import CostTag from './CostTag.jsx'

export default function Placement({ curriculum, hasKey, onNeedKey, onBack, onStartTopic, onChanged, lang = 'en' }) {
  const [phase, setPhase] = useState('idle') // idle | loading | active | done
  const [questions, setQuestions] = useState([])
  const [idx, setIdx] = useState(0)
  const [picked, setPicked] = useState(null)
  const [answers, setAnswers] = useState([]) // { topicId, correct }
  const [error, setError] = useState('')
  const [usage, setUsage] = useState(null)
  const [result, setResult] = useState(null) // { level, recommended, score, total }

  // Flat, ordered topic list + lookup by id.
  const orderedTopics = useMemo(
    () => (curriculum ? curriculum.modules.flatMap((m) => m.topics) : []),
    [curriculum]
  )
  const topicById = useMemo(() => {
    const map = {}
    orderedTopics.forEach((tp) => (map[tp.id] = tp))
    return map
  }, [orderedTopics])

  async function startTest() {
    if (!hasKey) return onNeedKey()
    setError('')
    setPhase('loading')
    let acc = ''
    try {
      const { usage: u } = await generate({
        kind: 'cheap',
        system: placementSystem(lang),
        messages: [{ role: 'user', content: buildPlacementRequest(orderedTopics, 8) }],
        label: 'placement',
        onToken: (tk) => (acc += tk),
      })
      const parsed = extractJsonObject(acc)
      const qs = Array.isArray(parsed?.questions) ? parsed.questions : []
      if (!qs.length) throw new Error('The model did not return a test. Try again.')
      setUsage(u)
      setQuestions(qs)
      setIdx(0)
      setPicked(null)
      setAnswers([])
      setPhase('active')
    } catch (err) {
      setError(err.message || String(err))
      setPhase('idle')
    }
  }

  function pick(choiceIdx) {
    if (picked !== null) return
    setPicked(choiceIdx)
    const q = questions[idx]
    setAnswers((a) => [...a, { topicId: q.topicId, correct: choiceIdx === q.answer }])
  }

  async function next() {
    if (idx + 1 < questions.length) {
      setIdx(idx + 1)
      setPicked(null)
      return
    }
    // Finished — compute level + recommended start, then save to profile.
    const correctCount = answers.filter((a) => a.correct).length
    const total = answers.length
    const pct = total ? correctCount / total : 0
    const level = pct >= 0.8 ? 'advanced' : pct >= 0.5 ? 'intermediate' : 'beginner'

    // Recommend the EARLIEST course topic the learner answered wrong.
    const wrongIds = answers.filter((a) => !a.correct).map((a) => a.topicId)
    let recommended = orderedTopics[0]?.id
    for (const tp of orderedTopics) {
      if (wrongIds.includes(tp.id)) {
        recommended = tp.id
        break
      }
    }

    // Build a short knowledge note for personalization.
    const titlesFor = (ids) =>
      [...new Set(ids)]
        .map((id) => topicById[id]?.title)
        .filter(Boolean)
        .slice(0, 8)
        .join('; ')
    const correctIds = answers.filter((a) => a.correct).map((a) => a.topicId)
    const notes =
      `Placement test: scored ${correctCount}/${total} → ${level}. ` +
      `Answered correctly around: ${titlesFor(correctIds) || '—'}. ` +
      `Needs work on: ${titlesFor(wrongIds) || '—'}.`

    await saveProfile({
      level,
      placementDone: true,
      recommendedTopicId: recommended,
      knowledgeNotes: notes,
    })
    onChanged?.()
    setResult({ level, recommended, score: correctCount, total })
    setPhase('done')
  }

  const current = questions[idx]
  const levelLabel = {
    beginner: lang === 'fa' ? 'مبتدی' : 'Beginner',
    intermediate: lang === 'fa' ? 'متوسط' : 'Intermediate',
    advanced: lang === 'fa' ? 'پیشرفته' : 'Advanced',
  }

  return (
    <div className="placement">
      <div className="lesson-bar">
        <button className="btn-ghost" onClick={onBack}>
          {t('back', lang)}
        </button>
      </div>
      <h1>{t('findMyLevel', lang)}</h1>

      {error && <div className="error">{error}</div>}

      {phase === 'idle' && (
        <div className="card">
          <p>
            {lang === 'fa'
              ? 'یک آزمون کوتاه چهارگزینه‌ای بده تا بفهمیم از کجا شروع کنی و درس‌ها متناسب با سطح تو ساخته شوند.'
              : 'Take a short 4-option diagnostic so we can find where to start and tailor every lesson to your level.'}
          </p>
          <button className="btn-primary" onClick={startTest}>
            {lang === 'fa' ? 'شروع آزمون تعیین سطح' : 'Start placement test'}
          </button>
        </div>
      )}

      {phase === 'loading' && (
        <p className="muted">
          <span className="spinner" /> {t('generating', lang)}
        </p>
      )}

      {phase === 'active' && current && (
        <div className="card">
          <div className="muted">
            {idx + 1} / {questions.length}
            {current.difficulty ? ` · ${current.difficulty}` : ''}
          </div>
          <div className="quiz-q">{current.q}</div>
          <ul className="choices">
            {current.choices.map((choice, ci) => {
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
              {current.explanation && <p>{current.explanation}</p>}
              <button className="btn-primary" onClick={next}>
                {idx + 1 < questions.length ? 'Next →' : 'Finish'}
              </button>
            </div>
          )}
        </div>
      )}

      {phase === 'done' && result && (
        <div className="card">
          <h2>
            {t('yourScore', lang)}: {result.score} / {result.total}
          </h2>
          <p>
            {lang === 'fa' ? 'سطح تخمینی: ' : 'Estimated level: '}
            <strong>{levelLabel[result.level]}</strong>
          </p>
          {topicById[result.recommended] && (
            <p>
              {lang === 'fa' ? 'پیشنهاد شروع از: ' : 'Recommended start: '}
              <strong>
                #{result.recommended} · {topicById[result.recommended].title}
              </strong>
            </p>
          )}
          <div className="row">
            {topicById[result.recommended] && (
              <button
                className="btn-primary"
                onClick={() => onStartTopic(topicById[result.recommended])}
              >
                {lang === 'fa' ? 'شروع درس پیشنهادی' : 'Start recommended lesson'}
              </button>
            )}
            <button className="btn" onClick={onBack}>
              {t('back', lang)}
            </button>
          </div>
          <CostTag usage={usage} lang={lang} />
        </div>
      )}
    </div>
  )
}

// Edge cases this file does NOT handle:
// - If the model returns topicIds that aren't in the curriculum, recommendation
//   falls back to the first topic.
// - It estimates level from a single short quiz; the per-lesson comprehension
//   checks refine the profile over time.
