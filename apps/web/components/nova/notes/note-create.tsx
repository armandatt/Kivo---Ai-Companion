'use client'

// Starting a note. Two ways, side by side, neither forced:
//   Start writing   the editor at once, with the title and place chosen here;
//   Draft with Nova Nova's editor proposes a title, an outline that suits the
//                   material and where to file it (POST /api/nova/notes/propose),
//                   from what the learner says and the files they give.
// The proposal is theirs to change: title, outline and place are edited here,
// another outline can be asked for, and nothing exists until Create note,
// which makes one note through the ordinary route (once, however often it is
// pressed). Asking again never makes a note. Nova's place is one of their own
// subjects or topics; a topic it suggests adding is made only on their click.

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, Check, FileText, Loader2, Paperclip, PenLine, RefreshCw, Sparkles } from 'lucide-react'
import type { NoteSubjectOption } from '@repo/api/nova/product/notes.types'
import { NOTE_TITLE_MAX } from '@repo/api/nova/product/notes.types'
import { PROPOSAL_INTENT_MAX, type NoteProposal, type NoteProposalResponse } from '@repo/api/nova/product/note-proposal.types'
import { ACCEPT, AttachmentTray, useAttachments, useDropZone } from '../attachments'
import { DestinationPicker } from './destination-picker'
import { NO_SUBJECT, destinationFor, destinationsOf, type Destination } from './note-destinations'
import { NoteBody } from './note-body'
import { createNote } from './notes-api'
import { createTopic } from './paper-api'

export type StartChoice = { title: string; subjectId: string; topicName: string }

const quiet = 'inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/12 px-4 text-sm font-medium text-foreground/85 transition-colors hover:bg-white/5 disabled:opacity-50'
const nova  = 'inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-action px-4 text-sm font-semibold text-action-foreground transition-colors hover:bg-action-hover disabled:opacity-50'

async function propose(body: object): Promise<NoteProposalResponse> {
  try {
    const res = await fetch('/api/nova/notes/propose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => null) as NoteProposalResponse | { ok: false; message?: string } | null
    if (data && 'ok' in data && data.ok) return data
    return { ok: false, error: 'unavailable', message: (data as { message?: string } | null)?.message ?? 'Nova couldn’t draft that. Try again, or start writing.' }
  } catch {
    return { ok: false, error: 'unavailable', message: 'Kivo couldn’t be reached. Try again, or start writing.' }
  }
}

export function NoteCreate({ subjects, initial, reloadSubjects, onBlank, onCreated }: {
  subjects: NoteSubjectOption[]
  initial: StartChoice
  reloadSubjects: () => Promise<NoteSubjectOption[] | null>
  onBlank: (choice: StartChoice) => void
  onCreated: (noteId: string) => void
}) {
  const [title, setTitle] = useState(initial.title)
  const [intent, setIntent] = useState('')
  const all = useMemo(() => destinationsOf(subjects), [subjects])
  const [place, setPlace] = useState<Destination>(() => destinationFor(destinationsOf(subjects), initial.subjectId || null, initial.topicName || null))
  const files = useAttachments()
  const zone = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const drop = useDropZone(zone, list => files.add(list))

  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proposal, setProposal] = useState<NoteProposal | null>(null)
  const [outline, setOutline] = useState('')
  const [preview, setPreview] = useState(false)
  const [creating, setCreating] = useState(false)
  const [topicState, setTopicState] = useState<'idle' | 'making' | 'made' | string>('idle')

  const canAsk = !asking && !files.preparing && !files.blocked && (title.trim() || intent.trim() || files.items.length > 0)

  async function ask(again = false) {
    if (!canAsk) return
    setAsking(true); setError(null)
    const r = await propose({ title: title.trim(), intent: intent.trim(), files: files.uploads().map(f => ({ name: f.name, data: f.data })), ...(again && outline ? { previous: outline } : {}) })
    setAsking(false)
    if (!r.ok) { setError(r.message); return }
    const p = r.proposal
    setProposal(p); setOutline(p.outline); setTitle(p.title); setPreview(false); setTopicState('idle')
    // Nova's place is chosen; the learner can change it below.
    if (p.destination) setPlace(destinationFor(all, p.destination.subjectId, p.destination.topicName))
  }

  async function makeTopic() {
    const nt = proposal?.newTopic
    if (!nt || topicState === 'making') return
    setTopicState('making')
    const r = await createTopic(nt.subjectId, nt.name)
    if (!r.ok) { setTopicState(r.message); return }
    const next = await reloadSubjects()
    const made = next ? destinationsOf(next).find(d => d.subjectId === nt.subjectId && d.topicName?.toLowerCase() === nt.name.toLowerCase()) : null
    if (made) { setPlace(made); setTopicState('made') } else setTopicState('The topic was made; choose it below.')
  }

  // Once, however fast it is pressed: the state below lands a render later.
  const sending = useRef(false)
  async function create() {
    if (sending.current || !title.trim()) return
    sending.current = true
    setCreating(true); setError(null)
    const r = await createNote({ title: title.trim(), body: outline, subjectId: place.subjectId, topicName: place.topicName, once: true })
    if (!r.ok) { sending.current = false; setCreating(false); setError(r.message); return }
    onCreated(r.note.id)
  }

  const blank = () => onBlank({ title: title.trim(), subjectId: place.subjectId ?? '', topicName: place.topicName ?? '' })

  return (
    <div className="mx-auto w-full max-w-3xl pb-16 pt-8 lg:pt-4" data-note-create>
      <div className="flex items-center gap-2">
        <Link href="/notes" className="inline-flex items-center gap-1.5 text-sm text-foreground/50 transition-colors hover:text-foreground"><ArrowLeft className="size-4" /> Notes</Link>
      </div>
      <h1 className="mt-5 font-serif text-3xl font-semibold tracking-tight text-foreground">New note</h1>

      <div className="mt-6 space-y-5">
        <div>
          <label htmlFor="new-note-title" className="mb-1.5 block text-xs text-foreground/60">Title</label>
          <input id="new-note-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={NOTE_TITLE_MAX} autoFocus
            onKeyDown={e => { if (e.key === 'Enter' && !proposal && title.trim()) blank() }}
            placeholder="e.g. Backpropagation, lecture 6" data-new-title
            className="h-12 w-full rounded-xl border border-white/10 bg-transparent px-4 font-serif text-xl text-foreground placeholder:text-foreground/30 focus:border-action/60 focus:outline-none" />
        </div>

        {!proposal && (
          <div ref={zone} className="relative rounded-2xl border border-white/8 bg-card/40 p-4" data-drop-zone>
            {drop.overlay}
            <label htmlFor="new-note-intent" className="mb-1.5 flex items-center gap-1.5 text-xs text-foreground/60"><Sparkles className="size-3.5 text-nova-ink" /> For Nova&apos;s editor (optional): what is this note for?</label>
            <textarea id="new-note-intent" value={intent} onChange={e => setIntent(e.target.value)} onPaste={files.onPaste} maxLength={PROPOSAL_INTENT_MAX} rows={3}
              placeholder="e.g. Notes from today's lecture on backprop, for the midterm. Or attach the slides or a paper."
              className="w-full resize-none rounded-xl border border-white/10 bg-transparent px-3.5 py-2.5 text-sm leading-relaxed text-foreground placeholder:text-foreground/30 focus:border-action/60 focus:outline-none" data-new-intent />
            <AttachmentTray items={files.items} onRemove={files.remove} onRetry={files.retry} className="mt-2" />
            <div className="mt-2 flex items-center gap-2">
              <input ref={picker} type="file" accept={ACCEPT} multiple hidden onChange={e => { if (e.target.files) files.add(e.target.files); e.target.value = '' }} data-file-input />
              <button type="button" onClick={() => picker.current?.click()} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-foreground/65 hover:bg-white/6 hover:text-foreground">
                <Paperclip className="size-3.5" /> Attach slides, a paper or a photo
              </button>
              <span className="text-[11px] text-subtle">PDF or image, up to 3 files and 3 MB. Drop or paste here.</span>
            </div>
          </div>
        )}

        {proposal && (
          <section className="rounded-2xl border border-nova/25 bg-nova/[0.03] p-4" aria-labelledby="proposal-title" data-proposal>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="proposal-title" className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><Sparkles className="size-4 text-nova-ink" /> Nova&apos;s outline</h2>
              <span className="text-xs text-subtle">Change anything. Nothing is created until you do.</span>
              <div role="tablist" aria-label="Edit or preview" className="ml-auto inline-flex rounded-lg border border-white/10 p-0.5 text-xs">
                {(['Edit', 'Preview'] as const).map(l => (
                  <button key={l} type="button" role="tab" aria-selected={(l === 'Preview') === preview} onClick={() => setPreview(l === 'Preview')}
                    className={`rounded-md px-2.5 py-1 ${(l === 'Preview') === preview ? 'bg-white/10 text-foreground' : 'text-foreground/55 hover:text-foreground'}`}>{l}</button>
                ))}
              </div>
            </div>
            {proposal.files.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs" aria-label="Your files" data-proposal-files>
                {proposal.files.map(f => (
                  <li key={f.name} className={`flex items-start gap-1.5 ${f.read ? 'text-foreground/70' : 'text-amber-200/90'}`} data-file-read={f.read}>
                    {f.read ? <Check className="mt-0.5 size-3.5 shrink-0 text-nova-ink" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}
                    <span><span className="font-medium">{f.name}</span>: {f.read ? 'read' : 'not read'}{f.note ? `. ${f.note}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3">
              {preview
                ? <div className="max-h-[28rem] overflow-y-auto rounded-xl border border-white/8 px-4 py-2" data-proposal-preview><NoteBody body={outline} links={[]} compact /></div>
                : <textarea value={outline} onChange={e => setOutline(e.target.value)} rows={14} aria-label="The outline, in Markdown" data-proposal-outline
                    className="w-full resize-y rounded-xl border border-white/10 bg-background/60 px-3.5 py-3 font-mono text-[13px] leading-[1.7] text-foreground/90 focus:border-action/60 focus:outline-none" />}
            </div>
          </section>
        )}

        <div>
          <DestinationPicker subjects={subjects} value={place} onChange={setPlace} onSubjectsChanged={reloadSubjects} />
          {proposal?.destination && place.subjectId === proposal.destination.subjectId && place.topicName === proposal.destination.topicName && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-foreground/60" data-proposal-place><Sparkles className="size-3 text-nova-ink" /> Nova&apos;s pick{proposal.destination.reason ? `: ${proposal.destination.reason}` : ''}</p>
          )}
          {proposal && !proposal.destination && !proposal.newTopic && <p className="mt-1.5 text-xs text-subtle">Nova didn&apos;t find a subject or topic of yours that fits. Choose one, or leave it unfiled.</p>}
          {proposal?.newTopic && topicState !== 'made' && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-nova/30 px-3 py-2 text-xs text-foreground/75" data-proposal-new-topic>
              <span>No topic of yours fits. Nova suggests adding <b className="text-foreground">{proposal.newTopic.name}</b> under {proposal.newTopic.path.join(' › ')}{proposal.newTopic.reason ? `: ${proposal.newTopic.reason}` : '.'}</span>
              <button type="button" onClick={() => void makeTopic()} disabled={topicState === 'making'} className="ml-auto inline-flex h-7 items-center gap-1 rounded-lg border border-nova/35 px-2.5 font-medium text-nova-ink hover:bg-nova/10 disabled:opacity-50">
                {topicState === 'making' ? <Loader2 className="size-3 animate-spin" /> : null} Add this topic
              </button>
              {topicState !== 'idle' && topicState !== 'making' && <span role="alert" className="basis-full text-red-300">{topicState}</span>}
            </div>
          )}
        </div>

        {error && <p role="alert" className="text-sm text-red-300" data-create-error>{error}</p>}

        <div className="flex flex-col-reverse gap-2 border-t border-white/8 pt-5 sm:flex-row sm:items-center">
          {proposal ? (
            <>
              <button type="button" onClick={() => { setProposal(null); setOutline('') }} className="text-sm text-foreground/55 hover:text-foreground">Back</button>
              <span className="flex-1" />
              <button type="button" onClick={blank} className={quiet} data-start-blank><PenLine className="size-4" /> Start blank instead</button>
              <button type="button" onClick={() => void ask(true)} disabled={!canAsk} className={quiet} data-regenerate>
                {asking ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Another outline
              </button>
              <button type="button" onClick={() => void create()} disabled={creating || asking || !title.trim()} className={nova} data-create-note>
                {creating ? <><Loader2 className="size-4 animate-spin" /> Creating…</> : <><FileText className="size-4" /> Create note</>}
              </button>
            </>
          ) : (
            <>
              <span className="flex-1 text-xs text-subtle">Start writing straight away, or let Nova&apos;s editor set it up first.</span>
              <button type="button" onClick={blank} className={quiet} data-start-blank><PenLine className="size-4" /> Start writing</button>
              <button type="button" onClick={() => void ask()} disabled={!canAsk} className={nova} title={canAsk ? undefined : 'Give it a title, say what it is for, or attach a file'} data-draft-with-nova>
                {asking ? <><Loader2 className="size-4 animate-spin" /> {files.items.length ? 'Reading your files…' : 'Drafting…'}</> : <><Sparkles className="size-4" /> Draft with Nova</>}
              </button>
            </>
          )}
        </div>
        {place === NO_SUBJECT && subjects.length === 0 && <p className="text-xs text-subtle">Nova doesn&apos;t know your subjects yet, so this note can&apos;t be filed under one. You can still write it.</p>}
      </div>
    </div>
  )
}
