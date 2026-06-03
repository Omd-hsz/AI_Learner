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
import { exportAll, importAll, resetAllData } from '../lib/db.js'

export default function Settings({ onBack, onChanged }) {
  const [settings, setSettings] = useState(getSettings())
  const [modelList, setModelList] = useState([]) // optional live model list
  const [status, setStatus] = useState('') // small feedback line

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
          placeholder="Paste your API key (e.g. sk-… or sk-ant-…)"
        />
      </section>

      <section className="setting-block">
        <h2>Provider & models</h2>
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
        <h2>Backup & data</h2>
        <div className="row">
          <button className="btn" onClick={handleExport}>
            ⬇ Export JSON
          </button>
          <label className="btn file-label">
            ⬆ Import JSON
            <input type="file" accept="application/json" onChange={handleImport} hidden />
          </label>
          <button className="btn btn-danger" onClick={handleReset}>
            ⨯ Reset progress
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
