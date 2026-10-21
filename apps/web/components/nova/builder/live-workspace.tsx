'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, Sparkles } from 'lucide-react'
import type { WorkspaceDetail } from '@repo/api/nova/product/builder.types'
import { LoadFailed, Skeleton } from '@/components/nova/workspace/ui'
import { cn } from '@/lib/utils'
import { loadWorkspaceDetail, patchTask } from './builder-api'
import { wordsFor } from './builder-view'
import type { PlaygroundView } from './plan-edit'
import { PlaygroundHeader, TITLE_AREA, ViewTabs } from './playground'
import { ProposalActions } from './proposal-actions'
import type { DraftState } from './use-draft'

// After approval the playground shows the workspace as it now is in Kivo:
// the real tasks, topics, notes and dates, read back from their owners.
// A task is changed here through the Planner's own route, so the board,
// Today and the calendar see the same change. Nova can add to it (Improve
// with Nova starts a conversation about it); it does not change or remove
// what is here, so the page does not offer that.

type Task = WorkspaceDetail['tasks'][number]
const COLUMNS: Array<{ status: Task['status']; label: string }> = [{ status: 'todo', label: 'To do' }, { status: 'in_progress', label: 'In progress' }, { status: 'done', label: 'Done' }]
const CARD = 'rounded-xl border border-white/8 bg-card/60'
const FIELD = 'w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm text-foreground outline-none transition-colors hover:border-white/10 focus:border-action/70 focus:bg-background/60'

function LiveTask({ t, onChange }: { t: Task; onChange: (patch: Partial<Task>) => Promise<void> }) {
  const [title, setTitle] = useState(t.title)
  useEffect(() => setTitle(t.title), [t.title])
  const i = COLUMNS.findIndex(c => c.status === t.status)
  return (
    <li className={cn(CARD, 'p-2')} data-live-task={t.id}>
      <textarea aria-label="Task title" value={title} maxLength={160} rows={2} onChange={e => setTitle(e.target.value.split('\n').join(' '))}
        onBlur={() => { if (title.trim() && title !== t.title) void onChange({ title: title.trim() }) }} className={cn(FIELD, TITLE_AREA)} />
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1 pt-1 text-[11px] text-subtle">
        {t.topicName && <span className="min-w-0 break-words">{t.topicName}</span>}
        {t.dueDay && <span className="whitespace-nowrap">due {t.dueDay}</span>}
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

export function LiveWorkspace({ workspaceId, view, onView, state, onAsk, onImprove }: {
  workspaceId: string; view: PlaygroundView; onView: (v: PlaygroundView) => void; state: DraftState; onAsk: (text: string) => void; onImprove: () => void
}) {
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null)
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await loadWorkspaceDetail(workspaceId)
    if (res.ok) { setDetail(res.detail); setFailed(false) } else setFailed(true)
  }, [workspaceId])
  useEffect(() => { void load() }, [load])

  const change = useCallback(async (id: string, patch: Partial<Task>) => {
    setError(null)
    // Shown at once; read back from the server either way.
    setDetail(d => (d ? { ...d, tasks: d.tasks.map(t => (t.id === id ? { ...t, ...patch } : t)) } : d))
    const res = await patchTask(id, patch)
    if (!res.ok) setError(res.message)
    await load()
  }, [load])

  if (failed && !detail) return <div className="p-5"><LoadFailed what="The workspace" onRetry={() => void load()} /></div>
  if (!detail) return <div className="space-y-3 p-5" aria-busy="true" aria-label="Loading the workspace"><Skeleton className="h-8 w-56" /><Skeleton className="h-40" /></div>

  const views: PlaygroundView[] = ['overview', 'board', 'topics', 'timeline', 'notes']
  const shown = views.includes(view) ? view : 'overview'
  const days = [...detail.dates.map(d => ({ day: d.day, label: d.title, kind: 'date' as const })), ...detail.tasks.filter(t => t.dueDay).map(t => ({ day: t.dueDay!, label: t.title, kind: 'task' as const }))].sort((a, b) => a.day.localeCompare(b.day))
  const done = detail.tasks.filter(t => t.status === 'done').length
  const words = wordsFor(state.draft?.brief.kind)
  const topics = detail.subjects.reduce((n, s) => n + s.topics.length, 0)
  const stats = [`${done} of ${detail.tasks.length} task${detail.tasks.length === 1 ? '' : 's'} done`, topics ? `${topics} ${topics === 1 ? words.topic : `${words.topic}s`}` : null, detail.notes.length ? `${detail.notes.length} note${detail.notes.length === 1 ? '' : 's'}` : null, detail.dates.length ? `${detail.dates.length} date${detail.dates.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')

  return (
    <div className="flex h-full min-h-0 flex-col" data-live-workspace>
      <PlaygroundHeader title={detail.workspace.title} badge="live" stats={stats} tabs={<ViewTabs views={views} view={shown} onView={onView} label="Workspace views" names={words.views} />} />
      <div id="pg-panel" role="tabpanel" aria-labelledby={`pg-tab-${shown}`} className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-3 sm:px-5">
        {error && <p role="alert" className="mb-3 text-sm text-red-400">{error}</p>}
        <button type="button" onClick={onImprove} data-hint
          className="group -mx-2 mb-3 flex w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-subtle transition-colors hover:bg-nova/6 hover:text-foreground/85">
          <Sparkles aria-hidden className="size-3.5 shrink-0 text-nova-ink" />
          <span className="min-w-0 flex-1">Ask Nova to add to this workspace. To change or remove what&apos;s here, edit it here or where it lives.</span>
        </button>
        {shown === 'overview' && (
          <div className="space-y-5">
            {detail.workspace.summary && <p className="text-sm leading-relaxed text-foreground/80">{detail.workspace.summary}</p>}
            <p className="text-xs text-subtle">These are your real records. Changing a task here changes it on your Planner board too.</p>
          </div>
        )}
        {shown === 'board' && (
          <div className="grid gap-3 md:grid-cols-3">
            {COLUMNS.map(c => (
              <section key={c.status} aria-label={c.label} className="rounded-xl bg-white/[0.025] p-2.5">
                <h3 className="mb-2 flex justify-between px-1 text-xs font-semibold text-foreground/80">{c.label}<span className="font-normal text-subtle">{detail.tasks.filter(t => t.status === c.status).length}</span></h3>
                <ul className="space-y-2">{detail.tasks.filter(t => t.status === c.status).map(t => <LiveTask key={t.id} t={t} onChange={patch => change(t.id, patch)} />)}</ul>
              </section>
            ))}
            {detail.tasks.length === 0 && <p className="text-sm text-foreground/65 md:col-span-3">No tasks from this workspace are left. <Link href="/planner?view=board" className="underline underline-offset-4">Open the board</Link></p>}
          </div>
        )}
        {shown === 'topics' && (
          <div className="space-y-3">
            {detail.subjects.map(s => (
              <section key={s.id} className={cn(CARD, 'p-3')}>
                <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium text-foreground">{s.name}</h3><Link href={`/knowledge?subject=${s.id}`} className="text-xs font-medium text-foreground/60 hover:text-foreground">Open in Knowledge</Link></div>
                <ul className="mt-2 flex flex-wrap gap-1.5">{s.topics.map(t => <li key={t.id}><Link href={`/knowledge?topic=${t.id}`} className="block rounded-full border border-white/10 px-2.5 py-0.5 text-xs text-foreground/80 hover:border-white/25">{t.name}</Link></li>)}</ul>
              </section>
            ))}
            {detail.subjects.length === 0 && <p className="text-sm text-foreground/65">Its subjects were removed in Knowledge.</p>}
          </div>
        )}
        {shown === 'timeline' && (
          days.length === 0 ? <p className="text-sm text-foreground/65">Nothing dated yet. Give tasks a due day on the board, or add a date on the <Link href="/calendar" className="underline underline-offset-4">calendar</Link>.</p> : (
            <ol className="space-y-2">{days.map((d, i) => (
              <li key={i} className="flex items-center gap-3 text-sm"><span className="w-24 shrink-0 text-xs tabular-nums text-subtle">{d.day}</span><span aria-hidden className={cn('size-2 rounded-full', d.kind === 'date' ? 'bg-amber-400' : 'bg-action')} /><span className="text-foreground/85">{d.label}</span></li>
            ))}</ol>
          )
        )}
        {shown === 'notes' && (
          <ul className="space-y-1.5">
            {detail.notes.map(n => <li key={n.id}><Link href={`/notes/${n.id}`} className={cn(CARD, 'block px-3 py-2 text-sm text-foreground/85 hover:border-white/20')}>{n.title}</Link></li>)}
            {detail.notes.length === 0 && <p className="text-sm text-foreground/65">No notes filed under this workspace&apos;s subjects.</p>}
          </ul>
        )}
      </div>
      <ProposalActions state={state} words={words} onEdit={() => onView('board')} onAsk={onAsk} onImprove={onImprove} />
    </div>
  )
}
