// src/lib/charts.js
// -----------------------------------------------------------------------------
// Turns a small JSON "chart spec" into a REAL inline <svg> string (bar, line,
// or pie). The LLM is told to emit ```chart code blocks holding this JSON
// instead of drawing ASCII art; Markdown.jsx pulls those blocks out and feeds
// them here, then drops the returned SVG into the rendered lesson.
//
// Why hand-rolled SVG instead of a chart library? CLAUDE.md says don't add a
// dependency without a strong reason. A charting lib (recharts/chart.js) is
// large and pulls in React/canvas integration we don't need — these lessons
// only need simple, static, theme-matched charts. Plain SVG strings also pass
// cleanly through our marked -> DOMPurify pipeline, so there is nothing new to
// wire up. The whole file is ~200 lines and has zero dependencies.
//
// The SVG uses CSS variables / inherits the page font, so charts automatically
// match the pastel theme and use Vazirmatn for Farsi text (RTL pages).
// -----------------------------------------------------------------------------

// Pastel palette chosen to match the app's module colors (see styles.css).
const PALETTE = [
  '#c98da0', // dusty rose (accent)
  '#a8c4d4', // soft blue
  '#b5d4b8', // sage green
  '#e0c069', // muted gold
  '#e8c4a8', // warm tan
  '#c8b8d8', // lavender
  '#d4948c', // terracotta
  '#9cc2bf', // teal
]

const INK = '#5a4a3a' // axis/label color, matches theme text
const GRID = '#e4dccf' // faint gridline color

// Escape any model-supplied text so it can't break the SVG markup. (DOMPurify
// runs again over the whole document later, but escaping here keeps the SVG
// well-formed in the first place.)
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Format a number for axis ticks / value labels without trailing noise.
function fmt(n) {
  if (!isFinite(n)) return ''
  if (Number.isInteger(n)) return String(n)
  return Number(n.toFixed(2)).toString()
}

// Pull a clean [{label, value}] list out of whatever the model sent.
function normalizeData(spec) {
  const rows = Array.isArray(spec.data) ? spec.data : []
  return rows
    .map((d) => ({
      label: d.label ?? d.name ?? d.x ?? '',
      value: Number(d.value ?? d.y ?? d.count ?? 0),
    }))
    .filter((d) => isFinite(d.value))
}

// Standard chart canvas size. SVG scales responsively via the wrapper CSS.
const W = 520
const H = 320

// Common <svg> open/close + optional title. We set a max-width so charts never
// overflow the lesson column, and font-family inherits from the page (Vazirmatn
// in Farsi). preserveAspectRatio keeps them tidy when scaled down on mobile.
function svgWrap(inner, title) {
  const titleSvg = title
    ? `<text x="${W / 2}" y="22" text-anchor="middle" font-size="15" font-weight="600" fill="${INK}">${esc(
        title,
      )}</text>`
    : ''
  return (
    `<div class="chart">` +
    `<svg viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="xMidYMid meet" ` +
    `style="width:100%;height:auto;font-family:inherit">` +
    titleSvg +
    inner +
    `</svg>` +
    `</div>`
  )
}

// --- BAR CHART -------------------------------------------------------------
function barChart(spec) {
  const data = normalizeData(spec)
  if (!data.length) return null

  const padL = 48
  const padR = 20
  const padT = spec.title ? 40 : 16
  const padB = 46
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const max = Math.max(...data.map((d) => d.value), 0)
  const min = Math.min(...data.map((d) => d.value), 0)
  const range = max - min || 1
  const yOf = (v) => padT + plotH - ((v - min) / range) * plotH

  // Horizontal gridlines + y-axis ticks (5 steps).
  let grid = ''
  for (let i = 0; i <= 4; i++) {
    const v = min + (range * i) / 4
    const y = yOf(v)
    grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`
    grid += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="${INK}">${fmt(v)}</text>`
  }

  const slot = plotW / data.length
  const barW = Math.min(slot * 0.62, 70)
  const baseY = yOf(0)

  let bars = ''
  data.forEach((d, i) => {
    const cx = padL + slot * i + slot / 2
    const y = yOf(d.value)
    const top = Math.min(y, baseY)
    const h = Math.abs(baseY - y)
    const color = PALETTE[i % PALETTE.length]
    bars +=
      `<rect x="${cx - barW / 2}" y="${top}" width="${barW}" height="${h}" rx="3" fill="${color}"/>` +
      `<text x="${cx}" y="${top - 5}" text-anchor="middle" font-size="11" fill="${INK}">${fmt(d.value)}</text>` +
      `<text x="${cx}" y="${H - padB + 16}" text-anchor="middle" font-size="11" fill="${INK}">${esc(d.label)}</text>`
  })

  return svgWrap(grid + bars, spec.title)
}

// --- LINE CHART ------------------------------------------------------------
function lineChart(spec) {
  const data = normalizeData(spec)
  if (data.length < 2) return barChart(spec) || null // a single point is just a bar

  const padL = 48
  const padR = 20
  const padT = spec.title ? 40 : 16
  const padB = 46
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const max = Math.max(...data.map((d) => d.value))
  const min = Math.min(...data.map((d) => d.value))
  const range = max - min || 1
  const yOf = (v) => padT + plotH - ((v - min) / range) * plotH
  const xOf = (i) => padL + (plotW * i) / (data.length - 1)

  let grid = ''
  for (let i = 0; i <= 4; i++) {
    const v = min + (range * i) / 4
    const y = yOf(v)
    grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`
    grid += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="${INK}">${fmt(v)}</text>`
  }

  const pts = data.map((d, i) => `${xOf(i)},${yOf(d.value)}`).join(' ')
  let dots = ''
  data.forEach((d, i) => {
    dots +=
      `<circle cx="${xOf(i)}" cy="${yOf(d.value)}" r="3.5" fill="${PALETTE[0]}"/>` +
      `<text x="${xOf(i)}" y="${H - padB + 16}" text-anchor="middle" font-size="11" fill="${INK}">${esc(d.label)}</text>`
  })
  const line = `<polyline points="${pts}" fill="none" stroke="${PALETTE[0]}" stroke-width="2.5" stroke-linejoin="round"/>`

  return svgWrap(grid + line + dots, spec.title)
}

// --- PIE CHART -------------------------------------------------------------
function pieChart(spec) {
  const data = normalizeData(spec).filter((d) => d.value > 0)
  if (!data.length) return null

  const total = data.reduce((s, d) => s + d.value, 0) || 1
  const cx = 150
  const cy = spec.title ? 170 : 160
  const r = 110

  let angle = -Math.PI / 2 // start at top
  let slices = ''
  let legend = ''
  data.forEach((d, i) => {
    const frac = d.value / total
    const next = angle + frac * Math.PI * 2
    const x1 = cx + r * Math.cos(angle)
    const y1 = cy + r * Math.sin(angle)
    const x2 = cx + r * Math.cos(next)
    const y2 = cy + r * Math.sin(next)
    const large = frac > 0.5 ? 1 : 0
    const color = PALETTE[i % PALETTE.length]
    // A full-circle single slice can't be drawn with one arc; draw a circle.
    if (frac >= 0.999) {
      slices += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`
    } else {
      slices += `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} Z" fill="${color}"/>`
    }
    const pct = Math.round(frac * 100)
    const ly = (spec.title ? 50 : 40) + i * 22
    legend +=
      `<rect x="320" y="${ly - 10}" width="13" height="13" rx="2" fill="${color}"/>` +
      `<text x="340" y="${ly}" font-size="12" fill="${INK}">${esc(d.label)} (${pct}%)</text>`
    angle = next
  })

  return svgWrap(slices + legend, spec.title)
}

// Render one chart spec to an SVG string, or null if we can't draw it (caller
// falls back to showing the raw block). Never throws on bad data.
export function renderChart(spec) {
  if (!spec || typeof spec !== 'object') return null
  try {
    switch ((spec.type || 'bar').toLowerCase()) {
      case 'line':
        return lineChart(spec)
      case 'pie':
      case 'doughnut':
        return pieChart(spec)
      case 'bar':
      case 'column':
      default:
        return barChart(spec)
    }
  } catch {
    return null
  }
}

// Edge cases this file does NOT handle:
// - Only bar, line, and pie. No stacked/grouped bars, multi-series lines,
//   scatter, or logarithmic axes (kept intentionally simple and robust).
// - Long category labels can overlap; the model is told to keep labels short.
// - Negative values work for bar/line but are meaningless for pie (filtered out).
// - No interactivity (tooltips/animation) — these are static teaching visuals.
