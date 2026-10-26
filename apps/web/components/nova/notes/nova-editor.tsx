'use client'

// Nova's editor beside the note. The learner asks for an edit (a structure,
// a clearer passage, an explanation filled out, repetition taken out, a
// summary, examples, or what the tutor wrote worked in), and Nova proposes
// changes: each shown where it goes, with what it removes struck through and
// what it adds in Nova's colour. The learner keeps the ones they want and
// applies them; nothing changes before that (POST /api/nova/notes/:id/edit
// only proposes).
//
// Applying goes through onApply, which checks every change against the note
// as it is on screen (note-outline.ts applyEdits): if the words a change was
// proposed on have changed since, nothing is applied and Nova is asked
// again. What is applied saves through the note's own save, with Undo.
//
// The status line says what is happening, as it happens: saving the latest
// edits, Nova drafting, a proposal waiting for the learner, applied.

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Eye, Loader2, RotateCcw, Send, Square, Trash2, X } from 'lucide-react'
import type { NoteDetail } from '@repo/api/nova/product/notes.types'
import type { EditChange } from '@repo/api/nova/product/note-outline'
import type { EditKind, EditProposal } from '@repo/api/nova/product/note-edit.types'
import { EDIT_INSTRUCTION_MAX } from '@repo/api/nova/product/note-edit.types'
import { NoteBody } from './note-body'
import { proposeEdit } from './tutor-api'
import type { Passage } from './nova-tutor'

export const EDIT_LABEL: Record<EditKind, string> = {
  structure: 'Improve the structure', rewrite: 'Rewrite more clearly', expand: 'Expand what’s thin', grammar: 'Fix grammar and wording',
  dedupe: 'Remove repetition', summary: 'Add a summary', takeaways: 'Add key takeaways', examples: 'Add examples',
  integrate: 'Work it into the note', custom: 'Edit',
}
const EDIT_WORK: Record<EditKind, string> = {
  structure: 'Drafting a structure', rewrite: 'Drafting a rewrite', expand: 'Drafting an expansion', grammar: 'Checking the wording',
  dedupe: 'Looking for repetition', summary: 'Drafting a summary', takeaways: 'Drafting takeaways', examples: 'Drafting examples',
  integrate: 'Finding where it belongs', custom: 'Drafting an edit',
}

export interface EditAsk { kind: EditKind; instruction?: string; passage?: string; material?: string; label?: string }
type Entry =
  | { id: string; ask: EditAsk; state: 'proposed' | 'applied' | 'discarded' | 'conflict'; proposal: EditProposal; skip: string[]; note?: string }
  | { id: string; ask: EditAsk; state: 'error'; message: string }
type Pending = { ask: EditAsk; stage: 'saving' | 'drafting'; controller: AbortController }

export type ApplyResult = { ok: true } | { ok: false; conflicts: string[]; message: string }

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
const chip = 'rounded-full border border-white/12 px-2.5 py-1 text-xs text-foreground/80 transition-colors hover:border-nova/50 hover:text-foreground disabled:opacity-40'

const OP_WORD: Record<EditChange['op'], string> = { replace: 'Changes', insert: 'Adds', delete: 'Removes' }

function ChangeView({ c, on, onToggle, onShow, disabled }: { c: EditChange; on: boolean; onToggle: () => void; onShow: () => void; disabled: boolean }) {
  return (
    <li className={`py-2.5 ${on ? '' : 'opacity-55'}`} data-edit-change={c.op}>
      <div className="flex items-center gap-2 text-xs">
        <label className="inline-flex min-w-0 flex-1 cursor-pointer items-center gap-2">
          <input type="checkbox" className="accent-[var(--nova)]" checked={on} disabled={disabled} onChange={onToggle} aria-label={`Keep: ${OP_WORD[c.op].toLowerCase()} ${c.section ? `in ${c.section}` : ''}`} />
          <span className="font-semibold text-foreground/85">{OP_WORD[c.op]}</span>
          <span className="truncate text-subtle">{c.op === 'insert' ? (c.section ? `in ${c.section}` : 'at the top') : c.section ? `in ${c.section}` : 'before the first heading'}</span>
        </label>
        <button type="button" onClick={onShow} className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-nova-ink hover:bg-nova/10" data-edit-show><Eye className="size-3" /> Show</button>
      </div>
      {c.why && <p className="mt-1 text-xs text-foreground/60">{c.why}</p>}
      {c.before && (
        // What goes: struck through, never silently.
        <p className="mt-1.5 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-md bg-red-400/[0.06] px-2.5 py-1.5 text-[13px] leading-relaxed text-foreground/55 line-through decoration-red-300/50" data-edit-before>{c.before}</p>
      )}
      {c.after && (
        <div className="mt-1.5 rounded-md border-l-2 border-nova/50 bg-nova/[0.05] px-2.5 py-1.5" data-edit-after><NoteBody body={c.after} links={[]} compact /></div>
      )}
    </li>
  )
}

export function NovaEditor({ note, passage, onClearPassage, ensureSaved, version, onApply, onShow, seed, onSeedUsed, header }: {
  note: NoteDetail | null
  passage: Passage | null
  onClearPassage: () => void
  ensureSaved: () => Promise<boolean>
  version: () => string | null
  // Applies the kept changes to the note on screen; refused whole when any no longer fits.
  onApply: (changes: EditChange[], label: string) => ApplyResult
  // Shows where a change goes in the note.
  onShow: (change: EditChange) => void
  // Material sent from the tutor to work into the note.
  seed: { material: string; label: string } | null
  onSeedUsed: () => void
  header: (status: React.ReactNode, working: boolean) => React.ReactNode
}) {
  const noteId = note?.id ?? null
  const [entries, setEntries] = useState<Entry[]>([])
  const [pending, setPending] = useState<Pending | null>(null)
  const [input, setInput] = useState('')
  const [announce, setAnnounce] = useState('')
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  // Refining the open proposal: the next message is a change to it.
  const [refining, setRefining] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setEntries([]); setChecked({}) }, [noteId])
  useEffect(() => () => pending?.controller.abort(), [noteId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [entries.length, pending?.stage])

  const send = useCallback(async (ask: EditAsk) => {
    if (!noteId || pending) return
    const controller = new AbortController()
    setPending({ ask, stage: 'saving', controller })
    setAnnounce('')
    const saved = await ensureSaved()
    if (controller.signal.aborted) return
    if (!saved) {
      setPending(null)
      setEntries(list => [...list, { id: newId(), ask, state: 'error', message: "Your latest edits aren't saved, so Nova would edit an older version of the note. Save them, then try again." }])
      return
    }
    setPending(p => (p ? { ...p, stage: 'drafting' } : p))
    const res = await proposeEdit(noteId, { kind: ask.kind, instruction: ask.instruction, selection: ask.passage, material: ask.material, noteVersion: version() ?? undefined }, controller.signal)
    setPending(null)
    if (!res.ok) {
      if (res.error === 'aborted') return
      setEntries(list => [...list, { id: newId(), ask, state: 'error', message: res.message }])
      setAnnounce(res.message)
      return
    }
    setEntries(list => [...list.map(e => (e.state === 'proposed' ? { ...e, state: 'discarded' as const } : e)), { id: newId(), ask, state: 'proposed', proposal: res as EditProposal, skip: [] }])
    setAnnounce(res.changes.length ? `Nova proposed ${res.changes.length} change${res.changes.length === 1 ? '' : 's'}. Review them before applying.` : 'Nova has a question.')
  }, [noteId, pending, ensureSaved, version])

  // From the tutor: "work this into the note".
  useEffect(() => {
    if (!seed || !noteId || pending) return
    onSeedUsed()
    void send({ kind: 'integrate', material: seed.material, label: `Work in: ${seed.label}` })
  }, [seed, noteId, pending, send, onSeedUsed])

  function submit() {
    const text = input.trim()
    if (!text || pending) return
    setInput('')
    const open = entries.find(e => e.state === 'proposed')
    if (refining && open && open.state === 'proposed') {
      // The proposal goes back with what to change in it, as material to work from.
      setRefining(false)
      const was = open.proposal.changes.map(c => `${c.op} ${c.section ? `in ${c.section}` : ''}:\n${c.after || c.before}`).join('\n\n').slice(0, 5_500)
      void send({ kind: open.ask.kind === 'integrate' ? 'integrate' : 'custom', instruction: `${text} (a change to the proposal below)`.slice(0, EDIT_INSTRUCTION_MAX), passage: open.ask.passage, material: `${open.ask.material ? `${open.ask.material.slice(0, 2_000)}\n\n` : ''}THE PROPOSAL SO FAR:\n${was}`.slice(0, 6_000), label: text })
      return
    }
    void send({ kind: 'custom', instruction: text.slice(0, EDIT_INSTRUCTION_MAX), passage: passage?.text })
  }

  // A change to one proposal (never to an error line).
  type Proposed = Extract<Entry, { proposal: EditProposal }>
  const update = (id: string, change: (e: Proposed) => Partial<Proposed>) =>
    setEntries(list => list.map(x => (x.id === id && x.state !== 'error' ? { ...x, ...change(x) } : x)))

  function apply(e: Proposed) {
    const kept = e.proposal.changes.filter(c => !e.skip.includes(c.id))
    if (!kept.length) return
    const result = onApply(kept, e.ask.label ?? EDIT_LABEL[e.ask.kind])
    if (result.ok) {
      update(e.id, () => ({ state: 'applied' }))
      setAnnounce(`Applied ${kept.length} change${kept.length === 1 ? '' : 's'}. It saves in a moment.`)
    } else {
      update(e.id, () => ({ state: 'conflict', note: result.message }))
      setAnnounce(result.message)
    }
  }

  const open = entries.find(e => e.state === 'proposed')
  const status = pending
    ? (pending.stage === 'saving' ? 'Saving your latest edits' : `Reading the note · ${EDIT_WORK[pending.ask.kind]}`)
    : open && open.state === 'proposed' ? (open.proposal.changes.length ? 'Preview ready · waiting for you' : 'Waiting for your answer')
    : entries.at(-1)?.state === 'applied' ? 'Applied'
    : entries.at(-1)?.state === 'error' || entries.at(-1)?.state === 'conflict' ? 'That didn’t work'
    : 'Ready when you are'
  const empty = !note?.body.trim()
  const actions: EditKind[] = empty ? ['structure'] : passage ? ['rewrite', 'expand', 'grammar', 'examples'] : ['structure', 'summary', 'dedupe', 'takeaways', 'grammar', 'examples']

  return (
    <section className="flex h-full min-h-0 flex-col bg-background" aria-label="Nova, your editor" data-nova-editor data-editor-state={pending ? pending.stage : open ? 'waiting' : 'idle'}>
      {header(<>{pending && <Loader2 className="size-3 animate-spin" aria-hidden />}{status}</>, !!pending)}

      <div ref={listRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4" data-editor-log>
        {!note ? (
          <p className="text-sm leading-relaxed text-foreground/60">Save this note first. Then Nova can help you edit it.</p>
        ) : entries.length === 0 && !pending ? (
          <div className="space-y-2 text-sm leading-relaxed text-foreground/70" data-editor-empty>
            <p>Ask Nova to improve this note: a clearer structure, a passage rewritten, an explanation filled out, a summary where it belongs.</p>
            <p className="text-xs text-subtle">Nova proposes; you see every change in place before anything is applied, and you can undo it after.</p>
          </div>
        ) : null}

        {entries.map(e => (
          <article key={e.id} className="nova-reveal" data-edit-entry={e.state}>
            <p className="mb-2 text-sm text-foreground/90" data-edit-ask>
              <span className="text-foreground/50">You asked: </span>{e.ask.instruction ?? e.ask.label ?? EDIT_LABEL[e.ask.kind]}
              {e.ask.passage && <span className="mt-1 block line-clamp-2 border-l-2 border-nova/40 pl-2 text-xs italic text-foreground/55">{e.ask.passage}</span>}
            </p>
            {e.state === 'error' ? (
              <div role="alert" className="text-sm text-foreground/80" data-editor-error>
                <p>{e.message}</p>
                <button type="button" disabled={!!pending} onClick={() => { setEntries(list => list.filter(x => x.id !== e.id)); void send(e.ask) }} className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-nova-ink hover:underline disabled:opacity-50"><RotateCcw className="size-3.5" /> Try again</button>
              </div>
            ) : (
              <div>
                <p className="text-sm leading-relaxed text-foreground/85">{e.proposal.question ?? e.proposal.summary}</p>
                {e.proposal.partial && <p className="mt-1 text-xs text-subtle">This note is long: Nova worked on the part around what you asked about.</p>}
                {e.proposal.changes.length > 0 && (
                  <ul className="mt-2 divide-y divide-white/6 border-y border-white/6" data-edit-changes>
                    {e.proposal.changes.map(c => (
                      <ChangeView key={c.id} c={c} on={!e.skip.includes(c.id)} disabled={e.state !== 'proposed'} onShow={() => onShow(c)}
                        onToggle={() => update(e.id, x => ({ skip: x.skip.includes(c.id) ? x.skip.filter(id => id !== c.id) : [...x.skip, c.id] }))} />
                    ))}
                  </ul>
                )}
                {e.proposal.dropped.length > 0 && <p className="mt-1.5 text-[11px] text-subtle">Left out: {e.proposal.dropped.join('; ')}.</p>}
                {e.state === 'proposed' && e.proposal.changes.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {e.proposal.large && (
                      <label className="flex items-start gap-2 rounded-lg bg-amber-300/[0.06] px-2.5 py-2 text-xs text-amber-200" data-edit-large>
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        <span className="flex-1">This rewrites most of your note. Read it through before applying.</span>
                        <input type="checkbox" className="mt-0.5 accent-[var(--nova)]" checked={!!checked[e.id]} onChange={ev => setChecked(c => ({ ...c, [e.id]: ev.target.checked }))} aria-label="I've read it" />
                      </label>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => apply(e)} disabled={e.skip.length === e.proposal.changes.length || (e.proposal.large && !checked[e.id])}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-action px-3 text-xs font-semibold text-action-foreground transition-colors hover:bg-action-hover disabled:opacity-50" data-edit-apply>
                        <Check className="size-3.5" /> Apply {e.proposal.changes.length - e.skip.length === e.proposal.changes.length ? (e.proposal.changes.length === 1 ? 'it' : 'all') : `${e.proposal.changes.length - e.skip.length}`}
                      </button>
                      <button type="button" onClick={() => { setRefining(true); inputRef.current?.focus() }} className="inline-flex h-8 items-center rounded-lg border border-white/12 px-3 text-xs font-medium text-foreground/80 hover:bg-white/5" data-edit-refine>Refine</button>
                      <button type="button" onClick={() => update(e.id, () => ({ state: 'discarded' }))} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-subtle hover:text-foreground" data-edit-discard><Trash2 className="size-3.5" /> Discard</button>
                    </div>
                  </div>
                )}
                {e.state === 'applied' && <p className="mt-2 flex items-center gap-1.5 text-xs text-foreground/65" data-edit-applied><Check className="size-3.5 text-keppel-300" /> Applied to your note. Undo is at the bottom of the note.</p>}
                {e.state === 'discarded' && <p className="mt-2 text-xs text-subtle">Not applied.</p>}
                {e.state === 'conflict' && (
                  <div role="alert" className="mt-2 text-xs text-amber-200" data-edit-conflict>
                    <p>{e.note}</p>
                    <button type="button" disabled={!!pending} onClick={() => void send(e.ask)} className="mt-1 inline-flex items-center gap-1.5 font-medium text-nova-ink hover:underline disabled:opacity-50"><RotateCcw className="size-3.5" /> Ask again on the note as it is now</button>
                  </div>
                )}
              </div>
            )}
          </article>
        ))}

        {pending && (
          <div className="space-y-2" aria-hidden data-editor-working>
            <div className="h-3 w-3/4 animate-pulse rounded bg-white/6" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-white/5" />
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-white/6 px-4 pb-3 pt-2.5">
        {passage && (
          <div className="mb-2 flex items-start gap-2 rounded-lg bg-nova/[0.06] px-2.5 py-1.5" data-editor-passage>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-nova-ink">Editing this passage</p>
              <p className="line-clamp-2 text-xs text-foreground/75">{passage.text}</p>
            </div>
            <button type="button" onClick={onClearPassage} className="text-subtle hover:text-foreground" aria-label="Stop editing this passage"><X className="size-3.5" /></button>
          </div>
        )}
        {note && (
          <div className="mb-2 flex flex-wrap gap-1.5" data-editor-actions>
            {actions.map(k => (
              <button key={k} type="button" className={chip} disabled={!!pending} onClick={() => void send({ kind: k, passage: passage?.text })} data-editor-action={k}>{EDIT_LABEL[k]}</button>
            ))}
          </div>
        )}
        <form onSubmit={e => { e.preventDefault(); submit() }} className="flex items-end gap-2">
          <label htmlFor="editor-input" className="sr-only">Tell Nova what to change</label>
          <textarea id="editor-input" ref={inputRef} rows={1} value={input} maxLength={EDIT_INSTRUCTION_MAX} disabled={!note}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } if (e.key === 'Escape' && pending) { pending.controller.abort(); setPending(null) } }}
            placeholder={refining ? 'What should be different in the proposal?' : passage ? 'What should change in this passage?' : 'Tell Nova what to change…'}
            className="max-h-32 min-h-10 flex-1 resize-none rounded-xl border border-white/10 bg-transparent px-3 py-2.5 text-sm text-foreground placeholder:text-foreground/35 focus:border-nova/60 focus:outline-none disabled:opacity-50"
            data-editor-input />
          {pending ? (
            <button type="button" onClick={() => { pending.controller.abort(); setPending(null) }} className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/12 text-foreground/80 hover:bg-white/5" title="Stop (Esc)" aria-label="Stop"><Square className="size-3.5" /></button>
          ) : (
            <button type="submit" disabled={!input.trim() || !note} className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-action text-action-foreground transition-colors hover:bg-action-hover disabled:opacity-40" title="Send (Enter)" aria-label="Send"><Send className="size-4" /></button>
          )}
        </form>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
    </section>
  )
}

