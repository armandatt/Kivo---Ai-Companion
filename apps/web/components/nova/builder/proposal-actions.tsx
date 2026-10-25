'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Check, Loader2, MessageSquare, Network, PencilLine, RotateCcw, Sparkles, Trash2 } from 'lucide-react'
import type { DraftView } from '@repo/api/nova/product/builder.types'
import { planCounts } from '@repo/api/nova/product/workspace-plan'
import { BUTTON_PRIMARY, BUTTON_QUIET } from '@/components/nova/workspace/ui'
import { mapDestinations, type Words } from './builder-view'
import type { DraftState } from './use-draft'

// The bottom of the playground: the decisions that are the learner's, kept
// apart from the workspace above and from the conversation. Shown only when
// there is something to decide or to report (a proposal to approve, a build
// under way, failed or done); before a proposal the playground has none.
//
// Approval names the version on screen. While Nova writes a new version the
// approve button waits, and once it lands it is that version (and only
// that one) the learner approves: an approval never carries over.

const BAR = 'shrink-0 border-t border-white/8 bg-card/85 px-4 py-3 backdrop-blur-sm sm:px-5'

function counted(n: number, one: string, many = `${one}s`) { return n ? `${n} ${n === 1 ? one : many}` : null }

export function ProposalActions({ state, words, onEdit, onAsk }: {
  state: DraftState; words: Words; onEdit: () => void; onAsk: (text: string) => void
}) {
  const { draft, plan, busy, save } = state
  const [confirmCancel, setConfirmCancel] = useState(false)
  if (!draft) return null
  const error = state.actionError && (state.errorOf === 'approve' || state.errorOf === 'cancel')
    ? <p role="alert" className="mb-2 text-xs text-red-400">{state.actionError}</p> : null

  // A deletion shown in the conversation: said in full, carried out only here.
  if (draft.deletion) return <DeletionActions state={state} />

  if (draft.status === 'building' || busy === 'approve') {
    return (
      <div className={BAR} role="status" data-actions="building">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground"><Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> {draft.changes ? `Applying the changes to ${draft.current?.title ?? 'it'}…` : `Creating version ${draft.version} in Kivo…`}</p>
        <p className="mt-1 text-xs text-subtle">{draft.changes ? 'All of them together, or none; everything else stays as it is.' : `Its tasks, ${words.areas.toLowerCase()}, notes and dates are written together, or not at all.`}</p>
      </div>
    )
  }

  if (draft.status === 'ready' && draft.current) {
    const places = mapDestinations(draft)
    return (
      <div className={BAR} role="status" data-actions="ready" data-built>
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><Check aria-hidden className="size-4 text-action-ink" /> {draft.current.title} is in Kivo</p>
        {places.length > 1 && <p className="mt-1 text-xs text-subtle">See it on the Knowledge Map, one subject at a time:</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {places.length === 1
            ? <Link href={places[0]!.href} className={BUTTON_PRIMARY} data-map-link><Network aria-hidden className="size-4" /> Open on the Knowledge Map</Link>
            : places.map(p => <Link key={p.href} href={p.href} className={BUTTON_QUIET} data-map-link><Network aria-hidden className="size-3.5" /> {p.label}</Link>)}
          <Link href="/planner?view=board" className={BUTTON_QUIET}>Planner board</Link>
          <Link href="/calendar" className={BUTTON_QUIET}>Calendar</Link>
          <button type="button" onClick={() => onAsk('')} className={`${BUTTON_QUIET} sm:ml-auto`}><Sparkles aria-hidden className="size-3.5" /> Keep changing it</button>
        </div>
      </div>
    )
  }

  if (draft.status === 'failed' && draft.failure?.stage === 'building') {
    return (
      <div className={BAR} role="alert" data-actions="build-failed">
        {error}
        <p className="flex items-start gap-2 text-sm text-foreground/85"><AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-red-400" /> {draft.failure.message} Nothing was created.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => void state.approve()} disabled={Boolean(busy)} className={BUTTON_PRIMARY}><RotateCcw aria-hidden className="size-3.5" /> Approve version {draft.version} again</button>
          <button type="button" onClick={() => onAsk('')} className={BUTTON_QUIET}><MessageSquare aria-hidden className="size-3.5" /> Discuss with Nova</button>
        </div>
      </div>
    )
  }

  const writing = state.working
  // A proposal on screen to approve, or one Nova is rewriting (approval waits for it).
  if (!(draft.status === 'awaiting_approval' || (draft.status === 'drafting' && writing))) return null
  if (draft.changes) return <ChangeActions state={state} onAsk={onAsk} error={error} />
  if (!plan) return null

  const counts = planCounts(plan)
  const blocked = Boolean(busy) || save === 'saving' || writing
  const similar = draft.similar.length > 0 && !draft.target
  const holds = [counted(plan.phases.length, words.phase), counted(counts.tasks, 'task'), counted(counts.topics, words.topic), counted(counts.notes, 'note'), counted(counts.dates, 'date')].filter(Boolean).join(' · ')
  const suggestions = draft.brief.suggestions.slice(0, 3)

  return (
    <div className={BAR} data-actions="approve" data-approval={draft.version}>
      {error}
      {suggestions.length > 0 && !writing && (
        <div className="-mx-1 mb-2.5 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5" aria-label="Nova's suggestions">
          <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-nova-ink"><Sparkles aria-hidden className="size-3" /> Refine</span>
          {suggestions.map(s => (
            <button key={s} type="button" onClick={() => onAsk(s)} title="Put this in the message box to send or change"
              className="max-w-[16rem] shrink-0 truncate rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-foreground/75 transition-colors hover:border-nova/40 hover:text-foreground">{s}</button>
          ))}
        </div>
      )}
      {similar && (
        <div role="alert" className="mb-2.5 rounded-xl border border-amber-300/25 bg-amber-300/5 p-2.5 text-xs" data-similar>
          <p className="font-medium text-foreground">You already have {draft.similar.length === 1 ? 'a workspace like this' : 'workspaces like this'}: {draft.similar.map(w => w.title).join(', ')}.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {draft.similar.slice(0, 2).map(w => <button key={w.id} type="button" disabled={blocked} onClick={() => void state.approve({ addTo: w.id })} className={BUTTON_QUIET}>Add to {w.title}</button>)}
            <button type="button" disabled={blocked} onClick={() => void state.approve({ confirmAnother: true })} className={BUTTON_QUIET}>Create a new one</button>
          </div>
          <p className="mt-1.5 text-subtle">Adding merges: nothing you have is changed or removed.</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto min-w-0">
          <p className="text-sm font-semibold text-foreground">{writing ? 'Nova is writing a new version…' : `Ready to review · version ${draft.version}`}</p>
          <p className="truncate text-xs text-subtle">{writing ? 'Approve once it lands, so you approve what you see.' : `${draft.target ? `Adds to ${draft.target.title}: ` : ''}${holds || 'An empty proposal'}. Nothing exists until you approve.`}</p>
        </div>
        {!similar && (
          <button type="button" onClick={() => void state.approve()} disabled={blocked} className={`${BUTTON_PRIMARY} order-last w-full justify-center sm:order-0 sm:w-auto`} data-approve>
            {save === 'saving' ? 'Saving your edits…' : writing ? <><Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> Waiting for Nova</> : <><Check aria-hidden className="size-4" /> Approve and build</>}
          </button>
        )}
        <button type="button" onClick={onEdit} disabled={writing} className={BUTTON_QUIET}><PencilLine aria-hidden className="size-3.5" /> Edit</button>
        <button type="button" onClick={() => onAsk('')} className={BUTTON_QUIET}><MessageSquare aria-hidden className="size-3.5" /> Discuss</button>
        {confirmCancel ? (
          <span className="flex basis-full flex-wrap items-center gap-2 text-xs text-foreground/75 sm:basis-auto">Discard this proposal? Nothing has been created.
            <button type="button" onClick={() => { setConfirmCancel(false); void state.cancel() }} className={BUTTON_QUIET} data-confirm-cancel>Discard</button>
            <button type="button" onClick={() => setConfirmCancel(false)} className={BUTTON_QUIET}>Keep</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmCancel(true)} disabled={blocked} aria-label="Discard this proposal" title="Discard this proposal"
            className="grid size-9 place-items-center rounded-lg text-subtle transition-colors hover:bg-white/6 hover:text-foreground disabled:opacity-40"><Trash2 aria-hidden className="size-4" /></button>
        )}
      </div>
    </div>
  )
}

// Deleting something of theirs: everything it would remove and everything
// it keeps, worked out by the server from the records, and one button that
// does it. A chat message never does; Keep it drops the request.
function DeletionActions({ state }: { state: DraftState }) {
  const d = state.draft?.deletion
  if (!d) return null
  const r = d.removes, k = d.keeps
  const goes = [
    r.workspace ? `The workspace ${d.title}` : null,
    ...r.subjects.map(s => `Subject ${s.name}`),
    r.topics.length ? `${r.topics.length} topic${r.topics.length === 1 ? '' : 's'}: ${r.topics.slice(0, 4).map(t => t.name).join(', ')}${r.topics.length > 4 ? '…' : ''}` : null,
    r.tasks.length ? `${r.tasks.length} open task${r.tasks.length === 1 ? '' : 's'}, steps included` : null,
    r.dates.length ? `${r.dates.length} date${r.dates.length === 1 ? '' : 's'}: ${r.dates.slice(0, 3).map(x => x.title).join(', ')}` : null,
    r.notes.length ? `${r.notes.length} note${r.notes.length === 1 ? '' : 's'} Nova wrote and nobody edited` : null,
  ].filter(Boolean) as string[]
  const stays = [
    k.topics.length ? `${k.topics.length} studied topic${k.topics.length === 1 ? '' : 's'}, with their history` : null,
    k.finishedTasks ? `${k.finishedTasks} finished task${k.finishedTasks === 1 ? '' : 's'}` : null,
    k.notes.length ? `${k.notes.length} note${k.notes.length === 1 ? '' : 's'} you wrote or edited` : null,
    ...k.subjects,
  ].filter(Boolean) as string[]
  const busy = state.busy === 'delete'
  return (
    <div className={`${BAR} border-red-400/25`} role="alertdialog" aria-label={`Delete ${d.title}?`} data-actions="delete">
      {state.actionError && state.errorOf === 'delete' && <p role="alert" className="mb-2 text-xs text-red-400">{state.actionError}</p>}
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><AlertTriangle aria-hidden className="size-4 text-red-400" /> Delete {d.title}?</p>
      <div className="mt-2 grid gap-3 text-xs sm:grid-cols-2">
        <div><p className="font-medium text-foreground/85">This removes</p><ul className="mt-1 space-y-0.5 text-foreground/70">{goes.length ? goes.map(g => <li key={g}>• {g}</li>) : <li>Nothing: all of it is yours to keep.</li>}</ul></div>
        <div><p className="font-medium text-foreground/85">This keeps</p><ul className="mt-1 space-y-0.5 text-foreground/70">{stays.length ? stays.map(g => <li key={g}>• {g}</li>) : <li>Nothing else is affected.</li>}</ul></div>
      </div>
      <p className="mt-2 text-[11px] text-subtle">Your other workspaces, subjects and notes aren&apos;t touched. Afterwards, Version history can bring it back as a new proposal.</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button type="button" onClick={() => void state.confirmDeletion()} disabled={busy || goes.length === 0} className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/85 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50" data-confirm-delete>
          {busy ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : <Trash2 aria-hidden className="size-4" />} Delete {d.title}
        </button>
        <button type="button" onClick={() => void state.keepResource()} disabled={busy} className={BUTTON_QUIET}>Keep it</button>
      </div>
    </div>
  )
}

// The status line a draft's playground shows above the plan while Nova
// works on it: the job's real stage, never a step the server has not reached.
export function workingLabel(draft: DraftView, words: Words): string | null {
  if (draft.status === 'building') return 'Creating your workspace in Kivo'
  const p = draft.pending
  if (!p) return null
  if (p.stage === 'reading') return draft.files.length ? 'Reading your message and files' : 'Reading your message'
  return p.kind === 'revise' ? words.revising : words.writing
}

// Approving changes to something the learner already has: what they apply
// to, how many, and the same rules (approval waits for Nova; it names the
// version on screen). Discarding drops the changes, not the conversation.
function ChangeActions({ state, onAsk, error }: { state: DraftState; onAsk: (text: string) => void; error: React.ReactNode }) {
  const { draft, busy, save } = state
  const [confirm, setConfirm] = useState(false)
  if (!draft?.changes) return null
  const writing = state.working
  const blocked = Boolean(busy) || save === 'saving' || writing
  const n = (e: 'add' | 'change' | 'remove') => draft.changes!.ops.filter(o => o.effect === e).length
  const counts = [n('add') && `${n('add')} to add`, n('change') && `${n('change')} to change`, n('remove') && `${n('remove')} to remove`].filter(Boolean).join(' · ')
  return (
    <div className={BAR} data-actions="apply" data-approval={draft.version}>
      {error}
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto min-w-0">
          <p className="text-sm font-semibold text-foreground">{writing ? 'Nova is updating the changes…' : `Changes to ${draft.current?.title ?? 'it'} · v${draft.version}`}</p>
          <p className="truncate text-xs text-subtle">{writing ? 'Approve once they land, so you approve what you see.' : `${counts}. Everything else stays as it is.`}</p>
        </div>
        <button type="button" onClick={() => void state.approve()} disabled={blocked} className={`${BUTTON_PRIMARY} order-last w-full justify-center sm:order-0 sm:w-auto`} data-approve>
          {save === 'saving' ? 'Saving…' : writing ? <><Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> Waiting for Nova</> : <><Check aria-hidden className="size-4" /> Apply changes</>}
        </button>
        <button type="button" onClick={() => onAsk('')} className={BUTTON_QUIET}><MessageSquare aria-hidden className="size-3.5" /> Discuss</button>
        {confirm ? (
          <span className="flex basis-full flex-wrap items-center gap-2 text-xs text-foreground/75 sm:basis-auto">Discard these changes? Nothing has been changed.
            <button type="button" onClick={() => { setConfirm(false); void state.cancel() }} className={BUTTON_QUIET} data-confirm-cancel>Discard</button>
            <button type="button" onClick={() => setConfirm(false)} className={BUTTON_QUIET}>Keep</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} disabled={blocked} aria-label="Discard these changes" title="Discard these changes"
            className="grid size-9 place-items-center rounded-lg text-subtle transition-colors hover:bg-white/6 hover:text-foreground disabled:opacity-40"><Trash2 aria-hidden className="size-4" /></button>
        )}
      </div>
    </div>
  )
}
