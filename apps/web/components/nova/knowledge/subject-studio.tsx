'use client'

// Subject Studio: the learner's own subjects and topics, edited by hand or
// with a proposal from Nova. The server decides everything that matters
// (product/setup-edit.ts, product/study-proposal.ts): this page only shows
// the structure, sends the learner's edits against the version it is showing,
// and shows back what was saved, refused or changed meanwhile.
//
// A hand edit is saved on its own, at once. Nova's proposal is a draft: kept
// in this browser until applied or discarded, every change can be edited or
// left out, and only the selected ones are sent, in one batch.

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { SUBJECT_DEPTH_MAX, type StudyEdit, type StudyEditResponse, type StudyStructure, type StudyStructureView } from '@repo/api/nova/product/setup-edit.types'
import { canPlace, treeOrder } from '@repo/api/nova/product/task-tree'
import type { StudyProposalResponse } from '@repo/api/nova/product/study-proposal.types'
import { STUDY_REQUEST_MAX } from '@repo/api/nova/product/study-proposal.types'

const DRAFT_KEY = 'kivo-study-proposal'
const FIELD = 'h-9 min-w-0 rounded-lg border border-white/10 bg-background px-2.5 text-sm text-foreground placeholder:text-foreground/30'
const SMALL = 'inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-foreground/60 transition-colors hover:bg-white/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35'
const PRIMARY = 'inline-flex h-9 items-center gap-1.5 rounded-xl bg-keppel-400 px-4 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300 disabled:opacity-50'

type Proposal = Extract<StudyProposalResponse, { ok: true }>
type DraftItem = { edit: StudyEdit; why: string; sentence: string; on: boolean }
type Draft = { request: string; version: string; items: DraftItem[]; dropped: Proposal['dropped']; questions: string[] }

async function call<T>(url: string, body?: unknown): Promise<T | { ok: false; error: string; message: string }> {
  try {
    const res = await fetch(url, body === undefined ? { cache: 'no-store' } : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store',
    })
    if (res.status === 401) { window.location.href = '/signin'; return { ok: false, error: 'unauthenticated', message: 'Sign in again.' } }
    return await res.json() as T
  } catch {
    return { ok: false, error: 'failed', message: 'Could not reach the server. Nothing was changed.' }
  }
}

const readDraft = (): Draft | null => { try { const raw = localStorage.getItem(DRAFT_KEY); return raw ? JSON.parse(raw) as Draft : null } catch { return null } }
const writeDraft = (d: Draft | null) => { try { if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); else localStorage.removeItem(DRAFT_KEY) } catch { /* private window */ } }
const lines = (text: string) => text.split(/[\n,]/).map(s => s.trim()).filter(Boolean)

export function SubjectStudio({ onChanged, onClose }: { onChanged: () => void; onClose: () => void }) {
  const [structure, setStructure] = useState<StudyStructure | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy]       = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string; details?: string[] } | null>(null)

  const load = useCallback(async () => {
    const v = await call<StudyStructureView>('/api/nova/subjects')
    if ('status' in v && v.status === 'ready') { setStructure(v); setLoadFailed(false) } else setLoadFailed(true)
  }, [])
  useEffect(() => { void load() }, [load])

  // One batch against the version on screen. True when it was saved.
  const save = useCallback(async (edits: StudyEdit[], key: string): Promise<boolean> => {
    if (!structure) return false
    setBusy(key); setMessage(null)
    const r = await call<StudyEditResponse>('/api/nova/subjects', { version: structure.version, edits })
    setBusy(null)
    if (r.ok) {
      setStructure(r.structure)
      setMessage({ tone: 'ok', text: 'Saved.', details: r.applied })
      onChanged()
      return true
    }
    if ('structure' in r && r.structure) setStructure(r.structure)
    setMessage({ tone: 'error', text: r.message, details: 'issues' in r ? r.issues?.map(i => i.message) : undefined })
    return false
  }, [structure, onChanged])

  return (
    <section aria-labelledby="studio-heading" className="mt-6 rounded-3xl border border-white/10 bg-card/60 p-5 sm:p-7" data-subject-studio>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="studio-heading" className="text-lg font-semibold text-foreground">Your subjects and topics</h2>
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-foreground/55">
            They are yours to shape. Renaming or moving a topic keeps its notes, tasks, saved pages and study history. A topic you have studied can&apos;t be removed, because that would delete its record.
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close subject editing" className="rounded-lg p-1.5 text-foreground/50 hover:bg-white/5 hover:text-foreground"><X className="size-4" /></button>
      </div>

      {message && (
        <div role={message.tone === 'error' ? 'alert' : 'status'} className={`mt-4 rounded-xl border p-3 text-sm ${message.tone === 'error' ? 'border-amber-300/25 bg-amber-300/5 text-foreground/85' : 'border-keppel-400/25 bg-keppel-400/5 text-foreground/85'}`} data-studio-message={message.tone}>
          {message.text}
          {message.details && message.details.length > 0 && <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-foreground/65">{message.details.map(d => <li key={d}>{d}</li>)}</ul>}
        </div>
      )}

      {loadFailed ? (
        <p className="mt-5 text-sm text-foreground/55">Your subjects didn&apos;t load. <button type="button" onClick={() => void load()} className="underline">Try again</button></p>
      ) : !structure ? (
        <p className="mt-5 inline-flex items-center gap-2 text-sm text-foreground/55"><Loader2 className="size-3.5 animate-spin" /> Loading…</p>
      ) : (
        <>
          <AskNova structure={structure} onApply={save} busy={busy} />
          <ManualEditor structure={structure} onSave={save} busy={busy} onRestore={async topicId => {
            // Restoring is the archive route's (topic-archive.ts), then the structure is read again.
            setBusy(`restore:${topicId}`); setMessage(null)
            const r = await call<{ ok: boolean; message?: string }>('/api/nova/topics/archive', { topicId, archived: false })
            setBusy(null)
            if (r.ok) { setMessage({ tone: 'ok', text: 'Restored.' }); onChanged(); await load() }
            else setMessage({ tone: 'error', text: 'message' in r && r.message ? r.message : "That didn't work." })
          }} />
        </>
      )}
    </section>
  )
}

// ── By hand ───────────────────────────────────────────────────────────────────

// How deep a topic sits, and what is inside it (never a place to put it).
type StudioTopic = StudyStructure['subjects'][number]['topics'][number]
function depthIn(topics: StudioTopic[], t: StudioTopic): number {
  let d = 0
  for (let at = t.parentId ?? null; at && d < 8; d++) at = topics.find(x => x.id === at)?.parentId ?? null
  return d
}
function insideOf(topics: StudioTopic[], id: string): Set<string> {
  const out = new Set<string>()
  for (let grew = true; grew;) { grew = false; for (const x of topics) if (x.parentId && (x.parentId === id || out.has(x.parentId)) && !out.has(x.id)) { out.add(x.id); grew = true } }
  return out
}

function ManualEditor({ structure, onSave, busy, onRestore }: { structure: StudyStructure; onSave: (e: StudyEdit[], key: string) => Promise<boolean>; busy: string | null; onRestore: (topicId: string) => Promise<void> }) {
  const [renaming, setRenaming] = useState<{ id: string; kind: 'subject' | 'topic'; name: string } | null>(null)
  const [adding, setAdding]     = useState<Record<string, string>>({})
  const [newSubject, setNewSubject] = useState({ name: '', topics: '' })
  const disabled = busy !== null

  const rename = async () => {
    if (!renaming) return
    const edit: StudyEdit = renaming.kind === 'subject'
      ? { op: 'rename_subject', subjectId: renaming.id, name: renaming.name }
      : { op: 'rename_topic', topicId: renaming.id, name: renaming.name }
    if (await onSave([edit], `rename:${renaming.id}`)) setRenaming(null)
  }

  return (
    <div className="mt-7">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-foreground/45">Edit by hand</h3>
      <ul className="mt-3 space-y-4">
        {treeOrder(structure.subjects.map(x => ({ ...x, parent: x.parentId ?? null }))).map(({ item: s, depth }) => {
          const removable = s.topics.length === 0 && s.dates === 0
          // Where it may go: any other subject, not one inside it, never deeper than subjects go.
          const nodes = structure.subjects.map(x => ({ id: x.id, parent: x.parentId ?? null }))
          const homes = structure.subjects.filter(x => x.id !== s.id && canPlace(nodes, s.id, x.id, SUBJECT_DEPTH_MAX).ok)
          return (
            <li key={s.id} className="rounded-2xl border border-white/8 p-4" style={depth ? { marginLeft: depth * 20 } : undefined} data-studio-subject={s.name}>
              <div className="flex flex-wrap items-center gap-2">
                {renaming?.id === s.id ? (
                  <form className="flex flex-1 flex-wrap gap-2" onSubmit={e => { e.preventDefault(); void rename() }}>
                    <label className="sr-only" htmlFor={`rename-${s.id}`}>New name for {s.name}</label>
                    <input id={`rename-${s.id}`} autoFocus value={renaming.name} maxLength={80} onChange={e => setRenaming({ ...renaming, name: e.target.value })} className={`${FIELD} flex-1`} />
                    <button type="submit" disabled={disabled} className={PRIMARY}>Save</button>
                    <button type="button" onClick={() => setRenaming(null)} className={SMALL}>Cancel</button>
                  </form>
                ) : (
                  <>
                    <p className="flex-1 text-sm font-semibold text-foreground">{s.name}</p>
                    <button type="button" className={SMALL} disabled={disabled} onClick={() => setRenaming({ id: s.id, kind: 'subject', name: s.name })} aria-label={`Rename ${s.name}`}><Pencil className="size-3.5" /> Rename</button>
                    <button type="button" className={SMALL} disabled={disabled || !removable} data-remove-subject
                      title={removable ? undefined : s.dates > 0 ? 'It has dates on record. Move or remove them in study settings first.' : 'Move or remove its topics first.'}
                      onClick={() => { if (window.confirm(`Remove ${s.name}? Its notes, tasks and saved pages stay, unfiled.`)) void onSave([{ op: 'remove_subject', subjectId: s.id }], `remove:${s.id}`) }}
                      aria-label={`Remove ${s.name}`}><Trash2 className="size-3.5" /> Remove</button>
                  </>
                )}
              </div>
              {(s.parentId || homes.length > 0) && (
                // On the Knowledge Map a subject inside another is drawn around it.
                <div className="mt-2 flex items-center gap-2 text-xs text-foreground/60">
                  <label htmlFor={`inside-${s.id}`}>Inside</label>
                  <select id={`inside-${s.id}`} value={s.parentId ?? ''} disabled={disabled} className={`${FIELD} h-8 text-xs`} data-subject-parent
                    onChange={e => void onSave([{ op: 'move_subject', subjectId: s.id, parentId: e.target.value || null }], `place:${s.id}`)}>
                    <option value="">nothing (on its own)</option>
                    {[...new Map([...structure.subjects.filter(x => x.id === s.parentId), ...homes].map(x => [x.id, x])).values()].map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </div>
              )}

              <ul className="mt-2 divide-y divide-white/6">
                {s.topics.map(t => (
                  // Indented under the topic it sits inside (the server sends them in that order).
                  <li key={t.id} className="flex flex-wrap items-center gap-2 py-2" style={{ paddingLeft: depthIn(s.topics, t) * 18 }} data-studio-topic={t.name} data-archived={t.archived || undefined}>
                    {t.archived ? (
                      <>
                        <span className="min-w-0 flex-1 truncate text-sm text-foreground/50">{t.name}<span className="ml-2 rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-foreground/45">archived</span></span>
                        <button type="button" className={SMALL} disabled={disabled} onClick={() => void onRestore(t.id)} aria-label={`Restore ${t.name}`} data-restore-topic>Restore</button>
                      </>
                    ) : renaming?.id === t.id ? (
                      <form className="flex flex-1 flex-wrap gap-2" onSubmit={e => { e.preventDefault(); void rename() }}>
                        <label className="sr-only" htmlFor={`rename-${t.id}`}>New name for {t.name}</label>
                        <input id={`rename-${t.id}`} autoFocus value={renaming.name} maxLength={120} onChange={e => setRenaming({ ...renaming, name: e.target.value })} className={`${FIELD} flex-1`} />
                        <button type="submit" disabled={disabled} className={PRIMARY}>Save</button>
                        <button type="button" onClick={() => setRenaming(null)} className={SMALL}>Cancel</button>
                      </form>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 truncate text-sm text-foreground/85">{t.name}{t.hasHistory && <span className="ml-2 text-xs text-foreground/40">studied</span>}</span>
                        <button type="button" className={SMALL} disabled={disabled} onClick={() => setRenaming({ id: t.id, kind: 'topic', name: t.name })} aria-label={`Rename ${t.name}`}><Pencil className="size-3.5" /> Rename</button>
                        <label className="sr-only" htmlFor={`inside-topic-${t.id}`}>Put {t.name} inside</label>
                        <select id={`inside-topic-${t.id}`} value={t.parentId ?? ''} disabled={disabled} className={`${FIELD} h-8 max-w-[10rem] text-xs`} data-topic-parent
                          onChange={e => void onSave([{ op: 'move_topic', topicId: t.id, parentId: e.target.value || null }], `inside:${t.id}`)}>
                          <option value="">At the top</option>
                          {s.topics.filter(x => !x.archived && x.id !== t.id && !insideOf(s.topics, t.id).has(x.id)).map(x => <option key={x.id} value={x.id}>Inside {x.name}</option>)}
                        </select>
                        {structure.subjects.length > 1 && (
                          <>
                            <label className="sr-only" htmlFor={`move-${t.id}`}>Move {t.name} to</label>
                            <select id={`move-${t.id}`} value="" disabled={disabled} className={`${FIELD} h-8 text-xs`}
                              onChange={e => { if (e.target.value) void onSave([{ op: 'move_topic', topicId: t.id, toSubjectId: e.target.value }], `move:${t.id}`) }}>
                              <option value="">Move to…</option>
                              {structure.subjects.filter(x => x.id !== s.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                            </select>
                          </>
                        )}
                        <button type="button" className={SMALL} disabled={disabled || t.hasHistory} data-remove-topic
                          title={t.hasHistory ? 'You have studied this, so removing it would delete that record. Rename or move it instead.' : undefined}
                          onClick={() => { if (window.confirm(`Remove ${t.name}? Its notes, tasks and saved pages stay under ${s.name}.`)) void onSave([{ op: 'remove_topic', topicId: t.id }], `remove:${t.id}`) }}
                          aria-label={`Remove ${t.name}`}><Trash2 className="size-3.5" /> Remove</button>
                      </>
                    )}
                  </li>
                ))}
              </ul>

              <form className="mt-2 flex gap-2" onSubmit={async e => {
                e.preventDefault()
                const names = lines(adding[s.id] ?? '')
                if (names.length && await onSave([{ op: 'add_topics', subjectId: s.id, names }], `add:${s.id}`)) setAdding(a => ({ ...a, [s.id]: '' }))
              }}>
                <label className="sr-only" htmlFor={`add-${s.id}`}>Add topics to {s.name}</label>
                <input id={`add-${s.id}`} value={adding[s.id] ?? ''} onChange={e => setAdding(a => ({ ...a, [s.id]: e.target.value }))} placeholder="Add topics (separate with commas)" className={`${FIELD} flex-1`} />
                <button type="submit" disabled={disabled || !lines(adding[s.id] ?? '').length} className={SMALL}><Plus className="size-3.5" /> Add</button>
              </form>
            </li>
          )
        })}
      </ul>

      <form className="mt-4 grid gap-2 rounded-2xl border border-dashed border-white/12 p-4 sm:grid-cols-[1fr_2fr_auto]" onSubmit={async e => {
        e.preventDefault()
        if (newSubject.name.trim() && await onSave([{ op: 'add_subject', name: newSubject.name, topics: lines(newSubject.topics) }], 'add-subject')) setNewSubject({ name: '', topics: '' })
      }}>
        <label className="sr-only" htmlFor="new-subject">New subject</label>
        <input id="new-subject" value={newSubject.name} maxLength={80} onChange={e => setNewSubject({ ...newSubject, name: e.target.value })} placeholder="New subject" className={FIELD} />
        <label className="sr-only" htmlFor="new-subject-topics">Its topics</label>
        <input id="new-subject-topics" value={newSubject.topics} onChange={e => setNewSubject({ ...newSubject, topics: e.target.value })} placeholder="Its topics, separated with commas (optional)" className={FIELD} />
        <button type="submit" disabled={busy !== null || !newSubject.name.trim()} className={PRIMARY}><Plus className="size-3.5" /> Add subject</button>
      </form>
    </div>
  )
}

// ── With Nova ─────────────────────────────────────────────────────────────────

function AskNova({ structure, onApply, busy }: { structure: StudyStructure; onApply: (e: StudyEdit[], key: string) => Promise<boolean>; busy: string | null }) {
  const [request, setRequest] = useState('')
  const [draft, setDraft]     = useState<Draft | null>(null)
  const [asking, setAsking]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => { setDraft(readDraft()) }, [])
  const keep = (d: Draft | null) => { setDraft(d); writeDraft(d) }

  const ask = async () => {
    setAsking(true); setError(null)
    const r = await call<StudyProposalResponse>('/api/nova/subjects/propose', { request })
    setAsking(false)
    if (!r.ok) { setError(r.message); return }
    keep({ request, version: r.version, items: r.changes.map(c => ({ ...c, on: true })), dropped: r.dropped, questions: r.questions })
  }

  const setItem = (i: number, item: DraftItem) => draft && keep({ ...draft, items: draft.items.map((x, j) => (j === i ? item : x)) })
  const chosen = draft?.items.filter(x => x.on) ?? []
  const stale = draft !== null && draft.version !== structure.version

  return (
    <div className="mt-6 rounded-2xl border border-keppel-400/20 bg-keppel-400/[0.04] p-4 sm:p-5" data-ask-nova-subjects>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Sparkles className="size-4 text-keppel-300" /> Ask Nova to update them</h3>
      <p className="mt-1 text-xs leading-relaxed text-foreground/55">Say what you are working toward. Nova proposes changes; nothing changes until you choose which to apply.</p>
      <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={e => { e.preventDefault(); if (request.trim()) void ask() }}>
        <label className="sr-only" htmlFor="studio-request">What should change</label>
        <textarea id="studio-request" value={request} maxLength={STUDY_REQUEST_MAX} rows={2} onChange={e => setRequest(e.target.value)}
          placeholder="e.g. I'm targeting AI engineering roles. Prioritise ML, deep learning, GenAI, DSA and system design."
          className="min-h-[2.75rem] flex-1 rounded-xl border border-white/10 bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground/30" />
        <button type="submit" disabled={asking || !request.trim()} className={`${PRIMARY} self-start`}>{asking ? <><Loader2 className="size-3.5 animate-spin" /> Thinking…</> : 'Propose changes'}</button>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-amber-200/90">{error}</p>}

      {draft && (
        <div className="mt-4 space-y-3" data-study-proposal>
          <p className="text-xs text-foreground/50">Proposal for: &ldquo;{draft.request}&rdquo;</p>
          {stale && <p role="alert" className="text-xs text-amber-200/90">Your subjects changed since this was proposed. Ask again, or applying will be refused.</p>}
          {draft.questions.length > 0 && (
            <div className="rounded-xl border border-white/8 p-3 text-sm text-foreground/80">
              <p className="text-xs font-medium text-foreground/55">Nova needs to know</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">{draft.questions.map(q => <li key={q}>{q}</li>)}</ul>
            </div>
          )}
          {draft.items.length > 0 && (
            <ul className="space-y-2">
              {draft.items.map((item, i) => (
                <li key={i} className={`rounded-xl border p-3 ${item.edit.op.startsWith('remove') ? 'border-rose-300/25' : 'border-white/8'}`} data-proposal-item={item.edit.op}>
                  <label className="flex items-start gap-2.5 text-sm">
                    <input type="checkbox" checked={item.on} onChange={e => setItem(i, { ...item, on: e.target.checked })} className="mt-1 size-4 accent-keppel-400" />
                    <span className="min-w-0 flex-1">
                      <span className="text-foreground/90">{item.sentence}</span>
                      {item.why && <span className="mt-0.5 block text-xs text-foreground/50">{item.why}</span>}
                    </span>
                  </label>
                  <ProposalFields item={item} onChange={edit => setItem(i, { ...item, edit })} />
                </li>
              ))}
            </ul>
          )}
          {draft.dropped.length > 0 && (
            <details className="text-xs text-foreground/50">
              <summary className="cursor-pointer">{draft.dropped.length} suggestion{draft.dropped.length === 1 ? '' : 's'} Kio won&apos;t make</summary>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5">{draft.dropped.map((d, i) => <li key={i}>{d.what}: {d.reason}</li>)}</ul>
            </details>
          )}
          <div className="flex flex-wrap gap-2">
            {draft.items.length > 0 && (
              <button type="button" disabled={busy !== null || chosen.length === 0} className={PRIMARY} data-apply-proposal
                onClick={async () => { if (await onApply(chosen.map(c => c.edit), 'proposal')) keep(null) }}>
                {busy === 'proposal' ? <Loader2 className="size-3.5 animate-spin" /> : null} Apply {chosen.length} selected
              </button>
            )}
            <button type="button" onClick={() => keep(null)} className={SMALL} data-discard-proposal>Discard</button>
          </div>
        </div>
      )}
    </div>
  )
}

// The names in a proposed change, editable before it is applied.
function ProposalFields({ item, onChange }: { item: DraftItem; onChange: (e: StudyEdit) => void }) {
  const e = item.edit
  const field = `${FIELD} mt-2 w-full`
  switch (e.op) {
    case 'add_subject':
      return (
        <div className="ml-6 grid gap-1 sm:grid-cols-[1fr_2fr] sm:gap-2">
          <input aria-label="Subject name" value={e.name} onChange={x => onChange({ ...e, name: x.target.value })} className={field} />
          <input aria-label="Its topics" value={e.topics.join(', ')} onChange={x => onChange({ ...e, topics: lines(x.target.value) })} className={field} />
        </div>
      )
    case 'add_topics':
      return <div className="ml-6"><input aria-label="Topics to add" value={e.names.join(', ')} onChange={x => onChange({ ...e, names: lines(x.target.value) })} className={field} /></div>
    case 'rename_subject':
    case 'rename_topic':
      return <div className="ml-6"><input aria-label="New name" value={e.name} onChange={x => onChange({ ...e, name: x.target.value })} className={field} /></div>
    default:
      return null
  }
}
