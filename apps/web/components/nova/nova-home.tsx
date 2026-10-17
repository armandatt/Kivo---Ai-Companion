'use client'

import { useRef, useState } from 'react'
import type { NovaTodayReady } from '@repo/api/nova/product/today.types'
import { ActiveSessionCard } from './active-session-card'
import { FirstSession } from './first-session'
import { TelegramCard } from './telegram-connect'
import { TalkToNova } from './talk-to-nova'
import { ShortfallNote } from './shortfall-note'
import { RecoveryCard } from './recovery-card'
import { ChooseAnother } from './choose-another'
import { useFocusContext } from './focus-context'
import { LinkedToTopic } from './linked-to-topic'
import { KnowledgeBoard, RecentlyCaptured } from './knowledge-board'
import { TimeAvailable } from './time-available'
import type { NovaNotesView } from '@repo/api/nova/product/notes.types'
import type { NovaCreatureView } from '@repo/api/nova/product/creature.types'
import type { NovaKnowledgeMapView } from '@repo/api/nova/product/knowledge-map.types'
import type { NovaProgressView } from '@repo/api/nova/product/progress.types'
import { AccountingFor, DayFlow, NowBlock, TodayPlan, WorkingToward } from './today-sections'
import { TodayHero } from './today-hero'
import { CompanionCard, ContinueLearning, Deadlines, PageProperties, WeekSoFar } from './home-panels'
import { TodayTasks } from './tasks/today-tasks'
import { useTasks } from './tasks/use-tasks'
import { useNovaView } from './use-nova-view'
import { firstName, greeting, inDays } from './format'
import { useStartSession } from './use-start-session'
import { CommandButton, CommandPalette, useCommandShortcut } from './workspace/command-palette'
import { NewMenu } from './workspace/new-menu'
import { SURFACE_RAISED } from './workspace/ui'
import { taskTopicHref, topicRecord } from './today-links'

type Props = {
  view:        NovaTodayReady
  minutes:     number | null
  onMinutes:   (minutes: number | null) => void
  refreshing:  boolean
  onRefresh:   () => void
}

// A line under the greeting only when the day is not an ordinary one.
function dayContext(view: NovaTodayReady): string | null {
  if (view.plan.mode === 'exam_crisis' && view.nextDeadline) {
    return `${view.nextDeadline.title} is ${inDays(view.nextDeadline.daysUntil)}. Today is exam prep.`
  }
  if (view.plan.mode === 'recovery') return 'Easing back in today. One light block is enough.'
  if (view.plan.budgetBasis === 'reentry') return 'First day back. A shorter day today, and it changes back after your next session.'
  return null
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

// A session started from a task has no planned block behind it, so it gets
// the length of an ordinary one.
const TASK_SESSION_MINUTES = 25

// Home for a Nova learner: a working page for today. The plan leads, with
// the block to do now opened out at its head; the learner's own tasks come
// next; the margin holds dates, the week and what they are working toward;
// everything on record follows. The page lays out what the server returned
// and decides nothing itself.
export function NovaHome({ view, minutes, onMinutes, refreshing, onRefresh }: Props) {
  const { start, starting, error: startError } = useStartSession()
  const board    = useTasks()
  const notes    = useNovaView<NovaNotesView>('/api/nova/notes')
  const creature = useNovaView<NovaCreatureView>('/api/nova/creature')
  // The links around the recommended topic, the knowledge rows and search.
  // An extra: Today never waits for it.
  const map      = useNovaView<NovaKnowledgeMapView>('/api/nova/knowledge-map')
  // The eight finished weeks beside this week's numbers. An extra, like the map.
  const progressView = useNovaView<NovaProgressView>('/api/nova/progress')

  const [paletteOpen, setPaletteOpen] = useState(false)
  useCommandShortcut(setPaletteOpen)
  const composer = useRef<HTMLInputElement>(null)

  const name   = firstName(view.learnerName)
  const active = view.activeSession
  const rec    = view.recommendation
  const empty  = !active && !rec && view.emptyReason ? EMPTY[view.emptyReason] : null
  const context = dayContext(view)
  const dayBlocks = rec ? [rec, ...view.alternatives] : view.alternatives

  const whyContext = [
    ...view.constraints.map(c => `Accounting for: ${c.description}`),
    ...view.plan.assumptions,
  ]
  const tasks = board.view?.status === 'ready' ? board.tasks : null
  // Where today's work sits on the record. The map is an extra: without it
  // the plan and the tasks show as they did.
  const mapReady = map.view?.status === 'ready' ? map.view : null
  const recordOf = (action: { subjectName: string; topicName: string }) => mapReady ? topicRecord(mapReady, tasks ?? [], action) : null
  // What the learner has filed under the recommended topic. Not asked for
  // while a session runs: the Focus screen shows that session's own.
  const recContext = useFocusContext(rec ? { subjectName: rec.subjectName, topicName: rec.topicName } : null, rec?.topicName ?? null, !active && rec !== null)

  return (
    <div className="mx-auto w-full max-w-7xl pb-20 pt-12 lg:pt-2">
      {/* The day, at a glance: the greeting on the day's colours, its flow,
          the two ways to act on anything, and the one thing to do next */}
      <TodayHero
        greeting={<>{greeting(new Date())}{name ? <span className="text-foreground/45">, {name}</span> : ''}</>}
        context={context}
        subjects={dayBlocks.map(b => b.subjectName)}
        properties={<PageProperties view={view} />}
        actions={<>
          <div className="min-w-0 flex-1 sm:flex-none"><CommandButton onOpen={() => setPaletteOpen(true)} /></div>
          <NewMenu onNewTask={() => { composer.current?.scrollIntoView({ block: 'center' }); composer.current?.focus() }} />
        </>}
        focal={active ? <ActiveSessionCard session={active} /> : rec ? (
          <NowBlock action={rec} why={whyContext} record={recordOf(rec)} onStart={() => void start(rec)}
            starting={starting === rec.topicName} error={startError} disabled={starting !== null} />
        ) : null}
      >
        <DayFlow blocks={dayBlocks} plan={view.plan} nowFirst={!active && rec !== null} />
        {!active && <TimeAvailable minutes={minutes} onChange={onMinutes} busy={refreshing} />}
      </TodayHero>

      <div className="mt-10 grid grid-cols-1 gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_17rem] xl:grid-cols-[minmax(0,1fr)_19rem]">
        {/* ── The day's work ─────────────────────────────────────────────── */}
        <div className="min-w-0 space-y-10">
          <div className="space-y-5">
            {/* The plan in the planner's order, after the block to do now
                (open in the hero). With a session running, nothing starts
                from here. */}
            <TodayPlan
              recommendation={rec} alternatives={view.alternatives}
              blockCount={view.plan.blockCount} plan={view.plan} why={whyContext}
              onStart={active ? undefined : start} disabled={starting !== null}
              starting={starting} error={startError} recordOf={recordOf} leadShown
            />

            {empty && (
              <section className={`${SURFACE_RAISED} relative isolate overflow-hidden p-5 sm:p-7`} data-empty={view.emptyReason ?? undefined}>
                <div aria-hidden className="nova-canvas pointer-events-none absolute inset-0 -z-10 opacity-60 [mask-image:linear-gradient(to_left,black,transparent_60%)]" />
                <p className="text-xs font-semibold text-foreground/60">No recommendation yet</p>
                <h2 className="mt-2 text-xl font-semibold leading-snug tracking-tight text-foreground">{empty.title}</h2>
                <p className="mt-2 max-w-prose text-sm leading-relaxed text-foreground/70">{empty.body}</p>
                {view.subjects.length > 0 && (
                  <p className="mt-3 text-xs text-foreground/55">Subjects on file: {view.subjects.join(', ')}</p>
                )}
                {view.emptyReason === 'no_topics' && (
                  <FirstSession
                    subjects={view.subjects}
                    starting={starting !== null}
                    error={startError}
                    onStart={(topicName, subjectName) => start({ topicName, subjectName, durationMinutes: 25 })}
                  />
                )}
                {empty.ask && <TalkToNova className="mt-5" placeholder={empty.ask} onReplied={onRefresh} />}
              </section>
            )}

            {!active && view.plan.shortfall && <ShortfallNote shortfall={view.plan.shortfall} timeHref="/planner" />}
          </div>

          {!active && rec && (
            <ChooseAnother alternatives={view.alternatives} onStart={a => void start(a)} disabled={starting !== null} />
          )}

          {!active && rec && (
            <LinkedToTopic topicName={rec.topicName} subjectName={rec.subjectName} context={recContext} map={map} />
          )}

          {!active && <RecoveryCard onChanged={() => void board.refresh()} />}

          <TodayTasks
            tasks={tasks} failed={board.loadError} error={board.error}
            onCreate={board.create} onUpdate={board.update} onRemove={board.remove}
            subjects={board.view?.status === 'ready' ? board.view.subjects : []}
            today={board.view?.status === 'ready' ? board.view.today : null}
            dayMinutes={{ planned: view.plan.totalMinutesToday, budget: view.plan.budgetMinutes }}
            onStart={active ? undefined : task => start({ topicName: task.topicName!, subjectName: task.subjectName!, durationMinutes: TASK_SESSION_MINUTES }, `task:${task.id}`)}
            starting={starting} composerRef={composer}
            topicHref={task => taskTopicHref(mapReady, task)}
          />
        </div>

        {/* ── The margin: dates, the week, where you left off, intent ─────── */}
        <aside aria-label="Today's context" className={`min-w-0 space-y-6 ${!active && !rec ? '' : 'lg:pt-28'}`}>
          <Deadlines exams={view.upcoming} tasks={tasks ?? []} />
          <WeekSoFar view={view} weeks={progressView} />
          <ContinueLearning
            view={view} busy={starting !== null}
            onResume={topicName => {
              // The plan's own block for that topic if it has one; else a
              // standard block. The subject comes from the plan, never guessed.
              const planned = [view.recommendation, ...view.alternatives].find(a => a?.topicName === topicName)
              if (planned) void start(planned)
              else window.location.assign('/focus')
            }}
          />
          {/* What the learner said they are working toward, and what Nova is
              allowing for. */}
          <div className="border-t border-white/8 pt-5">
            <WorkingToward goals={view.goals} />
            <AccountingFor constraints={view.constraints} />
          </div>
          <div className="space-y-3 border-t border-white/8 pt-5">
            <CompanionCard creature={creature.view} name={null} />
            <TelegramCard />
          </div>
        </aside>
      </div>

      {/* ── Everything on record, subject by subject, and what came in last ── */}
      <div className="mt-14 space-y-12 border-t border-white/8 pt-8">
        <KnowledgeBoard map={map} reviewDue={view.reviewDue} />
        <RecentlyCaptured notes={notes} map={map} />
      </div>

      <CommandPalette
        open={paletteOpen} onClose={() => setPaletteOpen(false)}
        map={map} tasks={tasks ?? []} onCreateTask={title => board.create({ title })}
      />
    </div>
  )
}
