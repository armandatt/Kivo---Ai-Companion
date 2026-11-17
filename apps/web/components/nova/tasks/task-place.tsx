'use client'

// Where a task is filed (subject, topic), chosen with the one destination
// picker instead of a free-text topic box: only the learner's own subjects
// and topics, and a new topic only by the picker's explicit "Create new
// topic" row, so a typo never files a task under a topic that doesn't exist.
// A task saved earlier with a topic name that matches none of theirs keeps
// it, said as such, until the learner chooses something else.

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, FolderClosed, Hash, Inbox } from 'lucide-react'
import type { NoteSubjectOption } from '@repo/api/nova/product/notes.types'
import { DestinationPicker } from '../notes/destination-picker'
import { NO_SUBJECT, destinationFor, destinationsOf, type Destination } from '../notes/note-destinations'
import { fetchNotes } from '../notes/notes-api'

export function TaskPlace({ subjectId, topicName, fallbackSubject, onChange }: {
  subjectId: string | null
  topicName: string | null
  fallbackSubject: string | null
  onChange: (subjectId: string | null, topicName: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [subjects, setSubjects] = useState<NoteSubjectOption[] | null>(null)
  const load = async () => { const v = await fetchNotes(); if (v?.status === 'ready') { setSubjects(v.subjects); return v.subjects } return null }
  useEffect(() => { void load() }, [])
  const all = useMemo(() => (subjects ? destinationsOf(subjects) : []), [subjects])
  const value: Destination = subjects ? destinationFor(all, subjectId, topicName) : NO_SUBJECT
  // A topic name on record that is none of the learner's topics.
  const unknownTopic = !!subjects && !!topicName && value.kind !== 'topic'
  const Icon = value.kind === 'topic' ? Hash : value.kind === 'subject' || subjectId ? FolderClosed : Inbox
  const shown = value.kind !== 'none' ? value.path.join(' › ') : subjectId ? (fallbackSubject ?? 'A subject') : 'Not filed'

  return (
    <div data-task-place>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="flex min-h-10 w-full items-center gap-2 rounded-xl border border-white/10 bg-transparent px-3 py-2 text-left text-sm text-foreground hover:bg-white/5">
        <Icon aria-hidden className="size-4 shrink-0 text-subtle" />
        <span className="min-w-0 flex-1 break-words">{shown}{unknownTopic ? <span className="text-amber-200"> · “{topicName}” (not one of your topics)</span> : null}</span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-subtle" />
      </button>
      {open && (
        <div className="mt-2">
          {subjects ? <DestinationPicker subjects={subjects} value={value} onChange={d => { onChange(d.subjectId, d.kind === 'topic' ? d.topicName : null); setOpen(false) }} onSubjectsChanged={load} />
            : <p className="text-sm text-foreground/60">Loading your subjects…</p>}
        </div>
      )}
    </div>
  )
}
