'use client'

// Before a session with no topic ends (Quick Focus, a task with no topic):
// "What was this on?", so it counts toward a topic like any other session.
// Optional: skipping ends it as it is (it still counts as focus time). Only
// the learner's own topics can be chosen, through the one destination picker
// (a new topic only by its explicit "Create new topic" row). The choice is
// sent at once (set_topic); the session then ends the ordinary way.

import { useEffect, useState } from 'react'
import { Hash } from 'lucide-react'
import type { NoteSubjectOption } from '@repo/api/nova/product/notes.types'
import { DestinationPicker } from './notes/destination-picker'
import { NO_SUBJECT, destinationLabel, type Destination } from './notes/note-destinations'
import { fetchNotes } from './notes/notes-api'
import { cn } from '@/lib/utils'

// after: the session has already ended (bug batch 28 Nov, item 4). The same
// question, asked on the end screen, the saved notice and Progress, filing a
// finished session (the "file" command) instead of a running one.
export function SessionTopicAsk({ topicName, onChoose, busy, dark = false, after = false }: {
  topicName: string | null
  onChoose: (subjectId: string, topicName: string) => Promise<boolean>
  busy: boolean
  dark?: boolean
  after?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [filed, setFiled] = useState<{ subjectId: string; topicName: string } | null>(null)
  const [status, setStatusShown] = useState<'in_progress' | 'completed' | null>(null)
  const [statusBusy, setStatusBusy] = useState(false)
  const setStatus = async (s: 'in_progress' | 'completed') => {
    if (!filed) return
    setStatusBusy(true)
    try {
      const r = await fetch('/api/nova/topics/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subjectId: filed.subjectId, topicName: filed.topicName, status: s }) })
      if ((await r.json().catch(() => null) as { ok?: boolean } | null)?.ok) setStatusShown(s)
    } catch { /* stays unchosen */ }
    setStatusBusy(false)
  }
  const [subjects, setSubjects] = useState<NoteSubjectOption[] | null>(null)
  const [value, setValue] = useState<Destination>(NO_SUBJECT)
  const [error, setError] = useState<string | null>(null)
  const load = async () => { const v = await fetchNotes(); if (v?.status === 'ready') { setSubjects(v.subjects); return v.subjects } return null }
  useEffect(() => { if (open && !subjects) void load() }, [open, subjects])

  if (filed && !topicName) return (
    <div className={cn('text-sm', dark ? 'text-white/70' : 'text-foreground/70')} data-session-filed>
      <p>Filed on <span className="font-medium">{filed.topicName}</span>. It now counts toward that topic.</p>
      {/* Optional (item 7, 28 Nov): where the topic stands now. Time alone never completes it. */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={`Where ${filed.topicName} stands`}>
        <span className={dark ? 'text-white/55' : 'text-foreground/50'}>Where does it stand?</span>
        {(['in_progress', 'completed'] as const).map(s => (
          <button key={s} type="button" disabled={statusBusy} aria-pressed={status === s} onClick={() => void setStatus(s)} data-filed-status={s}
            className={cn('rounded-full border px-2.5 py-0.5 text-xs', status === s ? 'border-nova/60 bg-nova/15' : dark ? 'border-white/20 hover:bg-white/10' : 'border-white/12 hover:bg-white/5')}>
            {s === 'completed' ? 'Completed' : 'Still in progress'}
          </button>
        ))}
      </div>
    </div>
  )
  if (topicName) return <p className={cn('text-sm', dark ? 'text-white/70' : 'text-foreground/70')} data-session-topic>On <span className="font-medium">{topicName}</span>: it counts toward that topic.</p>

  const choose = async (d: Destination) => {
    setValue(d); setError(null)
    if (d.kind !== 'topic' || !d.subjectId || !d.topicName) { if (d.kind !== 'none') setError('Choose a topic (open a subject to see its topics).'); return }
    if (!(await onChoose(d.subjectId, d.topicName))) setError('That didn’t save. Choose it again.')
    else { setOpen(false); setFiled({ subjectId: d.subjectId, topicName: d.topicName }) }
  }

  return (
    <div className={cn('rounded-2xl border p-3 text-left', dark ? 'border-white/15 bg-white/[0.06]' : 'border-white/10 bg-card/40')} data-session-topic-ask>
      <div className="flex flex-wrap items-center gap-2">
        <Hash aria-hidden className={cn('size-4', dark ? 'text-white/60' : 'text-subtle')} />
        <p className={cn('flex-1 text-sm', dark ? 'text-white/85' : 'text-foreground/85')}>What was this on? <span className={dark ? 'text-white/55' : 'text-foreground/50'}>{after ? 'Optional: file it on a topic so it shows on the map and counts toward it.' : 'Optional: a topic makes it count toward that topic.'}</span></p>
        {!open && <button type="button" disabled={busy} onClick={() => setOpen(true)} className={cn('rounded-lg border px-2.5 py-1 text-sm', dark ? 'border-white/20 text-white hover:bg-white/10' : 'border-white/12 hover:bg-white/5')} data-session-topic-open>Choose a topic</button>}
      </div>
      {open && (
        <div className="mt-3 rounded-xl bg-card p-2 text-foreground">
          {subjects ? <DestinationPicker subjects={subjects} value={value} onChange={d => void choose(d)} onSubjectsChanged={load} allowNone={false} />
            : <p className="p-2 text-sm text-foreground/60">Loading your topics…</p>}
          {value.kind === 'topic' && busy && <p className="p-2 text-sm text-foreground/60">Saving {destinationLabel(value)}…</p>}
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-amber-200">{error}</p>}
    </div>
  )
}
