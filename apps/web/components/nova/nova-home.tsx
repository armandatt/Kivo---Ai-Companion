'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { NovaTodayReady, TodayAction } from '@repo/api/nova/product/today.types'
import { ActiveSessionCard } from './active-session-card'
import { RecommendationCard } from './recommendation-card'
import { TalkToNova } from './talk-to-nova'
import { TimeAvailable } from './time-available'
import { AccountingFor, Recently, UpNext, Upcoming, WorkingToward } from './today-sections'
import { firstName, greeting, inDays } from './format'
import { sendSessionCommand } from './nova-api'

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
    body:  'A recommendation comes from what you have studied and how well it stuck. Tell Nova what you covered recently, or what you are working on now, and it will plan from there.',
    ask:   "e.g. I studied deadlocks for 40 minutes, still shaky on Banker's",
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

// Home for a Nova learner. It answers one question, "what should I do right
// now?", with what Nova's engines already decided.
export function NovaHome({ view, minutes, onMinutes, refreshing, onRefresh }: Props) {
  const router = useRouter()
  const [starting, setStarting]     = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)

  async function start(action: TodayAction) {
    setStarting(action.topicName)
    setStartError(null)
    const res = await sendSessionCommand({
      action:         'start',
      topicName:      action.topicName,
      subjectName:    action.subjectName,
      plannedMinutes: action.durationMinutes,
    })
    if (res.ok && res.session) {
      router.push('/focus')
      return
    }
    setStarting(null)
    setStartError(res.ok ? 'The session did not start. Try again.' : res.message)
  }

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

  return (
    <div className="mx-auto w-full max-w-3xl pb-20 pt-10 lg:pt-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {greeting(new Date())}{name ? `, ${name}` : ''}
        </h1>
        <p className="mt-1.5 text-sm text-foreground/55">{contextLine(view)}</p>
      </header>

      {!active && (
        <div className="mt-6">
          <TimeAvailable minutes={minutes} onChange={onMinutes} busy={refreshing} />
        </div>
      )}

      <div className="mt-6">
        {active ? (
          <ActiveSessionCard session={active} />
        ) : rec ? (
          <RecommendationCard
            action={rec}
            context={whyContext}
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
            {empty.ask && <TalkToNova className="mt-6" placeholder={empty.ask} onReplied={onRefresh} />}
          </section>
        ) : null}
      </div>

      <div className="mt-10 grid grid-cols-1 gap-x-12 gap-y-8 md:grid-cols-2">
        <UpNext actions={later} onStart={active ? undefined : start} disabled={starting !== null} />
        <Upcoming items={view.upcoming} />
        <WorkingToward goals={view.goals} />
        <Recently view={view} />
        <AccountingFor constraints={view.constraints} />
      </div>
    </div>
  )
}
