// src/components/Home.jsx
// -----------------------------------------------------------------------------
// The curriculum home screen. Each TOPIC is clickable and opens just that one
// lesson (generated on demand — we do NOT pre-load whole modules). There is also
// a "Find my level" button (placement test) and an optional "open whole module".
// -----------------------------------------------------------------------------
import { STATUS } from '../lib/db.js'
import { t } from '../lib/i18n.js'
import ProgressBar from './ProgressBar.jsx'

const STATUS_META = {
  [STATUS.NOT_STARTED]: { key: 'notStarted', cls: 'badge-grey' },
  [STATUS.IN_PROGRESS]: { key: 'inProgress', cls: 'badge-amber' },
  [STATUS.COMPLETED]: { key: 'completed', cls: 'badge-green' },
}

export default function Home({
  curriculum,
  progress,
  dueCount,
  profile,
  onOpenTopic,
  onOpenModule,
  onOpenPlacement,
  lang = 'en',
}) {
  if (!curriculum) return <p className="muted">Loading curriculum…</p>

  const allTopics = curriculum.modules.flatMap((m) => m.topics)
  const completedCount = allTopics.filter(
    (tp) => progress[tp.id] === STATUS.COMPLETED
  ).length

  const recommendedId = profile?.recommendedTopicId

  return (
    <div className="home">
      <header className="home-head">
        <h1>{curriculum.courseTitle}</h1>
        <ProgressBar
          completed={completedCount}
          total={allTopics.length}
          label={t('overall', lang)}
        />

        <div className="home-cta row">
          <button className="btn-primary" onClick={onOpenPlacement}>
            {profile?.placementDone ? t('retakePlacement', lang) : t('findMyLevel', lang)}
          </button>
          {profile?.level && (
            <span className="muted small">
              {lang === 'fa' ? 'سطح تو: ' : 'Your level: '}
              {profile.level}
            </span>
          )}
        </div>

        {dueCount > 0 && (
          <p className="due-banner">
            {lang === 'fa'
              ? `${dueCount} کارت برای مرور آماده است — به بخش کارت‌ها برو.`
              : `You have ${dueCount} flashcard${dueCount === 1 ? '' : 's'} due — head to the Cards tab.`}
          </p>
        )}
      </header>

      {curriculum.modules.map((module) => {
        const done = module.topics.filter(
          (tp) => progress[tp.id] === STATUS.COMPLETED
        ).length

        return (
          <section
            key={module.id}
            className={`module module-${module.color || 'grey'}`}
          >
            <div className="module-head">
              <div className="module-head-top">
                <h2>{module.title}</h2>
                <button className="btn btn-small" onClick={() => onOpenModule(module)}>
                  {lang === 'fa' ? 'باز کردن کل ماژول' : 'Open whole module'}
                </button>
              </div>
              <ProgressBar completed={done} total={module.topics.length} />
            </div>

            <ul className="topic-list">
              {module.topics.map((topic) => {
                const status = progress[topic.id] || STATUS.NOT_STARTED
                const meta = STATUS_META[status]
                const isRecommended = topic.id === recommendedId
                return (
                  <li key={topic.id}>
                    <button
                      className={`topic-row ${isRecommended ? 'topic-recommended' : ''}`}
                      onClick={() => onOpenTopic(topic)}
                    >
                      <span className="topic-id">#{topic.id}</span>
                      <span className="topic-title">
                        {topic.title}
                        {topic.foundation && (
                          <span className="foundation-tag" title="Foundation topic">
                            ∑
                          </span>
                        )}
                        {isRecommended && (
                          <span className="recommend-tag">
                            {lang === 'fa' ? 'شروع از اینجا' : 'start here'}
                          </span>
                        )}
                      </span>
                      <span className={`badge ${meta.cls}`}>{t(meta.key, lang)}</span>
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
// - It assumes topic ids are unique across the whole curriculum (they are).
