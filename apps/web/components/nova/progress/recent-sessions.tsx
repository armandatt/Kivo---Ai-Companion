'use client'

// The learner's latest finished sessions, Quick Focus ones included
// (GET /api/nova/sessions/recent, product/focus-history.ts). "Counted" is
// Progress's own rule, so this list and the totals above agree. A session
// with no topic moves no mastery and completes no task; the list says only
// what it was and how long. One with no topic can be filed on a topic here,
// afterwards (bug batch 28 Nov, item 4: the "file" session command).

import { useEffect, useState } from 'react'
import type { RecentSession } from '@repo/api/nova/product/focus-history.types'
import { minutesLabel } from '../format'
import { sendSessionCommand } from '../nova-api'
import { SessionTopicAsk } from '../session-topic'

export function RecentSessions() {
  const [sessions, setSessions] = useState<RecentSession[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [filing, setFiling] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const file = async (id: string, subjectId: string, topicName: string) => {
    setBusy(true)
    const res = await sendSessionCommand({ action: 'file', sessionId: id, subjectId, topicName })
    setBusy(false)
    if (!res.ok || !res.filed) return false
    setSessions(list => list?.map(x => (x.id === id ? { ...x, kind: 'topic', title: res.filed!.topicName } : x)) ?? list)
    return true
  }
  useEffect(() => {
    void fetch('/api/nova/sessions/recent', { cache: 'no-store' })
      .then(r => r.json())
      .then((out: { ok: boolean; sessions?: RecentSession[] }) => { if (out.ok && out.sessions) setSessions(out.sessions); else setFailed(true) })
      .catch(() => setFailed(true))
  }, [])
  if (failed || !sessions || sessions.length === 0) return null
  return (
    <section id="recent-sessions" aria-labelledby="recent-sessions-title" data-section="recent-sessions">
      <h2 id="recent-sessions-title" className="text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">Recent sessions</h2>
      <ul className="mt-4 divide-y divide-white/6 rounded-2xl border border-white/8 bg-card/50">
        {sessions.map(s => (
          <li key={s.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-3 text-sm" data-recent-session={s.kind}>
            <span className="min-w-0 flex-1 font-medium text-foreground">
              {s.title}
              {s.subjectName && <span className="ml-2 font-normal text-subtle">{s.subjectName}</span>}
              {s.category && <span className="ml-2 rounded-full border border-white/12 px-2 py-px text-[11px] font-medium text-foreground/70">{s.category}</span>}
            </span>
            <span className="tabular-nums text-foreground/80">{minutesLabel(s.minutes)}</span>
            <span className="w-full text-xs text-subtle sm:w-auto">
              {new Date(s.startedAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
              {!s.counted && ' · under 10 minutes, not counted'}
            </span>
            {s.description && <p className="w-full text-xs leading-relaxed text-foreground/55">{s.description}</p>}
            {s.kind === 'focus' && filing !== s.id && (
              <button type="button" onClick={() => setFiling(s.id)} className="text-xs font-medium text-nova-ink hover:underline" data-file-session={s.id}>File on a topic</button>
            )}
            {filing === s.id && <div className="w-full pt-2"><SessionTopicAsk topicName={null} after busy={busy} onChoose={(subjectId, topicName) => file(s.id, subjectId, topicName)} /></div>}
          </li>
        ))}
      </ul>
    </section>
  )
}
