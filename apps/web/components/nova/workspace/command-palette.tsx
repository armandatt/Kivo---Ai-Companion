'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bookmark, CheckSquare, CornerDownLeft, FileText, FolderClosed, Hash, Layout, Loader2, NotebookPen, Plus, Search,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { NOVA_ROUTES } from '@repo/api/nova/product/companion'
import type { NovaKnowledgeMapView } from '@repo/api/nova/product/knowledge-map.types'
import type { NovaTaskItem } from '@repo/api/nova/product/tasks.types'
import { cn } from '@/lib/utils'
import { trappedTabTarget } from '@/components/settings/dialog-focus'
import { KIND_LABEL, commandEntries, searchCommands, type CommandKind } from './command-search'

type Loaded<T> = { view: T | null; loading: boolean; error: boolean }

const ICON: Record<CommandKind, LucideIcon> = {
  page: Layout, subject: FolderClosed, topic: Hash, note: FileText, resource: Bookmark, task: CheckSquare,
}

type Option = { key: string; icon: LucideIcon; label: string; detail: string | null; tag: string; run: () => void }

// The trigger, for the page header. ⌘K / Ctrl+K opens the same palette.
export function CommandButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} aria-haspopup="dialog" aria-keyshortcuts="Meta+K Control+K"
      className="inline-flex h-9 min-w-0 items-center gap-2 rounded-lg border border-white/10 bg-white/3 pl-3 pr-2 text-sm text-foreground/60 transition-colors hover:border-white/20 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-keppel-400 sm:w-56">
      <Search aria-hidden className="size-4 shrink-0" />
      <span className="truncate">Search or jump to…</span>
      <kbd className="ml-auto hidden rounded border border-white/10 px-1.5 py-0.5 font-sans text-[10px] text-foreground/50 sm:inline">⌘K</kbd>
    </button>
  )
}

// ⌘K / Ctrl+K anywhere on the page toggles the palette.
export function useCommandShortcut(setOpen: (update: (open: boolean) => boolean) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(open => !open) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])
}

// Find any page, subject, topic, note, saved page or open task by name and
// go to it; or make a task or start a note with what was typed. Results are
// what the Knowledge Map and the task list returned; while those load, the
// pages can still be found.
export function CommandPalette({ open, onClose, map, tasks, onCreateTask }: {
  open:         boolean
  onClose:      () => void
  map:          Loaded<NovaKnowledgeMapView>
  tasks:        NovaTaskItem[]
  onCreateTask: (title: string) => Promise<boolean>
}) {
  if (!open) return null
  return <Palette onClose={onClose} map={map} tasks={tasks} onCreateTask={onCreateTask} />
}

function Palette({ onClose, map, tasks, onCreateTask }: Omit<Parameters<typeof CommandPalette>[0], 'open'>) {
  const router   = useRouter()
  const listId   = useId()
  const dialog   = useRef<HTMLDivElement>(null)
  const input    = useRef<HTMLInputElement>(null)
  const [query, setQuery]     = useState('')
  const [active, setActive]   = useState(0)
  const [busy, setBusy]       = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const entries = useMemo(() => {
    const nodes = map.view?.status === 'ready' ? map.view.nodes : []
    return commandEntries({ pages: NOVA_ROUTES, nodes, tasks })
  }, [map.view, tasks])
  const typed   = query.trim()

  const go = (href: string) => { onClose(); router.push(href) }
  const options: Option[] = [
    ...searchCommands(entries, query).map(e => ({
      key: e.id, icon: ICON[e.kind], label: e.label, detail: e.detail, tag: KIND_LABEL[e.kind], run: () => go(e.href),
    })),
    ...(typed ? [
      {
        key: 'create:task', icon: Plus, label: `Add task “${typed}”`, detail: 'To do, on your task board', tag: 'New',
        run: async () => {
          if (busy) return
          setBusy(true)
          const ok = await onCreateTask(typed)
          setBusy(false)
          setMessage(ok ? `Added “${typed}” to your tasks.` : 'That task wasn’t saved. Try again.')
          if (ok) setQuery('')
        },
      },
      {
        key: 'create:note', icon: NotebookPen, label: `Write a note titled “${typed}”`, detail: 'Opens the editor; nothing is saved until you save', tag: 'New',
        run: () => go(`/notes/new?title=${encodeURIComponent(typed)}`),
      },
    ] : []),
  ]
  const current = Math.min(active, Math.max(options.length - 1, 0))

  // Open: focus the field, hold the page still. The dashboard scrolls inside
  // its <main>, not the body, so that is what is held. Close: back to the opener.
  useEffect(() => {
    const opener   = document.activeElement as HTMLElement | null
    const scroller = dialog.current?.closest('main') ?? document.body
    input.current?.focus()
    const overflow = scroller.style.overflow
    scroller.style.overflow = 'hidden'
    return () => { scroller.style.overflow = overflow; opener?.focus?.() }
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
    // Moving through the list and choosing belong to the search field; a
    // button keeps its own Enter.
    const inField = e.target === input.current
    if (inField && e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (options.length ? (Math.min(i, options.length - 1) + 1) % options.length : 0)) }
    else if (inField && e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (options.length ? (Math.min(i, options.length - 1) - 1 + options.length) % options.length : 0)) }
    else if (inField && e.key === 'Enter' && options[current]) { e.preventDefault(); void options[current].run() }
    else if (e.key === 'Tab' && dialog.current) {
      const stops = Array.from(dialog.current.querySelectorAll<HTMLElement>('input, button:not([disabled])'))
      const target = trappedTabTarget(stops, document.activeElement as HTMLElement | null, e.shiftKey, dialog.current)
        ?? stops[stops.indexOf(document.activeElement as HTMLElement) + (e.shiftKey ? -1 : 1)]
      if (target) { e.preventDefault(); target.focus() }
    }
  }

  const optionId = (i: number) => `${listId}-option-${i}`
  const mapNote = !map.view && map.loading ? 'Subjects, topics, notes and saved pages are still loading.'
    : !map.view && map.error ? 'Subjects, topics, notes and saved pages didn’t load; pages can still be found.'
    : null

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]" onKeyDown={onKeyDown}>
      <div aria-hidden className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} />
      <div ref={dialog} role="dialog" aria-modal="true" aria-label="Search and jump"
        className="relative w-full max-w-xl overflow-hidden rounded-xl border border-white/10 bg-card shadow-2xl shadow-black/40">
        <div className="flex items-center gap-3 border-b border-white/8 px-4">
          <Search aria-hidden className="size-4 shrink-0 text-foreground/45" />
          <input
            ref={input} value={query} onChange={e => { setQuery(e.target.value); setActive(0); setMessage(null) }}
            role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list"
            aria-activedescendant={options.length ? optionId(current) : undefined}
            placeholder="Search pages, subjects, topics, notes, tasks…" aria-label="Search"
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-foreground/40"
          />
          <button type="button" onClick={onClose} className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] font-medium text-foreground/55 hover:text-foreground">Esc</button>
        </div>

        <ul id={listId} role="listbox" aria-label="Results" className="max-h-[min(60vh,26rem)] overflow-y-auto overscroll-contain p-1.5">
          {options.length === 0 ? (
            <li role="presentation" className="px-3 py-6 text-center text-sm text-foreground/55">Nothing by that name.</li>
          ) : options.map((option, i) => {
            const Icon = option.icon
            return (
              <li key={option.key} id={optionId(i)} role="option" aria-selected={i === current}
                onMouseMove={() => setActive(i)} onClick={() => void option.run()}
                className={cn('flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2', i === current ? 'bg-white/7 text-foreground' : 'text-foreground/80')}>
                <Icon aria-hidden className="size-4 shrink-0 text-foreground/45" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{option.label}</span>
                  {option.detail && <span className="block truncate text-xs text-foreground/50">{option.detail}</span>}
                </span>
                <span className="shrink-0 text-[11px] text-foreground/45">{option.tag}</span>
                {i === current && <CornerDownLeft aria-hidden className="size-3.5 shrink-0 text-foreground/40" />}
              </li>
            )
          })}
        </ul>

        <div className="flex items-center justify-between gap-3 border-t border-white/8 px-4 py-2 text-[11px] text-foreground/50">
          <p role="status" className="min-w-0 truncate">
            {busy ? <span className="inline-flex items-center gap-1.5"><Loader2 aria-hidden className="size-3 animate-spin" /> Adding…</span> : message ?? mapNote ?? '↑↓ to move · Enter to open'}
          </p>
          <p className="hidden shrink-0 sm:block">Esc to close</p>
        </div>
      </div>
    </div>
  )
}
