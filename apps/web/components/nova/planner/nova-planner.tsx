'use client'

import { useEffect, useState } from 'react'
import type { NovaPlannerReady } from '@repo/api/nova/product/planner.types'
import { TaskBoard } from '../tasks/task-board'
import { useTasks } from '../tasks/use-tasks'
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

type Tab = 'plan' | 'board'
const TABS: Array<{ id: Tab; label: string }> = [{ id: 'plan', label: 'Study plan' }, { id: 'board', label: 'Task board' }]

// Nova's current plan and the reasons for it. The page lays out the server's
// answer; changing the time available asks the server for a new one.
export function NovaPlanner({ view, minutes, onMinutes, refreshing }: Props) {
  const { start, starting, error } = useStartSession()
  const board = useTasks()
  // Which view is open is in the address, so it survives a refresh and a link
  // can point at the board.
  const [tab, setTab] = useState<Tab>('plan')
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('view') === 'board') setTab('board')
  }, [])
  const open = (next: Tab) => {
    setTab(next)
    const url = new URL(window.location.href)
    if (next === 'board') url.searchParams.set('view', 'board'); else url.searchParams.delete('view')
    window.history.replaceState(null, '', url)
  }
  const openTasks = board.view?.status === 'ready' ? board.view.counts.todo + board.view.counts.in_progress : null

  return (
    <div className="mx-auto w-full max-w-6xl pb-20 pt-10 lg:pt-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Planner</h1>
        <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-foreground/55">
          {tab === 'plan'
            ? <>What Nova thinks you should study, and why. It is worked out again from everything Nova knows each time you open it.{view.preferredStudyTime && <> You told Nova you study in the {view.preferredStudyTime}.</>}</>
            : <>Your own to-do list: assignments, chapters, anything with a deadline. Drag a card to move it, or use the arrows on it.</>}
        </p>
      </header>

      <div role="tablist" aria-label="Planner views" className="mt-6 inline-flex rounded-xl border border-white/8 bg-white/3 p-1">
        {TABS.map(t => (
          <button
            key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => open(t.id)}
            className={`h-9 rounded-lg px-4 text-sm font-medium transition-colors ${tab === t.id ? 'bg-white/10 text-foreground' : 'text-foreground/55 hover:text-foreground'}`}
          >
            {t.label}
            {t.id === 'board' && openTasks !== null && openTasks > 0 && <span className="ml-2 text-xs font-normal text-foreground/45">{openTasks}</span>}
          </button>
        ))}
      </div>

      {tab === 'board' && (
        <div className="mt-6">
          {board.loading ? (
            <div aria-busy="true" aria-label="Loading your tasks" className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {[0, 1, 2].map(i => <div key={i} className="h-56 animate-pulse rounded-3xl bg-white/3" />)}
            </div>
          ) : board.view?.status === 'ready' ? (
            <TaskBoard
              view={board.view} tasks={board.tasks} error={board.error} onClearError={board.clearError}
              onCreate={board.create} onUpdate={board.update} onDelete={board.remove}
            />
          ) : (
            <section role="alert" className="rounded-3xl border border-white/8 bg-card/70 p-6">
              <p className="text-sm text-foreground/70">Couldn&apos;t load your tasks. Nothing is lost.</p>
              <button type="button" onClick={() => void board.refresh()} className="mt-4 inline-flex h-10 items-center rounded-xl border border-white/12 px-5 text-sm font-medium text-foreground transition-colors hover:bg-white/5">Try again</button>
            </section>
          )}
        </div>
      )}

      {tab === 'plan' && (<>

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
      </>)}
    </div>
  )
}
