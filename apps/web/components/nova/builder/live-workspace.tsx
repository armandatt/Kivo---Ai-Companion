'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, Sparkles } from 'lucide-react'
import type { ChangeSet, ProposedChange, WorkspaceDetail } from '@repo/api/nova/product/builder.types'
import { treeOrder } from '@repo/api/nova/product/task-tree'
import { cn } from '@/lib/utils'
import { patchTask } from './builder-api'
import { changeMarks, hintFor, nestRows, subjectOutline, topicOutline, wordsFor, type ChangeMarks, type Nested, type SubjectRow, type Words } from './builder-view'
import type { PlaygroundView } from './plan-edit'
import { NovaHint, PlaygroundHeader, TITLE_AREA, TreeGuides, ViewTabs } from './playground'
import { ProposalActions } from './proposal-actions'
import type { DraftState } from './use-draft'

// What a conversation works on when it is something the learner already
// has: the real tasks, topics, notes and dates, read back from their owners
// on every view of the draft (DraftView.current), so this is what is stored.
// Nova's proposed changes (DraftView.changes) are drawn on those records,
// marked as proposals, and listed above them to keep or leave out; nothing
// changes until the learner approves. A task is changed here through the
// Planner's own route, so the board, Today and the calendar see the same.

type Task = WorkspaceDetail['tasks'][number]
const COLUMNS: Array<{ status: Task['status']; label: string }> = [{ status: 'todo', label: 'To do' }, { status: 'in_progress', label: 'In progress' }, { status: 'done', label: 'Done' }]
const CARD = 'rounded-xl border border-white/8 bg-card/70'
const FIELD = 'w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm text-foreground outline-none transition-colors hover:border-white/10 focus:border-action/70 focus:bg-background/60'
const PROPOSED = 'border-dashed border-nova/50 bg-nova/6'
const H = 'text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle'

function Proposed({ children }: { children: React.ReactNode }) {
  return <span className="ml-1.5 rounded bg-nova/12 px-1.5 py-0.5 text-[10px] font-medium text-nova-ink">{children}</span>
}

// The proposed changes, to keep or leave out one by one. Leaving one out is
// saved at once (a new version); approving applies what is listed.
function ChangeList({ state }: { state: DraftState }) {
  const set = state.draft?.changes
  if (!set) return null
  const editable = state.draft?.status === 'awaiting_approval' && !state.working
  const groups: Array<{ effect: ProposedChange['effect']; label: string }> = [{ effect: 'add', label: 'Adds' }, { effect: 'change', label: 'Changes' }, { effect: 'remove', label: 'Removes' }]
  const drop = (id: string) => void state.keepChanges(set.ops.filter(o => o.id !== id).map(o => o.id))
  return (
    <section aria-labelledby="pg-changes" className="mb-4 rounded-xl border border-nova/30 bg-nova/5 p-3" data-changes-list>
      <h3 id="pg-changes" className="flex items-center gap-1.5 text-xs font-semibold text-foreground"><Sparkles aria-hidden className="size-3.5 text-nova-ink" /> Proposed changes · v{state.draft!.version}</h3>
      <p className="mt-0.5 text-[11px] text-subtle">Marked below on your records. Everything else stays as it is; nothing changes until you approve.</p>
      {groups.map(g => {
        const ops = set.ops.filter(o => o.effect === g.effect)
        if (ops.length === 0) return null
        return (
          <div key={g.effect} className="mt-2.5">
            <p className={H}>{g.label}</p>
            <ul className="mt-1 space-y-1">
              {ops.map(o => (
                <li key={o.id} className="flex items-start gap-2 text-sm" data-change={o.op}>
                  <span aria-hidden className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', g.effect === 'add' ? 'bg-action' : g.effect === 'change' ? 'bg-amber-400' : 'bg-red-400')} />
                  <span className="min-w-0 flex-1 text-foreground/85">{o.says}{o.why && <span className="block text-[11px] text-subtle">{o.why}</span>}</span>
                  {editable && <button type="button" onClick={() => drop(o.id)} className="shrink-0 rounded px-1.5 text-[11px] font-medium text-subtle hover:bg-white/6 hover:text-foreground" aria-label={`Leave out: ${o.says}`}>Leave out</button>}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
      {set.dropped.length > 0 && <p className="mt-2.5 text-[11px] text-subtle" data-dropped>Left out by Kivo: {set.dropped.slice(0, 4).join('; ')}.</p>}
    </section>
  )
}

const STATUS_LABEL: Record<Task['status'], string> = { todo: 'To do', in_progress: 'In progress', done: 'Done' }
const same = (a: string | null | undefined, b: string | null | undefined) => a != null && b != null && a.toLocaleLowerCase() === b.toLocaleLowerCase()

// A task with its progress, moved through To do → In progress → Done here.
// Indented under the task it is a step of; its priority is the learner's to set here.
function LiveTaskRow({ t, depth, marks, onChange }: { t: Task; depth: number; marks: ChangeMarks; onChange: (patch: Partial<Task>) => Promise<void> }) {
  const [title, setTitle] = useState(t.title)
  useEffect(() => setTitle(t.title), [t.title])
  const i = COLUMNS.findIndex(c => c.status === t.status)
  const removed = marks.removedTasks.has(t.id)
  const changed = marks.changedTasks.get(t.id)
  const first = marks.firstTasks.indexOf(t.id)
  return (
    <li className={cn(CARD, 'p-2', removed && 'opacity-60', (changed || first >= 0) && 'border-nova/40', t.status === 'done' && 'opacity-75')} style={{ marginLeft: depth * 16 }} data-live-task={t.id} data-depth={depth}>
      <textarea aria-label="Task title" value={title} maxLength={160} rows={1} onChange={e => setTitle(e.target.value.split('\n').join(' '))}
        onBlur={() => { if (title.trim() && title !== t.title) void onChange({ title: title.trim() }) }} className={cn(FIELD, TITLE_AREA, (removed || t.status === 'done') && 'line-through')} />
      <div className="flex flex-wrap items-center gap-1.5 px-1.5 pt-1 text-[11px] text-subtle">
        <span className={cn('rounded px-1.5 py-0.5 font-medium', t.status === 'done' ? 'bg-action-soft text-action-ink' : t.status === 'in_progress' ? 'bg-amber-400/12 text-amber-300' : 'bg-white/5')}>{STATUS_LABEL[t.status]}</span>
        <label className="sr-only" htmlFor={`live-prio-${t.id}`}>Priority of {t.title}</label>
        <select id={`live-prio-${t.id}`} value={t.priority ?? ''} onChange={e => void onChange({ priority: (e.target.value || null) as Task['priority'] })}
          className={cn('h-6 rounded-md border px-1 text-[11px] font-medium', t.priority === 'high' ? 'border-amber-400/40 bg-amber-400/12 text-amber-200' : t.priority ? 'border-white/12 bg-white/5' : 'border-white/10 bg-background text-subtle')}>
          <option value="">No priority</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
        {t.dueDay && <span className="rounded bg-white/5 px-1.5 py-0.5 tabular-nums">due {t.dueDay}</span>}
        {t.estimatedMinutes && <span>~{t.estimatedMinutes} min</span>}
        {changed && <Proposed>→ {changed}</Proposed>}
        {first >= 0 && <Proposed>first #{first + 1}</Proposed>}
        {removed && <Proposed>to be removed</Proposed>}
        <span className="ml-auto flex gap-0.5">
          <button type="button" disabled={i === 0} onClick={() => void onChange({ status: COLUMNS[i - 1]!.status })} aria-label={`Move ${t.title} to ${COLUMNS[i - 1]?.label ?? ''}`}
            className="grid size-6 place-items-center rounded text-foreground/55 hover:bg-white/6 hover:text-foreground disabled:opacity-25"><ArrowLeft aria-hidden className="size-3" /></button>
          <button type="button" disabled={i === COLUMNS.length - 1} onClick={() => void onChange({ status: COLUMNS[i + 1]!.status })} aria-label={`Move ${t.title} to ${COLUMNS[i + 1]?.label ?? ''}`}
            className="grid size-6 place-items-center rounded text-foreground/55 hover:bg-white/6 hover:text-foreground disabled:opacity-25"><ArrowRight aria-hidden className="size-3" /></button>
        </span>
      </div>
    </li>
  )
}

// A subject in the overview, with what sits inside it within it.
function OutlineLine({ node, words }: { node: Nested<SubjectRow>; words: Words }) {
  const r = node.row
  return (
    <li className={cn(r.depth === 0 ? cn(CARD, 'px-3 py-2') : 'py-1', r.proposed && cn(PROPOSED, 'rounded-lg px-2'), r.removed && 'opacity-60')} data-subject-depth={r.depth}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn('min-w-0 truncate text-sm font-medium text-foreground', r.removed && 'line-through')}>{r.proposed ? '+ ' : ''}{r.name}{r.renamed && <span className="text-nova-ink"> → {r.renamed}</span>}{r.proposed && <Proposed>new</Proposed>}{r.moved && <Proposed>{r.under ? `moves inside ${r.under}` : 'moves out, on its own'}</Proposed>}{r.removed && <Proposed>to be removed</Proposed>}</span>
        <span className="shrink-0 text-xs text-subtle">{r.inside ? `${r.inside} ${r.inside === 1 ? words.area : `${words.area}s`}${r.topics ? ' · ' : ''}` : ''}{r.inside && !r.topics ? '' : `${r.topics}${r.addedTopics ? ` + ${r.addedTopics}` : ''} ${words.topic}s`}</span>
      </div>
      {node.inside.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 border-l-2 border-nova/25 pl-3" aria-label={`Inside ${r.renamed ?? r.name}`} data-subject-children>
          {node.inside.map(c => <OutlineLine key={c.row.key} node={c} words={words} />)}
        </ul>
      )}
    </li>
  )
}

// A live subject with its topics as they will stand once the proposed changes
// apply (topicOutline): new ones and moved ones drawn where they go, marked;
// the subjects inside it drawn within it.
function LiveSubject({ node, detail, marks, changes, words }: { node: Nested<SubjectRow>; detail: WorkspaceDetail; marks: ChangeMarks; changes: ChangeSet | null; words: Words }) {
  const r = node.row
  const s = r.id ? detail.subjects.find(x => x.id === r.id) : undefined
  const added = !s ? marks.addedSubjects.find(a => `+${a.key ?? a.name}` === r.key) : undefined
  const inside = node.inside.length > 0 && (
    <div className="mt-3 space-y-2 border-l-2 border-nova/25 pl-3" data-subject-children>
      <p className={H}>Inside {r.renamed ?? r.name}</p>
      {node.inside.map(c => <LiveSubject key={c.row.key} node={c} detail={detail} marks={marks} changes={changes} words={words} />)}
    </div>
  )
  const box = r.depth === 0 ? cn(CARD, 'p-3') : 'rounded-lg border border-white/8 bg-background/40 p-2.5'
  if (added) return (
    <section className={cn(box, PROPOSED)} data-subject-depth={r.depth} aria-label={added.name}>
      <h3 className="text-sm font-medium text-foreground">+ {added.name}<Proposed>{r.under ? `new, inside ${r.under}` : 'new'}</Proposed></h3>
      {added.topics.length > 0 && <ul className="mt-2 flex flex-wrap gap-1.5">{added.topics.map(t => <li key={t} className="rounded-full border border-dashed border-nova/40 px-2.5 py-0.5 text-xs text-foreground/80">{t}</li>)}</ul>}
      {inside}
    </section>
  )
  if (!s) return null
  const rows = topicOutline(s, changes)
  return (
    <section className={cn(box, marks.removedSubjects.has(s.id) && 'border-red-400/40 opacity-60')} data-subject-depth={r.depth} aria-label={s.name}>
      <div className="flex items-center justify-between gap-2"><h3 className={cn('text-sm font-medium text-foreground', marks.removedSubjects.has(s.id) && 'line-through')}>{s.name}{r.renamed && <span className="text-nova-ink"> → {r.renamed}</span>}{r.moved && <Proposed>{r.under ? `moves inside ${r.under}` : 'moves out, on its own'}</Proposed>}{marks.removedSubjects.has(s.id) && <Proposed>to be removed</Proposed>}</h3><Link href={`/map?focus=${encodeURIComponent(`subject:${s.id}`)}`} className="text-xs font-medium text-foreground/60 hover:text-foreground">On the map</Link></div>
      {rows.length > 0 && (
        <ol className="mt-2" data-topic-tree>
          {rows.map(t => (
            <li key={t.key} className={cn('relative py-0.5', t.state === 'added' && 'rounded-md bg-nova/6', t.state === 'moved' && 'rounded-md bg-amber-300/6')} style={{ paddingLeft: t.depth * 16 }} data-topic-depth={t.depth} data-topic-state={t.state}>
              <TreeGuides depth={t.depth} />
              <span className="relative">
                {t.id
                  ? <Link href={`/knowledge?topic=${t.id}`} className={cn('text-sm hover:underline', t.holds || t.kind === 'milestone' ? 'font-medium text-foreground' : 'text-foreground/85', t.state === 'removed' && 'line-through opacity-60')}>{t.kind === 'milestone' && <span className="mr-1 text-[10px] uppercase tracking-wide text-nova-ink">{words.phase}</span>}{t.name}</Link>
                  : <span className={cn('text-sm', t.holds || t.kind === 'milestone' ? 'font-medium text-foreground' : 'text-foreground/85')}>+ {t.kind === 'milestone' && <span className="mr-1 text-[10px] uppercase tracking-wide text-nova-ink">{words.phase}</span>}{t.name}</span>}
                {t.renamed && <span className="text-sm text-nova-ink"> → {t.renamed}</span>}
                {t.state === 'added' && <Proposed>new</Proposed>}
                {t.state === 'moved' && <Proposed>moved here from {t.was}</Proposed>}
                {t.state === 'removed' && <Proposed>to be removed</Proposed>}
              </span>
            </li>
          ))}
        </ol>
      )}
      {r.inside > 0 && rows.length === 0 && node.inside.length === 0 && <p className="mt-1 text-xs text-subtle">{r.inside} {r.inside === 1 ? words.area : `${words.area}s`} inside it</p>}
      {inside}
    </section>
  )
}

export function LiveWorkspace({ view, onView, state, onAsk }: {
  view: PlaygroundView; onView: (v: PlaygroundView) => void; state: DraftState; onAsk: (text: string) => void
}) {
  const detail = state.draft?.current
  const [error, setError] = useState<string | null>(null)
  if (!detail) return null
  const marks = changeMarks(state.draft?.changes ?? null)

  const change = async (id: string, patch: Partial<Task>) => {
    setError(null)
    const res = await patchTask(id, patch)
    if (!res.ok) setError(res.message)
    await state.reload()
  }

  // The same views as the proposal it was built from, on the live records:
  // its milestones are its topics of kind milestone, each with its own details.
  const phases = detail.subjects.flatMap(s => s.topics.filter(t => t.kind === 'milestone').map(t => ({ name: t.name, weeks: t.details?.weeks ?? null, goals: t.details?.goals ?? [], completion: t.details?.completion ?? null })))
  const views: PlaygroundView[] = ['overview', ...(phases.length ? ['roadmap' as const] : []), 'board', 'topics', 'timeline', 'notes']
  const shown = views.includes(view) ? view : 'overview'
  // Tasks under each milestone, in the plan's order, then the rest.
  const groups = [
    ...phases.map((p, i) => ({ name: p.name as string | null, index: i as number | null, phase: p, tasks: detail.tasks.filter(t => same(t.topicName, p.name)) })),
    { name: null, index: null, phase: null, tasks: detail.tasks.filter(t => !phases.some(p => same(t.topicName, p.name))) },
  ].filter(g => g.name !== null || g.tasks.length > 0 || marks.addedTasks.some(a => !phases.some(p => same(a.topicName, p.name))))
  const proposedIn = (name: string | null) => marks.addedTasks.filter(a => (name === null ? !phases.some(p => same(a.topicName, p.name)) : same(a.topicName, name)))
  const days = [
    ...detail.dates.map(d => ({ day: marks.movedDates.get(d.id) ?? d.day, was: marks.movedDates.has(d.id) ? d.day : null, label: d.title, kind: 'date' as const, proposed: false, removed: marks.removedDates.has(d.id) })),
    ...detail.tasks.filter(t => t.dueDay && t.status !== 'done').map(t => ({ day: t.dueDay!, was: null, label: t.title, kind: 'task' as const, proposed: false, removed: marks.removedTasks.has(t.id) })),
    ...marks.addedDates.map(d => ({ day: d.day, was: null, label: d.title, kind: 'date' as const, proposed: true, removed: false })),
  ].sort((a, b) => a.day.localeCompare(b.day))
  const done = detail.tasks.filter(t => t.status === 'done').length
  const words = wordsFor(state.draft?.brief.kind)
  const topics = detail.subjects.reduce((n, s) => n + s.topics.filter(t => t.kind !== 'milestone').length, 0)
  // The subjects as they will sit once the proposed changes apply, a subject under the one it is inside.
  const outline = subjectOutline(detail, marks)
  const nested = outline.some(r => r.depth > 0)
  const stats = [phases.length ? `${phases.length} ${phases.length === 1 ? words.phase : words.phases.toLowerCase()}` : null, `${done} of ${detail.tasks.length} task${detail.tasks.length === 1 ? '' : 's'} done`, topics ? `${topics} ${topics === 1 ? words.topic : `${words.topic}s`}` : null, detail.dates.length ? `${detail.dates.length} date${detail.dates.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')
  const talking = state.draft && ['discovery', 'awaiting_approval', 'failed', 'ready'].includes(state.draft.status)
  const progress = (tasks: Task[]) => `${tasks.filter(t => t.status === 'done').length}/${tasks.length} done`

  return (
    <div className="flex h-full min-h-0 flex-col" data-live-workspace>
      <PlaygroundHeader title={detail.title} badge="live" state={state} stats={stats} tabs={<ViewTabs views={views} view={shown} onView={onView} label="Workspace views" names={words.views} />} />
      <div id="pg-panel" role="tabpanel" aria-labelledby={`pg-tab-${shown}`} className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-3 sm:px-5">
        {error && <p role="alert" className="mb-3 text-sm text-red-400">{error}</p>}
        <ChangeList state={state} />
        {talking && <div className="-mx-2 mb-3"><NovaHint hint={hintFor(state.draft?.brief.kind, shown)} onAsk={onAsk} /></div>}
        {shown === 'overview' && (
          <div className="space-y-6">
            {detail.workspace?.summary && (
              <div><p className={H}>What it&apos;s for</p><p className="mt-1.5 text-sm leading-relaxed text-foreground/85">{detail.workspace.summary}</p></div>
            )}
            {phases.length > 0 ? (
              <section aria-labelledby="live-outline">
                <div className="flex items-baseline justify-between"><h3 id="live-outline" className={H}>{words.phases}</h3><button type="button" onClick={() => onView('roadmap')} className="text-xs font-medium text-foreground/60 hover:text-foreground">Open</button></div>
                <ol className="mt-2 space-y-1.5">
                  {groups.filter(g => g.index !== null).map(g => (
                    <li key={g.name} className={cn(CARD, 'flex items-center gap-3 px-3 py-2')}>
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-nova/12 text-[11px] font-semibold text-nova-ink">{g.index! + 1}</span>
                      <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{g.name}</span>
                      <span className="shrink-0 text-xs text-subtle">{g.tasks.length ? progress(g.tasks) : 'no tasks'}{proposedIn(g.name).length ? ` · +${proposedIn(g.name).length}` : ''}</span>
                    </li>
                  ))}
                </ol>
              </section>
            ) : (
              <section aria-labelledby="live-outline">
                <div className="flex items-baseline justify-between"><h3 id="live-outline" className={H}>{words.areas}</h3><button type="button" onClick={() => onView('topics')} className="text-xs font-medium text-foreground/60 hover:text-foreground">Open</button></div>
                {/* A subject inside another is drawn inside it, as it will be once the changes apply. */}
                <ul className={cn('mt-2 gap-1.5', nested ? 'flex flex-col' : 'grid sm:grid-cols-2')}>
                  {nestRows(outline).map(node => <OutlineLine key={node.row.key} node={node} words={words} />)}
                </ul>
              </section>
            )}
            {days.length > 0 && (
              <section aria-labelledby="live-soon">
                <div className="flex items-baseline justify-between"><h3 id="live-soon" className={H}>Coming up</h3><button type="button" onClick={() => onView('timeline')} className="text-xs font-medium text-foreground/60 hover:text-foreground">Calendar</button></div>
                <ul className="mt-2 space-y-1">{days.slice(0, 3).map((d, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm"><span className="w-24 shrink-0 text-xs tabular-nums text-subtle">{d.day}</span><span aria-hidden className={cn('size-2 shrink-0 rounded-full', d.kind === 'date' ? 'bg-amber-400' : 'bg-action')} /><span className="min-w-0 truncate text-foreground/85">{d.label}</span></li>
                ))}</ul>
              </section>
            )}
            <p className="text-xs text-subtle">These are your real records: changing a task here changes it on your Planner board too.</p>
          </div>
        )}
        {shown === 'roadmap' && (
          <ol className="space-y-3">
            {groups.filter(g => g.index !== null).map(g => (
              <li key={g.name} className={cn(CARD, 'p-3')} data-milestone={g.index}>
                <div className="flex items-center gap-2">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-nova/12 text-[11px] font-semibold text-nova-ink">{g.index! + 1}</span>
                  <p className="min-w-0 flex-1 text-sm font-medium text-foreground">{g.name}</p>
                  <span className="shrink-0 text-xs text-subtle">{g.tasks.length ? progress(g.tasks) : ''}</span>
                </div>
                {(g.phase!.weeks || g.phase!.goals.length > 0) && <p className="mt-1 pl-8 text-xs leading-relaxed text-foreground/65">{g.phase!.weeks ? `≈ ${g.phase!.weeks} week${g.phase!.weeks === 1 ? '' : 's'}` : ''}{g.phase!.weeks && g.phase!.goals.length ? ' — ' : ''}{g.phase!.goals.join(' · ')}</p>}
                {g.phase!.completion && <p className="mt-1 pl-8 text-[11px] text-subtle">Done when {g.phase!.completion}</p>}
                {(g.tasks.length > 0 || proposedIn(g.name).length > 0) && (
                  <ul className="ml-3 mt-2 space-y-1 border-l border-white/8 pl-4">
                    {treeOrder(g.tasks.map(t => ({ ...t, parent: t.parentId }))).map(({ item: t, depth }) => <li key={t.id} style={{ marginLeft: depth * 14 }} data-depth={depth} className={cn('flex items-center gap-2 text-sm text-foreground/80', t.status === 'done' && 'text-subtle line-through', marks.removedTasks.has(t.id) && 'opacity-60 line-through')}><span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', t.status === 'done' ? 'bg-action' : t.status === 'in_progress' ? 'bg-amber-400' : 'bg-foreground/30')} />{t.title}{marks.changedTasks.get(t.id) && <Proposed>→ {marks.changedTasks.get(t.id)}</Proposed>}</li>)}
                    {proposedIn(g.name).map(a => <li key={a.key} className="text-sm text-foreground/85">+ {a.title}<Proposed>proposed</Proposed></li>)}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
        {shown === 'board' && (
          <div className="space-y-4">
            {groups.filter(g => g.tasks.length > 0 || proposedIn(g.name).length > 0).map(g => (
              <section key={g.name ?? '—'} aria-label={g.name ?? 'Other tasks'}>
                <h3 className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold text-foreground/85">
                  {g.index !== null && <span className="grid size-5 place-items-center rounded-full bg-nova/12 text-[10px] text-nova-ink">{g.index + 1}</span>}
                  <span className="min-w-0 flex-1">{g.name ?? (phases.length ? 'Other tasks' : 'Tasks')}</span>
                  <span className="font-normal text-subtle">{g.tasks.length ? progress(g.tasks) : ''}</span>
                </h3>
                <ul className="space-y-2">
                  {treeOrder(g.tasks.map(t => ({ ...t, parent: t.parentId }))).map(({ item: t, depth }) => <LiveTaskRow key={t.id} t={t} depth={depth} marks={marks} onChange={patch => change(t.id, patch)} />)}
                  {proposedIn(g.name).map(a => (
                    <li key={a.key} className={cn(CARD, PROPOSED, 'p-2 text-sm text-foreground/85')} data-proposed-task>+ {a.title}<span className="mt-0.5 block text-[11px] text-subtle">{a.parentId ? `a step of ${detail.tasks.find(x => x.id === a.parentId)?.title ?? 'a task'} · ` : a.parentKey ? `a step of ${marks.addedTasks.find(x => x.key === a.parentKey)?.title ?? 'a new task'} · ` : ''}{a.dueDay ? `due ${a.dueDay}` : 'no due day'}{a.priority ? ` · ${a.priority}` : ''}</span><Proposed>proposed</Proposed></li>
                  ))}
                </ul>
              </section>
            ))}
            {detail.tasks.length === 0 && marks.addedTasks.length === 0 && <p className="text-sm text-foreground/65">No tasks here. <Link href="/planner?view=board" className="underline underline-offset-4">Open the board</Link></p>}
          </div>
        )}
        {shown === 'topics' && (
          <div className="space-y-3">
            {nestRows(outline).map(node => <LiveSubject key={node.row.key} node={node} detail={detail} marks={marks} changes={state.draft?.changes ?? null} words={words} />)}
            {detail.subjects.length === 0 && <p className="text-sm text-foreground/65">Its subjects were removed in Knowledge.</p>}
          </div>
        )}
        {shown === 'timeline' && (
          days.length === 0 ? <p className="text-sm text-foreground/65">Nothing dated yet. Give tasks a due day on the board, or add a date on the <Link href="/calendar" className="underline underline-offset-4">calendar</Link>.</p> : (
            <ol className="space-y-2">{days.map((d, i) => (
              <li key={i} className={cn('flex items-center gap-3 rounded-lg px-1 text-sm', d.proposed && PROPOSED)}><span className="w-24 shrink-0 text-xs tabular-nums text-subtle">{d.day}</span><span aria-hidden className={cn('size-2 rounded-full', d.kind === 'date' ? 'bg-amber-400' : 'bg-action')} /><span className={cn('text-foreground/85', d.removed && 'line-through opacity-60')}>{d.label}{d.was && <Proposed>moved from {d.was}</Proposed>}{d.proposed && <Proposed>proposed</Proposed>}{d.removed && <Proposed>to be removed</Proposed>}</span></li>
            ))}</ol>
          )
        )}
        {shown === 'notes' && (
          <ul className="space-y-1.5">
            {detail.notes.map(n => <li key={n.id}><Link href={`/notes/${n.id}`} className={cn(CARD, 'block px-3 py-2 text-sm text-foreground/85 hover:border-white/20', marks.removedNotes.has(n.id) && 'border-red-400/40 line-through opacity-60')}>{n.title}{marks.removedNotes.has(n.id) && <Proposed>to be removed</Proposed>}</Link></li>)}
            {marks.addedNotes.map(n => <li key={n.title} className={cn(CARD, PROPOSED, 'px-3 py-2 text-sm text-foreground/85')}>+ {n.title}<Proposed>proposed</Proposed></li>)}
            {detail.notes.length === 0 && marks.addedNotes.length === 0 && <p className="text-sm text-foreground/65">No notes filed under these subjects.</p>}
          </ul>
        )}
      </div>
      <ProposalActions state={state} words={words} onEdit={() => onView('board')} onAsk={onAsk} />
    </div>
  )
}
