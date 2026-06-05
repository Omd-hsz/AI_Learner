// src/App.jsx
// -----------------------------------------------------------------------------
// The top-level component. It:
//   - loads curriculum.json once
//   - keeps the "current screen" (home / lesson / cards / quiz / settings)
//   - holds shared data the screens need (progress map, # cards due, hasKey)
//   - shows a first-use API-key prompt
//
// We deliberately do NOT use a router library: a single `view` string is enough
// for five screens and keeps the app tiny.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from 'react'
import Home from './components/Home.jsx'
import Module from './components/Module.jsx'
import Lesson from './components/Lesson.jsx'
import Flashcards from './components/Flashcards.jsx'
import Quiz from './components/Quiz.jsx'
import Settings from './components/Settings.jsx'
import Placement from './components/Placement.jsx'
import { getAllProgress, getAllFlashcards, getProfile } from './lib/db.js'
import { getDueCards } from './lib/srs.js'
import { hasApiKey, saveSettings, getSettings } from './lib/storage.js'
import { t, isRTL } from './lib/i18n.js'

export default function App() {
  const [curriculum, setCurriculum] = useState(null)
  const [view, setView] = useState('home')
  const [module, setModule] = useState(null)
  const [topic, setTopic] = useState(null)

  // Shared, frequently-read state.
  const [progress, setProgress] = useState({})
  const [dueCount, setDueCount] = useState(0)
  const [hasKey, setHasKey] = useState(hasApiKey())
  const [lang, setLang] = useState(getSettings().language || 'en')
  const [profile, setProfile] = useState({})

  // First-use prompt: show only if there is no key yet.
  const [showKeyPrompt, setShowKeyPrompt] = useState(!hasApiKey())

  // Re-read progress, due count, key, language, and profile. Children call this
  // after they change data so the UI stays in sync.
  const refresh = useCallback(async () => {
    const [prog, cards, prof] = await Promise.all([
      getAllProgress(),
      getAllFlashcards(),
      getProfile(),
    ])
    setProgress(prog)
    setDueCount(getDueCards(cards).length)
    setHasKey(hasApiKey())
    setProfile(prof)
    setLang(getSettings().language || 'en')
  }, [])

  // Apply text direction (Farsi is right-to-left) to the document.
  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = isRTL(lang) ? 'rtl' : 'ltr'
  }, [lang])

  // The next topic in curriculum order (for the "Next lesson" button).
  const orderedTopics = useMemo(
    () => (curriculum ? curriculum.modules.flatMap((m) => m.topics) : []),
    [curriculum]
  )
  const nextTopic = useMemo(() => {
    if (!topic) return null
    const i = orderedTopics.findIndex((tp) => tp.id === topic.id)
    return i >= 0 && i + 1 < orderedTopics.length ? orderedTopics[i + 1] : null
  }, [topic, orderedTopics])

  // Load the curriculum file (respecting the GitHub Pages base path) + initial
  // data on first mount.
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}curriculum.json`)
      .then((r) => r.json())
      .then(setCurriculum)
      .catch((err) => console.error('Failed to load curriculum.json', err))
    refresh()
  }, [refresh])

  function openModule(m) {
    setModule(m)
    setTopic(null)
    setView('module')
  }

  function openTopic(t) {
    setTopic(t)
    setView('lesson')
  }

  function backFromLesson() {
    // Return to the module if we came from one, otherwise home.
    if (module) setView('module')
    else setView('home')
  }

  // Saving a key from the first-use prompt.
  function saveKeyFromPrompt(key) {
    saveSettings({ apiKey: key })
    setHasKey(true)
    setShowKeyPrompt(false)
  }

  return (
    <div className="app">
      {/* Top navigation bar, always visible. */}
      <nav className="nav">
        <button className="brand" onClick={() => { setModule(null); setView('home') }}>
          AI Learning Companion
        </button>
        <div className="nav-links">
          <button className={navCls(view, 'home')} onClick={() => setView('home')}>
            {t('curriculum', lang)}
          </button>
          <button className={navCls(view, 'cards')} onClick={() => setView('cards')}>
            {t('cards', lang)}{dueCount > 0 ? ` (${dueCount})` : ''}
          </button>
          <button className={navCls(view, 'quiz')} onClick={() => setView('quiz')}>
            {t('quiz', lang)}
          </button>
          <button className={navCls(view, 'settings')} onClick={() => setView('settings')}>
            {t('settings', lang)}
          </button>
        </div>
      </nav>

      {/* No-key warning banner (persistent until a key is added). */}
      {!hasKey && !showKeyPrompt && (
        <div className="key-banner" onClick={() => setView('settings')}>
          No API key set — click here to add one (use a key with a low spending cap).
        </div>
      )}

      <main className="main">
        {view === 'home' && (
          <Home
            curriculum={curriculum}
            progress={progress}
            dueCount={dueCount}
            profile={profile}
            lang={lang}
            onOpenTopic={openTopic}
            onOpenModule={openModule}
            onOpenPlacement={() => setView('placement')}
          />
        )}

        {view === 'placement' && (
          <Placement
            curriculum={curriculum}
            hasKey={hasKey}
            lang={lang}
            onNeedKey={() => setView('settings')}
            onBack={() => setView('home')}
            onStartTopic={(tp) => { setModule(null); openTopic(tp) }}
            onChanged={refresh}
          />
        )}

        {view === 'module' && module && (
          <Module
            module={module}
            progress={progress}
            hasKey={hasKey}
            lang={lang}
            onNeedKey={() => setView('settings')}
            onBack={() => setView('home')}
            onOpenTopic={openTopic}
            onChanged={refresh}
          />
        )}

        {view === 'lesson' && topic && (
          <Lesson
            topic={topic}
            hasKey={hasKey}
            lang={lang}
            nextTopic={nextTopic}
            onOpenTopic={openTopic}
            onNeedKey={() => setView('settings')}
            onBack={backFromLesson}
            onChanged={refresh}
          />
        )}

        {view === 'cards' && (
          <Flashcards
            curriculum={curriculum}
            onBack={() => setView('home')}
            onChanged={refresh}
          />
        )}

        {view === 'quiz' && (
          <Quiz
            curriculum={curriculum}
            hasKey={hasKey}
            lang={lang}
            onNeedKey={() => setView('settings')}
            onBack={() => setView('home')}
          />
        )}

        {view === 'settings' && (
          <Settings onBack={() => setView('home')} onChanged={refresh} />
        )}
      </main>

      {/* First-use API key prompt (a simple modal). */}
      {showKeyPrompt && (
        <KeyPrompt
          onSave={saveKeyFromPrompt}
          onSkip={() => setShowKeyPrompt(false)}
        />
      )}
    </div>
  )
}

// Helper to highlight the active nav button.
function navCls(view, name) {
  return view === name ? 'nav-link active' : 'nav-link'
}

// The first-use modal asking for an API key.
function KeyPrompt({ onSave, onSkip }) {
  const [key, setKey] = useState('')
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>Add your LiteLLM key</h2>
        <p>
          This app runs entirely in your browser and has no server. To generate
          lessons it calls the Divar LiteLLM gateway (
          <code>litellm.data.divar.cloud</code>) using <em>your</em> team key,
          stored only on this device.
        </p>
        <p className="warn">
          ⚠ Use a key with a <strong>low spending cap</strong> so a mistake can't
          run up a big bill.
        </p>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Paste your LiteLLM key (sk-…)"
          autoFocus
        />
        <div className="row">
          <button className="btn-ghost" onClick={onSkip}>
            Later
          </button>
          <button
            className="btn-primary"
            onClick={() => key.trim() && onSave(key.trim())}
            disabled={!key.trim()}
          >
            Save key
          </button>
        </div>
      </div>
    </div>
  )
}

// Edge cases this file does NOT handle:
// - If curriculum.json fails to load (offline before first cache, or bad JSON),
//   screens that need it show their own "loading" text indefinitely; the error
//   is logged to the console.
// - There is no browser-history / back-button integration (single-page state).
