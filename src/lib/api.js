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
import { addUsage } from './db.js'

// Approximate prices in USD per 1,000,000 tokens (input/output), used as a
// FALLBACK when the provider does not return a real cost. Numbers mirror the
// Divar team pricing in server.py. Unknown models => cost shown as "—".
export const PRICES = {
  'gemini-2.5-flash': { in: 0.3, out: 2.5 },
  'gemini-3-flash-preview': { in: 0.5, out: 3.0 },
  'gemini-2.5-pro': { in: 1.25, out: 10.0 },
  'gemini-3-pro-preview': { in: 2.0, out: 12.0 },
  'grok-4-1-fast-non-reasoning': { in: 0.2, out: 0.5 },
  'grok-4-1-fast-reasoning': { in: 0.2, out: 0.5 },
  'grok-4-fast-non-reasoning': { in: 0.2, out: 0.5 },
  'gpt-4.1': { in: 2.0, out: 8.0 },
  'gpt-5.2': { in: 1.75, out: 14.0 },
  'gpt-4o': { in: 5.0, out: 15.0 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'chatgpt-4o-latest': { in: 5.0, out: 15.0 },
  'claude-sonnet-4-5': { in: 3.0, out: 15.0 },
  'claude-sonnet-4-5-20250929': { in: 3.0, out: 15.0 },
  'claude-haiku-4-5': { in: 1.0, out: 5.0 },
  'claude-opus-4-5-20251101': { in: 5.0, out: 25.0 },
  'deepseek-v3-fireworks': { in: 0.9, out: 0.9 },
  'gemma-3-27b-it': { in: 0, out: 0 },
  'gemma-3-12b-it': { in: 0, out: 0 },
}

// Compute a fallback cost (USD) from token counts and the PRICES table.
// Returns null when we don't know the model's price.
function estimateCost(model, inputTokens, outputTokens) {
  const p = PRICES[model]
  if (!p) return null
  return (inputTokens / 1e6) * p.in + (outputTokens / 1e6) * p.out
}

// The swappable provider config. To add a provider, add another entry here.
//
// LiteLLM is the DEFAULT: Divar's proxy speaks the OpenAI API format, so we
// POST to /v1/chat/completions with Authorization: Bearer <key> — exactly like
// the Python example you shared (openai.OpenAI(base_url=..., api_key=...)).
export const PROVIDERS = {
  litellm: {
    // OpenAI-compatible LiteLLM proxy (Divar team gateway).
    baseUrl: 'https://litellm.data.divar.cloud',
    url: 'https://litellm.data.divar.cloud/v1/chat/completions',
    modelsUrl: 'https://litellm.data.divar.cloud/v1/models',
    modelInfoUrl: 'https://litellm.data.divar.cloud/v1/model/info',
    format: 'openai',
    // gemini-2.5-flash: best price/quality for structured teaching (~$0.30/$2.50
    // per 1M tokens on the team key — see server.py MODELS_TO_TEST).
    premiumModel: 'gemini-2.5-flash',
    // grok-4-1-fast-non-reasoning: cheapest chat model on the key (~$0.20/$0.50);
    // fine for short quiz/flashcard calls. Use gemini-2.5-flash if quality drops.
    cheapModel: 'grok-4-1-fast-non-reasoning',
    headers: (k) => ({
      Authorization: `Bearer ${k}`,
      'content-type': 'application/json',
    }),
    body: (system, messages, model) => ({
      model,
      stream: true,
      max_tokens: 4096,
      // Ask the proxy to send a final usage event so we can show token counts.
      stream_options: { include_usage: true },
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    url: 'https://api.anthropic.com/v1/messages',
    modelsUrl: 'https://api.anthropic.com/v1/models',
    format: 'anthropic',
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
    baseUrl: 'https://api.openai.com',
    url: 'https://api.openai.com/v1/chat/completions',
    modelsUrl: 'https://api.openai.com/v1/models',
    format: 'openai',
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
      max_tokens: 4096,
      stream_options: { include_usage: true },
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  },
}

// Pull one text chunk out of a single parsed SSE JSON object.
function extractDelta(format, json) {
  if (format === 'anthropic') {
    // Anthropic streams typed events; only content_block_delta has text.
    if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
      return json.delta.text || ''
    }
    return ''
  }
  // OpenAI format (also used by LiteLLM proxy): choices[0].delta.content
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
// reply streams in, and resolves with { text, usage } where usage holds token
// counts + an estimated/real cost so the UI can show "what did this cost me?".
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

  // LiteLLM exposes the real per-request cost in a response header (when CORS
  // allows reading it). We try; if missing we fall back to token math below.
  let headerCost = null
  const rawCost = res.headers.get('x-litellm-response-cost')
  if (rawCost != null && rawCost !== '') {
    const n = Number(rawCost)
    if (!Number.isNaN(n)) headerCost = n
  }

  // Read the streamed body chunk by chunk and split it into SSE "events".
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  let inputTokens = 0
  let outputTokens = 0

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
          const piece = extractDelta(provider.format, json)
          if (piece) {
            full += piece
            if (onToken) onToken(piece)
          }
          // Capture token usage (shape differs per provider/format).
          if (provider.format === 'anthropic') {
            if (json.type === 'message_start' && json.message?.usage) {
              inputTokens = json.message.usage.input_tokens || inputTokens
              outputTokens = json.message.usage.output_tokens || outputTokens
            }
            if (json.type === 'message_delta' && json.usage) {
              outputTokens = json.usage.output_tokens || outputTokens
            }
          } else if (json.usage) {
            // OpenAI / LiteLLM final usage chunk.
            inputTokens = json.usage.prompt_tokens || inputTokens
            outputTokens = json.usage.completion_tokens || outputTokens
          }
        } catch {
          // Ignore keep-alive comments / non-JSON lines.
        }
      }
    }
  }

  const totalTokens = inputTokens + outputTokens
  const cost = headerCost != null ? headerCost : estimateCost(model, inputTokens, outputTokens)

  return {
    text: full,
    usage: { model, inputTokens, outputTokens, totalTokens, cost },
  }
}

// -----------------------------------------------------------------------------
// generate: the function components actually call. It reads settings, picks the
// right model ('premium' for lessons, 'cheap' for flashcards/quizzes), logs the
// token/cost usage to IndexedDB, and on a model error auto-recovers by fetching
// the provider's current model list and retrying once with a valid model.
//
// Returns { text, usage }. `label` is a short tag (e.g. "lesson:F3") stored with
// the usage log so the Settings screen can break down spending.
// -----------------------------------------------------------------------------
export async function generate({ kind = 'premium', system, messages, onToken, signal, label = '' }) {
  const settings = getSettings()
  const providerName = settings.provider
  const provider = PROVIDERS[providerName]
  if (!provider) throw new Error(`Unknown provider: ${providerName}`)

  // Use the user's override model if set, otherwise the provider default.
  const pickModel = () => {
    if (kind === 'cheap') return settings.cheapModel || provider.cheapModel
    return settings.premiumModel || provider.premiumModel
  }

  // Record the usage to the on-device log (best-effort; never blocks the reply).
  const logUsage = (usage) => {
    if (!usage) return
    addUsage({ ...usage, kind, label, at: Date.now() }).catch(() => {})
  }

  try {
    const result = await streamChat({
      providerName,
      apiKey: settings.apiKey,
      model: pickModel(),
      system,
      messages,
      onToken,
      signal,
    })
    logUsage(result.usage)
    return result
  } catch (err) {
    if (err instanceof ModelNotFoundError) {
      // Recover: fetch the live model list, choose a sane replacement, persist
      // it to settings (so this is a one-time fix), and retry once.
      const replacement = await pickValidModel(providerName, settings.apiKey, kind)
      if (replacement) {
        if (kind === 'cheap') saveSettings({ cheapModel: replacement })
        else saveSettings({ premiumModel: replacement })
        const result = await streamChat({
          providerName,
          apiKey: settings.apiKey,
          model: replacement,
          system,
          messages,
          onToken,
          signal,
        })
        logUsage(result.usage)
        return result
      }
    }
    throw err
  }
}

// -----------------------------------------------------------------------------
// synthesizeSpeech: turn text into REAL, natural-sounding speech audio using the
// provider's OpenAI-compatible Text-to-Speech endpoint (/v1/audio/speech). This
// replaces the robotic built-in browser voice with an AI voice. Returns an audio
// Blob (mp3) the caller plays with an <audio> element.
//
// Only works for OpenAI-format providers (litellm proxy + openai). Throws if the
// provider can't do TTS or the model isn't available — the caller then falls
// back to the browser voice, so a missing TTS model degrades gracefully.
// -----------------------------------------------------------------------------
export async function synthesizeSpeech({ text, voice = 'alloy', model, signal } = {}) {
  const settings = getSettings()
  const provider = PROVIDERS[settings.provider]
  if (!provider) throw new Error(`Unknown provider: ${settings.provider}`)
  if (provider.format !== 'openai') {
    throw new Error('This provider has no AI voice (TTS). Use the LiteLLM proxy or OpenAI.')
  }
  if (!settings.apiKey) throw new Error('No API key set. Add one in Settings.')

  const ttsModel = model || settings.ttsModel || 'gpt-4o-mini-tts'
  const res = await fetch(`${provider.baseUrl}/v1/audio/speech`, {
    method: 'POST',
    headers: provider.headers(settings.apiKey),
    body: JSON.stringify({
      model: ttsModel,
      input: text,
      voice,
      response_format: 'mp3',
    }),
    signal,
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`TTS error ${res.status}: ${errText || res.statusText}`)
  }
  return await res.blob()
}

// Fetch the provider's current list of chat model IDs.
// For LiteLLM we prefer /v1/model/info (includes mode=chat vs embedding).
export async function fetchModels(providerName, apiKey) {
  const provider = PROVIDERS[providerName]
  if (!provider) throw new Error(`Unknown provider: ${providerName}`)
  const headers = provider.headers(apiKey)

  // LiteLLM: richer endpoint that separates chat from embedding models.
  if (provider.modelInfoUrl) {
    try {
      const res = await fetch(provider.modelInfoUrl, { headers })
      if (res.ok) {
        const json = await res.json()
        const chat = []
        for (const m of json.data || []) {
          const info = m.model_info || {}
          const name = m.model_name || info.id
          if (!name) continue
          const mode = (info.mode || '').toLowerCase()
          if (mode === 'embedding' || name.toLowerCase().includes('embed')) continue
          if (mode === 'chat' || mode === 'completion' || mode === '') chat.push(name)
        }
        if (chat.length) return chat.sort()
      }
    } catch {
      // fall through to /v1/models
    }
  }

  const res = await fetch(provider.modelsUrl, { headers })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`Could not list models (${res.status}): ${t}`)
  }
  const json = await res.json()
  // OpenAI + LiteLLM return { data: [{ id, ... }, ...] }.
  return (json.data || [])
    .map((m) => m.id)
    .filter((id) => id && !id.toLowerCase().includes('embed'))
}

// Pick a reasonable model from the live list when the configured one is invalid.
// Heuristic: prefer one whose name hints at "mini/haiku/small" for cheap, or
// "sonnet/4o/gpt-4" for premium; otherwise just take the first available.
async function pickValidModel(providerName, apiKey, kind) {
  const ids = await fetchModels(providerName, apiKey).catch(() => [])
  if (!ids.length) return null
  const wantCheap = kind === 'cheap'
  const cheapHints = ['mini', 'haiku', 'small', 'flash', 'lite', 'grok', 'gemma']
  const premiumHints = ['sonnet', '4o', 'gpt-4', 'opus', 'pro', 'gemini-2.5-flash', 'gpt-4.1']
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
