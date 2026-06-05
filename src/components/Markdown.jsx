// src/components/Markdown.jsx
// -----------------------------------------------------------------------------
// Renders a markdown string as HTML. The LLM returns markdown (headers, bold,
// code blocks, lists, REAL tables), and we want it to look nice.
//
// Three small libraries do the work, and each earns its place:
//   - marked    : turns markdown text into an HTML string (fast, tiny).
//   - dompurify : SANITIZES that HTML so a malicious/odd model response can't
//                 inject a working <script>. Since we use dangerouslySetInnerHTML
//                 (required to render HTML), sanitizing is non-negotiable.
//   - charts.js : our own (dependency-free) renderer that turns ```chart JSON
//                 blocks into REAL inline-SVG bar/line/pie charts instead of
//                 ASCII art.
//
// CHART PIPELINE (why this exact ordering):
//   1. Pull every ```chart ...``` fenced block OUT of the raw text first and
//      swap in a safe placeholder token. We render charts ourselves rather than
//      via a marked plugin so we don't depend on marked's renderer API (which
//      changes between versions).
//   2. Run marked on what's left (normal markdown -> HTML).
//   3. Put the rendered SVG back in place of each placeholder.
//   4. Run ONE DOMPurify pass over the whole document — this also sanitizes the
//      SVG and any model-supplied chart labels.
// During streaming a ```chart block arrives one character at a time, so its JSON
// is invalid for most of the stream. renderChart() returns null on bad JSON and
// we simply show the raw block (as a code fence) until it completes — the view
// never throws mid-stream.
// -----------------------------------------------------------------------------
import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { renderChart } from '../lib/charts.js'

// Configure marked once: GitHub-style line breaks feel natural for lessons.
marked.setOptions({ breaks: true, gfm: true })

// Matches a ```chart fenced code block. The [\s\S]*? is a non-greedy "anything
// including newlines" so we grab the JSON body. `g` so we can handle several.
const CHART_BLOCK = /```chart\s*\n([\s\S]*?)```/g

// Replace each ```chart block with a placeholder, returning the cleaned text
// plus a map of placeholder -> rendered SVG (or the original block on failure).
function extractCharts(text) {
  const charts = {}
  let i = 0
  const cleaned = text.replace(CHART_BLOCK, (whole, body) => {
    let svg = null
    try {
      svg = renderChart(JSON.parse(body.trim()))
    } catch {
      svg = null // incomplete/invalid JSON (common during streaming)
    }
    // If we couldn't render (e.g. the block is still streaming in), leave the
    // original fenced block untouched so it shows as code and "upgrades" to a
    // chart once the JSON is complete on a later render.
    if (!svg) return whole
    const token = `CHARTPLACEHOLDER${i}ENDCHART`
    charts[token] = svg
    i++
    return '\n\n' + token + '\n\n'
  })
  return { cleaned, charts }
}

export default function Markdown({ text }) {
  // useMemo re-renders the HTML only when `text` changes (during streaming this
  // runs on every chunk, so keeping it cheap matters).
  const html = useMemo(() => {
    const { cleaned, charts } = extractCharts(text || '')
    let raw = marked.parse(cleaned)
    // Swap placeholders for their SVG. marked wraps a lone token in <p>…</p>;
    // replacing the token text inside that paragraph is fine.
    for (const token in charts) {
      raw = raw.replaceAll(token, charts[token])
    }
    // Sanitize the whole document, explicitly allowing inline SVG so our charts
    // survive (DOMPurify keeps SVG with this profile; html:true keeps the rest).
    return DOMPurify.sanitize(raw, {
      USE_PROFILES: { html: true, svg: true, svgFilters: true },
    })
  }, [text])

  return (
    <div
      className="markdown"
      // We trust this only because DOMPurify stripped anything dangerous above.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

// Edge cases this file does NOT handle:
// - It does not do syntax highlighting of code blocks (kept simple; code still
//   renders in a monospace block). Add highlight.js later if desired.
// - Extremely long text re-parses fully on each streamed chunk; fine for lesson
//   sizes, but not optimized for megabytes of text.
// - A ```chart block whose JSON is valid but describes an unsupported chart type
//   falls back to a bar chart (see charts.js).
