'use client'

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, CornerLeftUp, X } from 'lucide-react'
import type { MapEdge, MapNode } from '@repo/api/nova/product/knowledge-map.types'
import type { StudyStructure } from '@repo/api/nova/product/setup-edit.types'
import { cn } from '@/lib/utils'
import { BUTTON_PRIMARY, BUTTON_QUIET } from '../workspace/ui'
import { addChoices, addRequest, checkName, cleanName, deletePlan, deleteRequest, EXPLANATION_MAX, madeSubject, madeTopic, type AddChoice, type DeleteMode } from './map-structure'
import { archiveTopic, describeTopic, loadStructure, sendAdd, sendConnect, sendDelete } from './map-structure-api'
import { canConnectFrom, connectCandidates, connectOptions, type ConnectOption } from './map-connect'
import { treeOf } from './layout'
import type { NovaKnowledgeMapView } from '@repo/api/nova/product/knowledge-map.types'
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

export interface Added { select: string | null; said: string; stale?: boolean }

// Two things the + does, kept apart: make a new card, or connect one that exists.
export function AddDialog({ node, nodes, edges, workspace, choices, style, onClose, onAdded }: {
  // null: a subject of its own, from the toolbar.
  node: MapNode | null; nodes: readonly MapNode[]; edges?: readonly MapEdge[]
  // The workspace the map shows (null: everything), for searching beyond it.
  workspace?: string | null
  choices?: AddChoice[]
  style?: CSSProperties; onClose: () => void; onAdded: (a: Added) => void
}) {
  const [mode, setMode] = useState<'create' | 'connect'>('create')
  const panel = usePanel(onClose)
  const id = useId()
  const connectable = !!node && !!edges && canConnectFrom(node)
  const tab = (m: typeof mode, label: string) => (
    <button type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} data-add-mode={m}
      className={cn('flex-1 rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring', mode === m ? 'bg-white/10 text-foreground' : 'text-subtle hover:text-foreground')}>{label}</button>
  )
  return (
    <div ref={panel.ref} onKeyDown={panel.onKeyDown} role="dialog" aria-modal="false" aria-labelledby={`${id}-t`} data-add-dialog
      className={cn(PANEL, 'absolute z-30 w-[min(24rem,calc(100%-1.5rem))] p-4')} style={style} onPointerDown={e => e.stopPropagation()}>
      <Header title={<span id={`${id}-t`}>{node ? <>Add to “{node.label}”</> : 'New subject'}</span>} onClose={onClose} />
      {connectable && (
        <div role="tablist" aria-label="Add a card" className="mt-3 flex gap-1 rounded-full border border-white/10 p-0.5">
          {tab('create', 'Create new')}{tab('connect', 'Connect existing')}
        </div>
      )}
      {mode === 'connect' && connectable
        ? <ConnectPane source={node!} nodes={nodes} edges={edges!} workspace={workspace ?? null} onClose={onClose} onDone={onAdded} />
        : <CreatePane node={node} nodes={nodes} choices={choices} onClose={onClose} onAdded={onAdded} />}
    </div>
  )
}

function CreatePane({ node, nodes, choices: given, onClose, onAdded }: {
  node: MapNode | null; nodes: readonly MapNode[]; choices?: AddChoice[]; onClose: () => void; onAdded: (a: Added) => void
}) {
  const choices = useMemo(() => given ?? (node ? addChoices(node, nodes) : []), [given, node, nodes])
  const [kind, setKind] = useState(choices[0]?.kind)
  const [name, setName] = useState('')
  const [about, setAbout] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // One key for this dialog: a double click or a retry makes one task.
  const [clientKey] = useState(() => `map:${crypto.randomUUID()}`)
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
          <input id={`${id}-name`} data-autofocus autoFocus value={name} onChange={e => { setName(e.target.value); setError(null) }} autoComplete="off"
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
  )
}

// Find a card that exists, see how it would connect, and confirm. The card
// is the same row afterwards: nothing is copied.
function ConnectPane({ source, nodes, edges, workspace, onClose, onDone }: {
  source: MapNode; nodes: readonly MapNode[]; edges: readonly MapEdge[]; workspace: string | null; onClose: () => void; onDone: (a: Added) => void
}) {
  const [scope, setScope] = useState<{ nodes: readonly MapNode[]; edges: readonly MapEdge[]; all: boolean }>({ nodes, edges, all: workspace === null })
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [target, setTarget] = useState<MapNode | null>(null)
  const [key, setKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  const here = useMemo(() => new Set(nodes.map(n => n.id)), [nodes])
  const tree = useMemo(() => treeOf([...scope.nodes], [...scope.edges]), [scope])
  const found = useMemo(() => connectCandidates(source, scope.nodes, tree, query), [source, scope.nodes, tree, query])
  const options = useMemo(() => (target ? connectOptions(source, target, { nodes: scope.nodes, edges: scope.edges, tree }) : []), [source, target, scope, tree])
  const option: ConnectOption | undefined = options.find(o => o.key === key) ?? options.find(o => !o.blocked) ?? options[0]

  // Beyond this workspace: the same map read for everything the learner has.
  const widen = async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/nova/knowledge-map?workspace=all', { cache: 'no-store' })
      const v = await res.json() as NovaKnowledgeMapView
      if (v.status === 'ready') setScope({ nodes: v.nodes, edges: v.edges, all: true })
      else setError("Couldn't load everything you have.")
    } catch { setError('Could not reach the server. Check your connection and try again.') }
    setLoading(false)
  }
  const pick = (n: MapNode) => { setTarget(n); setKey(null); setError(null) }
  const confirm = async () => {
    if (!option?.request || option.blocked || busy) return
    setBusy(true); setError(null)
    const out = await sendConnect(option.request, option.request.route === 'file' ? source.label : target!.label)
    setBusy(false)
    if (out.ok) { onDone({ select: target!.id, said: `Connected “${target!.label}” to “${source.label}”.` }); return }
    setError(out.message)
    if (out.stale) onDone({ select: null, said: out.message, stale: true })
  }

  if (!target) {
    return (
      <div className="mt-3 space-y-2" data-connect-pick>
        <label htmlFor={`${id}-q`} className="sr-only">Find a card to connect</label>
        <input id={`${id}-q`} data-autofocus autoFocus value={query} autoComplete="off" placeholder="Find a card by name or where it is"
          role="combobox" aria-expanded aria-controls={`${id}-list`} aria-activedescendant={found[active] ? `${id}-o${active}` : undefined}
          onChange={e => { setQuery(e.target.value); setActive(0) }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown' && found.length) { e.preventDefault(); setActive(i => (i + 1) % found.length) }
            else if (e.key === 'ArrowUp' && found.length) { e.preventDefault(); setActive(i => (i - 1 + found.length) % found.length) }
            else if (e.key === 'Enter' && found[active]) { e.preventDefault(); pick(found[active]!.node) }
          }}
          className={FIELD} />
        <ul id={`${id}-list`} role="listbox" aria-label="Cards that can be connected" className="max-h-60 space-y-0.5 overflow-y-auto">
          {found.length === 0 && <li className="px-2 py-2 text-xs leading-relaxed text-subtle" data-connect-empty>{query.trim() ? `No card that can go with “${source.label}” matches “${query.trim()}”.` : `Nothing here can be connected to “${source.label}”.`}</li>}
          {found.map(({ node: n, context }, i) => {
            const linked = tree.parent.get(n.id) === source.id
            return (
              <li key={n.id} id={`${id}-o${i}`} role="option" aria-selected={i === active}>
                <button type="button" tabIndex={-1} onClick={() => pick(n)} onPointerEnter={() => setActive(i)} data-connect-option={n.label}
                  className={cn('flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors', i === active ? 'bg-white/6 text-foreground' : 'text-foreground/85')}>
                  <span aria-hidden className="mt-1.5 inline-block size-2 shrink-0 rounded-full" style={{ background: n.type === 'subject' ? 'var(--nova)' : `var(--map-${n.type})` }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{n.label}</span>
                    <span className="block truncate text-[11px] text-subtle">{n.type[0]!.toUpperCase() + n.type.slice(1)} · {context}{scope.all && !here.has(n.id) ? ' · not on this map' : ''}</span>
                  </span>
                  {linked && <span className="shrink-0 text-[11px] text-subtle">Already inside</span>}
                </button>
              </li>
            )
          })}
        </ul>
        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
        <div className="flex items-center justify-between gap-2">
          {!scope.all ? <button type="button" onClick={() => void widen()} disabled={loading} className="text-xs font-medium text-foreground/70 underline-offset-4 hover:text-foreground hover:underline" data-connect-all>{loading ? 'Loading…' : 'Search everything you have'}</button> : <span />}
          <button type="button" onClick={onClose} className={cn(BUTTON_QUIET, 'h-8')}>Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-3 space-y-3 text-sm" data-connect-confirm>
      {options.length === 0
        ? <p className="text-xs leading-relaxed text-foreground/80">“{target.label}” can’t be connected to “{source.label}”.</p>
        : (
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-xs text-foreground/75">Connect “{target.label}” to “{source.label}”:</legend>
            {options.map(o => (
              <label key={o.key} className={cn('flex cursor-pointer gap-2.5 rounded-xl border p-2.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring',
                option?.key === o.key ? 'border-white/20 bg-white/5' : 'border-white/8 hover:border-white/14', o.blocked && 'cursor-not-allowed opacity-75')}>
                <input type="radio" name={`${id}-rel`} checked={option?.key === o.key} disabled={!!o.blocked} onChange={() => setKey(o.key)} className="mt-1 accent-[var(--action)]" data-connect-relation={o.key} data-autofocus={option?.key === o.key || undefined} />
                <span className="min-w-0">
                  <span className="block font-medium text-foreground">{o.label} <span className="ml-1 rounded-full border border-white/10 px-1.5 text-[10px] font-normal text-subtle">{o.relation === 'link' ? 'link' : 'moves it'}</span></span>
                  <span className="block text-xs leading-relaxed text-foreground/70">{o.blocked ?? o.detail}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
      {option && !option.blocked && option.moves && <p className="rounded-lg bg-amber-400/10 px-2.5 py-2 text-xs leading-relaxed text-foreground/85" data-connect-moves>{option.moves} A card sits in one place at a time.</p>}
      {error && <p role="alert" className="text-xs leading-relaxed text-red-400">{error}</p>}
      <div className="flex justify-between gap-2">
        <button type="button" onClick={() => setTarget(null)} disabled={busy} className={cn(BUTTON_QUIET, 'h-8')}>Back</button>
        <span className="flex gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={cn(BUTTON_QUIET, 'h-8')}>Cancel</button>
          <button type="button" onClick={() => void confirm()} disabled={!option || !!option.blocked || busy} className={cn(BUTTON_PRIMARY, 'h-8 px-3 text-xs')} data-connect-save>{busy ? 'Connecting…' : 'Connect'}</button>
        </span>
      </div>
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
