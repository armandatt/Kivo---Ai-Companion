'use client'

import { useRef, useState } from 'react'
import { milestones, removePhase } from '../builder/plan-edit'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, Check, FileText, Loader2, X } from 'lucide-react'
import { planCounts, type WorkspacePlan } from '@repo/api/nova/product/workspace-plan'
import type { WorkspaceCounts, WorkspaceSummary } from '@repo/api/nova/product/workspaces.types'
import { BUTTON_PRIMARY, BUTTON_QUIET } from '@/components/nova/workspace/ui'
import { cn } from '@/lib/utils'
import { createWorkspace, newClientKey } from './templates-api'
import { BOARD_PATH } from '@repo/api/nova/product/companion'

// A proposed workspace, before anything exists: what it will create, where
// it came from, and what was assumed. The learner trims it (rename, remove)
// and presses Create; the server checks it again and makes it in one go.
// Nothing here is saved until then.

export const ROUTE_LABEL: Record<'use' | 'adapt' | 'custom', string> = {
  use:    'Kio template',
  adapt:  'Kio template, personalised by Nova',
  custom: 'Designed by Nova',
}

const FIELD = 'h-9 w-full rounded-lg border border-white/12 bg-background/60 px-2.5 text-sm text-foreground outline-none focus:border-action'
const SECTION = 'border-t border-white/8 pt-4'
const H = 'text-xs font-semibold uppercase tracking-[0.12em] text-foreground/55'

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={`Remove ${label}`} className="grid size-7 shrink-0 place-items-center rounded-md text-foreground/50 transition-colors hover:bg-white/6 hover:text-foreground">
      <X aria-hidden className="size-3.5" />
    </button>
  )
}

const without = <T,>(list: T[], i: number) => list.filter((_, j) => j !== i)

export function PlanReview({ route, reason, plan: proposed, dropped, similar: similarAtFirst, onBack }: {
  route: 'use' | 'adapt' | 'custom'; reason: string; plan: WorkspacePlan; dropped: string[]; similar: WorkspaceSummary[]; onBack: () => void
}) {
  const [plan, setPlan] = useState<WorkspacePlan>(proposed)
  // One key per proposal: Create pressed twice, or retried, makes one workspace.
  const key = useRef(newClientKey())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A workspace like it is shown up front, with the choice, before Create.
  const [similar, setSimilar] = useState<WorkspaceSummary[] | null>(similarAtFirst.length > 0 ? similarAtFirst : null)
  const [done, setDone] = useState<null | { status: 'created' | 'updated' | 'exists'; workspace: WorkspaceSummary; counts?: WorkspaceCounts }>(null)
  const set = (patch: Partial<WorkspacePlan>) => { setPlan(p => ({ ...p, ...patch })); setError(null) }
  const counts = planCounts(plan)
  const empty = counts.subjects + counts.tasks + counts.notes === 0

  async function create(opts: { addTo?: string; confirmAnother?: boolean } = {}) {
    if (busy) return
    setBusy(true); setError(null)
    const res = await createWorkspace({ plan, clientKey: key.current, ...opts })
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    if (res.status === 'similar') { setSimilar(res.similar); return }
    setDone(res.status === 'exists' ? { status: 'exists', workspace: res.workspace } : { status: res.status, workspace: res.workspace, counts: res.counts })
  }

  if (done) return <Created done={done} />

  return (
    <div className="space-y-5" data-plan-review={route}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('rounded-full border px-2.5 py-0.5 text-xs font-medium', route === 'custom' ? 'border-nova/40 text-nova-ink' : 'border-white/15 text-foreground/75')}>{ROUTE_LABEL[route]}</span>
        <span className="text-xs text-foreground/60">{reason}</span>
      </div>

      <div>
        <label htmlFor="plan-title" className="text-xs font-medium text-foreground/60">Workspace name</label>
        <input id="plan-title" value={plan.title} maxLength={80} onChange={e => set({ title: e.target.value })} className={cn(FIELD, 'mt-1 h-10 text-[15px] font-medium')} />
        {plan.summary && <p className="mt-2 text-sm leading-relaxed text-foreground/70">{plan.summary}</p>}
      </div>

      {plan.sources.length > 0 && (
        <div className={SECTION}>
          <p className={H}>Your files</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {plan.sources.map(s => (
              <li key={s.file} className="flex items-start gap-2" data-source-read={s.read}>
                {s.read ? <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-action-ink" /> : <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-400" />}
                <span className="text-foreground/80"><span className="font-medium text-foreground">{s.file}</span>
                  {s.read ? ` read${s.pages ? `, ${s.pages} pages` : ''}.` : ` not read${s.note ? `: ${s.note}` : '.'}`}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.subjects.length > 0 && (
        <div className={SECTION}>
          <p className={H}>Subjects and topics</p>
          <div className="mt-3 space-y-3">
            {plan.subjects.map((s, i) => (
              <div key={i} className="rounded-xl border border-white/8 p-3">
                <div className="flex items-center gap-2">
                  <input aria-label={`Subject ${i + 1} name`} value={s.name} maxLength={80} className={cn(FIELD, 'font-medium')}
                    onChange={e => set({ subjects: plan.subjects.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <RemoveButton label={s.name || 'subject'} onClick={() => set({ subjects: without(plan.subjects, i) })} />
                </div>
                {s.topics.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {s.topics.map((t, k) => (
                      <li key={k} className="flex items-center gap-1 rounded-full border border-white/10 py-0.5 pl-2.5 pr-0.5 text-xs text-foreground/80" title={t.explanation ?? undefined}>
                        {t.name}{t.sources.length > 0 && <FileText aria-label="from your files" className="size-3 text-action-ink" />}
                        <RemoveButton label={t.name} onClick={() => set({ subjects: plan.subjects.map((x, j) => (j === i ? { ...x, topics: without(x.topics, k) } : x)) })} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {milestones(plan).length > 0 && (
        <div className={SECTION}>
          <p className={H}>Phases</p>
          <ol className="mt-3 space-y-2">
            {milestones(plan).map((p, i) => (
              <li key={i} className="rounded-xl border border-white/8 p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-foreground">{i + 1}. {p.name}
                    {(p.weeks || p.hoursPerWeek) && <span className="ml-2 text-xs font-normal text-foreground/60">{[p.weeks ? `${p.weeks} wk` : null, p.hoursPerWeek ? `~${p.hoursPerWeek} h/wk` : null].filter(Boolean).join(' · ')} (estimate)</span>}</p>
                  <RemoveButton label={p.name} onClick={() => set(removePhase(plan, i))} />
                </div>
                {p.goals.length > 0 && <p className="mt-1 text-foreground/70">{p.goals.join(' · ')}</p>}
                {p.project && <p className="mt-1 text-foreground/70"><span className="text-foreground/55">Project:</span> {p.project}</p>}
                {p.completion && <p className="mt-1 text-foreground/70"><span className="text-foreground/55">Done when:</span> {p.completion}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {(plan.dates.length > 0 || plan.tasks.length > 0) && (
        <div className={cn(SECTION, 'grid gap-5 sm:grid-cols-2')}>
          {plan.dates.length > 0 && (
            <div>
              <p className={H}>Dates</p>
              <ul className="mt-2 space-y-1">{plan.dates.map((d, i) => (
                <li key={i} className="flex items-center justify-between gap-2 text-sm text-foreground/80">{d.title} · {d.day}<RemoveButton label={d.title} onClick={() => set({ dates: without(plan.dates, i) })} /></li>
              ))}</ul>
            </div>
          )}
          {plan.tasks.length > 0 && (
            <div>
              <p className={H}>Tasks</p>
              <ul className="mt-2 space-y-1">{plan.tasks.map((t, i) => (
                <li key={t.key} className="flex items-center justify-between gap-2 text-sm text-foreground/80">{t.title}<RemoveButton label={t.title} onClick={() => set({ tasks: without(plan.tasks, i) })} /></li>
              ))}</ul>
            </div>
          )}
        </div>
      )}

      {plan.notes.length > 0 && (
        <div className={SECTION}>
          <p className={H}>Notes</p>
          <ul className="mt-2 space-y-1">{plan.notes.map((n, i) => (
            <li key={n.key} className="flex items-center justify-between gap-2 text-sm text-foreground/80">
              <span>{n.title} <span className="text-xs text-foreground/55">{n.origin === 'source' ? 'from your files' : n.origin === 'nova' ? 'by Nova' : 'template'}</span></span>
              <RemoveButton label={n.title} onClick={() => set({ notes: without(plan.notes, i) })} />
            </li>
          ))}</ul>
        </div>
      )}

      {plan.resources.length > 0 && (
        <div className={SECTION}>
          <p className={H}>Resources</p>
          <ul className="mt-2 space-y-1 text-sm text-foreground/80">{plan.resources.map((r, i) => (
            <li key={i}>{r.title} <span className="text-xs text-foreground/55">({r.kind}{r.origin === 'nova' ? ', suggested by Nova, not checked' : ''})</span></li>
          ))}</ul>
        </div>
      )}

      {(plan.assumptions.length > 0 || dropped.length > 0) && (
        <div className={cn(SECTION, 'space-y-1.5 text-xs leading-relaxed text-foreground/65')}>
          {plan.assumptions.map(a => <p key={a}>{a}</p>)}
          {dropped.length > 0 && <p data-dropped>Left out because it didn&apos;t fit Kio&apos;s limits: {dropped.slice(0, 4).join('; ')}{dropped.length > 4 ? ` and ${dropped.length - 4} more` : ''}.</p>}
        </div>
      )}

      <p className="text-xs text-foreground/60">
        Creates {counts.subjects} subject{counts.subjects === 1 ? '' : 's'}, {counts.topics} topics, {counts.tasks} tasks, {counts.notes} notes{counts.dates ? ` and ${counts.dates} date${counts.dates === 1 ? '' : 's'}` : ''}. Subjects you already have are added to, never replaced.
      </p>

      {similar && (
        <div role="alert" className="rounded-xl border border-amber-300/25 bg-amber-300/5 p-4 text-sm" data-similar>
          <p className="font-medium text-foreground">You already have {similar.length === 1 ? 'a workspace like this' : 'workspaces like this'}.</p>
          <ul className="mt-2 space-y-2">
            {similar.map(w => (
              <li key={w.id} className="flex flex-wrap items-center gap-2">
                <span className="mr-auto text-foreground/80">{w.title}</span>
                {w.subjects[0] && <Link href={`/knowledge?subject=${w.subjects[0].id}`} className={BUTTON_QUIET}>Open</Link>}
                <button type="button" disabled={busy} onClick={() => void create({ addTo: w.id })} className={BUTTON_QUIET}>Add to it</button>
              </li>
            ))}
          </ul>
          <button type="button" disabled={busy} onClick={() => void create({ confirmAnother: true })} className={cn(BUTTON_QUIET, 'mt-3')}>Create another anyway</button>
          <p className="mt-2 text-xs text-foreground/60">Adding merges: nothing you have is changed or removed.</p>
        </div>
      )}

      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <button type="button" onClick={onBack} disabled={busy} className={BUTTON_QUIET}><ArrowLeft aria-hidden className="size-3.5" /> Back</button>
        {!similar && (
          <button type="button" onClick={() => void create()} disabled={busy || empty || !plan.title.trim()} className={BUTTON_PRIMARY} data-create>
            {busy ? <><Loader2 aria-hidden className="size-4 animate-spin" /> Creating…</> : 'Create workspace'}
          </button>
        )}
      </div>
    </div>
  )
}

function Created({ done }: { done: { status: 'created' | 'updated' | 'exists'; workspace: WorkspaceSummary; counts?: WorkspaceCounts } }) {
  const c = done.counts
  const first = done.workspace.subjects[0]
  return (
    <div role="status" className="space-y-4" data-created={done.status}>
      <p className="flex items-center gap-2 text-base font-semibold text-foreground"><Check aria-hidden className="size-5 text-action-ink" />
        {done.status === 'exists' ? 'This was already created.' : done.status === 'updated' ? `Added to ${done.workspace.title}.` : `${done.workspace.title} is ready.`}</p>
      {c && (
        <p className="text-sm text-foreground/75">
          {[c.subjectsAdded && `${c.subjectsAdded} new subject${c.subjectsAdded === 1 ? '' : 's'}`, c.topicsAdded && `${c.topicsAdded} topics`, c.tasksAdded && `${c.tasksAdded} tasks`, c.notesAdded && `${c.notesAdded} notes`, c.datesAdded && `${c.datesAdded} date${c.datesAdded === 1 ? '' : 's'}`].filter(Boolean).join(', ') || 'Nothing new: you already had all of it'}.
          {c.notesSkipped.length > 0 && ` Kept your existing notes: ${c.notesSkipped.join(', ')}.`}
          {c.datesSkipped.length > 0 && ` Dates not added (already on record or out of range): ${c.datesSkipped.join(', ')}.`}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {first && <Link href={`/knowledge?subject=${first.id}`} className={BUTTON_PRIMARY}>Open in Knowledge</Link>}
        <Link href={BOARD_PATH} className={BUTTON_QUIET}>Tasks</Link>
        <Link href="/notes" className={BUTTON_QUIET}>Notes</Link>
        <Link href="/home" className={BUTTON_QUIET}>Today&apos;s plan</Link>
      </div>
    </div>
  )
}
