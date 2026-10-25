'use client'

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, CornerLeftUp, X } from 'lucide-react'
import type { MapEdge, MapNode } from '@repo/api/nova/product/knowledge-map.types'
import type { StudyStructure } from '@repo/api/nova/product/setup-edit.types'
import { cn } from '@/lib/utils'
import { BUTTON_PRIMARY, BUTTON_QUIET } from '../workspace/ui'
import { addChoices, addRequest, checkName, cleanName, deletePlan, deleteRequest, EXPLANATION_MAX, madeSubject, madeTopic, type AddChoice, type DeleteMode } from './map-structure'
import { archiveTopic, describeTopic, loadStructure, sendAdd, sendDelete } from './map-structure-api'
import { SHORTCUTS, keyLabel } from './map-shortcuts'

// A panel that gives focus back to what had it when it closes, and closes on
// Escape (the map's own Escape handling skips a key the panel took).
function usePanel(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current?.querySelector<HTMLElement>('input, button, select, textarea, a[href]')
    first?.focus()
    return () => { if (before && document.contains(before)) before.focus({ preventScroll: true }) }
  }, [])
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); onClose() }
    // Keys inside a panel are the panel's, never the map's shortcuts.
    else e.nativeEvent.stopImmediatePropagation()
  }
  return { ref, onKeyDown }
}

const PANEL = 'rounded-2xl border border-white/10 bg-popover text-foreground shadow-float'
const FIELD = 'h-9 w-full rounded-lg border border-white/12 bg-background px-3 text-sm text-foreground outline-none placeholder:text-subtle focus-visible:border-ring'

function Header({ title, onClose }: { title: ReactNode; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <h2 className="min-w-0 text-sm font-semibold leading-snug">{title}</h2>
      <button type="button" onClick={onClose} aria-label="Close" className="-m-1 rounded-lg p-1 text-subtle hover:bg-white/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><X className="size-4" /></button>
    </div>
  )
}

// ── Adding ───────────────────────────────────────────────────────────────────

export interface Added { select: string | null; said: string }

export function AddDialog({ node, nodes, choices: given, style, onClose, onAdded }: {
  // null: a subject of its own, from the toolbar.
  node: MapNode | null; nodes: readonly MapNode[]; choices?: AddChoice[]
  style?: CSSProperties; onClose: () => void; onAdded: (a: Added) => void
}) {
  const choices = useMemo(() => given ?? (node ? addChoices(node, nodes) : []), [given, node, nodes])
  const [kind, setKind] = useState(choices[0]?.kind)
  const [name, setName] = useState('')
  const [about, setAbout] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // One key for this dialog: a double click or a retry makes one task.
  const [clientKey] = useState(() => `map:${crypto.randomUUID()}`)
  const panel = usePanel(onClose)
  const id = useId()
  const choice = choices.find(c => c.kind === kind) ?? choices[0]
  if (!choice) return null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    const bad = checkName(choice, name)
    if (bad) { setError(bad); return }
    setBusy(true); setError(null)
    const req = addRequest(choice, node, name, about, clientKey)
    const out = await sendAdd(req)
    if (!out.ok) { setBusy(false); setError(out.message); return }
    let select: string | null = null
    const said = [`Added “${cleanName(name)}”.`]
    if (req.route === 'task') select = out.value.taskId ? `task:${out.value.taskId}` : null
    else if (out.value.after) {
      if (choice.makes === 'topic') {
        const made = madeTopic(out.value.before, out.value.after, req)
        if (made) {
          select = `topic:${made.id}`
          if (made.name !== req.name) said[0] = `Added “${made.name}”: “${req.name}” is already a topic of this subject.`
          if (req.explanation) {
            const d = await describeTopic(out.value.after, made.id, req.explanation)
            if (!d.ok) said.push(`The topic was added, but its description wasn’t saved: ${d.message}`)
          }
        }
      } else {
        const made = madeSubject(out.value.before, out.value.after, req.name)
        if (made) select = `subject:${made}`
      }
    }
    setBusy(false)
    onAdded({ select, said: said.join(' ') })
  }

  return (
    <div ref={panel.ref} onKeyDown={panel.onKeyDown} role="dialog" aria-modal="false" aria-labelledby={`${id}-t`} data-add-dialog
      className={cn(PANEL, 'absolute z-30 w-[min(22rem,calc(100%-1.5rem))] p-4')} style={style} onPointerDown={e => e.stopPropagation()}>
      <Header title={<span id={`${id}-t`}>{node ? <>Add to “{node.label}”</> : 'New subject'}</span>} onClose={onClose} />
      <form onSubmit={e => void submit(e)} className="mt-3 space-y-3">
        {choices.length > 1 && (
          <fieldset>
            <legend className="sr-only">What to add</legend>
            <div className="flex flex-wrap gap-1.5">
              {choices.map(c => (
                <label key={c.kind} className={cn('cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring',
                  c.kind === choice.kind ? 'border-action bg-action-soft text-foreground' : 'border-white/10 text-foreground/70 hover:text-foreground')}>
                  <input type="radio" name={`${id}-kind`} value={c.kind} checked={c.kind === choice.kind} onChange={() => { setKind(c.kind); setError(null) }} className="sr-only" />
                  {c.label}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <p className="text-xs leading-relaxed text-foreground/70" data-add-detail>{choice.detail}</p>
        {choice.note && <p className="rounded-lg bg-amber-400/10 px-2.5 py-2 text-xs leading-relaxed text-foreground/80">{choice.note}</p>}
        <div>
          <label htmlFor={`${id}-name`} className="text-xs font-medium text-foreground/75">{choice.makes === 'task' ? 'Title' : 'Name'}</label>
          <input id={`${id}-name`} data-autofocus value={name} onChange={e => { setName(e.target.value); setError(null) }} autoComplete="off"
            placeholder={choice.makes === 'task' ? 'What needs doing' : choice.makes === 'topic' ? 'e.g. Recursion trees' : 'e.g. Operating Systems'} className={cn(FIELD, 'mt-1')} />
        </div>
        {choice.makes === 'topic' && (
          <div>
            <label htmlFor={`${id}-about`} className="text-xs font-medium text-foreground/75">Description <span className="font-normal text-subtle">(optional)</span></label>
            <textarea id={`${id}-about`} value={about} onChange={e => setAbout(e.target.value)} maxLength={EXPLANATION_MAX} rows={2}
              className="mt-1 w-full resize-none rounded-lg border border-white/12 bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-subtle focus-visible:border-ring" />
          </div>
        )}
        {error && <p role="alert" className="text-xs leading-relaxed text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={cn(BUTTON_QUIET, 'h-8')}>Cancel</button>
          <button type="submit" disabled={busy} className={cn(BUTTON_PRIMARY, 'h-8 px-3 text-xs')} data-add-confirm>{busy ? 'Adding…' : `Add ${choice.makes}`}</button>
        </div>
      </form>
    </div>
  )
}

// ── Deleting ─────────────────────────────────────────────────────────────────

export function DeleteDialog({ node, edges, tree, style, onClose, onDeleted, onStale }: {
  node: MapNode; edges: readonly MapEdge[]; tree: { children: ReadonlyMap<string, readonly string[]> }
  style?: CSSProperties; onClose: () => void; onDeleted: (said: string) => void; onStale: () => void
}) {
  const needsStructure = node.type === 'topic' || node.type === 'subject'
  const [structure, setStructure] = useState<StudyStructure | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mode, setMode] = useState<DeleteMode | null>(null)
  const [ticked, setTicked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const panel = usePanel(onClose)
  const id = useId()

  useEffect(() => {
    if (!needsStructure) return
    let live = true
    void loadStructure().then(r => { if (!live) return; if (r.ok) setStructure(r.value); else setLoadError(r.message) })
    return () => { live = false }
  }, [needsStructure])

  const plan = needsStructure && !structure ? null : deletePlan(node, edges, tree, structure)
  const options = plan?.ok ? plan.options : []
  const chosen = options.find(o => o.mode === mode) ?? options.find(o => !o.blocked) ?? null
  const ready = chosen && !chosen.blocked && (!chosen.confirm || ticked)

  const confirm = async () => {
    if (!chosen || !ready || busy) return
    setBusy(true); setError(null)
    const out = await sendDelete(deleteRequest(node, chosen.mode, tree, structure), structure)
    setBusy(false)
    const how: Record<DeleteMode, string> = { only: '', lift: '; the topics inside moved up in its place', branch: ' and everything inside it', keep_steps: '; its steps are tasks of their own now', with_steps: ' and its steps' }
    if (out.ok) { onDeleted(out.said[0] === 'It was already gone.' ? `“${node.label}” was already deleted.` : `Deleted “${node.label}”${how[chosen.mode]}.`); return }
    setError(out.message)
    if (out.stale) onStale()
  }
  const archive = async (topicId: string) => {
    setBusy(true); setError(null)
    const out = await archiveTopic(topicId)
    setBusy(false)
    if (out.ok) onDeleted(out.said.join(' '))
    else setError(out.message)
  }

  return (
    <div ref={panel.ref} onKeyDown={panel.onKeyDown} role="alertdialog" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} data-delete-dialog
      className={cn(PANEL, 'absolute z-30 w-[min(24rem,calc(100%-1.5rem))] p-4')} style={style} onPointerDown={e => e.stopPropagation()}>
      <Header title={<span id={`${id}-t`}>Delete “{node.label}”?</span>} onClose={onClose} />
      <div id={`${id}-d`} className="mt-3 space-y-3 text-sm">
        {!plan && !loadError && <p className="text-xs text-subtle" role="status">Checking what it holds…</p>}
        {loadError && <p role="alert" className="text-xs text-red-400">{loadError}</p>}
        {plan && !plan.ok && (
          <>
            <p className="leading-relaxed text-foreground/85" data-delete-blocked>{plan.why}</p>
            <div className="flex flex-wrap justify-end gap-2">
              {plan.href && <Link href={plan.href.to} className={cn(BUTTON_QUIET, 'h-8')}>{plan.href.label}</Link>}
              {plan.archive && <button type="button" onClick={() => void archive(plan.archive!.topicId)} disabled={busy} className={cn(BUTTON_PRIMARY, 'h-8 px-3 text-xs')} data-archive-confirm>{busy ? 'Archiving…' : 'Archive it'}</button>}
              <button type="button" onClick={onClose} className={cn(BUTTON_QUIET, 'h-8')} data-autofocus={!plan.archive || undefined}>Cancel</button>
            </div>
          </>
        )}
        {plan?.ok && (
          <>
            {options.length > 1 ? (
              <fieldset className="space-y-1.5">
                <legend className="sr-only">What to delete</legend>
                {options.map(o => (
                  <label key={o.mode} className={cn('flex cursor-pointer gap-2.5 rounded-xl border p-2.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring',
                    chosen?.mode === o.mode ? 'border-white/20 bg-white/5' : 'border-white/8 hover:border-white/14', o.blocked && 'cursor-not-allowed opacity-75')}>
                    <input type="radio" name={`${id}-mode`} checked={chosen?.mode === o.mode} disabled={!!o.blocked} onChange={() => { setMode(o.mode); setTicked(false) }} className="mt-1 accent-[var(--action)]" data-delete-mode={o.mode} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">{o.label}</span>
                      <span className="block text-xs leading-relaxed text-foreground/70">{o.blocked ?? o.detail}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : chosen && <p className="leading-relaxed text-foreground/85">{chosen.detail}</p>}
            {plan.stays.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-xs leading-relaxed text-foreground/70">{plan.stays.map(s => <li key={s}>{s}</li>)}</ul>}
            {chosen?.confirm && !chosen.blocked && (
              <label className="flex items-center gap-2 text-xs font-medium text-foreground/85">
                <input type="checkbox" checked={ticked} onChange={e => setTicked(e.target.checked)} className="accent-[var(--action)]" data-delete-tick /> {chosen.confirm}
              </label>
            )}
            {error && <p role="alert" className="text-xs leading-relaxed text-red-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} disabled={busy} className={cn(BUTTON_QUIET, 'h-8')} data-autofocus>Cancel</button>
              <button type="button" onClick={() => void confirm()} disabled={!ready || busy} data-delete-confirm
                className="inline-flex h-8 items-center rounded-lg bg-red-500/90 px-3 text-xs font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                {busy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Shortcuts, legend, where you are ─────────────────────────────────────────

export function ShortcutsHelp({ mac, onClose }: { mac: boolean; onClose: () => void }) {
  const panel = usePanel(onClose)
  const groups = ['Find and move', 'View', 'Edit'] as const
  return (
    <div className="absolute inset-0 z-40 flex items-start justify-center bg-background/50 p-4 pt-14 backdrop-blur-[2px]" onPointerDown={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose() }}>
      <div ref={panel.ref} onKeyDown={panel.onKeyDown} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" data-shortcuts-help className={cn(PANEL, 'max-h-full w-full max-w-lg overflow-y-auto p-5')}>
        <Header title="Keyboard shortcuts" onClose={onClose} />
        <p className="mt-1 text-xs text-subtle">They work while the map has focus, and never while you type in a box.</p>
        {groups.map(g => (
          <section key={g} className="mt-4">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-subtle">{g}</h3>
            <dl className="mt-1.5 divide-y divide-white/6">
              {SHORTCUTS.filter(s => s.group === g).map(s => (
                <div key={s.action} className="flex items-start justify-between gap-4 py-1.5 text-sm">
                  <dt className="text-foreground/80">{s.label}</dt>
                  <dd className="flex shrink-0 gap-1">{s.keys.map(k => <kbd key={k} className="rounded border border-white/12 bg-white/4 px-1.5 py-0.5 font-sans text-[11px] text-foreground/85">{keyLabel(k, mac)}</kbd>)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <p className="mt-4 text-xs leading-relaxed text-subtle">Also: Alt and the arrow keys move the focused card (with Shift, further); Tab reaches each card in turn.</p>
      </div>
    </div>
  )
}

export function Legend({ onClose, suggestions, outside }: { onClose: () => void; suggestions: boolean; outside: boolean }) {
  const panel = usePanel(onClose)
  const row = (mark: ReactNode, text: ReactNode) => (
    <li className="flex items-center gap-3"><svg aria-hidden width={34} height={18} className="shrink-0 overflow-visible">{mark}</svg><span>{text}</span></li>
  )
  return (
    <div ref={panel.ref} onKeyDown={panel.onKeyDown} role="dialog" aria-label="What the map shows" data-legend
      className={cn(PANEL, 'absolute bottom-14 left-3 z-30 w-[min(21rem,calc(100%-1.5rem))] p-4 text-xs leading-relaxed text-foreground/80')} onPointerDown={e => e.stopPropagation()}>
      <Header title="What the map shows" onClose={onClose} />
      <ul className="mt-3 space-y-2">
        {row(<rect x={2} y={2} width={30} height={14} rx={5} fill="var(--card)" stroke="var(--border)" />, 'A card: a subject, topic, task, note or saved page. Each branch reads top to bottom in its saved order.')}
        {row(<rect x={2} y={2} width={30} height={14} rx={5} fill="none" stroke="var(--map-topic)" strokeDasharray="4 3" />, 'A topic with no session yet.')}
        {row(<path d="M 6 2 v 14 M 6 2 h 9 l -2.5 3.5 l 2.5 3.5 h -9" fill="none" stroke="var(--nova)" strokeWidth={1.4} />, 'A milestone: a stage of work, not studied.')}
        {row(<><path d="M 0 9 Q 14 2 26 9" fill="none" stroke="var(--map-line-strong)" strokeWidth={1.2} /><circle cx={28} cy={9} r={4} fill="var(--card)" stroke="var(--nova)" strokeWidth={1.5} /></>, <>A <b className="font-semibold text-foreground">ring</b> is a [[link]]: a note links to the card the ring sits on.</>)}
        {row(<path d="M 0 9 Q 16 2 32 9" fill="none" stroke="var(--map-task)" strokeWidth={1.2} strokeDasharray="5 3" />, 'A task waiting on another, from the one that waits.')}
        {outside && row(<circle cx={17} cy={9} r={7.5} fill="var(--card)" stroke="var(--map-line-strong)" strokeDasharray="2.5 2" />, 'A round card is outside what you are exploring, joined by a link. Select it to go to it.')}
        {suggestions && row(<path d="M 0 9 H 32" stroke="var(--map-line-strong)" strokeDasharray="1 5" strokeLinecap="round" strokeWidth={1.4} />, 'A suggestion Nova made for a saved page, not a link. File the page to make it one.')}
      </ul>
      <p className="mt-3 text-subtle">Drag a card to arrange it; drag the background to move around; scroll or pinch to zoom.</p>
    </div>
  )
}

export function Breadcrumbs({ trail, onGo, onBack, onUp, canBack }: {
  // From the whole map down to the card explored; the last is where you are.
  trail: Array<{ id: string | null; label: string }>
  onGo: (id: string | null) => void; onBack: () => void; onUp: () => void; canBack: boolean
}) {
  if (trail.length <= 1) return null
  return (
    <nav aria-label="Where you are on the map" className="flex min-w-0 flex-1 items-center gap-1" data-breadcrumbs>
      <button type="button" onClick={onBack} disabled={!canBack} aria-label="Back to the view before" title="Back"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-white/10 text-foreground/75 hover:text-foreground disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring"><ChevronLeft className="size-4" /></button>
      <button type="button" onClick={onUp} aria-label="Up one level" title="Up one level (U)" data-explore-up
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-white/10 text-foreground/75 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><CornerLeftUp className="size-3.5" /></button>
      <ol className="flex min-w-0 items-center gap-0.5 overflow-hidden text-xs">
        {trail.map((c, i) => {
          const last = i === trail.length - 1
          return (
            <li key={c.id ?? 'root'} className={cn('flex min-w-0 items-center gap-0.5', last && 'shrink-0', !last && i > 0 && i < trail.length - 2 && 'hidden xl:flex')}>
              {i > 0 && <ChevronRight aria-hidden className="size-3 shrink-0 text-subtle" />}
              {last
                ? <span aria-current="location" className="truncate font-semibold text-foreground">{c.label}</span>
                : <button type="button" onClick={() => onGo(c.id)} className="min-w-0 max-w-[10rem] truncate rounded px-1 text-foreground/65 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">{c.label}</button>}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
