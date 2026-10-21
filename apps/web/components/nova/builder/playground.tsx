'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, CalendarDays, FileText, Flag, LayoutGrid, ListTree, Loader2, Map as MapIcon, Plus, X } from 'lucide-react'
import type { BriefFact, DraftView } from '@repo/api/nova/product/builder.types'
import { planCounts, type PlanTask, type WorkspacePlan } from '@repo/api/nova/product/workspace-plan'
import { cn } from '@/lib/utils'
import * as edit from './plan-edit'
import type { PlaygroundView } from './plan-edit'
import type { DraftState } from './use-draft'

// The right half of Build with Nova: the proposal itself, the structured
// plan the server checked, not a picture of it. While it is a draft every
// part can be edited here; edits show at once and are saved as a new
// version (use-draft.ts). Before there is a proposal, what Nova has
// understood so far fills in as the conversation goes.

export const VIEW_LABEL: Record<PlaygroundView, string> = { overview: 'Overview', roadmap: 'Roadmap', board: 'Board', topics: 'Topics', timeline: 'Timeline', notes: 'Notes' }
export const VIEW_ICON: Record<PlaygroundView, typeof LayoutGrid> = { overview: MapIcon, roadmap: Flag, board: LayoutGrid, topics: ListTree, timeline: CalendarDays, notes: FileText }

const FIELD = 'w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm text-foreground outline-none transition-colors hover:border-white/10 focus:border-action/70 focus:bg-background/60 disabled:hover:border-transparent'
const H = 'text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle'
const CARD = 'rounded-xl border border-white/8 bg-card/60'
// A title that wraps instead of being cut off; it grows with its text where
// the browser can size a field to its content.
export const TITLE_AREA = 'resize-none overflow-hidden leading-snug [field-sizing:content]'

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

// What Nova has understood: the learner's words, their record, Nova's
// assumptions and suggestions, each said for what it is.
export function Understanding({ draft }: { draft: DraftView }) {
  const b = draft.brief
  const any = b.facts.length + b.known.length + b.assumptions.length + b.suggestions.length > 0
  if (!any) return null
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Facts title="You told Nova" facts={b.facts} tone="yours" />
      <Facts title="From your Kivo profile" facts={b.known} tone="known" />
      <Facts title="Nova is assuming" facts={b.assumptions} tone="assumed" />
      <Facts title="Nova suggests" facts={b.suggestions} tone="suggested" />
    </div>
  )
}

function Overview({ plan, draft, editable, set }: { plan: WorkspacePlan; draft: DraftView; editable: boolean; set: (p: WorkspacePlan) => void }) {
  const counts = planCounts(plan)
  return (
    <div className="space-y-6">
      <div>
        <label htmlFor="pg-summary" className={H}>What it&apos;s for</label>
        <textarea id="pg-summary" value={plan.summary} disabled={!editable} maxLength={400} rows={3} onChange={e => set({ ...plan, summary: e.target.value })}
          className={cn(FIELD, 'mt-1.5 resize-none leading-relaxed text-foreground/85')} placeholder="A line about what this workspace is for" />
      </div>
      <dl className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {([['Milestones', plan.phases.length], ['Tasks', counts.tasks], ['Topics', counts.topics], ['Notes', counts.notes], ['Dates', counts.dates]] as const).map(([k, v]) => (
          <div key={k} className={cn(CARD, 'px-3 py-2.5')}><dt className="text-[11px] text-subtle">{k}</dt><dd className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{v}</dd></div>
        ))}
      </dl>
      <Understanding draft={draft} />
      {plan.assumptions.length > 0 && (
        <div>
          <p className={H}>The proposal assumes</p>
          <ul className="mt-2 space-y-1 text-xs leading-relaxed text-foreground/70">{plan.assumptions.map(a => <li key={a}>{a}</li>)}</ul>
        </div>
      )}
      {draft.brief.dropped.length > 0 && <p className="text-xs text-subtle" data-dropped>Left out to fit Kivo&apos;s limits: {draft.brief.dropped.slice(0, 4).join('; ')}{draft.brief.dropped.length > 4 ? ` and ${draft.brief.dropped.length - 4} more` : ''}.</p>}
    </div>
  )
}

function Roadmap({ plan, editable, set }: { plan: WorkspacePlan; editable: boolean; set: (p: WorkspacePlan) => void }) {
  const groups = edit.tasksByMilestone(plan)
  return (
    <div className="space-y-3">
      <ol className="space-y-3">
        {plan.phases.map((p, i) => {
          const tasks = groups.find(g => g.index === i)?.tasks ?? []
          return (
            <li key={i} className={cn(CARD, 'p-3')} data-milestone={i}>
              <div className="flex items-center gap-2">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-nova/12 text-[11px] font-semibold text-nova-ink">{i + 1}</span>
                <input aria-label={`Milestone ${i + 1} name`} value={p.name} disabled={!editable} maxLength={80} onChange={e => set(edit.updatePhase(plan, i, { name: e.target.value }))} className={cn(FIELD, 'font-medium')} />
                {editable && <>
                  <IconButton label={`Move ${p.name} up`} disabled={i === 0} onClick={() => set(edit.reorderPhase(plan, i, -1))}><ArrowUp aria-hidden className="size-3.5" /></IconButton>
                  <IconButton label={`Move ${p.name} down`} disabled={i === plan.phases.length - 1} onClick={() => set(edit.reorderPhase(plan, i, 1))}><ArrowDown aria-hidden className="size-3.5" /></IconButton>
                  <IconButton label={`Remove ${p.name}`} onClick={() => set(edit.removePhase(plan, i))}><X aria-hidden className="size-3.5" /></IconButton>
                </>}
              </div>
              {(p.weeks || p.hoursPerWeek) && <p className="mt-1 pl-8 text-xs text-subtle">{[p.weeks ? `${p.weeks} week${p.weeks === 1 ? '' : 's'}` : null, p.hoursPerWeek ? `about ${p.hoursPerWeek} h a week` : null].filter(Boolean).join(' · ')} (an estimate)</p>}
              {p.goals.length > 0 && <p className="mt-1.5 pl-8 text-xs leading-relaxed text-foreground/70">{p.goals.join(' · ')}</p>}
              <div className="mt-2 space-y-1 pl-8">
                <label className="block text-[11px] text-subtle">Done when
                  <input value={p.completion ?? ''} disabled={!editable} maxLength={240} placeholder="What finishing this looks like" onChange={e => set(edit.updatePhase(plan, i, { completion: e.target.value || null }))} className={cn(FIELD, 'text-xs')} />
                </label>
              </div>
              {tasks.length > 0 && (
                <ul className="mt-2 space-y-1 border-l border-white/8 pl-4 ml-3">
                  {tasks.map(t => <li key={t.key} className="text-sm text-foreground/80">{t.title}{t.after && <span className="ml-1.5 text-[11px] text-subtle">after {plan.tasks.find(x => x.key === t.after)?.title}</span>}</li>)}
                </ul>
              )}
              {editable && <div className="mt-2 pl-8"><AddRow label={`Add a task to ${p.name}`} placeholder="Add a task to this milestone" onAdd={title => set(edit.addTask(plan, title, p.name))} /></div>}
            </li>
          )
        })}
      </ol>
      <AddRow label="Add a milestone" placeholder="Add a milestone" disabled={!editable} onAdd={name => set(edit.addPhase(plan, name))} />
    </div>
  )
}

function TaskRow({ t, plan, editable, set }: { t: PlanTask; plan: WorkspacePlan; editable: boolean; set: (p: WorkspacePlan) => void }) {
  const [open, setOpen] = useState(false)
  const index = plan.tasks.findIndex(x => x.key === t.key)
  return (
    <li className={cn(CARD, 'p-2')} data-task={t.key}>
      <div className="flex items-center gap-1">
        <textarea aria-label="Task title" value={t.title} disabled={!editable} maxLength={160} rows={1} onChange={e => set(edit.updateTask(plan, t.key, { title: e.target.value.split('\n').join(' ') }))} className={cn(FIELD, TITLE_AREA)} />
        {editable && <>
          <IconButton label={`Move ${t.title} up`} disabled={index === 0} onClick={() => set(edit.reorderTask(plan, t.key, -1))}><ArrowUp aria-hidden className="size-3.5" /></IconButton>
          <IconButton label={`Move ${t.title} down`} disabled={index === plan.tasks.length - 1} onClick={() => set(edit.reorderTask(plan, t.key, 1))}><ArrowDown aria-hidden className="size-3.5" /></IconButton>
          <IconButton label={`Remove ${t.title}`} onClick={() => set(edit.removeTask(plan, t.key))}><X aria-hidden className="size-3.5" /></IconButton>
        </>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-1.5 pt-1 text-[11px] text-subtle">
        {t.priority && <span className={cn('rounded px-1.5 py-0.5', t.priority === 'high' ? 'bg-amber-400/12 text-amber-300' : 'bg-white/5')}>{t.priority}</span>}
        {t.dueDay && <span>due {t.dueDay}</span>}
        {t.estimatedMinutes && <span>~{t.estimatedMinutes} min</span>}
        {t.after && <span>after {plan.tasks.find(x => x.key === t.after)?.title}</span>}
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="ml-auto rounded px-1 font-medium text-foreground/60 hover:text-foreground">{open ? 'Done' : editable ? 'Details' : 'More'}</button>
      </div>
      {open && (
        <div className="mt-2 grid gap-2 px-1.5 pb-1 sm:grid-cols-2">
          <label className="text-[11px] text-subtle">Milestone
            <select value={t.topic ?? ''} disabled={!editable} onChange={e => set(edit.updateTask(plan, t.key, { topic: e.target.value || null }))} className="mt-0.5 h-8 w-full rounded-md border border-white/10 bg-background px-1.5 text-xs text-foreground">
              <option value="">None</option>
              {plan.phases.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
              {t.topic && !plan.phases.some(p => p.name === t.topic) && <option value={t.topic}>{t.topic}</option>}
            </select>
          </label>
          <label className="text-[11px] text-subtle">Priority
            <select value={t.priority ?? ''} disabled={!editable} onChange={e => set(edit.updateTask(plan, t.key, { priority: (e.target.value || null) as PlanTask['priority'] }))} className="mt-0.5 h-8 w-full rounded-md border border-white/10 bg-background px-1.5 text-xs text-foreground">
              <option value="">Not set</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
            </select>
          </label>
          <label className="text-[11px] text-subtle">Due
            <input type="date" value={t.dueDay ?? ''} disabled={!editable} onChange={e => set(edit.updateTask(plan, t.key, { dueDay: e.target.value || null }))} className="mt-0.5 h-8 w-full rounded-md border border-white/10 bg-background px-1.5 text-xs text-foreground" />
          </label>
          <label className="text-[11px] text-subtle">Comes after
            <select value={t.after ?? ''} disabled={!editable} onChange={e => set(edit.updateTask(plan, t.key, { after: e.target.value || null }))} className="mt-0.5 h-8 w-full rounded-md border border-white/10 bg-background px-1.5 text-xs text-foreground">
              <option value="">Nothing</option>
              {edit.possibleAfter(plan, t.key).map(x => <option key={x.key} value={x.key}>{x.title}</option>)}
            </select>
          </label>
        </div>
      )}
    </li>
  )
}

// Tasks by milestone. In the Planner they start in To do.
function Board({ plan, editable, set }: { plan: WorkspacePlan; editable: boolean; set: (p: WorkspacePlan) => void }) {
  const groups = edit.tasksByMilestone(plan)
  return (
    <div className="space-y-3">
      <p className="text-xs text-subtle">On your Planner board these start in To do. Order them, give them dates and say what waits for what.</p>
      <div className="space-y-3">
        {groups.map(g => (
          <section key={g.milestone ?? '—'} aria-label={g.milestone ?? 'Other tasks'} className="rounded-xl bg-white/[0.025] p-2.5">
            <h3 className="mb-2 flex items-center justify-between px-1 text-xs font-semibold text-foreground/80">{g.milestone ?? (plan.phases.length ? 'Other tasks' : 'Tasks')}<span className="font-normal text-subtle">{g.tasks.length}</span></h3>
            <ul className="space-y-2">{g.tasks.map(t => <TaskRow key={t.key} t={t} plan={plan} editable={editable} set={set} />)}</ul>
            {editable && <div className="mt-2"><AddRow label={`Add a task${g.milestone ? ` to ${g.milestone}` : ''}`} placeholder="Add a task" onAdd={title => set(edit.addTask(plan, title, g.milestone))} /></div>}
          </section>
        ))}
      </div>
    </div>
  )
}

function Topics({ plan, editable, set }: { plan: WorkspacePlan; editable: boolean; set: (p: WorkspacePlan) => void }) {
  return (
    <div className="space-y-3">
      {plan.subjects.map((s, i) => (
        <section key={i} className={cn(CARD, 'p-3')} data-subject={i}>
          <div className="flex items-center gap-2">
            <input aria-label={`Subject ${i + 1} name`} value={s.name} disabled={!editable} maxLength={80} onChange={e => set(edit.renameSubject(plan, i, e.target.value))} className={cn(FIELD, 'font-medium')} />
            {editable && <IconButton label={`Remove ${s.name}`} onClick={() => set(edit.removeSubject(plan, i))}><X aria-hidden className="size-3.5" /></IconButton>}
          </div>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {s.topics.map((t, k) => (
              <li key={k} className="flex items-center gap-0.5 rounded-full border border-white/10 py-0.5 pl-2.5 pr-0.5 text-xs text-foreground/85" title={t.explanation ?? undefined}>
                {t.name}
                {editable && <IconButton label={`Remove ${t.name}`} onClick={() => set(edit.removeTopic(plan, i, k))}><X aria-hidden className="size-3" /></IconButton>}
              </li>
            ))}
          </ul>
          {editable && <div className="mt-2"><AddRow label={`Add a topic to ${s.name}`} placeholder="Add a topic" onAdd={name => set(edit.addTopic(plan, i, name))} /></div>}
        </section>
      ))}
      <AddRow label="Add a subject" placeholder="Add a subject or area" disabled={!editable} onAdd={name => set(edit.addSubject(plan, name))} />
      {plan.phases.length > 0 && <p className="text-xs text-subtle">Each milestone also becomes a topic, in order, so the Planner offers them one after another.</p>}
    </div>
  )
}

function Timeline({ plan, editable, set }: { plan: WorkspacePlan; editable: boolean; set: (p: WorkspacePlan) => void }) {
  const items = edit.timeline(plan)
  const [title, setTitle] = useState('')
  const [day, setDay] = useState('')
  return (
    <div className="space-y-4">
      {items.length === 0 && <p className="text-sm text-foreground/65">No dates yet. Add a deadline below, or give tasks due days on the Board.</p>}
      <ol className="space-y-2">
        {items.map(item => (
          <li key={`${item.kind}-${item.ref}`} className="flex items-center gap-3 text-sm">
            <span className="w-24 shrink-0 text-xs tabular-nums text-subtle">{item.day}</span>
            <span aria-hidden className={cn('size-2 shrink-0 rounded-full', item.kind === 'date' ? 'bg-amber-400' : 'bg-action')} />
            {item.kind === 'date' && typeof item.ref === 'number' ? (
              <>
                <input aria-label="Date title" value={plan.dates[item.ref]!.title} disabled={!editable} maxLength={80} onChange={e => set(edit.updateDate(plan, item.ref as number, { title: e.target.value }))} className={cn(FIELD, 'font-medium')} />
                <input aria-label="Day" type="date" value={plan.dates[item.ref]!.day} disabled={!editable} onChange={e => e.target.value && set(edit.updateDate(plan, item.ref as number, { day: e.target.value }))} className="h-8 rounded-md border border-white/10 bg-background px-1.5 text-xs text-foreground" />
                {editable && <IconButton label={`Remove ${plan.dates[item.ref]!.title}`} onClick={() => set(edit.removeDate(plan, item.ref as number))}><X aria-hidden className="size-3.5" /></IconButton>}
              </>
            ) : <span className="text-foreground/80">{item.label} <span className="text-xs text-subtle">task due</span></span>}
          </li>
        ))}
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

function Notes({ plan, editable, set }: { plan: WorkspacePlan; editable: boolean; set: (p: WorkspacePlan) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="space-y-2">
      {plan.phases.length > 0 && <p className="text-xs text-subtle">Each milestone&apos;s goals, exercises and resources are written as a note too{plan.tasks.some(t => t.after) ? ', and the order of work as one more' : ''}.</p>}
      {plan.notes.length === 0 && <p className="text-sm text-foreground/65">No other notes in this proposal.</p>}
      {plan.notes.map(n => (
        <section key={n.key} className={cn(CARD, 'p-2.5')} data-note={n.key}>
          <div className="flex items-center gap-1">
            <input aria-label="Note title" value={n.title} disabled={!editable} maxLength={120} onChange={e => set(edit.updateNote(plan, n.key, { title: e.target.value }))} className={cn(FIELD, 'font-medium')} />
            <span className="shrink-0 text-[11px] text-subtle">{n.origin === 'source' ? 'from your files' : n.origin === 'nova' ? 'by Nova' : 'template'}</span>
            <button type="button" onClick={() => setOpen(o => (o === n.key ? null : n.key))} aria-expanded={open === n.key} className="shrink-0 rounded px-1.5 text-xs font-medium text-foreground/60 hover:text-foreground">{open === n.key ? 'Close' : 'Open'}</button>
            {editable && <IconButton label={`Remove ${n.title}`} onClick={() => set(edit.removeNote(plan, n.key))}><X aria-hidden className="size-3.5" /></IconButton>}
          </div>
          {open === n.key && (
            <textarea aria-label={`${n.title} text`} value={n.body} disabled={!editable} rows={8} maxLength={8000} onChange={e => set(edit.updateNote(plan, n.key, { body: e.target.value }))}
              className="mt-2 w-full resize-y rounded-md border border-white/10 bg-background/60 p-2 font-mono text-xs leading-relaxed text-foreground/85 outline-none focus:border-action/70" />
          )}
        </section>
      ))}
    </div>
  )
}

export function ViewTabs({ views, view, onView, label }: { views: PlaygroundView[]; view: PlaygroundView; onView: (v: PlaygroundView) => void; label: string }) {
  // Arrow keys move between tabs, as a tab list should.
  const onKey = (e: React.KeyboardEvent) => {
    const i = views.indexOf(view)
    const next = e.key === 'ArrowRight' ? views[(i + 1) % views.length] : e.key === 'ArrowLeft' ? views[(i - 1 + views.length) % views.length] : null
    if (next) { e.preventDefault(); onView(next); document.getElementById(`pg-tab-${next}`)?.focus() }
  }
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKey} className="flex gap-1 overflow-x-auto">
      {views.map(v => {
        const Icon = VIEW_ICON[v]
        return (
          <button key={v} id={`pg-tab-${v}`} type="button" role="tab" aria-selected={view === v} aria-controls="pg-panel" tabIndex={view === v ? 0 : -1} onClick={() => onView(v)}
            className={cn('flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring',
              view === v ? 'bg-white/8 text-foreground' : 'text-foreground/60 hover:text-foreground')}>
            <Icon aria-hidden className="size-3.5" /> {VIEW_LABEL[v]}
          </button>
        )
      })}
    </div>
  )
}

// The draft: an editable copy of the proposal, or what is understood so far.
export function DraftPlayground({ state, view, onView }: { state: DraftState; view: PlaygroundView; onView: (v: PlaygroundView) => void }) {
  const { draft, plan } = state
  if (!draft) return null
  const editable = Boolean(plan) && ['awaiting_approval', 'failed', 'drafting'].includes(draft.status) && draft.status !== 'building'
  const views = edit.viewsFor(plan)
  const shown = views.includes(view) ? view : 'overview'

  if (!plan) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PlaygroundHeader title={draft.title ?? draft.brief.title ?? 'Your workspace'} badge="draft" state={state} />
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
          {draft.pending?.stage === 'writing' ? (
            <div role="status" className="space-y-3" aria-label="Writing the proposal">
              <p className="flex items-center gap-2 text-sm text-foreground/75"><Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> Nova is writing the proposal. It appears here when it&apos;s ready.</p>
              {[0, 1, 2].map(i => <div key={i} aria-hidden className="h-16 animate-pulse rounded-xl bg-white/4 motion-reduce:animate-none" />)}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/12 p-5 text-sm leading-relaxed text-foreground/70">
              <p className="font-medium text-foreground">The proposal will appear here.</p>
              <p className="mt-1">As you talk, what Nova understands fills in below. When there&apos;s enough, Nova proposes a structure you can edit right here before anything is created.</p>
            </div>
          )}
          <Understanding draft={draft} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PlaygroundHeader title={plan.title} badge={draft.status === 'building' ? 'building' : 'draft'} state={state}
        onTitle={editable ? title => state.setPlan({ ...plan, title }) : undefined}
        tabs={<ViewTabs views={views} view={shown} onView={onView} label="Proposal views" />} />
      {state.conflict && (
        <div role="alert" className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300/25 bg-amber-300/5 p-3 text-xs text-foreground/85" data-conflict>
          <span className="min-w-0 flex-1">Nova made version {state.conflict.version} while you were editing. Your edits are still on screen and not saved.</span>
          <button type="button" onClick={() => void state.keepMine()} className="rounded-md border border-white/12 px-2.5 py-1 font-medium hover:bg-white/5">Keep my edits</button>
          <button type="button" onClick={state.takeTheirs} className="rounded-md border border-white/12 px-2.5 py-1 font-medium hover:bg-white/5">Use Nova&apos;s version</button>
        </div>
      )}
      <div id="pg-panel" role="tabpanel" aria-labelledby={`pg-tab-${shown}`} className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        {shown === 'overview' && <Overview plan={plan} draft={draft} editable={editable} set={state.setPlan} />}
        {shown === 'roadmap' && <Roadmap plan={plan} editable={editable} set={state.setPlan} />}
        {shown === 'board' && <Board plan={plan} editable={editable} set={state.setPlan} />}
        {shown === 'topics' && <Topics plan={plan} editable={editable} set={state.setPlan} />}
        {shown === 'timeline' && <Timeline plan={plan} editable={editable} set={state.setPlan} />}
        {shown === 'notes' && <Notes plan={plan} editable={editable} set={state.setPlan} />}
      </div>
    </div>
  )
}

export function PlaygroundHeader({ title, badge, state, onTitle, tabs }: {
  title: string; badge: 'draft' | 'building' | 'live'; state?: DraftState; onTitle?: (t: string) => void; tabs?: React.ReactNode
}) {
  return (
    <div className="space-y-3 border-b border-white/8 px-4 pb-3 pt-4 sm:px-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className={cn('mb-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
            badge === 'live' ? 'bg-action-soft text-action-ink' : 'bg-white/6 text-foreground/70')} data-badge={badge}>
            <span aria-hidden className={cn('size-1.5 rounded-full', badge === 'live' ? 'bg-action' : 'bg-amber-400')} />
            {badge === 'live' ? 'Live workspace' : badge === 'building' ? 'Building…' : `Draft · not created yet${state?.draft ? ` · version ${state.draft.version}` : ''}`}
          </p>
          {onTitle
            ? <input aria-label="Workspace name" value={title} maxLength={80} onChange={e => onTitle(e.target.value)} className={cn(FIELD, '-ml-1.5 text-lg font-semibold tracking-tight')} />
            : <h2 className="truncate text-lg font-semibold tracking-tight text-foreground">{title}</h2>}
        </div>
        {state && <SaveIndicator state={state} />}
      </div>
      {tabs}
    </div>
  )
}

function SaveIndicator({ state }: { state: DraftState }) {
  if (state.save === 'saving') return <span role="status" className="mt-1 shrink-0 text-xs text-subtle">Saving…</span>
  if (state.save === 'saved') return <span role="status" className="mt-1 shrink-0 text-xs text-subtle">Saved as version {state.draft?.version}</span>
  if (state.save === 'error') return <span role="alert" className="mt-1 max-w-[12rem] shrink-0 text-right text-xs text-red-400">{state.saveError ?? "Not saved."}</span>
  return null
}
