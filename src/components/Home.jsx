// src/components/Home.jsx
// -----------------------------------------------------------------------------
// The curriculum home screen. Each module opens as ONE page with all its lessons
// loaded/generated together. Individual topics can still be opened from there.
// -----------------------------------------------------------------------------
import { STATUS } from '../lib/db.js'
import ProgressBar from './ProgressBar.jsx'

const STATUS_META = {
  [STATUS.NOT_STARTED]: { label: 'Not started', cls: 'badge-grey' },
  [STATUS.IN_PROGRESS]: { label: 'In progress', cls: 'badge-amber' },
  [STATUS.COMPLETED]: { label: 'Completed', cls: 'badge-green' },
}

export default function Home({ curriculum, progress, dueCount, onOpenModule }) {
  if (!curriculum) return <p className="muted">Loading curriculum…</p>

  const allTopics = curriculum.modules.flatMap((m) => m.topics)
  const completedCount = allTopics.filter(
    (t) => progress[t.id] === STATUS.COMPLETED
  ).length

  return (
    <div className="home">
      <header className="home-head">
        <h1>{curriculum.courseTitle}</h1>
        <ProgressBar
          completed={completedCount}
          total={allTopics.length}
          label="Overall"
        />
        {dueCount > 0 && (
          <p className="due-banner">
            You have <strong>{dueCount}</strong> flashcard
            {dueCount === 1 ? '' : 's'} due — head to the Cards tab to review.
          </p>
        )}
      </header>

      {curriculum.modules.map((module) => {
        const done = module.topics.filter(
          (t) => progress[t.id] === STATUS.COMPLETED
        ).length
        const started = module.topics.filter(
          (t) => progress[t.id] && progress[t.id] !== STATUS.NOT_STARTED
        ).length
        const moduleStatus =
          done === module.topics.length
            ? STATUS.COMPLETED
            : started > 0
              ? STATUS.IN_PROGRESS
              : STATUS.NOT_STARTED
        const meta = STATUS_META[moduleStatus]

        return (
          <section
            key={module.id}
            className={`module module-${module.color || 'grey'}`}
          >
            <button
              className="module-open"
              onClick={() => onOpenModule(module)}
            >
              <div className="module-head">
                <div className="module-head-top">
                  <h2>{module.title}</h2>
                  <span className={`badge ${meta.cls}`}>{meta.label}</span>
                </div>
                <ProgressBar completed={done} total={module.topics.length} />
                <p className="module-open-hint muted">
                  {module.topics.length} topics · tap to open whole module
                </p>
              </div>
            </button>

            <ul className="topic-list topic-list-compact">
              {module.topics.map((topic) => {
                const status = progress[topic.id] || STATUS.NOT_STARTED
                const topicMeta = STATUS_META[status]
                return (
                  <li key={topic.id} className="topic-preview">
                    <span className="topic-id">#{topic.id}</span>
                    <span className="topic-title">
                      {topic.title}
                      {topic.foundation && (
                        <span className="foundation-tag" title="Foundation topic">
                          ∑
                        </span>
                      )}
                    </span>
                    <span className={`badge ${topicMeta.cls}`}>{topicMeta.label}</span>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

// Edge cases this file does NOT handle:
// - Topic rows here are previews only; you must open the module to read/generate.
