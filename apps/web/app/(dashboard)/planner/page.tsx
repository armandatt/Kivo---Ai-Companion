'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { BOARD_PATH } from '@repo/api/nova/product/companion'
import { PageLoading } from '@/components/dashboard/page-states'
import { RexPlanner } from '@/components/planner/rex-planner'
import { useDashboardCompanion } from '@/components/dashboard-shell'

// One Planner address, two companions. Rex's planner lives here. A Nova
// learner plans the day on Today, where the task board now opens too, so an
// old link (a bookmark, a Telegram message) lands there: ?view=board on the
// board, with the task it named.
function ToToday() {
  const router = useRouter()
  useEffect(() => {
    const at = new URLSearchParams(window.location.search)
    const task = at.get('task')
    router.replace(at.get('view') === 'board' || task ? `${BOARD_PATH}${task ? `&task=${encodeURIComponent(task)}` : ''}` : '/home')
  }, [router])
  return <PageLoading label="Opening Today"><div className="h-8 w-40 animate-pulse rounded-lg bg-white/5" /></PageLoading>
}

export default function PlannerPage() {
  return useDashboardCompanion() === 'nova' ? <ToToday /> : <RexPlanner />
}
