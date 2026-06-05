// src/components/Lesson.jsx
// -----------------------------------------------------------------------------
// The lesson screen — the heart of the app. Responsibilities:
//   - Load a CACHED lesson (free/offline) or GENERATE it (personalized to the
//     learner's level + notes), streaming the markdown as it arrives.
//   - Voice tutor: read the lesson aloud and let the user ASK by voice (free,
//     browser Web Speech API; works in English and Farsi).
//   - After the lesson, a 4-option COMPREHENSION CHECK that updates the learner
//     profile so the NEXT lesson is personalized.
//   - Interactive: Regenerate, Mark Complete, "I'm Stuck", Ask Follow-up,
//     Teach-back. Each AI section shows its token/cost.
// -----------------------------------------------------------------------------
import { useEffect, useRef, useState } from 'react'
import { generate } from '../lib/api.js'
import {
  buildSystemPrompt,
  comprehensionSystem,
  buildComprehensionRequest,
} from '../lib/prompts.js'
import { extractJsonObject } from '../lib/parse.js'
import { generateAndCacheLesson } from '../lib/lessonGen.js'
import {
  STATUS,
  getLesson,
  saveLesson,
  setProgress,
  getProgress,
  getProfile,
  setComprehension,
  appendKnowledgeNote,
} from '../lib/db.js'
import { getSettings } from '../lib/storage.js'
import { speak, speakAI, stopSpeaking, listenOnce, isTtsSupported, isSttSupported } from '../lib/speech.js'
import { t } from '../lib/i18n.js'
import Markdown from './Markdown.jsx'
import CostTag from './CostTag.jsx'

export default function Lesson({
  topic,
  hasKey,
  onNeedKey,
  onBack,
  onChanged,
  lang = 'en',
  nextTopic,
  onOpenTopic,
}) {
  const [messages, setMessages] = useState([])
  const [lessonText, setLessonText] = useState('')
  const [streaming, setStreaming] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState(STATUS.NOT_STARTED)
  const [lessonUsage, setLessonUsage] = useState(null)

  const [followUp, setFollowUp] = useState('')
  const [teachBack, setTeachBack] = useState('')

  // Voice state.
  const [speaking, setSpeaking] = useState(false)
  const [listening, setListening] = useState(false)
  const speakRef = useRef(null)
  const listenRef = useRef(null)

  // Comprehension check state.
  const [comp, setComp] = useState({
    phase: 'idle', // idle | loading | active | done
    questions: [],
    idx: 0,
    picked: null,
    score: 0,
    usage: null,
  })

  const abortRef = useRef(null)
  const didInit = useRef(false)
  const settings = getSettings()
  const profileRef = useRef({})

  const firstAssistantIdx = messages.findIndex((m) => m.role === 'assistant')
  const thread = firstAssistantIdx >= 0 ? messages.slice(firstAssistantIdx + 1) : []

  // --- Load cached lesson (or auto-generate the first time) -----------------
  useEffect(() => {
    if (didInit.current) return
    didInit.current = true

    ;(async () => {
      profileRef.current = await getProfile()
      const cached = await getLesson(topic.id)
      setStatus(await getProgress(topic.id))

      if (cached) {
        setMessages(cached.messages || [])
        const firstAssistant = (cached.messages || []).find((m) => m.role === 'assistant')
        setLessonText(cached.markdown || firstAssistant?.content || '')
      } else if (hasKey) {
        runGeneration(false)
      }
    })()

    return () => {
      abortRef.current?.abort()
      stopSpeaking()
      listenRef.current?.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // System prompt rebuilt with the latest profile each call.
  function systemPrompt() {
    return buildSystemPrompt(topic, { ...profileRef.current, language: lang })
  }

  // --- Generate (or regenerate) the main lesson -----------------------------
  async function runGeneration(isRegenerate) {
    if (!hasKey) return onNeedKey()
    setError('')
    setBusy(true)
    setStreaming('')
    setLessonText('')
    setLessonUsage(null)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      profileRef.current = await getProfile()
      const result = await generateAndCacheLesson(topic, {
        signal: controller.signal,
        isRegenerate,
        onToken: (acc) => setStreaming(acc),
      })
      setMessages(result.messages)
      setLessonText(result.markdown)
      setStreaming('')
      setLessonUsage(result.usage)
      setStatus(await getProgress(topic.id))
      onChanged?.()
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message || String(err))
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  // --- Follow-up turn that CONTINUES the conversation -----------------------
  // Returns the assistant's final text (so voice mode can speak it).
  async function sendTurn(userContent, kind = 'premium') {
    if (!hasKey) {
      onNeedKey()
      return ''
    }
    setError('')
    setBusy(true)

    const userMsg = { role: 'user', content: userContent }
    const withUser = [...messages, userMsg]
    setMessages([...withUser, { role: 'assistant', content: '' }])

    const controller = new AbortController()
    abortRef.current = controller

    let acc = ''
    try {
      await generate({
        kind,
        system: systemPrompt(),
        messages: withUser,
        signal: controller.signal,
        label: `followup:${topic.id}`,
        onToken: (tk) => {
          acc += tk
          setMessages((prev) => {
            const copy = prev.slice()
            copy[copy.length - 1] = { role: 'assistant', content: acc }
            return copy
          })
        },
      })
      const full = [...withUser, { role: 'assistant', content: acc }]
      setMessages(full)
      await saveLesson(topic.id, { markdown: lessonText, messages: full })
      onChanged?.()
      return acc
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message || String(err))
      setMessages(withUser)
      return ''
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

  // --- Voice: read aloud ----------------------------------------------------
  // Start speaking `text`. Prefer the realistic AI voice (TTS model via the
  // provider); if it errors (e.g. the provider has no TTS model) fall back to
  // the free browser voice so the button always does something.
  function startSpeaking(text) {
    setSpeaking(true)
    if (settings.aiVoice) {
      speakRef.current = speakAI(text, {
        voice: settings.ttsVoice,
        model: settings.ttsModel,
        onEnd: () => setSpeaking(false),
        onError: (err) => {
          // The AI voice failed (often: the provider has no TTS model). Tell the
          // user why, then fall back to the free browser voice so something plays.
          setError(
            `AI voice unavailable (${err?.message || 'TTS error'}). Using the browser voice — check the TTS model in Settings.`,
          )
          speakRef.current = speak(text, {
            language: lang,
            rate: settings.voiceRate || 1,
            onEnd: () => setSpeaking(false),
            onError: () => setSpeaking(false),
          })
        },
      })
    } else {
      speakRef.current = speak(text, {
        language: lang,
        rate: settings.voiceRate || 1,
        onEnd: () => setSpeaking(false),
        onError: () => setSpeaking(false),
      })
    }
  }

  function handleListen() {
    if (speaking) {
      speakRef.current?.stop()
      setSpeaking(false)
      return
    }
    startSpeaking(lessonText)
  }

  // --- Voice: ask a question by speaking ------------------------------------
  async function handleAskByVoice() {
    if (!hasKey) return onNeedKey()
    if (listening) {
      listenRef.current?.stop()
      setListening(false)
      return
    }
    setError('')
    setListening(true)
    try {
      listenRef.current = listenOnce({ language: lang })
      const said = await listenRef.current.promise
      setListening(false)
      if (said && said.trim()) {
        const reply = await sendTurn(said.trim())
        if (reply) startSpeaking(reply)
      }
    } catch (err) {
      setListening(false)
      setError(err.message || String(err))
    }
  }

  // --- Comprehension check --------------------------------------------------
  async function startComprehension() {
    if (!hasKey) return onNeedKey()
    setError('')
    setComp((c) => ({ ...c, phase: 'loading' }))
    let acc = ''
    try {
      const { usage } = await generate({
        kind: 'cheap',
        system: comprehensionSystem(lang),
        messages: [{ role: 'user', content: buildComprehensionRequest(topic, 4) }],
        label: `check:${topic.id}`,
        onToken: (tk) => (acc += tk),
      })
      const parsed = extractJsonObject(acc)
      const qs = Array.isArray(parsed?.questions) ? parsed.questions : []
      if (!qs.length) throw new Error('Could not build a check. Try again.')
      setComp({ phase: 'active', questions: qs, idx: 0, picked: null, score: 0, usage })
    } catch (err) {
      setError(err.message || String(err))
      setComp((c) => ({ ...c, phase: 'idle' }))
    }
  }

  function pickComp(choiceIdx) {
    if (comp.picked !== null) return
    const correct = choiceIdx === comp.questions[comp.idx].answer
    setComp((c) => ({ ...c, picked: choiceIdx, score: c.score + (correct ? 1 : 0) }))
  }

  async function nextComp() {
    if (comp.idx + 1 < comp.questions.length) {
      setComp((c) => ({ ...c, idx: c.idx + 1, picked: null }))
      return
    }
    // Finished — store comprehension + feed it into the learner profile.
    const total = comp.questions.length
    const pct = Math.round((comp.score / total) * 100)
    await setComprehension(topic.id, pct)
    await appendKnowledgeNote(
      `Topic #${topic.id} (${topic.title}): comprehension check ${comp.score}/${total} (${pct}%).`
    )
    profileRef.current = await getProfile()
    onChanged?.()
    setComp((c) => ({ ...c, phase: 'done' }))
  }

  // --- Render ---------------------------------------------------------------
  const hasLesson = Boolean(lessonText) || Boolean(streaming)
  const statusBadge =
    status === STATUS.COMPLETED ? 'badge-green' : status === STATUS.IN_PROGRESS ? 'badge-amber' : 'badge-grey'
  const statusKey =
    status === STATUS.COMPLETED ? 'completed' : status === STATUS.IN_PROGRESS ? 'inProgress' : 'notStarted'

  return (
    <div className="lesson">
      <div className="lesson-bar">
        <button className="btn-ghost" onClick={onBack}>
          {t('back', lang)}
        </button>
        <span className={`badge ${statusBadge}`}>{t(statusKey, lang)}</span>
      </div>

      <h1 className="lesson-title">
        #{topic.id} · {topic.title}
        {topic.foundation && <span className="foundation-tag"> ∑</span>}
      </h1>

      {error && <div className="error">{error}</div>}

      {!hasLesson && !busy && (
        <div className="empty-lesson">
          <p className="muted">No lesson cached yet for this topic.</p>
          <button className="btn-primary" onClick={() => runGeneration(false)}>
            {t('generateLesson', lang)}
          </button>
        </div>
      )}

      {/* Voice controls (only when a lesson exists and the browser supports it) */}
      {hasLesson && (isTtsSupported() || isSttSupported()) && (
        <div className="voice-bar">
          {isTtsSupported() && settings.voiceEnabled && (
            <button className="btn btn-small" onClick={handleListen} disabled={busy}>
              {speaking ? `⏹ ${t('stopAudio', lang)}` : `▶ ${t('listen', lang)}`}
            </button>
          )}
          {isSttSupported() && settings.voiceEnabled && (
            <button className="btn btn-small" onClick={handleAskByVoice} disabled={busy}>
              {listening ? `● ${t('listening', lang)}` : `🎤 ${t('askByVoice', lang)}`}
            </button>
          )}
        </div>
      )}

      {hasLesson && <Markdown text={streaming || lessonText} />}

      {busy && (
        <div className="streaming-note">
          <span className="spinner" /> {t('generating', lang)}{' '}
          <button className="btn-ghost" onClick={handleStop}>
            {t('stop', lang)}
          </button>
        </div>
      )}

      {/* Cost of generating this lesson (this session). */}
      {!busy && lessonUsage && <CostTag usage={lessonUsage} lang={lang} />}

      {/* Conversation thread (hints, follow-ups, teach-back feedback). */}
      {thread.length > 0 && (
        <div className="thread">
          <h3>Conversation</h3>
          {thread.map((m, i) => (
            <div key={i} className={`bubble bubble-${m.role}`}>
              <div className="bubble-role">{m.role === 'user' ? 'You' : 'Tutor'}</div>
              <Markdown text={m.content} />
            </div>
          ))}
        </div>
      )}

      {/* Actions + comprehension + interactive boxes (once a lesson exists). */}
      {hasLesson && !busy && (
        <>
          <div className="lesson-actions">
            <button className="btn" onClick={() => runGeneration(true)}>
              {t('regenerate', lang)}
            </button>
            <button className="btn" onClick={handleComplete} disabled={status === STATUS.COMPLETED}>
              {t('markComplete', lang)}
            </button>
            <button className="btn" onClick={handleStuck}>
              {t('imStuck', lang)}
            </button>
          </div>

          {/* Comprehension check (personalizes the next lesson). */}
          <div className="comp-block">
            <h3>{t('comprehensionTitle', lang)}</h3>

            {comp.phase === 'idle' && (
              <button className="btn-primary" onClick={startComprehension}>
                {t('startCheck', lang)}
              </button>
            )}

            {comp.phase === 'loading' && (
              <p className="muted">
                <span className="spinner" /> {t('generating', lang)}
              </p>
            )}

            {comp.phase === 'active' && comp.questions[comp.idx] && (
              <div className="card">
                <div className="muted">
                  {comp.idx + 1} / {comp.questions.length}
                </div>
                <div className="quiz-q">{comp.questions[comp.idx].q}</div>
                <ul className="choices">
                  {comp.questions[comp.idx].choices.map((choice, ci) => {
                    let cls = ''
                    if (comp.picked !== null) {
                      if (ci === comp.questions[comp.idx].answer) cls = 'choice-correct'
                      else if (ci === comp.picked) cls = 'choice-wrong'
                    }
                    return (
                      <li key={ci}>
                        <button
                          className={`choice ${cls}`}
                          onClick={() => pickComp(ci)}
                          disabled={comp.picked !== null}
                        >
                          {choice}
                        </button>
                      </li>
                    )
                  })}
                </ul>
                {comp.picked !== null && (
                  <div className="explanation">
                    {comp.questions[comp.idx].explanation && (
                      <p>{comp.questions[comp.idx].explanation}</p>
                    )}
                    <button className="btn-primary" onClick={nextComp}>
                      {comp.idx + 1 < comp.questions.length ? 'Next →' : 'Finish'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {comp.phase === 'done' && (
              <div className="card">
                <h2>
                  {t('yourScore', lang)}: {comp.score} / {comp.questions.length}
                </h2>
                <p className="muted">
                  {lang === 'fa'
                    ? 'این نتیجه برای شخصی‌سازی درس بعدی ذخیره شد.'
                    : 'Saved — your next lesson will adapt to this.'}
                </p>
                <div className="row">
                  {nextTopic && (
                    <button className="btn-primary" onClick={() => onOpenTopic(nextTopic)}>
                      {t('nextLesson', lang)}
                    </button>
                  )}
                </div>
                <CostTag usage={comp.usage} lang={lang} />
              </div>
            )}
          </div>

          {/* Ask a free-text follow-up that continues the lesson context. */}
          <form className="ask-form" onSubmit={handleFollowUp}>
            <label>{t('askFollowUp', lang)}</label>
            <div className="row">
              <input
                type="text"
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                placeholder={lang === 'fa' ? 'مثلاً: یک مثال دیگر می‌دهی؟' : 'e.g. Can you give another example?'}
              />
              <button className="btn-primary" type="submit">
                {t('send', lang)}
              </button>
            </div>
          </form>

          {/* Teach-back: explain it back, get feedback. */}
          <form className="ask-form teachback" onSubmit={handleTeachBack}>
            <label>{t('teachBack', lang)}</label>
            <textarea
              rows={4}
              value={teachBack}
              onChange={(e) => setTeachBack(e.target.value)}
              placeholder={lang === 'fa' ? 'توضیح خودت را اینجا بنویس…' : 'Type your explanation here…'}
            />
            <button className="btn-primary" type="submit">
              {t('checkUnderstanding', lang)}
            </button>
          </form>

          {/* Quick jump to the next lesson even without the check. */}
          {nextTopic && (
            <div className="next-row">
              <button className="btn" onClick={() => onOpenTopic(nextTopic)}>
                {t('nextLesson', lang)} #{nextTopic.id} · {nextTopic.title}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Edge cases this file does NOT handle:
// - Partial generations are not cached (only saved on success).
// - Voice quality/availability depends on the device (esp. Farsi voices).
// - Speech recognition needs mic permission + (usually) a network connection.
