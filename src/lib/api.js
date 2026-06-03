// src/lib/api.js
// -----------------------------------------------------------------------------
// Everything about TALKING TO THE LLM lives here:
//   - PROVIDERS: the per-provider config (URL, model names, headers, body shape)
//   - streamChat(): send a request and stream the reply token-by-token (SSE)
//   - generate(): a friendly wrapper that reads the user's settings and picks
//                 the premium or cheap model for you
//   - fetchModels(): list a provider's current models (used to recover from a
//                    "model not found" error)
//
// SSE = "Server-Sent Events": the provider streams the answer as a series of
// small "data: {...}" lines instead of one big response. Streaming lets us show
// the lesson appearing live.
// -----------------------------------------------------------------------------
import { getSettings, saveSettings } from './storage.js'

// The swappable provider config. To add a provider, add another entry here.
export const PROVIDERS = {
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    modelsUrl: 'https://api.anthropic.com/v1/models',
    premiumModel: 'claude-sonnet-4-5',
    cheapModel: 'claude-haiku-4-5',
    headers: (k) => ({
      'x-api-key': k,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      // Required so the browser is allowed to call Anthropic directly.
      'anthropic-dangerous-direct-browser-access': 'true',
    }),
    body: (system, messages, model) => ({
      model,
      max_tokens: 4096,
      system,
      messages,
      stream: true,
    }),
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    modelsUrl: 'https://api.openai.com/v1/models',
    premiumModel: 'gpt-4o',
    cheapModel: 'gpt-4o-mini',
    headers: (k) => ({
      Authorization: `Bearer ${k}`,
      'content-type': 'application/json',
    }),
    // OpenAI puts the system prompt as the first message, not a separate field.
    body: (system, messages, model) => ({
      model,
      stream: true,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  },
}

// Pull one text chunk out of a single parsed SSE JSON object, for either
// provider. Returns '' if this particular event carries no text.
function extractDelta(provider, json) {
  if (provider === 'anthropic') {
    // Anthropic streams typed events; only content_block_delta has text.
    if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
      return json.delta.text || ''
    }
    return ''
  }
  // openai: choices[0].delta.content
  return json.choices?.[0]?.delta?.content || ''
}

// Custom error so callers can detect a bad/unknown model and react (e.g. fetch
// the model list). We sniff common phrasings from both providers.
export class ModelNotFoundError extends Error {}

function looksLikeModelError(status, text) {
  const t = (text || '').toLowerCase()
  return (
    status === 404 ||
    t.includes('model') &&
      (t.includes('not found') ||
        t.includes('does not exist') ||
        t.includes('invalid model') ||
        t.includes('unknown model'))
  )
}

// -----------------------------------------------------------------------------
// streamChat: the core network call. Calls onToken(textChunk) repeatedly as the
// reply streams in, and resolves with the FULL concatenated text at the end.
// -----------------------------------------------------------------------------
export async function streamChat({
  providerName,
  apiKey,
  model,
  system,
  messages,
  onToken,
  signal,
}) {
  const provider = PROVIDERS[providerName]
  if (!provider) throw new Error(`Unknown provider: ${providerName}`)
  if (!apiKey) throw new Error('No API key set. Add one in Settings.')

  const res = await fetch(provider.url, {
    method: 'POST',
    headers: provider.headers(apiKey),
    body: JSON.stringify(provider.body(system, messages, model)),
    signal, // lets the caller cancel an in-flight stream (AbortController)
  })

  // If the HTTP status is an error, read the body for a useful message.
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    if (looksLikeModelError(res.status, errText)) {
      throw new ModelNotFoundError(errText || `Model "${model}" not found`)
    }
    throw new Error(`API error ${res.status}: ${errText || res.statusText}`)
  }

  // Read the streamed body chunk by chunk and split it into SSE "events".
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE events are separated by a blank line ("\n\n"). Process complete ones
    // and keep any partial trailing event in the buffer for the next loop.
    const parts = buffer.split('\n\n')
    buffer = parts.pop() // last item may be incomplete
    for (const part of parts) {
      // An event can have multiple "data:" lines; collect them.
      for (const line of part.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const data = trimmed.slice('data:'.length).trim()
        if (data === '[DONE]') continue // OpenAI's end marker
        try {
          const json = JSON.parse(data)
          const piece = extractDelta(providerName, json)
          if (piece) {
            full += piece
            if (onToken) onToken(piece)
          }
        } catch {
          // Ignore keep-alive comments / non-JSON lines.
        }
      }
    }
  }

  return full
}

// -----------------------------------------------------------------------------
// generate: the function components actually call. It reads settings, picks the
// right model ('premium' for lessons, 'cheap' for flashcards/quizzes), and on a
// model error it auto-recovers by fetching the provider's current model list and
// retrying once with a valid model.
// -----------------------------------------------------------------------------
export async function generate({ kind = 'premium', system, messages, onToken, signal }) {
  const settings = getSettings()
  const providerName = settings.provider
  const provider = PROVIDERS[providerName]
  if (!provider) throw new Error(`Unknown provider: ${providerName}`)

  // Use the user's override model if set, otherwise the provider default.
  const pickModel = () => {
    if (kind === 'cheap') return settings.cheapModel || provider.cheapModel
    return settings.premiumModel || provider.premiumModel
  }

  try {
    return await streamChat({
      providerName,
      apiKey: settings.apiKey,
      model: pickModel(),
      system,
      messages,
      onToken,
      signal,
    })
  } catch (err) {
    if (err instanceof ModelNotFoundError) {
      // Recover: fetch the live model list, choose a sane replacement, persist
      // it to settings (so this is a one-time fix), and retry once.
      const replacement = await pickValidModel(providerName, settings.apiKey, kind)
      if (replacement) {
        if (kind === 'cheap') saveSettings({ cheapModel: replacement })
        else saveSettings({ premiumModel: replacement })
        return await streamChat({
          providerName,
          apiKey: settings.apiKey,
          model: replacement,
          system,
          messages,
          onToken,
          signal,
        })
      }
    }
    throw err
  }
}

// Fetch the provider's current list of model IDs.
export async function fetchModels(providerName, apiKey) {
  const provider = PROVIDERS[providerName]
  if (!provider) throw new Error(`Unknown provider: ${providerName}`)
  const res = await fetch(provider.modelsUrl, { headers: provider.headers(apiKey) })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`Could not list models (${res.status}): ${t}`)
  }
  const json = await res.json()
  // Both providers return { data: [{ id, ... }, ...] }.
  return (json.data || []).map((m) => m.id)
}

// Pick a reasonable model from the live list when the configured one is invalid.
// Heuristic: prefer one whose name hints at "mini/haiku/small" for cheap, or
// "sonnet/4o/gpt-4" for premium; otherwise just take the first available.
async function pickValidModel(providerName, apiKey, kind) {
  const ids = await fetchModels(providerName, apiKey).catch(() => [])
  if (!ids.length) return null
  const wantCheap = kind === 'cheap'
  const cheapHints = ['mini', 'haiku', 'small', 'flash', 'lite']
  const premiumHints = ['sonnet', '4o', 'gpt-4', 'opus', 'pro']
  const hints = wantCheap ? cheapHints : premiumHints
  const match = ids.find((id) => hints.some((h) => id.toLowerCase().includes(h)))
  return match || ids[0]
}

// Edge cases this file does NOT handle:
// - CORS: providers must allow browser calls. Anthropic needs the special
//   "dangerous-direct-browser-access" header (set above). Some providers/proxies
//   will reject browser-origin requests entirely.
// - It does not retry on rate limits (429) or transient network blips.
// - Token/cost accounting is not tracked here.
