// src/components/ProgressBar.jsx
// -----------------------------------------------------------------------------
// A reusable horizontal progress bar. Give it a count of completed items and a
// total; it draws a filled track and a "3 / 10" label.
// -----------------------------------------------------------------------------

export default function ProgressBar({ completed, total, label }) {
  // Guard against divide-by-zero when a module somehow has no topics.
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div className="progress">
      <div className="progress-track">
        {/* The inline width is the one place a style must be dynamic. */}
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="progress-label">
        {label ? `${label} ` : ''}
        {completed} / {total} ({pct}%)
      </span>
    </div>
  )
}

// Edge cases this file does NOT handle:
// - Negative or out-of-range counts are not clamped; callers pass sane numbers.
