// src/components/Placement.jsx
// -----------------------------------------------------------------------------
// The placement test. Before loading any lessons, this asks a short 4-option
// diagnostic quiz spanning the whole course (easy→hard). From the answers it:
//   - estimates the learner's LEVEL (beginner / intermediate / advanced)
//   - recommends WHERE TO START (the earliest topic they got wrong)
//   - writes a short knowledge summary into the profile so later lessons are
//     personalized
//
// It asks 20 PRACTICAL questions tagged by skill (concept / math / coding) so the
// summary can tell later lessons which dimension to slow down on. Every question
// also gets an "I don't know" option — an honest gap is more useful than a guess.
//
// It uses the PREMIUM model (the cheap model wrote low-quality, predictable
// questions). To kill answer-position bias, we SHUFFLE each question's real
// choices on-device and recompute the correct index before showing it.
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

  // The label for the always-present honest "I don't know" choice.
  const idkLabel = lang === 'fa' ? 'نمی‌دانم' : "I don't know"

  // Take one model-written question and make it fair to display:
  //  1. keep only its 4 real choices,
  //  2. SHUFFLE them so the correct answer isn't stuck in one slot (kills the
  //     "the answer is always option 2" bias the model tends to have),
  //  3. recompute `answer` to point at the correct text's NEW position,
  //  4. append the "I don't know" option as the last choice.
  function prepareQuestion(q) {
    const real = q.choices.slice(0, 4)
    // Some models return the index as a string ("1"); coerce so it indexes right.
    const ans = Number(q.answer)
    const correctText = real[ans] ?? real[0]
    const shuffled = [...real]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return {
      ...q,
      skill: q.skill || 'concept',
      choices: [...shuffled, idkLabel],
      answer: shuffled.indexOf(correctText),
      idkIndex: shuffled.length, // the "I don't know" option, appended last
    }
  }

  async function startTest() {
    if (!hasKey) return onNeedKey()
    setError('')
    setPhase('loading')
    let acc = ''
    try {
      const { usage: u } = await generate({
        kind: 'premium',
        system: placementSystem(lang),
        messages: [{ role: 'user', content: buildPlacementRequest(orderedTopics, 20) }],
        label: 'placement',
        onToken: (tk) => (acc += tk),
      })
      const parsed = extractJsonObject(acc)
      const raw = Array.isArray(parsed?.questions) ? parsed.questions : []
      // Keep only well-formed questions, then make each one fair (shuffle + IDK).
      const qs = raw
        .filter((q) => q && Array.isArray(q.choices) && q.choices.length >= 2 && Number.isFinite(Number(q.answer)))
        .map(prepareQuestion)
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
    const unknown = choiceIdx === q.idkIndex
    setAnswers((a) => [
      ...a,
      { topicId: q.topicId, skill: q.skill || 'concept', correct: choiceIdx === q.answer, unknown },
    ])
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
    const unknownIds = answers.filter((a) => a.unknown).map((a) => a.topicId)

    // Per-skill breakdown (concept / math / coding) so lessons know which
    // dimension to slow down on. e.g. "math 1/6" => go very slow on math.
    const dimText = ['concept', 'math', 'coding']
      .map((d) => {
        const items = answers.filter((a) => a.skill === d)
        if (!items.length) return null
        return `${d} ${items.filter((a) => a.correct).length}/${items.length}`
      })
      .filter(Boolean)
      .join(', ')

    const notes =
      `Placement (20 practical Qs): ${correctCount}/${total} correct → ${level}. ` +
      `By skill: ${dimText || '—'}. ` +
      `Strong on: ${titlesFor(correctIds) || '—'}. ` +
      `Needs work on: ${titlesFor(wrongIds) || '—'}. ` +
      `Explicitly said "I don't know" on: ${titlesFor(unknownIds) || '—'} (real gaps — teach these from scratch). ` +
      `Adapt by skill: if math is weak, slow down on math with tiny hand-computed numbers; if coding is strong, teach through code; pitch terminology to the concept score.`

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
              ? '۲۰ پرسش کاربردی که دانش، ریاضی و برنامه‌نویسی تو را می‌سنجند. هر سؤال گزینهٔ «نمی‌دانم» هم دارد — اگر نمی‌دانی همان را بزن؛ صادقانه بودن کمک می‌کند درس‌ها دقیق‌تر برای تو ساخته شوند.'
              : '20 practical questions that gauge your AI knowledge, math, and coding. Every question has an "I don\'t know" option — use it honestly; real gaps help us tailor every lesson to you.'}
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
                // Don't paint "I don't know" red — it's an honest answer, not wrong.
                else if (ci === picked && picked !== current.idkIndex) cls = 'choice-wrong'
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
