'use client'

// The Notes workspace's commands: Import research paper (⌘P / Ctrl+P, and a
// toolbar button), the command palette (⌘K / Ctrl+K) and the list of
// shortcuts (?). Mounted by the notes list and by a note, and only there, so
// Print keeps ⌘P on every other page. The keys are notes-shortcuts.ts's; each
// command listed here does what it says.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookOpen, CornerDownLeft, FileText, FolderClosed, Keyboard, NotebookPen, PenLine, Search, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { NoteSubjectOption, NoteSummary } from '@repo/api/nova/product/notes.types'
import type { PaperImported } from '@repo/api/nova/product/paper.types'
import { trappedTabTarget } from '@/components/settings/dialog-focus'
import { PaperImportDialog } from './paper-import-dialog'
import { isMacPlatform, isTypingTarget, modLabel, notesShortcut, shortcutList } from './notes-shortcuts'
import { filterNotes } from './notes-tree-data'

export interface NotesCommand { id: string; label: string; detail?: string; icon: LucideIcon; keys?: string; run: () => void }

function useMac(): boolean {
  const [mac, setMac] = useState(false)
  useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
    setMac(isMacPlatform(nav.userAgentData?.platform ?? nav.platform ?? ''))
  }, [])
  return mac
}

export function useNotesCommands({ notes, subjects, reloadSubjects, here, extra = [], onImported }: {
  notes: NoteSummary[]
  subjects: NoteSubjectOption[]
  reloadSubjects: () => Promise<NoteSubjectOption[] | null>
  // Where a paper imported from here is saved to start with.
  here?: { subjectId: string | null; topicName: string | null }
  // Commands of the page they are on (Nova's two modes, on a note).
  extra?: NotesCommand[]
  onImported?: (r: PaperImported) => void
}) {
  const router = useRouter()
  const mac = useMac()
  const [open, setOpen] = useState<'import' | 'palette' | 'help' | null>(null)
  // The subjects as reloaded after a topic was made in the picker, until the page has them.
  const [fresh, setFresh] = useState<NoteSubjectOption[] | null>(null)
  useEffect(() => setFresh(null), [subjects])
  const reload = useCallback(async () => { const s = await reloadSubjects(); if (s) setFresh(s); return s }, [reloadSubjects])
  const openRef = useRef(open); openRef.current = open

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = notesShortcut(e, mac, isTypingTarget(e.target as HTMLElement | null))
      if (!action) return
      // One handler for the page: the dialog that is open takes its own keys.
      if (openRef.current === 'import' && action !== 'import') return
      e.preventDefault()
      setOpen(o => (o === action ? null : action))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mac])

  const close = useCallback(() => setOpen(null), [])
  const m = modLabel(mac)
  const commands: NotesCommand[] = useMemo(() => [
    { id: 'import', label: 'Import research paper', detail: 'From an arXiv, DOI, PubMed, OpenReview or PDF link', icon: FileText, keys: `${m}P`, run: () => setOpen('import') },
    { id: 'new', label: 'New note', icon: NotebookPen, run: () => router.push('/notes/new') },
    ...extra,
    { id: 'help', label: 'Keyboard shortcuts', icon: Keyboard, keys: '?', run: () => setOpen('help') },
  ], [m, router, extra])

  const element = (
    <>
      {open === 'import' && (
        <PaperImportDialog subjects={fresh ?? subjects} initial={here} onClose={close} onSubjectsChanged={reload} onImported={onImported} />
      )}
      {open === 'palette' && <Palette commands={commands} notes={notes} subjects={subjects} onClose={close} />}
      {open === 'help' && <ShortcutHelp mac={mac} onClose={close} />}
    </>
  )
  return { element, openImport: () => setOpen('import'), openPalette: () => setOpen('palette'), openHelp: () => setOpen('help'), mac }
}

// Escape closes, Tab stays inside; focus goes back where it was.
function useDialog(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('input, button')?.focus()
    return () => opener?.focus?.()
  }, [])
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
    if (e.key === 'Tab' && ref.current) {
      const stops = Array.from(ref.current.querySelectorAll<HTMLElement>('input, button:not([disabled])'))
      const target = trappedTabTarget(stops, document.activeElement as HTMLElement | null, e.shiftKey, ref.current)
      if (target) { e.preventDefault(); target.focus() }
    }
  }
  return { ref, onKeyDown }
}

type Option = { key: string; icon: LucideIcon; label: string; detail?: string; tag: string; run: () => void }

function Palette({ commands, notes, subjects, onClose }: { commands: NotesCommand[]; notes: NoteSummary[]; subjects: NoteSubjectOption[]; onClose: () => void }) {
  const router = useRouter()
  const listId = useId()
  const { ref, onKeyDown } = useDialog(onClose)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const q = query.trim().toLowerCase()
  const go = (href: string) => { onClose(); router.push(href) }
  const options: Option[] = [
    ...commands.filter(c => !q || c.label.toLowerCase().includes(q)).map(c => ({ key: `c:${c.id}`, icon: c.icon, label: c.label, detail: c.detail, tag: c.keys ?? 'Command', run: () => { onClose(); c.run() } })),
    ...(q ? filterNotes(notes, query).slice(0, 8) : notes.slice(0, 5)).map(n => ({ key: `n:${n.id}`, icon: FileText, label: n.title, detail: [n.subjectName, n.topicName].filter(Boolean).join(' › ') || undefined, tag: 'Note', run: () => go(`/notes/${encodeURIComponent(n.id)}`) })),
    ...subjects.filter(s => q && s.name.toLowerCase().includes(q)).slice(0, 5).map(s => ({ key: `s:${s.id}`, icon: FolderClosed, label: s.name, detail: 'Notes in this subject', tag: 'Subject', run: () => go(`/notes?subjectId=${encodeURIComponent(s.id)}`) })),
  ]
  const current = Math.min(active, Math.max(options.length - 1, 0))
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]" onKeyDown={e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(() => (options.length ? (current + 1) % options.length : 0)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(() => (options.length ? (current - 1 + options.length) % options.length : 0)) }
      else if (e.key === 'Enter' && e.target instanceof HTMLInputElement && options[current]) { e.preventDefault(); options[current]!.run() }
      else onKeyDown(e)
    }}>
      <div aria-hidden className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Notes commands" className="relative w-full max-w-xl overflow-hidden rounded-xl border border-white/10 bg-card shadow-2xl shadow-black/40" data-notes-palette>
        <div className="flex items-center gap-3 border-b border-white/8 px-4">
          <Search aria-hidden className="size-4 shrink-0 text-foreground/45" />
          <input value={query} onChange={e => { setQuery(e.target.value); setActive(0) }} role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list"
            aria-activedescendant={options.length ? `${listId}-${current}` : undefined} placeholder="Search notes and subjects, or run a command…" aria-label="Search"
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-foreground/40" />
          <button type="button" onClick={onClose} className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] font-medium text-foreground/55 hover:text-foreground">Esc</button>
        </div>
        <ul id={listId} role="listbox" aria-label="Results" className="max-h-[min(60vh,26rem)] overflow-y-auto overscroll-contain p-1.5">
          {options.length === 0 && <li role="presentation" className="px-3 py-6 text-center text-sm text-foreground/55">Nothing by that name.</li>}
          {options.map((o, i) => (
            <li key={o.key} id={`${listId}-${i}`} role="option" aria-selected={i === current} onMouseMove={() => setActive(i)} onClick={o.run}
              className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ${i === current ? 'bg-white/7 text-foreground' : 'text-foreground/80'}`} data-palette-option={o.key}>
              <o.icon aria-hidden className="size-4 shrink-0 text-foreground/45" />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm">{o.label}</span>{o.detail && <span className="block truncate text-xs text-foreground/50">{o.detail}</span>}</span>
              <span className="shrink-0 text-[11px] text-foreground/45">{o.tag}</span>
              {i === current && <CornerDownLeft aria-hidden className="size-3.5 shrink-0 text-foreground/40" />}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function ShortcutHelp({ mac, onClose }: { mac: boolean; onClose: () => void }) {
  const { ref, onKeyDown } = useDialog(onClose)
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[10vh]" onKeyDown={onKeyDown}>
      <div aria-hidden className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="notes-keys-title" className="relative w-full max-w-lg rounded-xl border border-white/10 bg-card shadow-2xl shadow-black/40" data-notes-shortcuts>
        <header className="flex items-center gap-2 border-b border-white/8 px-4 py-3">
          <Keyboard className="size-4 text-subtle" aria-hidden />
          <h2 id="notes-keys-title" className="flex-1 text-sm font-semibold text-foreground">Keyboard shortcuts</h2>
          <button type="button" onClick={onClose} className="inline-flex size-7 items-center justify-center rounded-lg text-subtle hover:bg-white/6 hover:text-foreground" aria-label="Close (Esc)"><X className="size-4" /></button>
        </header>
        <table className="w-full text-sm">
          <tbody>
            {shortcutList(mac).map(s => (
              <tr key={s.keys} className="border-t border-white/6 first:border-t-0">
                <td className="w-28 py-2 pl-4 align-top"><kbd className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 font-sans text-xs text-foreground">{s.keys}</kbd></td>
                <td className="py-2 pr-4 text-foreground/85">{s.action}<span className="block text-[11px] text-subtle">{s.where}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-white/8 px-4 py-2.5 text-[11px] leading-relaxed text-subtle">On the Notes pages {modLabel(mac)}P imports a paper instead of printing; print from the browser’s menu, or press {modLabel(mac)}P on any other page.</p>
      </div>
    </div>
  )
}

// Nova's two modes, as commands on a note.
export const novaModeCommands = (setMode: (m: 'tutor' | 'editor') => void): NotesCommand[] => [
  { id: 'tutor', label: 'Nova Tutor: learn from this note', icon: BookOpen, run: () => setMode('tutor') },
  { id: 'editor', label: 'Nova Editor: improve this note', icon: PenLine, run: () => setMode('editor') },
]
