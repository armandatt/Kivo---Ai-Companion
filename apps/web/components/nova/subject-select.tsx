'use client'

// Choosing a subject: a button that opens a searchable list of the learner's
// subjects, subjects inside subjects shown inside their parent. One component
// for every place a note or a capture is filed.
//
// Why not a native <select>: Chrome draws a select's options from the page's
// styles, and a dark form (transparent background, pale text) came out as pale
// text on Chrome's white list: the options were there and unreadable. Safari
// uses the system's own menu, so it looked fine there. This list is drawn by
// the page, in the theme's own popover colours, the same in every browser.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, FolderClosed, Inbox, Loader2, RotateCcw, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

export type SubjectOption = { id: string; name: string; parentId?: string | null }
type Row = { id: string; name: string; depth: number; path: string[] }

// Tree order, each subject under its parent; one whose parent is missing (or a loop) at the top.
export function subjectRows(subjects: readonly SubjectOption[]): Row[] {
  const ids = new Set(subjects.map(s => s.id))
  const kids = new Map<string | null, SubjectOption[]>()
  for (const s of subjects) {
    const parent = s.parentId && ids.has(s.parentId) && s.parentId !== s.id ? s.parentId : null
    kids.set(parent, [...(kids.get(parent) ?? []), s])
  }
  const out: Row[] = []
  const seen = new Set<string>()
  const walk = (parent: string | null, depth: number, path: string[]) => {
    for (const s of (kids.get(parent) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))) {
      if (seen.has(s.id)) continue
      seen.add(s.id)
      out.push({ id: s.id, name: s.name, depth, path: [...path, s.name] })
      walk(s.id, depth + 1, [...path, s.name])
    }
  }
  walk(null, 0, [])
  for (const s of subjects) if (!seen.has(s.id)) { seen.add(s.id); out.push({ id: s.id, name: s.name, depth: 0, path: [s.name] }); walk(s.id, 1, [s.name]) }
  return out
}

export function SubjectSelect({ id, subjects, value, onChange, loading = false, error = null, onRetry, noneLabel = 'No subject', className }: {
  id?: string
  subjects: readonly SubjectOption[]
  value: string
  onChange: (subjectId: string) => void
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  noneLabel?: string
  className?: string
}) {
  const auto = useId()
  const buttonId = id ?? `${auto}-button`
  const listId = `${auto}-list`
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  // Opens upward when there is more room above than below (a field near the
  // bottom of the screen), so the list is never cut off by the window.
  const [upward, setUpward] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  const rows = useMemo(() => subjectRows(subjects), [subjects])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = q ? rows.filter(r => r.path.join(' ').toLowerCase().includes(q)) : rows
    return [{ id: '', name: noneLabel, depth: 0, path: [noneLabel] }, ...matched]
  }, [rows, query, noneLabel])
  const chosen = rows.find(r => r.id === value) ?? null
  const at = Math.min(active, shown.length - 1)

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', away)
    window.setTimeout(() => search.current?.focus(), 0)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])
  useEffect(() => { if (!open) return; document.getElementById(`${listId}-${at}`)?.scrollIntoView({ block: 'nearest' }) }, [at, open, listId])

  const pick = (subjectId: string) => { onChange(subjectId); setOpen(false); setQuery(''); button.current?.focus() }
  const toggle = () => {
    if (loading || error) return
    const r = button.current?.getBoundingClientRect()
    if (r) { const below = window.innerHeight - r.bottom, above = r.top; setUpward(below < 320 && above > below) }
    setOpen(o => !o); setActive(Math.max(0, shown.findIndex(r => r.id === value)))
  }

  return (
    <div ref={box} className={cn('relative', className)} data-subject-select>
      <button ref={button} id={buttonId} type="button" onClick={toggle} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        disabled={loading}
        onKeyDown={e => { if ((e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') && !open) { e.preventDefault(); toggle() } }}
        className="flex h-10 w-full items-center gap-2 rounded-xl border border-white/10 bg-background/40 px-3 text-left text-sm text-foreground transition-colors hover:border-white/20 focus:border-nova/60 focus:outline-none disabled:opacity-60"
        data-subject-select-button>
        {loading ? <Loader2 aria-hidden className="size-3.5 shrink-0 animate-spin text-subtle" />
          : chosen ? <FolderClosed aria-hidden className="size-3.5 shrink-0 text-nova-ink" /> : <Inbox aria-hidden className="size-3.5 shrink-0 text-subtle" />}
        <span className={cn('min-w-0 flex-1 truncate', !chosen && 'text-foreground/70')}>
          {loading ? 'Loading your subjects…' : chosen ? <>{chosen.path.slice(0, -1).map((p, i) => <span key={i} className="text-subtle">{p} › </span>)}{chosen.name}</> : noneLabel}
        </span>
        <ChevronDown aria-hidden className={cn('size-3.5 shrink-0 text-subtle transition-transform duration-150', open && 'rotate-180')} />
      </button>
      {error && (
        <p role="alert" className="mt-1.5 flex items-center gap-2 text-xs text-amber-300/90">
          {error}{onRetry && <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"><RotateCcw aria-hidden className="size-3" /> Try again</button>}
        </p>
      )}
      {open && (
        <div className={cn('subject-pop absolute left-0 right-0 z-50', upward ? 'bottom-[calc(100%+6px)] origin-bottom' : 'top-[calc(100%+6px)]')} data-upward={upward || undefined}>
          <div className="min-w-[14rem] overflow-hidden rounded-xl border border-white/12 bg-popover text-popover-foreground shadow-float" data-subject-select-pop>
          <div className="flex items-center gap-2 border-b border-white/8 px-3">
            <Search aria-hidden className="size-3.5 shrink-0 text-subtle" />
            <input ref={search} value={query} onChange={e => { setQuery(e.target.value); setActive(0) }} placeholder="Search subjects…"
              role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-activedescendant={`${listId}-${at}`} aria-label="Search your subjects"
              onKeyDown={e => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, shown.length - 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)) }
                else if (e.key === 'Enter') { e.preventDefault(); if (shown[at]) pick(shown[at]!.id) }
                else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); button.current?.focus() }
                else if (e.key === 'Tab') setOpen(false)
              }}
              className="h-10 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-foreground/40" data-subject-search />
          </div>
          <ul id={listId} role="listbox" aria-label="Subjects" className="max-h-64 overflow-y-auto overscroll-contain p-1">
            {shown.map((r, i) => {
              const selected = r.id === value
              return (
                <li key={r.id || 'none'} id={`${listId}-${i}`} role="option" aria-selected={selected} onMouseMove={() => setActive(i)} onClick={() => pick(r.id)}
                  className={cn('flex cursor-pointer items-center gap-2 rounded-lg py-2 pr-2.5 text-sm transition-colors', i === at ? 'bg-white/8' : 'hover:bg-white/5', selected && 'font-medium')}
                  style={{ paddingLeft: 10 + (query.trim() ? 0 : r.depth * 14) }} data-subject-option={r.id || 'none'}>
                  {r.id ? <FolderClosed aria-hidden className={cn('size-3.5 shrink-0', selected ? 'text-nova-ink' : 'text-subtle')} /> : <Inbox aria-hidden className="size-3.5 shrink-0 text-subtle" />}
                  <span className="min-w-0 flex-1 truncate" title={r.path.join(' › ')}>
                    {query.trim() && r.path.length > 1 && <span className="text-subtle">{r.path.slice(0, -1).join(' › ')} › </span>}{r.name}
                  </span>
                  {selected && <Check aria-hidden className="size-3.5 shrink-0 text-nova-ink" />}
                </li>
              )
            })}
            {rows.length === 0 && <li role="presentation" className="px-2.5 py-2 text-xs text-subtle" data-subject-empty>You have no subjects yet. Add them in Knowledge, or save it with no subject.</li>}
            {rows.length > 0 && shown.length === 1 && query.trim() && <li role="presentation" className="px-2.5 py-2 text-xs text-subtle">No subject called “{query.trim()}”.</li>}
          </ul>
        </div></div>
      )}
    </div>
  )
}
