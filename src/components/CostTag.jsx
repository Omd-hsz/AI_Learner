// src/components/CostTag.jsx
// -----------------------------------------------------------------------------
// A tiny, unobtrusive footer that shows what an API call cost: token counts and
// estimated/real USD. Shown at the end of a lesson and after each quiz/check so
// the learner always knows what they paid for that section.
// -----------------------------------------------------------------------------
import { t } from '../lib/i18n.js'

// Format a USD amount with enough decimals to be meaningful for tiny costs.
function formatCost(cost) {
  if (cost == null) return null
  if (cost === 0) return '$0'
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(3)}`
}

export default function CostTag({ usage, lang = 'en' }) {
  if (!usage) return null
  const cost = formatCost(usage.cost)
  const tokens = usage.totalTokens ? usage.totalTokens.toLocaleString() : null

  return (
    <p className="cost-tag muted">
      {cost ? `${t('costLabel', lang)} ≈ ${cost}` : t('costUnknown', lang)}
      {tokens ? ` · ${tokens} ${t('tokens', lang)}` : ''}
      {usage.model ? ` · ${usage.model}` : ''}
    </p>
  )
}

// Edge cases this file does NOT handle:
// - If the provider returned no usage at all, the parent passes null and we
//   render nothing.
