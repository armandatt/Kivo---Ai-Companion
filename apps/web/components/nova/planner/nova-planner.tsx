'use client'

import type { NovaPlannerReady } from '@repo/api/nova/product/planner.types'
import { TimeAvailable } from '../time-available'
import { useStartSession } from '../use-start-session'
import { UpcomingPressure } from './pressure'
import { TodayPlan } from './today-plan'
import { WeekPlan } from './week-plan'
import { WhyPlan } from './why-plan'

type Props = {
  view:       NovaPlannerReady
  minutes:    number | null
  onMinutes:  (minutes: number | null) => void
  refreshing: boolean
}

const TIME_CHOICES = [30, 60, 120]

// Nova's current plan and the reasons for it. The page lays out the server's
// answer; changing the time available asks the server for a new one.
export function NovaPlanner({ view, minutes, onMinutes, refreshing }: Props) {
  const { start, starting, error } = useStartSession()

  return (
    <div className="mx-auto w-full max-w-6xl pb-20 pt-10 lg:pt-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Planner</h1>
        <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-foreground/55">
          What Nova thinks you should get done, and why. It is worked out again from everything Nova knows each time you open it.
          {view.preferredStudyTime && <> You told Nova you study in the {view.preferredStudyTime}.</>}
        </p>
      </header>

      {/* Asking how long you have only makes sense when there is something to fit. */}
      {!view.today.activeSession && view.today.emptyReason !== 'no_topics' && (
        <div className="mt-6">
          <TimeAvailable minutes={minutes} onChange={onMinutes} busy={refreshing} choices={TIME_CHOICES} allowCustom />
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className={refreshing ? 'space-y-10 opacity-70 transition-opacity' : 'space-y-10 transition-opacity'}>
          <TodayPlan
            today={view.today}
            budget={view.reasoning.budget}
            onStart={block => void start(block, block.id)}
            starting={starting}
            error={error}
          />
          <WeekPlan week={view.week} />
        </div>

        <aside className="space-y-6">
          <WhyPlan reasoning={view.reasoning} />
          <UpcomingPressure pressure={view.pressure} timezone={view.timezone} goals={view.goals} />
        </aside>
      </div>
    </div>
  )
}
