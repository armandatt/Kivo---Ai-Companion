'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, FileText, Plus, Search } from 'lucide-react'
import type { NoteSummary } from '@repo/api/nova/product/notes.types'
import { subjectColor } from '../subject-color'
import { filterNotes, groupNotes } from './notes-tree-data'

// The notebook beside an open note: every note, by subject and topic, the
// open one marked. Folding a subject is remembered only while the page is open.
export function NotesTree({ notes, currentId, onNavigate }: {
  notes: NoteSummary[]
  currentId: string | null
  onNavigate?: (e: React.MouseEvent) => void
}) {
  const [query, setQuery]   = useState('')
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const groups = useMemo(() => groupNotes(filterNotes(notes, query)), [notes, query])

  const toggle = (key: string) => setClosed(s => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n })

  return (
    <nav aria-label="Your notebook" className="flex h-full min-h-0 flex-col" data-notes-tree>
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-foreground/40">Notebook</p>
        <Link href="/notes/new" onClick={onNavigate} title="New note" aria-label="New note"
          className="inline-flex size-7 items-center justify-center rounded-lg text-foreground/50 transition-colors hover:bg-white/6 hover:text-foreground">
          <Plus className="size-4" />
        </Link>
      </div>
      <label className="relative mx-3 mb-2 block">
        <span className="sr-only">Find a note</span>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-foreground/35" />
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a note"
          className="h-8 w-full rounded-lg border border-white/8 bg-transparent pl-8 pr-2 text-xs text-foreground placeholder:text-foreground/35 focus:border-keppel-400/50 focus:outline-none" />
      </label>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
        {groups.length === 0 && <p className="px-3 py-2 text-xs text-foreground/45">{query ? 'No note matches.' : 'No notes yet.'}</p>}
        {groups.map(g => {
          const key = g.subjectId ?? ''
          const open = !closed.has(key) || query.length > 0
          const color = subjectColor(g.subjectName)
          return (
            <div key={key || 'none'} className="mb-1">
              <button type="button" onClick={() => toggle(key)} aria-expanded={open}
                className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium text-foreground/80 transition-colors hover:bg-white/4">
                <ChevronRight className={`size-3.5 shrink-0 text-foreground/40 transition-transform ${open ? 'rotate-90' : ''}`} />
                <span className={`size-2 shrink-0 rounded-full ${g.subjectId ? color.dot : 'bg-foreground/25'}`} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{g.subjectName ?? 'No subject'}</span>
                <span className="text-[11px] tabular-nums text-foreground/35">{g.count}</span>
              </button>
              {open && g.topics.map(t => (
                <div key={t.topic ?? ''} className="ml-[1.15rem] border-l border-white/6 pl-1.5">
                  {t.topic && <p className="truncate px-2 pb-0.5 pt-1.5 text-[11px] text-foreground/40">{t.topic}</p>}
                  <ul>
                    {t.notes.map(n => {
                      const current = n.id === currentId
                      return (
                        <li key={n.id}>
                          <Link href={`/notes/${encodeURIComponent(n.id)}`} onClick={onNavigate} aria-current={current ? 'page' : undefined}
                            className={`flex items-center gap-2 rounded-md px-2 py-1 text-[13px] transition-colors ${current ? 'bg-keppel-400/12 text-keppel-200' : 'text-foreground/65 hover:bg-white/4 hover:text-foreground'}`}>
                            <FileText className={`size-3.5 shrink-0 ${current ? 'text-keppel-300' : 'text-foreground/30'}`} aria-hidden />
                            <span className="min-w-0 truncate">{n.title}</span>
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </nav>
  )
}
