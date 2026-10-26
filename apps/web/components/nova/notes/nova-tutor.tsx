'use client'

// Nova, the tutor beside the note. The learner asks about the note or a
// passage they chose, and Nova teaches from it: an explanation, an example,
// a walk-through, a question to check they have it, an exercise and its
// feedback, a quiz, ideas, flashcards, an organised version. Each request is
// one call to /api/nova/notes/:id/tutor, made only when the learner asks.
//
// What the panel says it is doing is what is happening: saving the latest
// edits first (so Nova reads the note as it is on screen), then one request
// in flight, named by what was asked; "waiting for your answer" only while
// an exercise is open. Nothing is streamed: a reply arrives whole and eases
// in part by part (at once with reduced motion). Stop abandons the request;
// nothing is changed either way. Anything that goes into the note goes
// through onInsert, which previews it and asks.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RotateCcw, Send, Square, Trash2, X } from 'lucide-react'
import type { NoteDetail } from '@repo/api/nova/product/notes.types'
import type { TutorMode, TutorReply } from '@repo/api/nova/product/note-tutor.types'
import { TUTOR_MESSAGE_MAX } from '@repo/api/nova/product/note-tutor.types'
import { KivoMark } from '@/components/brand/kivo-brand'
import { askTutor } from './tutor-api'
import { ReplyView, type Insert } from './tutor-playground'
import {
  MODE_LABEL, MODE_WORK, askLine, historyOf, loadConversation, nextActions, openExercise, resultsOf, saveConversation,
  type TutorAsk, type TutorEntry, type TutorWork,
} from './tutor-session'

export interface Passage { text: string }

type Pending = { ask: TutorAsk; stage: 'saving' | 'asking'; since: number; controller: AbortController }

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
const tabStore = () => { try { return window.sessionStorage } catch { return null } }

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t) }, [])
  return <span className="tabular-nums">{Math.max(0, Math.round((now - since) / 1000))}s</span>
}

// Nova's mark: still when idle, a slow ring while working.
function Identity({ working }: { working: boolean }) {
  return (
    <span aria-hidden className="relative grid size-8 shrink-0 place-items-center rounded-full bg-nova/12 ring-1 ring-nova/30">
      {working && <span className="absolute inset-0 rounded-full ring-2 ring-nova/40 kivo-node-pulse" />}
      <KivoMark size={16} className="text-nova-ink" />
    </span>
  )
}

export function NovaTutor({ note, passage, onClearPassage, ensureSaved, version, onInsert, onUseTitle, onClose, autoAsk, onAutoAsked, inputRef }: {
  note: NoteDetail | null
  passage: Passage | null
  onClearPassage: () => void
  // Saves what is typed, if anything, so Nova reads the note on screen.
  // false: it could not be saved.
  ensureSaved: () => Promise<boolean>
  // The note's saved version, read when a request is sent.
  version: () => string | null
  onInsert: Insert
  onUseTitle: (title: string) => void
  onClose?: () => void
  // A mode to run once on open (the capture page's "Organise with Nova").
  autoAsk?: TutorMode | null
  onAutoAsked?: () => void
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
}) {
  const noteId = note?.id ?? null
  const [entries, setEntries] = useState<TutorEntry[]>([])
  const [fresh, setFresh] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [input, setInput] = useState('')
  const [announce, setAnnounce] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const ownInput = useRef<HTMLTextAreaElement>(null)
  const box = inputRef ?? ownInput
  const entriesRef = useRef(entries)
  entriesRef.current = entries

  // Each note has its own conversation, kept in this tab.
  useEffect(() => { setEntries(noteId ? loadConversation(tabStore(), noteId) : []); setFresh(null) }, [noteId])
  useEffect(() => { if (noteId) saveConversation(tabStore(), noteId, entries) }, [noteId, entries])
  // A request still running for the note that was left is abandoned.
  useEffect(() => () => pending?.controller.abort(), [noteId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [entries.length, pending?.stage])

  const send = useCallback(async (ask: TutorAsk) => {
    if (!noteId || pending) return
    const before = entriesRef.current
    const evaluating = ask.mode === 'evaluate' ? openExercise(before)?.entry.id ?? null : null
    const controller = new AbortController()
    setEntries(list => [...list, { id: newId(), role: 'learner', ask, at: Date.now() }])
    setPending({ ask, stage: 'saving', since: Date.now(), controller })
    setAnnounce('')

    const saved = await ensureSaved()
    if (controller.signal.aborted) return
    if (!saved) {
      setPending(null)
      setEntries(list => [...list, { id: newId(), role: 'error', ask, at: Date.now(), message: "Your latest edits aren't saved, so Nova would read an older version of the note. Save them, then try again." }])
      return
    }
    setPending(p => (p ? { ...p, stage: 'asking' } : p))
    const res = await askTutor(noteId, {
      mode: ask.mode, message: ask.message, selection: ask.passage, noteVersion: version() ?? undefined,
      history: historyOf(before), results: resultsOf(before), exercise: ask.exercise, answer: ask.answer,
    }, controller.signal)
    setPending(null)
    if (!res.ok) {
      if (res.error === 'aborted') { setEntries(list => [...list, { id: newId(), role: 'stopped', ask, at: Date.now() }]); return }
      setEntries(list => [...list, { id: newId(), role: 'error', ask, at: Date.now(), message: res.message }])
      setAnnounce(res.message)
      return
    }
    const id = newId()
    setFresh(id)
    setEntries(list => [
      ...list.map(e => (e.id === evaluating && e.role === 'nova' ? { ...e, work: { ...e.work, checked: true } } : e)),
      { id, role: 'nova', reply: res as TutorReply, work: {}, at: Date.now() },
    ])
    setAnnounce(`Nova answered: ${MODE_LABEL[ask.mode]}.`)
  }, [noteId, pending, ensureSaved, version])

  // The capture page's "Organise with Nova": once, when the note is open.
  const autoRan = useRef(false)
  useEffect(() => {
    if (!autoAsk || !noteId || autoRan.current) return
    autoRan.current = true
    onAutoAsked?.()
    void send({ mode: autoAsk })
  }, [autoAsk, noteId, send, onAutoAsked])

  function stop() { pending?.controller.abort(); setPending(null) }

  function submit() {
    const text = input.trim()
    if (!text || pending) return
    setInput('')
    void send({ mode: 'explain', message: text.slice(0, TUTOR_MESSAGE_MAX), passage: passage?.text })
  }

  const work = (id: string, change: Partial<TutorWork>) =>
    setEntries(list => list.map(e => (e.id === id && e.role === 'nova' ? { ...e, work: { ...e.work, ...change } } : e)))

  const last = useMemo(() => [...entries].reverse().find(e => e.role === 'nova') as Extract<TutorEntry, { role: 'nova' }> | undefined, [entries])
  const waiting = !pending && openExercise(entries) !== null
  const empty = !note?.body.trim()
  const actions = nextActions({ passage: !!passage, last: last?.reply ?? null, empty })
  const status = pending
    ? (pending.stage === 'saving' ? 'Saving your latest edits' : `${MODE_WORK[pending.ask.mode]}`)
    : waiting ? 'Waiting for your answer'
    : entries.at(-1)?.role === 'error' ? 'That didn’t work'
    : last ? 'Done' : 'Ready when you are'

  return (
    <section className="flex h-full min-h-0 flex-col bg-background" aria-label="Nova, your tutor" data-tutor data-tutor-state={pending ? pending.stage : waiting ? 'waiting' : 'idle'}>
      <header className="flex shrink-0 items-center gap-2.5 border-b border-white/6 px-3.5 py-2.5">
        <Identity working={!!pending} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Nova <span className="font-normal text-subtle">· your tutor</span></p>
          <p className="flex items-center gap-1.5 truncate text-[11px] text-subtle" data-tutor-status>
            {pending && <Loader2 className="size-3 animate-spin" aria-hidden />}
            {status}{pending && <> · <Elapsed since={pending.since} /></>}
          </p>
        </div>
        {entries.length > 0 && !pending && (
          <button type="button" onClick={() => { if (window.confirm('Start a new conversation? This one is cleared from this tab.')) { setEntries([]); setFresh(null) } }}
            className="inline-flex size-8 items-center justify-center rounded-lg text-subtle hover:bg-white/6 hover:text-foreground" title="New conversation" aria-label="New conversation">
            <Trash2 className="size-4" />
          </button>
        )}
        {onClose && (
          <button type="button" onClick={onClose} className="inline-flex size-8 items-center justify-center rounded-lg text-subtle hover:bg-white/6 hover:text-foreground" title="Close Nova" aria-label="Close Nova">
            <X className="size-4" />
          </button>
        )}
      </header>

      <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3.5 py-4" data-tutor-log>
        {!note ? (
          <p className="text-sm leading-relaxed text-foreground/60">Save this note first. Then Nova can teach you from it.</p>
        ) : entries.length === 0 && !pending ? (
          <div className="space-y-3 text-sm leading-relaxed text-foreground/70" data-tutor-empty>
            <p>{empty
              ? 'This note is empty. Paste or capture something into it, and Nova can organise it with you, or ask Nova anything to get started.'
              : 'Ask about anything in this note, or select a passage and ask about that. Nova teaches from what you wrote and says when it goes beyond it.'}</p>
            <p className="text-xs text-subtle">Nova reads this note and, when it helps, a few related notes and saved pages of yours. Nothing you ask here is stored or added to your note unless you choose to add it.</p>
          </div>
        ) : null}

        {entries.map(e => {
          if (e.role === 'learner') return (
            <div key={e.id} className="ml-8 rounded-2xl rounded-br-md bg-white/6 px-3 py-2 text-sm text-foreground" data-tutor-ask={e.ask.mode}>
              {e.ask.passage && <p className="mb-1 line-clamp-2 border-l-2 border-nova/40 pl-2 text-xs italic text-foreground/60">{e.ask.passage}</p>}
              {askLine(e.ask)}
            </div>
          )
          if (e.role === 'nova') return (
            <ReplyView key={e.id} reply={e.reply} work={e.work} fresh={fresh === e.id} busy={!!pending}
              onWork={c => work(e.id, c)} onAsk={a => void send(a)} onInsert={onInsert} onUseTitle={onUseTitle} />
          )
          if (e.role === 'stopped') return <p key={e.id} className="text-xs text-subtle">Stopped. Nothing was changed.</p>
          return (
            <div key={e.id} role="alert" className="rounded-xl border border-red-400/25 bg-red-400/[0.05] px-3 py-2.5 text-sm text-foreground/80" data-tutor-error>
              <p>{e.message}</p>
              <button type="button" disabled={!!pending} onClick={() => { setEntries(list => list.filter(x => x.id !== e.id)); void send(e.ask) }}
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-nova-ink hover:underline disabled:opacity-50" data-tutor-retry>
                <RotateCcw className="size-3.5" /> Try again
              </button>
            </div>
          )
        })}

        {pending && (
          <div className="space-y-2" aria-hidden data-tutor-working>
            <div className="h-3 w-3/4 animate-pulse rounded bg-white/6" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-white/5" />
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-white/6 px-3.5 pb-3 pt-2.5">
        {passage && (
          <div className="mb-2 flex items-start gap-2 rounded-xl border border-nova/25 bg-nova/[0.05] px-2.5 py-1.5" data-tutor-passage>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-nova-ink">Discussing{last?.reply.passage?.text === passage.text && last.reply.passage.heading ? ` · ${last.reply.passage.heading}` : ''}</p>
              <p className="line-clamp-2 text-xs text-foreground/75">{passage.text}</p>
            </div>
            <button type="button" onClick={onClearPassage} className="text-subtle hover:text-foreground" aria-label="Stop discussing this passage"><X className="size-3.5" /></button>
          </div>
        )}
        {note && (
          <div className="mb-2 flex flex-wrap gap-1.5" data-tutor-actions>
            {actions.map(m => (
              <button key={m} type="button" disabled={!!pending || (empty && m !== 'organize' && m !== 'brainstorm')} onClick={() => void send({ mode: m, passage: passage?.text })}
                className="rounded-full border border-white/12 px-2.5 py-1 text-xs text-foreground/80 transition-colors hover:border-nova/50 hover:text-foreground disabled:opacity-40" data-tutor-action={m}>
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
        )}
        <form onSubmit={e => { e.preventDefault(); submit() }} className="flex items-end gap-2">
          <label htmlFor="tutor-input" className="sr-only">Ask Nova</label>
          <textarea id="tutor-input" ref={box} rows={1} value={input} maxLength={TUTOR_MESSAGE_MAX} disabled={!note}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } if (e.key === 'Escape' && pending) stop() }}
            placeholder={passage ? 'Ask about this passage…' : 'Ask Nova about this note…'}
            className="max-h-32 min-h-10 flex-1 resize-none rounded-xl border border-white/10 bg-transparent px-3 py-2.5 text-sm text-foreground placeholder:text-foreground/35 focus:border-nova/60 focus:outline-none disabled:opacity-50"
            data-tutor-input />
          {pending ? (
            <button type="button" onClick={stop} className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/12 text-foreground/80 hover:bg-white/5" title="Stop (Esc)" aria-label="Stop">
              <Square className="size-3.5" />
            </button>
          ) : (
            <button type="submit" disabled={!input.trim() || !note} className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-action text-action-foreground transition-colors hover:bg-action-hover disabled:opacity-40" title="Send (Enter)" aria-label="Send">
              <Send className="size-4" />
            </button>
          )}
        </form>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
    </section>
  )
}
