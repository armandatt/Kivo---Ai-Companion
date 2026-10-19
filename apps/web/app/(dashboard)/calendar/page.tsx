'use client'

import { useEffect, useState } from 'react'
import { PageFrame } from '@/components/dashboard/page-states'
import { NovaCalendar } from '@/components/nova/calendar/nova-calendar'

// The device's own day, only to open on the right month before the server
// answers; the server's "today" (the learner's zone) is used from then on.
const deviceToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function CalendarPage() {
  // Read after mount: the server render has no device to ask.
  const [today, setToday] = useState<string | null>(null)
  useEffect(() => { setToday(deviceToday()) }, [])
  return (
    <PageFrame width="wide">
      {today && <NovaCalendar initialToday={today} />}
    </PageFrame>
  )
}
