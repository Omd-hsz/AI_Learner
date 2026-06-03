// src/components/Home.jsx
// -----------------------------------------------------------------------------
// The curriculum home screen. Shows:
//   - an overall progress bar across ALL topics
//   - how many flashcards are due (quick link to study them)
//   - each module as a card with its own progress bar and a list of topics,
//     each topic showing a status badge (Not Started / In Progress / Completed)
//
// All data is passed in as props from App.jsx so this component stays "dumb"
// (it just displays things and reports clicks back up).
// -----------------------------------------------------------------------------
import { STATUS } from '../lib/db.js'
import ProgressBar from './ProgressBar.jsx'

// Human-friendly text + css class for each status value.
const STATUS_META = {
  [STATUS.NOT_STARTED]: { label: 'Not started', cls: 'badge-grey' },
  [STATUS.IN_PROGRESS]: { label: 'In progress', cls: 'badge-amber' },
  [STATUS.COMPLETED]: { label: 'Completed', cls: 'badge-green' },
}

export default function Home({ curriculum, progress, dueCount, onOpenTopic }) {
  if (!curriculum) return <p className="muted">Loading curriculum…</p>

  // Flatten every topic so we can compute an overall completion count.
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
        // Per-module progress.
        const done = module.topics.filter(
          (t) => progress[t.id] === STATUS.COMPLETED
        ).length

        return (
          <section
            key={module.id}
            className={`module module-${module.color || 'grey'}`}
          >
            <div className="module-head">
              <h2>{module.title}</h2>
              <ProgressBar completed={done} total={module.topics.length} />
            </div>

            <ul className="topic-list">
              {module.topics.map((topic) => {
                const status = progress[topic.id] || STATUS.NOT_STARTED
                const meta = STATUS_META[status]
                return (
                  <li key={topic.id}>
                    <button
                      className="topic-row"
                      onClick={() => onOpenTopic(topic)}
                    >
                      <span className="topic-id">#{topic.id}</span>
                      <span className="topic-title">
                        {topic.title}
                        {topic.foundation && (
                          <span className="foundation-tag" title="Foundation (math/CS) topic">
                            ∑
                          </span>
                        )}
                      </span>
                      <span className={`badge ${meta.cls}`}>{meta.label}</span>
                    </button>
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
// - It assumes topic ids are unique across the whole curriculum (they are in the
//   provided file). Duplicate ids would share one progress/lesson record.
