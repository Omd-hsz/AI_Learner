// src/components/Settings.jsx
// -----------------------------------------------------------------------------
// Settings screen:
//   - API key field (stored only in this browser's localStorage)
//   - provider + model dropdowns (anthropic / openai, premium + cheap models)
//   - Export ALL data to a JSON file (manual backup)
//   - Import a JSON backup (restore / move to another device)
//   - Reset progress (wipe lessons, progress, cards, scores)
// -----------------------------------------------------------------------------
import { useEffect, useState } from 'react'
import { getSettings, saveSettings } from '../lib/storage.js'
import { PROVIDERS, fetchModels } from '../lib/api.js'
import { exportAll, importAll, resetAllData, getUsageTotals, resetUsage } from '../lib/db.js'
import { isTtsSupported, isSttSupported } from '../lib/speech.js'

export default function Settings({ onBack, onChanged }) {
  const [settings, setSettings] = useState(getSettings())
  const [modelList, setModelList] = useState([]) // optional live model list
  const [status, setStatus] = useState('') // small feedback line
  const [totals, setTotals] = useState(null) // usage/cost summary

  // Load the running usage totals when the screen opens.
  useEffect(() => {
    getUsageTotals().then(setTotals)
  }, [])

  // The provider object for the currently-selected provider.
  const provider = PROVIDERS[settings.provider]

  // Whenever a field changes, update local state AND persist to localStorage so
  // nothing is lost if the user navigates away without an explicit "save".
  function update(partial) {
    const next = saveSettings(partial)
    setSettings(next)
    onChanged?.()
  }

  // Try to pull the provider's live model list so the dropdown shows real IDs.
  async function loadModels() {
    setStatus('Fetching models…')
    try {
      const ids = await fetchModels(settings.provider, settings.apiKey)
      setModelList(ids)
      setStatus(`Found ${ids.length} models.`)
    } catch (err) {
      setStatus(`Could not fetch models: ${err.message}`)
    }
  }

  // Reset the live list when the provider changes (different model names).
  useEffect(() => setModelList([]), [settings.provider])

  // --- Export: download all on-device data as a .json file ------------------
  async function handleExport() {
    const data = await exportAll()
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ai-learning-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url) // free the temporary blob URL
  }

  // --- Import: read a backup file and replace current data ------------------
  async function handleImport(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      await importAll(data)
      setStatus('Import complete. Your data has been restored.')
      onChanged?.()
    } catch (err) {
      setStatus(`Import failed: ${err.message}`)
    } finally {
      e.target.value = '' // allow re-importing the same file later
    }
  }

  async function handleReset() {
    // Native confirm is fine for a destructive, rarely-used action.
    if (!confirm('Erase ALL lessons, progress, flashcards and scores? This cannot be undone.')) {
      return
    }
    await resetAllData()
    setStatus('All progress data has been reset.')
    onChanged?.()
  }

  return (
    <div className="settings">
      <div className="lesson-bar">
        <button className="btn-ghost" onClick={onBack}>
          ← Curriculum
        </button>
      </div>
      <h1>Settings</h1>

      <section className="setting-block">
        <h2>API key</h2>
        <p className="warn">
          ⚠ Use a key with a <strong>low spending cap</strong>. Your key is stored
          only on this device and is sent only to the LLM provider. Other visitors
          to this site must enter their own key.
        </p>
        <input
          type="password"
          value={settings.apiKey}
          onChange={(e) => update({ apiKey: e.target.value })}
          placeholder="Paste your LiteLLM key (sk-…)"
        />
      </section>

      <section className="setting-block">
        <h2>Language & voice</h2>
        <label>Language (UI + lessons)</label>
        <select
          value={settings.language}
          onChange={(e) => update({ language: e.target.value })}
        >
          <option value="en">English</option>
          <option value="fa">فارسی (Farsi)</option>
        </select>

        <label style={{ marginTop: 14 }}>
          <input
            type="checkbox"
            checked={settings.voiceEnabled}
            onChange={(e) => update({ voiceEnabled: e.target.checked })}
            style={{ width: 'auto', marginInlineEnd: 8 }}
          />
          Enable voice tutor (free — uses your browser)
        </label>

        <label style={{ marginTop: 14 }}>
          <input
            type="checkbox"
            checked={settings.aiVoice}
            onChange={(e) => update({ aiVoice: e.target.checked })}
            style={{ width: 'auto', marginInlineEnd: 8 }}
          />
          Realistic AI voice (natural — uses your API key)
        </label>

        {settings.aiVoice && (
          <>
            <label>Voice service</label>
            <select
              value={settings.ttsProvider}
              onChange={(e) => update({ ttsProvider: e.target.value })}
            >
              <option value="gemini">Google AI Studio / Gemini (free, no card)</option>
              <option value="google">Google Cloud TTS (needs billing)</option>
              <option value="proxy">Chat provider TTS (OpenAI-style)</option>
            </select>

            {settings.ttsProvider === 'gemini' && (
              <>
                <label>Google AI Studio API key</label>
                <input
                  type="password"
                  value={settings.geminiTtsKey}
                  onChange={(e) => update({ geminiTtsKey: e.target.value })}
                  placeholder="AIza… (free key from aistudio.google.com)"
                />
                <label>Voice</label>
                <select
                  value={settings.geminiVoice}
                  onChange={(e) => update({ geminiVoice: e.target.value })}
                >
                  <option value="Kore">Kore</option>
                  <option value="Puck">Puck</option>
                  <option value="Zephyr">Zephyr</option>
                  <option value="Charon">Charon</option>
                  <option value="Fenrir">Fenrir</option>
                  <option value="Aoede">Aoede</option>
                  <option value="Leda">Leda</option>
                  <option value="Orus">Orus</option>
                </select>
                <p className="muted small">
                  Free and no credit card: create a key at aistudio.google.com (Get
                  API key). The voice auto-detects English vs Farsi from the text.
                  Note: TTS uses preview models with tight free rate limits — if a
                  call fails it falls back to the free browser voice.
                </p>
              </>
            )}

            {settings.ttsProvider === 'google' && (
              <>
                <label>Google Cloud API key</label>
                <input
                  type="password"
                  value={settings.googleTtsKey}
                  onChange={(e) => update({ googleTtsKey: e.target.value })}
                  placeholder="AIza… (Google Cloud Text-to-Speech key)"
                />
                <label>English voice name</label>
                <input
                  type="text"
                  value={settings.googleVoiceEn}
                  onChange={(e) => update({ googleVoiceEn: e.target.value })}
                  placeholder="en-US-Neural2-C"
                />
                <label>Farsi voice name</label>
                <input
                  type="text"
                  value={settings.googleVoiceFa}
                  onChange={(e) => update({ googleVoiceFa: e.target.value })}
                  placeholder="fa-IR-Standard-A"
                />
                <p className="muted small">
                  Uses Google Cloud Text-to-Speech. Free tier: ~1M characters/month
                  for Neural2/WaveNet voices (~4M for Standard) — plenty for
                  studying. Enable the Text-to-Speech API in your Google Cloud
                  project and create an API key. Leave a voice name blank to let
                  Google auto-pick. Browse voice names at cloud.google.com/text-to-speech/docs/voices.
                  Falls back to the free browser voice if a call fails.
                </p>
              </>
            )}

            {settings.ttsProvider === 'proxy' && (
              <>
                <label>AI voice</label>
                <select
                  value={settings.ttsVoice}
                  onChange={(e) => update({ ttsVoice: e.target.value })}
                >
                  <option value="alloy">Alloy</option>
                  <option value="echo">Echo</option>
                  <option value="fable">Fable</option>
                  <option value="onyx">Onyx</option>
                  <option value="nova">Nova</option>
                  <option value="shimmer">Shimmer</option>
                </select>
                <label>TTS model</label>
                <input
                  type="text"
                  value={settings.ttsModel}
                  onChange={(e) => update({ ttsModel: e.target.value })}
                  placeholder="gpt-4o-mini-tts"
                />
                <p className="muted small">
                  Calls your chat provider's /v1/audio/speech endpoint. Note: the
                  Divar LiteLLM proxy currently has no TTS model, so this will fall
                  back to the browser voice — use Google Cloud TTS instead.
                </p>
              </>
            )}
          </>
        )}

        <label>Speaking speed (browser voice): {Number(settings.voiceRate).toFixed(2)}×</label>
        <input
          type="range"
          min="0.5"
          max="1.75"
          step="0.05"
          value={settings.voiceRate}
          onChange={(e) => update({ voiceRate: Number(e.target.value) })}
        />
        <p className="muted small">
          Voice uses the browser's built-in Web Speech API — no API key, no cost.
          {' '}
          {isTtsSupported() ? 'Read-aloud: available.' : 'Read-aloud: not supported here.'}{' '}
          {isSttSupported() ? 'Voice questions: available.' : 'Voice questions: not supported here (try Chrome).'}{' '}
          Farsi voice quality depends on the voices installed on your device.
        </p>
      </section>

      <section className="setting-block">
        <h2>Provider & models</h2>
        {settings.provider === 'litellm' && (
          <p className="muted small">
            Default gateway: <code>https://litellm.data.divar.cloud</code> (OpenAI-compatible).
            Lessons default to <strong>gemini-2.5-flash</strong>; quizzes to{' '}
            <strong>grok-4-1-fast-non-reasoning</strong>.
          </p>
        )}
        <label>Provider</label>
        <select
          value={settings.provider}
          onChange={(e) => update({ provider: e.target.value })}
        >
          {Object.keys(PROVIDERS).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        <label>Premium model (lessons)</label>
        <ModelInput
          value={settings.premiumModel}
          placeholder={provider.premiumModel}
          modelList={modelList}
          onChange={(v) => update({ premiumModel: v })}
        />

        <label>Cheap model (flashcards / quizzes)</label>
        <ModelInput
          value={settings.cheapModel}
          placeholder={provider.cheapModel}
          modelList={modelList}
          onChange={(v) => update({ cheapModel: v })}
        />

        <button className="btn" onClick={loadModels} disabled={!settings.apiKey}>
          Fetch available models
        </button>
        <p className="muted small">
          Leave a model blank to use the provider default ({provider.premiumModel}{' '}
          / {provider.cheapModel}).
        </p>
      </section>

      <section className="setting-block">
        <h2>Usage & cost</h2>
        {totals ? (
          <>
            <p>
              Total so far:{' '}
              <strong>
                {totals.costKnown ? `≈ $${totals.cost.toFixed(4)}` : `≈ $${totals.cost.toFixed(4)} (partial)`}
              </strong>{' '}
              · {totals.totalTokens.toLocaleString()} tokens · {totals.calls} API calls
            </p>
            {!totals.costKnown && (
              <p className="muted small">
                Some calls didn't report a price, so the real total may be a bit higher.
              </p>
            )}
            <button
              className="btn"
              onClick={async () => {
                await resetUsage()
                setTotals(await getUsageTotals())
                setStatus('Usage log cleared.')
              }}
            >
              Clear usage log
            </button>
          </>
        ) : (
          <p className="muted">No usage recorded yet.</p>
        )}
      </section>

      <section className="setting-block">
        <h2>Backup & data</h2>
        <div className="row">
          <button className="btn" onClick={handleExport}>
            Export JSON
          </button>
          <label className="btn file-label">
            Import JSON
            <input type="file" accept="application/json" onChange={handleImport} hidden />
          </label>
          <button className="btn btn-danger" onClick={handleReset}>
            Reset progress
          </button>
        </div>
      </section>

      {status && <p className="status-line">{status}</p>}
    </div>
  )
}

// A tiny input that also offers a datalist of fetched model IDs (autocomplete)
// while still letting the user type any custom model name.
function ModelInput({ value, placeholder, modelList, onChange }) {
  const listId = `models-${placeholder}`
  return (
    <>
      <input
        type="text"
        list={modelList.length ? listId : undefined}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {modelList.length > 0 && (
        <datalist id={listId}>
          {modelList.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
      )}
    </>
  )
}

// Edge cases this file does NOT handle:
// - Import does not validate the backup's schema/version beyond JSON.parse; a
//   file from a future version with a different shape could import partially.
// - It does not test that the API key is valid here (that happens on first call).
