'use client'

import type { NovaTodayReady } from '@repo/api/nova/product/today.types'
import { ActiveSessionCard } from './active-session-card'
import { FirstSession } from './first-session'
import { TelegramCard } from './telegram-connect'
import { RecommendationCard } from './recommendation-card'
import { TalkToNova } from './talk-to-nova'
import { TimeAvailable } from './time-available'
import type { NovaNotesView } from '@repo/api/nova/product/notes.types'
import type { NovaCreatureView } from '@repo/api/nova/product/creature.types'
import { AccountingFor, UpNext, WorkingToward } from './today-sections'
import { CompanionCard, ContinueLearning, Deadlines, QuickActions, WeekSoFar } from './home-panels'
import { TodayTasks } from './tasks/today-tasks'
import { useTasks } from './tasks/use-tasks'
import { useNovaView } from './use-nova-view'
import { firstName, greeting, inDays, minutesLabel } from './format'
import { useStartSession } from './use-start-session'

type Props = {
  view:        NovaTodayReady
  minutes:     number | null
  onMinutes:   (minutes: number | null) => void
  refreshing:  boolean
  onRefresh:   () => void
}

function contextLine(view: NovaTodayReady): string {
  if (view.plan.mode === 'exam_crisis' && view.nextDeadline) {
    return `${view.nextDeadline.title} is ${inDays(view.nextDeadline.daysUntil)}. Today is exam prep.`
  }
  if (view.plan.mode === 'recovery') return 'Easing back in today. One light block is enough.'
  return new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
}

const EMPTY: Record<NonNullable<NovaTodayReady['emptyReason']>, { title: string; body: string; ask: string | null }> = {
  no_topics: {
    title: "Nova doesn't know your topics yet",
    body:  'A recommendation comes from what you have studied and how well it stuck. Start a session on whatever you are working on now. When it ends, tell Nova how it went, and it will plan from there.',
    ask:   null,
  },
  too_little_time: {
    title: "That's less time than Nova's shortest block",
    body:  'Nothing useful fits in the time you chose, so Nova has not recommended anything. Pick a longer time, or come back when you have a little more.',
    ask:   null,
  },
  recovery: {
    title: 'Nothing heavy today',
    body:  'Nova is keeping today light after a rough stretch, and there is no comfortable topic on file to revisit yet. Rest counts. If you do study, tell Nova what you covered.',
    ask:   'Tell Nova how today went',
  },
  nothing_due: {
    title: "You're caught up",
    body:  'Nothing is due for review and no exam is pressing. If you want to start something new, tell Nova what it is.',
    ask:   "e.g. I'm starting dynamic programming this week",
  },
}

// Home for a Nova learner. One question leads the page, "what should I do
// right now?", answered with what Nova's engines already decided; the
// learner's own tasks come next; everything else is context in the margin.
// The page lays out what the server returned and decides nothing itself.
export function NovaHome({ view, minutes, onMinutes, refreshing, onRefresh }: Props) {
  const { start, starting, error: startError } = useStartSession()
  const board    = useTasks()
  const notes    = useNovaView<NovaNotesView>('/api/nova/notes')
  const creature = useNovaView<NovaCreatureView>('/api/nova/creature')

  const name   = firstName(view.learnerName)
  const active = view.activeSession
  const rec    = view.recommendation
  const empty  = !active && !rec && view.emptyReason ? EMPTY[view.emptyReason] : null

  // With a session running, the recommendation waits its turn below it.
  const later = active && rec ? [rec, ...view.alternatives] : view.alternatives

  const whyContext = [
    ...view.constraints.map(c => `Accounting for: ${c.description}`),
    ...view.plan.assumptions,
  ]
  const tasks = board.view?.status === 'ready' ? board.tasks : null
  const recentNotes = notes.view?.status === 'ready' ? notes.view.notes : []

  return (
    <div className="mx-auto w-full max-w-6xl pb-20 pt-10 lg:pt-4">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {greeting(new Date())}{name ? `, ${name}` : ''}
          </h1>
          <p className="mt-2 text-sm text-foreground/55">{contextLine(view)}</p>
        </div>
        <QuickActions />
      </header>

      <div className="mt-8 grid grid-cols-1 gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* ── What to do ─────────────────────────────────────────────────── */}
        <div className="min-w-0 space-y-10">
          <section aria-label="Focus now">
            {!active && (
              <div className="mb-5">
                <TimeAvailable minutes={minutes} onChange={onMinutes} busy={refreshing} />
              </div>
            )}
            {active ? (
              <ActiveSessionCard session={active} />
            ) : rec ? (
              <RecommendationCard
                action={rec}
                context={whyContext}
                note={view.plan.budgetBasis === 'stated_time' && view.availableMinutes
                  ? `Today's plan is fitted to the ${minutesLabel(view.availableMinutes)} you have.` : null}
                onStart={() => start(rec)}
                starting={starting === rec.topicName}
                error={startError}
              />
            ) : empty ? (
              <section className="rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-9">
                <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">No recommendation yet</p>
                <h2 className="mt-5 text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl">{empty.title}</h2>
                <p className="mt-3 max-w-prose text-sm leading-relaxed text-foreground/65">{empty.body}</p>
                {view.subjects.length > 0 && (
                  <p className="mt-3 text-xs text-foreground/45">Subjects on file: {view.subjects.join(', ')}</p>
                )}
                {view.emptyReason === 'no_topics' && (
                  <FirstSession
                    subjects={view.subjects}
                    starting={starting !== null}
                    error={startError}
                    onStart={(topicName, subjectName) => start({ topicName, subjectName, durationMinutes: 25 })}
                  />
                )}
                {empty.ask && <TalkToNova className="mt-6" placeholder={empty.ask} onReplied={onRefresh} />}
              </section>
            ) : null}
          </section>

          <TodayTasks
            tasks={tasks} failed={board.loadError} error={board.error}
            onCreate={board.create} onUpdate={board.update}
          />

          <UpNext actions={later} onStart={active ? undefined : start} disabled={starting !== null} />
        </div>

        {/* ── Context ────────────────────────────────────────────────────── */}
        <aside className="space-y-9">
          <Deadlines exams={view.upcoming} tasks={tasks ?? []} />
          <WeekSoFar view={view} />
          <ContinueLearning
            view={view} notes={recentNotes} busy={starting !== null}
            onResume={topicName => {
              // The plan's own block for that topic if it has one; else a
              // standard block. The subject comes from the plan, never guessed.
              const planned = [view.recommendation, ...view.alternatives].find(a => a?.topicName === topicName)
              if (planned) void start(planned)
              else window.location.assign('/focus')
            }}
          />
          <CompanionCard creature={creature.view} name={null} />
          <TelegramCard />
          <WorkingToward goals={view.goals} />
          <AccountingFor constraints={view.constraints} />
        </aside>
      </div>
    </div>
  )
}
