'use client'

// What the Planner page used to show beside its plan, kept on Today under
// "More for today": the week ahead, why the planner sized today as it did,
// and what is coming up. Read only (GET /api/nova/planner), and read only
// while it is open: it never touches today's flow.

import type { NovaPlannerReady } from '@repo/api/nova/product/planner.types'
import { useNovaPlanner } from '../use-nova-planner'
import { WeekPlan } from '../planner/week-plan'
import { WhyPlan } from '../planner/why-plan'
import { UpcomingPressure } from '../planner/pressure'

export function PlannerLook() {
  const { view, loading, refresh } = useNovaPlanner(null)
  if (loading) return <div aria-busy="true" aria-label="Loading the week ahead" className="h-40 animate-pulse rounded-2xl bg-white/3" />
  if (!view || view.status !== 'ready') {
    return <p role="status" className="text-sm text-foreground/60">The week ahead didn&apos;t load. <button type="button" onClick={() => void refresh()} className="underline">Try again</button></p>
  }
  const ready: NovaPlannerReady = view
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]" data-today-planner-look>
      <WeekPlan week={ready.week} />
      <div className="space-y-6">
        <WhyPlan reasoning={ready.reasoning} />
        <UpcomingPressure pressure={ready.pressure} timezone={ready.timezone} goals={ready.goals} />
      </div>
    </div>
  )
}
