'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, CalendarDays, ChevronRight, FileText, Flag, IndentDecrease, IndentIncrease, LayoutGrid, Link2, ListTree, Map as MapIcon, Plus, Sparkles, X } from 'lucide-react'
import type { BriefFact, DraftView } from '@repo/api/nova/product/builder.types'
import { planCounts, type PlanTask, type WorkspacePlan } from '@repo/api/nova/product/workspace-plan'
import { cn } from '@/lib/utils'
import { diffSummary, hintFor, ids, planDiff, planSubjects, wordsFor, type Hint, type PlanDiff, type Words } from './builder-view'
import * as edit from './plan-edit'
import type { PlaygroundView } from './plan-edit'
import { ProposalActions, workingLabel } from './proposal-actions'
import { HistoryButton } from './history-panel'
import type { DraftState } from './use-draft'

// The right half of Build with Nova: the proposal itself, the structured
// plan the server checked, not a picture of it. While it is a draft every
// part can be edited here; edits show at once and are saved as a new
// version (use-draft.ts). Before there is a proposal, what Nova has
// understood so far fills in as the conversation goes.
//
// A version that arrives while the page is open comes in item by item, and
// what it changed is lit for a moment (builder-view.ts planDiff). That is
// the page drawing a finished, checked proposal in order: the server writes
// a version whole, and the page never shows an item before it exists.

export const VIEW_ICON: Record<PlaygroundView, typeof LayoutGrid> = { overview: MapIcon, roadmap: Flag, board: LayoutGrid, topics: ListTree, timeline: CalendarDays, notes: FileText }

const FIELD = 'w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm text-foreground outline-none transition-colors hover:border-white/10 focus:border-action/70 focus:bg-background/60 disabled:hover:border-transparent'
const H = 'text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle'
const CARD = 'rounded-xl border border-white/8 bg-card/70'
// A title that wraps instead of being cut off; it grows with its text where
// the browser can size a field to its content.
export const TITLE_AREA = 'resize-none overflow-hidden leading-snug [field-sizing:content]'
// How many items a reveal staggers before the rest come in together.
const STAGGER_MAX = 14
const MARKS_FOR_MS = 4000

// ── Marking what a new version brought ────────────────────────────────────────

type Marked = { className?: string; style?: React.CSSProperties }
type Marker = (id: string) => Marked
const MarkContext = createContext<() => Marker>(() => () => ({}))

// One marker per view render: each marked item takes the next place in the queue.
function markerFor(diff: PlanDiff | null, first: boolean): () => Marker {
  return () => {
    let n = 0
    return (id: string) => {
      if (!diff) return {}
      const fresh = diff.fresh.has(id), changed = diff.changed.has(id)
      if (!fresh && !changed) return {}
      const style = { ['--i' as string]: Math.min(n++, STAGGER_MAX) } as React.CSSProperties
      return { className: first ? 'nova-reveal' : fresh ? 'nova-reveal nova-changed' : 'nova-changed', style }
    }
  }
}
const useMarker = () => useContext(MarkContext)()

// ── Small parts ───────────────────────────────────────────────────────────────

function IconButton({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className="grid size-7 shrink-0 place-items-center rounded-md text-foreground/50 transition-colors hover:bg-white/6 hover:text-foreground disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-ring">
      {children}
    </button>
  )
}

function AddRow({ label, placeholder, onAdd, disabled }: { label: string; placeholder: string; onAdd: (text: string) => void; disabled?: boolean }) {
  const [text, setText] = useState('')
  if (disabled) return null
  return (
    <form className="flex items-center gap-1.5" onSubmit={e => { e.preventDefault(); if (text.trim()) { onAdd(text.trim()); setText('') } }}>
      <input aria-label={label} value={text} onChange={e => setText(e.target.value)} placeholder={placeholder} maxLength={160}
        className="h-8 min-w-0 flex-1 rounded-md border border-dashed border-white/12 bg-transparent px-2 text-xs text-foreground outline-none placeholder:text-subtle focus:border-action/70" />
      <IconButton label={label} onClick={() => { if (text.trim()) { onAdd(text.trim()); setText('') } }}><Plus aria-hidden className="size-3.5" /></IconButton>
    </form>
  )
}

// "Change this with Nova": puts the start of a sentence in the message box,
// focused, and sends nothing.
export function NovaHint({ hint, onAsk }: { hint: Hint; onAsk: (text: string) => void }) {
  return (
    <button type="button" onClick={() => onAsk(hint.prefill)} data-hint
      className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-subtle transition-colors hover:bg-nova/6 hover:text-foreground/85">
      <Sparkles aria-hidden className="size-3.5 shrink-0 text-nova-ink" />
      <span className="min-w-0 flex-1">{hint.text}</span>
      <span className="shrink-0 font-medium text-nova-ink opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">Ask</span>
    </button>
  )
}

function Facts({ title, facts, tone }: { title: string; facts: BriefFact[] | string[]; tone: 'yours' | 'known' | 'assumed' | 'suggested' }) {
  if (facts.length === 0) return null
  return (
    <div data-brief={tone}>
      <p className={H}>{title}</p>
      <ul className="mt-2 space-y-1.5 text-sm">
        {facts.map((f, i) => (
          <li key={i} className="flex gap-2 leading-snug">
            <span aria-hidden className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', tone === 'yours' ? 'bg-action' : tone === 'known' ? 'bg-foreground/40' : tone === 'assumed' ? 'bg-amber-400' : 'bg-nova')} />
            {typeof f === 'string' ? <span className="text-foreground/80">{f}</span> : <span><span className="text-subtle">{f.label}:</span> <span className="text-foreground/85">{f.value}</span></span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

// The files shared in the conversation, and, once a proposal exists, whether
// Nova reported reading each one.
function SharedFiles({ draft, plan }: { draft: DraftView; plan: WorkspacePlan | null }) {
  if (draft.files.length === 0) return null
  return (
    <div data-files>
      <p className={H}>Your files</p>
      <ul className="mt-2 space-y-1.5 text-sm">
        {draft.files.map(f => {
          const src = plan?.sources.find(s => s.file === f.name)
          return (
            <li key={f.id} className="flex items-start gap-2" data-file-read={src ? String(src.read) : 'pending'}>
              <FileText aria-hidden className={cn('mt-0.5 size-4 shrink-0', src && !src.read ? 'text-amber-400' : 'text-action-ink')} />
              <span className="min-w-0 text-foreground/80"><span className="font-medium text-foreground">{f.name}</span>
                {' · '}{f.pages ? `${f.pages} pages` : f.mimeType === 'application/pdf' ? 'PDF' : 'photo'}
                {src ? (src.read ? ' · read for the proposal' : ` · not read${src.note ? `: ${src.note}` : ''}`) : ''}</span>
            </li>
          )
        })}
      </ul>
      <p className="mt-1.5 text-xs text-subtle">Kept with this conversation; deleted once it&apos;s built or cancelled.</p>
    </div>
  )
}

// What Nova has understood: the learner's words, their record, Nova's
// assumptions and suggestions, each said for what it is.
export function Understanding({ draft }: { draft: DraftView }) {
  const b = draft.brief
  const said = b.facts.filter(f => !f.file)
  const fromFiles = b.facts.filter(f => f.file).map(f => ({ label: `${f.label} (${f.file})`, value: f.value }))
  const any = b.facts.length + b.known.length + b.assumptions.length + b.suggestions.length > 0
  if (!any) return null
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Facts title="You told Nova" facts={said} tone="yours" />
      <Facts title="From your files" facts={fromFiles} tone="yours" />
      <Facts title="From your Kivo profile" facts={b.known} tone="known" />
      <Facts title="Nova is assuming" facts={b.assumptions} tone="assumed" />
      <Facts title="Nova suggests" facts={b.suggestions} tone="suggested" />
    </div>
  )
}

// ── Views ─────────────────────────────────────────────────────────────────────

type ViewProps = { plan: WorkspacePlan; editable: boolean; set: (p: WorkspacePlan) => void; words: Words }

function Overview({ plan, draft, editable, set, words, onView }: ViewProps & { draft: DraftView; onView: (v: PlaygroundView) => void }) {
  const mark = useMarker()
  const groups = edit.tasksByMilestone(plan)
  const soon = edit.timeline(plan).slice(0, 3)
  const basis = draft.brief.facts.length + draft.brief.known.length + draft.brief.assumptions.length + plan.assumptions.length
  return (
    <div className="space-y-6">
      <div>
        <label htmlFor="pg-summary" className={H}>What it&apos;s for</label>
        <textarea id="pg-summary" value={plan.summary} disabled={!editable} maxLength={400} rows={2} onChange={e => set({ ...plan, summary: e.target.value })} data-editable
          className={cn(FIELD, TITLE_AREA, 'mt-1 leading-relaxed text-foreground/85')} placeholder="A line about what this workspace is for" />
      </div>
      {plan.phases.length > 0 ? (
        <section aria-labelledby="pg-outline">
          <div className="flex items-baseline justify-between"><h3 id="pg-outline" className={H}>{words.phases}</h3><button type="button" onClick={() => onView('roadmap')} className="text-xs font-medium text-foreground/60 hover:text-foreground">Open</button></div>
          <ol className="mt-2 space-y-1.5">
            {plan.phases.map((p, i) => {
              const m = mark(ids.phase(p.name))
              const n = groups.find(g => g.index === i)?.tasks.length ?? 0
              return (
                <li key={p.name} className={cn(CARD, 'flex items-center gap-3 px-3 py-2', m.className)} style={m.style}>
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-nova/12 text-[11px] font-semibold text-nova-ink">{i + 1}</span>
                  <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{p.name}</span>
                  <span className="shrink-0 text-xs text-subtle">{n} task{n === 1 ? '' : 's'}</span>
                </li>
              )
            })}
          </ol>
        </section>
      ) : plan.subjects.length > 0 && (
        <section aria-labelledby="pg-outline">
          <div className="flex items-baseline justify-between"><h3 id="pg-outline" className={H}>{words.areas}</h3><button type="button" onClick={() => onView('topics')} className="text-xs font-medium text-foreground/60 hover:text-foreground">Open</button></div>
          <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {planSubjects(plan).map(({ index, depth, inside }) => {
              const s = plan.subjects[index]!
              const m = mark(ids.subject(s.name))
              // A subject inside another is listed under it, indented, across the whole row.
              const nested = plan.subjects.some(x => x.parent)
              return <li key={s.name} className={cn(CARD, 'flex items-center justify-between gap-2 px-3 py-2', nested && 'sm:col-span-2', m.className)} style={{ ...m.style, ...(depth ? { marginLeft: depth * 18 } : {}) }} data-subject-depth={depth}><span className="min-w-0 truncate text-sm font-medium text-foreground">{s.name}</span><span className="shrink-0 text-xs text-subtle">{inside ? `${inside} ${inside === 1 ? words.area : `${words.area}s`}${s.topics.length ? ' · ' : ''}` : ''}{inside && !s.topics.length ? '' : `${s.topics.length} ${s.topics.length === 1 ? words.topic : `${words.topic}s`}`}</span></li>
            })}
          </ul>
        </section>
      )}
      {soon.length > 0 && (
        <section aria-labelledby="pg-soon">
          <div className="flex items-baseline justify-between"><h3 id="pg-soon" className={H}>Coming up</h3><button type="button" onClick={() => onView('timeline')} className="text-xs font-medium text-foreground/60 hover:text-foreground">Calendar</button></div>
          <ul className="mt-2 space-y-1">
            {soon.map(item => (
              <li key={`${item.kind}-${item.ref}`} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 text-xs tabular-nums text-subtle">{item.day}</span>
                <span aria-hidden className={cn('size-2 shrink-0 rounded-full', item.kind === 'date' ? 'bg-amber-400' : 'bg-action')} />
                <span className="min-w-0 truncate text-foreground/85">{item.label}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <SharedFiles draft={draft} plan={plan} />
      {basis > 0 && (
        <details className="group rounded-xl border border-white/8 px-3 py-2.5">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-foreground/70 hover:text-foreground">
            <ChevronRight aria-hidden className="size-3.5 transition-transform group-open:rotate-90" /> What this proposal is based on
          </summary>
          <div className="mt-3 space-y-5">
            <Understanding draft={draft} />
            {plan.assumptions.length > 0 && <Facts title="The proposal assumes" facts={plan.assumptions} tone="assumed" />}
          </div>
        </details>
      )}
      {draft.brief.dropped.length > 0 && <p className="text-xs text-subtle" data-dropped>Left out to fit Kivo&apos;s limits: {draft.brief.dropped.slice(0, 4).join('; ')}{draft.brief.dropped.length > 4 ? ` and ${draft.brief.dropped.length - 4} more` : ''}.</p>}
    </div>
  )
}

function Roadmap({ plan, editable, set, words }: ViewProps) {
  const mark = useMarker()
  const groups = edit.tasksByMilestone(plan)
  return (
    <div className="space-y-3">
      <ol className="space-y-3">
        {plan.phases.map((p, i) => {
          const tasks = groups.find(g => g.index === i)?.tasks ?? []
          const m = mark(ids.phase(p.name))
          return (
            <li key={i} className={cn(CARD, 'p-3', m.className)} style={m.style} data-milestone={i}>
              <div className="flex items-center gap-2">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-nova/12 text-[11px] font-semibold text-nova-ink">{i + 1}</span>
                <input aria-label={`${words.phase} ${i + 1} name`} value={p.name} disabled={!editable} maxLength={80} onChange={e => set(edit.updatePhase(plan, i, { name: e.target.value }))} className={cn(FIELD, 'font-medium')} data-editable />
                {editable && <>
                  <IconButton label={`Move ${p.name} up`} disabled={i === 0} onClick={() => set(edit.reorderPhase(plan, i, -1))}><ArrowUp aria-hidden className="size-3.5" /></IconButton>
                  <IconButton label={`Move ${p.name} down`} disabled={i === plan.phases.length - 1} onClick={() => set(edit.reorderPhase(plan, i, 1))}><ArrowDown aria-hidden className="size-3.5" /></IconButton>
                  <IconButton label={`Remove ${p.name}`} onClick={() => set(edit.removePhase(plan, i))}><X aria-hidden className="size-3.5" /></IconButton>
                </>}
              </div>
              {(p.weeks || p.hoursPerWeek || p.goals.length > 0) && (
                <p className="mt-1 pl-8 text-xs leading-relaxed text-foreground/65">
                  {[p.weeks ? `≈ ${p.weeks} week${p.weeks === 1 ? '' : 's'}` : null, p.hoursPerWeek ? `${p.hoursPerWeek} h a week` : null].filter(Boolean).join(' · ')}
                  {(p.weeks || p.hoursPerWeek) && p.goals.length > 0 ? ' — ' : ''}{p.goals.join(' · ')}
                </p>
              )}
              <label className="mt-1.5 flex items-center gap-1 pl-8 text-[11px] text-subtle"><span className="shrink-0">Done when</span>
                <input value={p.completion ?? ''} disabled={!editable} maxLength={240} placeholder="what finishing this looks like" onChange={e => set(edit.updatePhase(plan, i, { completion: e.target.value || null }))} className={cn(FIELD, 'text-xs')} />
              </label>
              {tasks.length > 0 && (
                <ul className="ml-3 mt-2 space-y-1 border-l border-white/8 pl-4">
                  {edit.treeRows(tasks).map(({ task: t, depth }) => {
                    const tm = mark(ids.task(t.key))
                    return <li key={t.key} className={cn('rounded px-1 text-sm text-foreground/80', depth > 0 && 'text-foreground/65', tm.className)} style={{ ...tm.style, marginLeft: depth * 14 }} data-depth={depth}>{depth > 0 && <span aria-hidden className="mr-1 text-subtle">└</span>}{t.title}{t.after && <span className="ml-1.5 text-[11px] text-subtle">waits for {plan.tasks.find(x => x.key === t.after)?.title}</span>}</li>
                  })}
                </ul>
              )}
              {editable && <div className="mt-2 pl-8"><AddRow label={`Add a task to ${p.name}`} placeholder="Add a task" onAdd={title => set(edit.addTask(plan, title, p.name))} /></div>}
            </li>
          )
        })}
      </ol>
      <AddRow label={`Add a ${words.phase}`} placeholder={`Add a ${words.phase}`} disabled={!editable} onAdd={name => set(edit.addPhase(plan, name))} />
    </div>
  )
}

const PRIORITY_STYLE: Record<NonNullable<PlanTask['priority']>, string> = {
  high: 'border-amber-400/40 bg-amber-400/12 text-amber-200', medium: 'border-sky-400/30 bg-sky-400/10 text-sky-200', low: 'border-white/12 bg-white/5 text-foreground/70',
}
const PRIORITY_WORD = { high: 'High', medium: 'Medium', low: 'Low' } as const

// The learner's own priority: chosen here, never set by Nova. Nova's view,
// when it has a reason for one, is a suggestion beside it to take or leave.
function PriorityPicker({ t, plan, editable, set }: { t: PlanTask } & Pick<ViewProps, 'plan' | 'editable' | 'set'>) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <label className="sr-only" htmlFor={`prio-${t.key}`}>Priority of {t.title}</label>
      <select id={`prio-${t.key}`} value={t.priority ?? ''} disabled={!editable} onChange={e => set(edit.updateTask(plan, t.key, { priority: (e.target.value || null) as PlanTask['priority'] }))}
        className={cn('h-6 rounded-md border px-1 text-[11px] font-medium', t.priority ? PRIORITY_STYLE[t.priority] : 'border-white/10 bg-background text-subtle')} data-priority={t.priority ?? 'none'}>
        <option value="">No priority</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
      </select>
      {!t.priority && t.suggestedPriority && (
        <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-nova/40 px-1.5 py-0.5 text-[11px] text-foreground/75" data-suggestion>
          <Sparkles aria-hidden className="size-3 text-nova" />Nova suggests {PRIORITY_WORD[t.suggestedPriority]}{t.priorityReason ? `: ${t.priorityReason}` : ''}
          {editable && <>
            <button type="button" onClick={() => set(edit.acceptSuggestion(plan, t.key))} className="ml-1 rounded px-1 font-medium text-nova-ink hover:bg-nova/10">Use</button>
            <button type="button" onClick={() => set(edit.dismissSuggestion(plan, t.key))} aria-label={`Dismiss the suggestion for ${t.title}`} className="rounded px-0.5 text-subtle hover:text-foreground"><X aria-hidden className="size-3" /></button>
          </>}
        </span>
      )}
    </span>
  )
}

// One task in the tree: indented under its task, its steps folded or open,
// what it waits for and what waits for it, edited in place.
function TaskRow({ t, depth, steps, folded, onFold, plan, editable, set, words, m }: { t: PlanTask; depth: number; steps: number; folded: boolean; onFold: () => void; m: Marked } & ViewProps) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const waits = t.after ? plan.tasks.find(x => x.key === t.after) : null
  const blocks = edit.waitingOn(plan, t.key)
  return (
    <li className={cn('relative', depth > 0 && 'border-l border-white/10 pl-3')} style={{ marginLeft: depth * 16 }} data-task={t.key} data-depth={depth}>
      <div className={cn(CARD, 'p-2', m.className)} style={m.style}>
        <div className="flex items-start gap-1">
          {steps > 0
            ? <button type="button" onClick={onFold} aria-expanded={!folded} aria-label={`${folded ? 'Show' : 'Hide'} the ${steps} step${steps === 1 ? '' : 's'} of ${t.title}`} className="mt-1 grid size-6 shrink-0 place-items-center rounded-md text-foreground/60 hover:bg-white/6"><ChevronRight aria-hidden className={cn('size-3.5 transition-transform', !folded && 'rotate-90')} /></button>
            : <span aria-hidden className="mt-1 grid size-6 shrink-0 place-items-center"><span className="size-1.5 rounded-full bg-foreground/25" /></span>}
          <textarea aria-label="Task title" value={t.title} disabled={!editable} maxLength={160} rows={1} onChange={e => set(edit.updateTask(plan, t.key, { title: e.target.value.split('\n').join(' ') }))} className={cn(FIELD, TITLE_AREA)} data-editable />
          {editable && <div className="flex shrink-0 items-center">
            <IconButton label={`Add a step to ${t.title}`} onClick={() => setAdding(a => !a)}><Plus aria-hidden className="size-3.5" /></IconButton>
            <IconButton label={`Make ${t.title} a step of the task above`} disabled={!edit.canIndent(plan, t.key)} onClick={() => set(edit.indent(plan, t.key))}><IndentIncrease aria-hidden className="size-3.5" /></IconButton>
            <IconButton label={`Move ${t.title} out one level`} disabled={!t.parent} onClick={() => set(edit.outdent(plan, t.key))}><IndentDecrease aria-hidden className="size-3.5" /></IconButton>
            <IconButton label={`Move ${t.title} up`} onClick={() => set(edit.reorderTask(plan, t.key, -1))}><ArrowUp aria-hidden className="size-3.5" /></IconButton>
            <IconButton label={`Move ${t.title} down`} onClick={() => set(edit.reorderTask(plan, t.key, 1))}><ArrowDown aria-hidden className="size-3.5" /></IconButton>
            <IconButton label={`Remove ${t.title}${steps ? ` and its ${steps} step${steps === 1 ? '' : 's'}` : ''}`} onClick={() => set(edit.removeTask(plan, t.key))}><X aria-hidden className="size-3.5" /></IconButton>
          </div>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pl-7 pt-1 text-[11px] text-subtle">
          <PriorityPicker t={t} plan={plan} editable={editable} set={set} />
          {steps > 0 && <span className="rounded bg-white/5 px-1.5 py-0.5">{steps} step{steps === 1 ? '' : 's'}</span>}
          {t.dueDay && <span className="rounded bg-white/5 px-1.5 py-0.5 tabular-nums">due {t.dueDay}</span>}
          {t.estimatedMinutes && <span>~{t.estimatedMinutes} min</span>}
          {waits && <span className="inline-flex items-center gap-1 rounded bg-white/5 px-1.5 py-0.5" data-waits><Link2 aria-hidden className="size-3" />waits for {waits.title}</span>}
          {blocks.length > 0 && <span className="inline-flex items-center gap-1 rounded bg-white/5 px-1.5 py-0.5" data-blocks><Link2 aria-hidden className="size-3" />{blocks.length === 1 ? `${blocks[0]!.title} waits for this` : `${blocks.length} tasks wait for this`}</span>}
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="ml-auto rounded px-1 font-medium text-foreground/60 hover:text-foreground">{open ? 'Done' : editable ? 'Details' : 'More'}</button>
        </div>
        {open && (
          <div className="mt-2 grid gap-2 pl-7 pb-1 sm:grid-cols-2">
            {!t.parent && <label className="text-[11px] text-subtle">{words.phase[0]!.toUpperCase() + words.phase.slice(1)}
              <select value={t.topic ?? ''} disabled={!editable} onChange={e => set(edit.updateTask(plan, t.key, { topic: e.target.value || null }))} className="mt-0.5 h-8 w-full rounded-md border border-white/10 bg-background px-1.5 text-xs text-foreground">
                <option value="">None</option>
                {plan.phases.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                {t.topic && !plan.phases.some(p => p.name === t.topic) && <option value={t.topic}>{t.topic}</option>}
              </select>
            </label>}
            <label className="text-[11px] text-subtle">Due
              <input type="date" value={t.dueDay ?? ''} disabled={!editable} onChange={e => set(edit.updateTask(plan, t.key, { dueDay: e.target.value || null }))} className="mt-0.5 h-8 w-full rounded-md border border-white/10 bg-background px-1.5 text-xs text-foreground" />
            </label>
            <label className="text-[11px] text-subtle">Waits for
              <select value={t.after ?? ''} disabled={!editable} onChange={e => set(edit.updateTask(plan, t.key, { after: e.target.value || null }))} className="mt-0.5 h-8 w-full rounded-md border border-white/10 bg-background px-1.5 text-xs text-foreground">
                <option value="">Nothing</option>
                {edit.possibleAfter(plan, t.key).map(x => <option key={x.key} value={x.key}>{x.title}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-subtle">A step of
              <select value={t.parent ?? ''} disabled={!editable} onChange={e => set(edit.setParent(plan, t.key, e.target.value || null))} className="mt-0.5 h-8 w-full rounded-md border border-white/10 bg-background px-1.5 text-xs text-foreground">
                <option value="">Nothing (a task of its own)</option>
                {plan.tasks.filter(x => x.key !== t.key).map(x => <option key={x.key} value={x.key}>{x.title}</option>)}
              </select>
            </label>
          </div>
        )}
        {adding && editable && <div className="mt-2 pl-7"><AddRow label={`Add a step to ${t.title}`} placeholder="Add a step" onAdd={title => { set(edit.addStep(plan, t.key, title)); setAdding(false) }} /></div>}
      </div>
    </li>
  )
}

// A list of tasks as a tree, steps folded or open.
function TaskTree({ tasks, folded, onFold, ...props }: { tasks: PlanTask[] } & ViewProps & { folded: Set<string>; onFold: (key: string) => void }) {
  const mark = useMarker()
  const rows = edit.treeRows(tasks)
  const hidden = new Set<string>()
  for (const r of rows) if (r.task.parent && (hidden.has(r.task.parent) || folded.has(r.task.parent))) hidden.add(r.task.key)
  return (
    <ul className="space-y-1.5">
      {rows.filter(r => !hidden.has(r.task.key)).map(r => (
        <TaskRow key={r.task.key} t={r.task} depth={r.depth} steps={r.steps} folded={folded.has(r.task.key)} onFold={() => onFold(r.task.key)} m={mark(ids.task(r.task.key))} {...props} />
      ))}
    </ul>
  )
}

// Tasks by milestone, each a tree. In the Planner they start in To do.
function Board(props: ViewProps) {
  const { plan, editable, set } = props
  const groups = edit.tasksByMilestone(plan)
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const parents = plan.tasks.filter(t => plan.tasks.some(x => x.parent === t.key)).map(t => t.key)
  const fold = (key: string) => setFolded(f => { const n = new Set(f); if (n.has(key)) n.delete(key); else n.add(key); return n })
  return (
    <div className="space-y-4">
      {parents.length > 0 && (
        <div className="flex justify-end gap-2 text-[11px]">
          <button type="button" onClick={() => setFolded(new Set())} className="rounded px-1.5 py-0.5 text-foreground/60 hover:text-foreground">Expand all</button>
          <button type="button" onClick={() => setFolded(new Set(parents))} className="rounded px-1.5 py-0.5 text-foreground/60 hover:text-foreground">Collapse all</button>
        </div>
      )}
      {groups.map(g => (
        <section key={g.milestone ?? '—'} aria-label={g.milestone ?? 'Other tasks'}>
          <h3 className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold text-foreground/85">
            {g.index !== null && <span className="grid size-5 place-items-center rounded-full bg-nova/12 text-[10px] text-nova-ink">{g.index + 1}</span>}
            <span className="min-w-0 flex-1">{g.milestone ?? (plan.phases.length ? 'Other tasks' : 'Tasks')}</span>
            <span className="font-normal text-subtle">{g.tasks.length}</span>
          </h3>
          <TaskTree tasks={g.tasks} {...props} folded={folded} onFold={fold} />
          {editable && <div className="mt-2"><AddRow label={`Add a task${g.milestone ? ` to ${g.milestone}` : ''}`} placeholder="Add a task" onAdd={title => set(edit.addTask(plan, title, g.milestone))} /></div>}
        </section>
      ))}
    </div>
  )
}

function Topics({ plan, editable, set, words }: ViewProps) {
  const mark = useMarker()
  return (
    <div className="space-y-3">
      {planSubjects(plan).map(({ index: i, depth }) => {
        const s = plan.subjects[i]!
        const m = mark(ids.subject(s.name))
        const choices = editable ? edit.parentChoices(plan, i) : []
        return (
          <section key={i} className={cn(CARD, 'p-3', m.className)} style={{ ...m.style, ...(depth ? { marginLeft: depth * 18 } : {}) }} data-subject={i} data-subject-depth={depth}>
            <div className="flex items-center gap-2">
              <input aria-label={`${words.area} ${i + 1} name`} value={s.name} disabled={!editable} maxLength={80} onChange={e => set(edit.renameSubject(plan, i, e.target.value))} className={cn(FIELD, 'font-medium')} data-editable />
              <span className="shrink-0 text-xs text-subtle">{s.topics.length}</span>
              {editable && <IconButton label={`Remove ${s.name}`} onClick={() => set(edit.removeSubject(plan, i))}><X aria-hidden className="size-3.5" /></IconButton>}
            </div>
            {(s.parent || choices.length > 0) && (
              // Where it sits on the Knowledge Map: on its own, or inside another of these.
              <label className="mt-1.5 flex items-center gap-2 text-xs text-subtle">
                Inside
                <select value={s.parent ?? ''} disabled={!editable} onChange={e => set(edit.setSubjectParent(plan, i, e.target.value || null))} className="h-7 rounded-md border border-white/10 bg-transparent px-1.5 text-xs text-foreground/85" data-subject-parent>
                  <option value="">nothing (on its own)</option>
                  {[...new Set([...(s.parent ? [s.parent] : []), ...choices])].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            )}
            {s.topics.some(t => t.unit || t.subtopics?.length) ? (
              // A course in learning order: each unit once, where it starts, and what each topic covers.
              <ol className="mt-2 space-y-1">
                {s.topics.map((t, k) => {
                  const tm = mark(ids.topic(s.name, t.name))
                  const unit = t.unit && t.unit !== s.topics[k - 1]?.unit ? t.unit : null
                  return (
                    <li key={k} className={cn('rounded-lg px-1.5 py-1', tm.className)} style={tm.style}>
                      {unit && <p className="mb-1 mt-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-subtle">{unit}</p>}
                      <div className="flex items-start gap-1.5">
                        <span className="w-5 shrink-0 pt-0.5 text-right text-[11px] tabular-nums text-subtle">{k + 1}.</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground/90">{t.name}</p>
                          {t.subtopics && t.subtopics.length > 0 && <p className="text-xs leading-relaxed text-foreground/65">{t.subtopics.join(' · ')}</p>}
                        </div>
                        {editable && <IconButton label={`Remove ${t.name}`} onClick={() => set(edit.removeTopic(plan, i, k))}><X aria-hidden className="size-3" /></IconButton>}
                      </div>
                    </li>
                  )
                })}
              </ol>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {s.topics.map((t, k) => {
                  const tm = mark(ids.topic(s.name, t.name))
                  return (
                    <li key={k} className={cn('flex items-center gap-0.5 rounded-full border border-white/10 py-0.5 pl-2.5 pr-0.5 text-xs text-foreground/85', !editable && 'pr-2.5', tm.className)} style={tm.style} title={t.explanation ?? undefined}>
                      {t.name}
                      {editable && <IconButton label={`Remove ${t.name}`} onClick={() => set(edit.removeTopic(plan, i, k))}><X aria-hidden className="size-3" /></IconButton>}
                    </li>
                  )
                })}
              </ul>
            )}
            {editable && <div className="mt-2"><AddRow label={`Add a ${words.topic} to ${s.name}`} placeholder={`Add a ${words.topic}`} onAdd={name => set(edit.addTopic(plan, i, name))} /></div>}
          </section>
        )
      })}
      <AddRow label={`Add ${words.area === 'area' ? 'an area' : `a ${words.area}`}`} placeholder={`Add ${words.area === 'area' ? 'an area' : `a ${words.area}`}`} disabled={!editable} onAdd={name => set(edit.addSubject(plan, name))} />
    </div>
  )
}

function Timeline({ plan, editable, set }: ViewProps) {
  const mark = useMarker()
  const items = edit.timeline(plan)
  const [title, setTitle] = useState('')
  const [day, setDay] = useState('')
  return (
    <div className="space-y-4">
      {items.length === 0 && <p className="text-sm text-foreground/65">No dates yet. Add a deadline below, or give tasks a due day.</p>}
      <ol className="space-y-1.5">
        {items.map(item => {
          const m = mark(item.kind === 'date' && typeof item.ref === 'number' ? ids.date(plan.dates[item.ref]!.title) : ids.task(String(item.ref)))
          return (
            <li key={`${item.kind}-${item.ref}`} className={cn('flex items-center gap-3 rounded-lg px-1 text-sm', m.className)} style={m.style}>
              <span className="w-24 shrink-0 text-xs tabular-nums text-subtle">{item.day}</span>
              <span aria-hidden className={cn('size-2 shrink-0 rounded-full', item.kind === 'date' ? 'bg-amber-400' : 'bg-action')} />
              {item.kind === 'date' && typeof item.ref === 'number' ? (
                <>
                  <input aria-label="Date title" value={plan.dates[item.ref]!.title} disabled={!editable} maxLength={80} onChange={e => set(edit.updateDate(plan, item.ref as number, { title: e.target.value }))} className={cn(FIELD, 'font-medium')} data-editable />
                  <input aria-label="Day" type="date" value={plan.dates[item.ref]!.day} disabled={!editable} onChange={e => e.target.value && set(edit.updateDate(plan, item.ref as number, { day: e.target.value }))} className="h-8 rounded-md border border-white/10 bg-background px-1.5 text-xs text-foreground" />
                  {editable && <IconButton label={`Remove ${plan.dates[item.ref]!.title}`} onClick={() => set(edit.removeDate(plan, item.ref as number))}><X aria-hidden className="size-3.5" /></IconButton>}
                </>
              ) : <span className="min-w-0 py-1 text-foreground/80">{item.label} <span className="text-xs text-subtle">task due</span></span>}
            </li>
          )
        })}
      </ol>
      {editable && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); if (title.trim() && day) { set(edit.addDate(plan, title.trim(), day)); setTitle(''); setDay('') } }}>
          <input aria-label="New date title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Add a deadline" maxLength={80} className="h-8 min-w-0 flex-1 rounded-md border border-dashed border-white/12 bg-transparent px-2 text-xs text-foreground outline-none placeholder:text-subtle focus:border-action/70" />
          <input aria-label="New date day" type="date" value={day} onChange={e => setDay(e.target.value)} className="h-8 rounded-md border border-white/10 bg-background px-1.5 text-xs text-foreground" />
          <button type="submit" disabled={!title.trim() || !day} className="h-8 rounded-md border border-white/10 px-2.5 text-xs font-medium text-foreground/80 disabled:opacity-40">Add</button>
        </form>
      )}
    </div>
  )
}

function Notes({ plan, editable, set }: ViewProps) {
  const mark = useMarker()
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="space-y-2">
      {plan.notes.length === 0 && <p className="text-sm text-foreground/65">No notes in this proposal{plan.phases.length > 0 ? ' besides the ones each step writes for itself' : ''}.</p>}
      {plan.notes.map(n => {
        const m = mark(ids.note(n.key))
        return (
          <section key={n.key} className={cn(CARD, 'p-2.5', m.className)} style={m.style} data-note={n.key}>
            <div className="flex items-center gap-1">
              <input aria-label="Note title" value={n.title} disabled={!editable} maxLength={120} onChange={e => set(edit.updateNote(plan, n.key, { title: e.target.value }))} className={cn(FIELD, 'font-medium')} data-editable />
              <span className="shrink-0 text-[11px] text-subtle">{n.origin === 'source' ? 'from your files' : n.origin === 'nova' ? 'by Nova' : 'template'}</span>
              <button type="button" onClick={() => setOpen(o => (o === n.key ? null : n.key))} aria-expanded={open === n.key} className="shrink-0 rounded px-1.5 text-xs font-medium text-foreground/60 hover:text-foreground">{open === n.key ? 'Close' : 'Open'}</button>
              {editable && <IconButton label={`Remove ${n.title}`} onClick={() => set(edit.removeNote(plan, n.key))}><X aria-hidden className="size-3.5" /></IconButton>}
            </div>
            {open === n.key && (
              <textarea aria-label={`${n.title} text`} value={n.body} disabled={!editable} rows={8} maxLength={8000} onChange={e => set(edit.updateNote(plan, n.key, { body: e.target.value }))}
                className="mt-2 w-full resize-y rounded-md border border-white/10 bg-background/60 p-2 font-mono text-xs leading-relaxed text-foreground/85 outline-none focus:border-action/70" />
            )}
          </section>
        )
      })}
    </div>
  )
}

export function ViewTabs({ views, view, onView, label, names }: { views: PlaygroundView[]; view: PlaygroundView; onView: (v: PlaygroundView) => void; label: string; names: Record<PlaygroundView, string> }) {
  // Arrow keys move between tabs, as a tab list should.
  const onKey = (e: React.KeyboardEvent) => {
    const i = views.indexOf(view)
    const next = e.key === 'ArrowRight' ? views[(i + 1) % views.length] : e.key === 'ArrowLeft' ? views[(i - 1 + views.length) % views.length] : null
    if (next) { e.preventDefault(); onView(next); document.getElementById(`pg-tab-${next}`)?.focus() }
  }
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKey} className="-mb-px flex gap-0.5 overflow-x-auto">
      {views.map(v => {
        const Icon = VIEW_ICON[v]
        return (
          <button key={v} id={`pg-tab-${v}`} type="button" role="tab" aria-selected={view === v} aria-controls="pg-panel" tabIndex={view === v ? 0 : -1} onClick={() => onView(v)}
            className={cn('flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 pb-2 pt-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring',
              view === v ? 'border-action text-foreground' : 'border-transparent text-foreground/60 hover:text-foreground')}>
            <Icon aria-hidden className="size-3.5" /> {names[v]}
          </button>
        )
      })}
    </div>
  )
}

// What a playground shows before there is a proposal: where it will appear,
// and while Nova writes, its real stage.
export function PlaygroundWaiting({ draft, words }: { draft: DraftView | null; words: Words }) {
  const label = draft ? workingLabel(draft, words) : null
  const writing = draft?.pending?.stage === 'writing'
  return (
    <div className="space-y-5">
      {writing ? (
        <div role="status" aria-label={label ?? 'Writing the proposal'} className="space-y-2.5">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground/85"><Sparkles aria-hidden className="size-4 text-nova-ink" /> {label}…</p>
          <p className="text-xs text-subtle">It appears here as soon as Kivo has checked it, usually within a minute.</p>
          {[0, 1, 2].map(i => (
            <div key={i} aria-hidden className={cn(CARD, 'space-y-2 p-3')}>
              <div className="h-3 w-1/3 animate-pulse rounded bg-white/8 motion-reduce:animate-none" />
              <div className="h-2.5 w-2/3 animate-pulse rounded bg-white/5 motion-reduce:animate-none" />
              <div className="h-2.5 w-1/2 animate-pulse rounded bg-white/5 motion-reduce:animate-none" />
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-white/12 p-5" data-playground-empty>
          <p className="text-sm font-medium text-foreground">Your workspace takes shape here</p>
          <p className="mt-1 text-sm leading-relaxed text-foreground/65">Once Nova understands what you&apos;re working on, it proposes a structure on this side: {words.phases.toLowerCase()}, tasks and dates you can edit. Nothing is created until you approve it.</p>
          <div aria-hidden className="mt-4 grid gap-2 opacity-60 sm:grid-cols-3">
            {[words.phases, 'Tasks', 'Calendar'].map(t => (
              <div key={t} className="rounded-xl border border-white/8 p-2.5">
                <p className="text-[11px] font-medium text-subtle">{t}</p>
                <div className="mt-2 space-y-1.5"><div className="h-2 w-4/5 rounded bg-white/6" /><div className="h-2 w-3/5 rounded bg-white/6" /></div>
              </div>
            ))}
          </div>
        </div>
      )}
      {draft && <SharedFiles draft={draft} plan={null} />}
      {draft && <Understanding draft={draft} />}
    </div>
  )
}

// ── The draft's playground ────────────────────────────────────────────────────

export function DraftPlayground({ state, view, onView, onAsk }: {
  state: DraftState; view: PlaygroundView; onView: (v: PlaygroundView) => void; onAsk: (text: string) => void
}) {
  const { draft, plan, arrival } = state
  const words = wordsFor(draft?.brief.kind)
  // What the newest version brought, lit for a few seconds after it lands.
  const diff = useMemo(() => (arrival ? planDiff(arrival.previous, arrival.next) : null), [arrival])
  const [marking, setMarking] = useState(false)
  useEffect(() => {
    if (!arrival) return
    setMarking(true)
    const t = setTimeout(() => setMarking(false), MARKS_FOR_MS)
    return () => clearTimeout(t)
  }, [arrival])
  const marker = useMemo(() => markerFor(marking ? diff : null, !arrival?.previous), [marking, diff, arrival])

  if (!draft) return null
  const editable = Boolean(plan) && ['awaiting_approval', 'failed', 'drafting'].includes(draft.status)
  const views = edit.viewsFor(plan)
  const shown = views.includes(view) ? view : 'overview'
  const label = workingLabel(draft, words)
  const changes = marking && diff && arrival?.previous ? diffSummary(diff) : null

  const onEdit = () => {
    onView(views.includes('board') ? 'board' : 'overview')
    requestAnimationFrame(() => document.querySelector<HTMLElement>('#pg-panel [data-editable]:not(:disabled)')?.focus())
  }

  if (!plan) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PlaygroundHeader title={draft.title ?? draft.brief.title ?? 'Your workspace'} badge="draft" state={state} />
        {label && <WorkingStrip label={label} />}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5"><PlaygroundWaiting draft={draft} words={words} /></div>
        <ProposalActions state={state} words={words} onEdit={onEdit} onAsk={onAsk} />
      </div>
    )
  }

  const counts = planCounts(plan)
  // Milestones are written as topics too: counted once, as milestones.
  const topics = Math.max(0, counts.topics - plan.phases.length)
  const stats = [
    plan.phases.length ? `${plan.phases.length} ${words.phases.toLowerCase()}` : null,
    `${counts.tasks} task${counts.tasks === 1 ? '' : 's'}`,
    topics ? `${topics} ${topics === 1 ? words.topic : `${words.topic}s`}` : null,
    counts.dates ? `${counts.dates} date${counts.dates === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PlaygroundHeader title={plan.title} badge={draft.status === 'building' ? 'building' : 'draft'} state={state} stats={stats}
        onTitle={editable ? title => state.setPlan({ ...plan, title }) : undefined}
        tabs={<ViewTabs views={views} view={shown} onView={onView} label="Proposal views" names={words.views} />} />
      {label && <WorkingStrip label={label} />}
      {state.conflict && (
        <div role="alert" className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300/25 bg-amber-300/5 p-3 text-xs text-foreground/85" data-conflict>
          <span className="min-w-0 flex-1">Nova made version {state.conflict.version} while you were editing. Your edits are still on screen and not saved.</span>
          <button type="button" onClick={() => void state.keepMine()} className="rounded-md border border-white/12 px-2.5 py-1 font-medium hover:bg-white/5">Keep my edits</button>
          <button type="button" onClick={state.takeTheirs} className="rounded-md border border-white/12 px-2.5 py-1 font-medium hover:bg-white/5">Use Nova&apos;s version</button>
        </div>
      )}
      <div id="pg-panel" role="tabpanel" aria-labelledby={`pg-tab-${shown}`} className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-3 sm:px-5">
        {changes && (
          <p role="status" className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-nova/10 px-2.5 py-1 text-[11px] font-medium text-nova-ink" data-changes>
            <Sparkles aria-hidden className="size-3" /> Version {arrival?.version}: {changes}{diff && diff.removed.length > 0 ? ` (${diff.removed.slice(0, 3).join(', ')}${diff.removed.length > 3 ? '…' : ''})` : ''}
          </p>
        )}
        {editable && <div className="-mx-2 mb-3"><NovaHint hint={hintFor(draft.brief.kind, shown)} onAsk={onAsk} /></div>}
        <MarkContext.Provider value={marker}>
          <div key={arrival?.version ?? 0}>
            {shown === 'overview' && <Overview plan={plan} draft={draft} editable={editable} set={state.setPlan} words={words} onView={onView} />}
            {shown === 'roadmap' && <Roadmap plan={plan} editable={editable} set={state.setPlan} words={words} />}
            {shown === 'board' && <Board plan={plan} editable={editable} set={state.setPlan} words={words} />}
            {shown === 'topics' && <Topics plan={plan} editable={editable} set={state.setPlan} words={words} />}
            {shown === 'timeline' && <Timeline plan={plan} editable={editable} set={state.setPlan} words={words} />}
            {shown === 'notes' && <Notes plan={plan} editable={editable} set={state.setPlan} words={words} />}
          </div>
        </MarkContext.Provider>
      </div>
      <ProposalActions state={state} words={words} onEdit={onEdit} onAsk={onAsk} />
    </div>
  )
}

// What Nova is doing to this proposal right now: the job's stage, said once.
function WorkingStrip({ label }: { label: string }) {
  return (
    <div role="status" className="relative shrink-0 overflow-hidden border-b border-white/8 bg-nova/5 px-4 py-1.5 text-xs font-medium text-nova-ink sm:px-5" data-working>
      <span aria-hidden className="nova-progress absolute inset-x-0 bottom-0 h-0.5 w-2/5 bg-nova/60" />
      {label}…
    </div>
  )
}

export function PlaygroundHeader({ title, badge, state, onTitle, tabs, stats }: {
  title: string; badge: 'draft' | 'building' | 'live'; state?: DraftState; onTitle?: (t: string) => void; tabs?: React.ReactNode; stats?: string
}) {
  return (
    <div className="shrink-0 border-b border-white/8 px-4 pt-3.5 sm:px-5">
      <div className="flex items-center gap-2 text-[11px]">
        <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium', badge === 'live' ? 'bg-action-soft text-action-ink' : 'bg-white/6 text-foreground/70')} data-badge={badge}>
          <span aria-hidden className={cn('size-1.5 rounded-full', badge === 'live' ? 'bg-action' : badge === 'building' ? 'bg-nova' : 'bg-amber-400')} />
          {badge === 'live' ? 'Live workspace' : badge === 'building' ? 'Building…' : `Draft${state?.draft?.plan ? ` · v${state.draft.version}` : ''} · not created yet`}
        </span>
        <span className="ml-auto flex items-center gap-2">{state && <SaveIndicator state={state} />}{state?.draft && <HistoryButton state={state} />}</span>
      </div>
      {onTitle
        ? <input aria-label="Workspace name" value={title} maxLength={80} onChange={e => onTitle(e.target.value)} className={cn(FIELD, '-ml-1.5 mt-1 text-lg font-semibold tracking-tight')} />
        : <h2 className="mt-1.5 truncate text-lg font-semibold tracking-tight text-foreground">{title}</h2>}
      {stats && <p className="mt-0.5 text-xs text-subtle" data-stats>{stats}</p>}
      <div className={tabs ? 'mt-2.5' : 'pb-3'}>{tabs}</div>
    </div>
  )
}

function SaveIndicator({ state }: { state: DraftState }) {
  if (state.save === 'saving') return <span role="status" className="text-subtle">Saving…</span>
  if (state.save === 'saved') return <span role="status" className="text-subtle">Saved as v{state.draft?.version}</span>
  if (state.save === 'error') return <span role="alert" className="text-red-400">{state.saveError ?? 'Not saved.'}</span>
  return null
}
