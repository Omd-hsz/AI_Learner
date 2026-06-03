// src/components/Markdown.jsx
// -----------------------------------------------------------------------------
// Renders a markdown string as HTML. The LLM returns markdown (headers, bold,
// code blocks, lists), and we want it to look nice.
//
// Two small libraries do the work, and each earns its place:
//   - marked    : turns markdown text into an HTML string (fast, tiny).
//   - dompurify : SANITIZES that HTML so a malicious/odd model response can't
//                 inject a working <script>. Since we use dangerouslySetInnerHTML
//                 (required to render HTML), sanitizing is non-negotiable.
// -----------------------------------------------------------------------------
import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

// Configure marked once: GitHub-style line breaks feel natural for lessons.
marked.setOptions({ breaks: true, gfm: true })

export default function Markdown({ text }) {
  // useMemo re-renders the HTML only when `text` changes (during streaming this
  // runs on every chunk, so keeping it cheap matters).
  const html = useMemo(() => {
    const raw = marked.parse(text || '')
    return DOMPurify.sanitize(raw)
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
