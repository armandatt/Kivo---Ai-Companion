'use client'

// "Ask Nova about this note". One action at a time, on the learner's request.
// What the sources say and what Nova adds are shown apart, every [S#] opens
// the note or saved page it names, and every proposal (a link, a concept, a
// rewrite) changes nothing until the learner acts on it: a link is added by
// an ordinary save of the note, a rewrite opens in the editor unsaved.

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Loader2, Sparkles } from 'lucide-react'
import type { NoteDetail } from '@repo/api/nova/product/notes.types'
import type { NoteAssistAction, NoteAssistResponse, NoteAssistSource } from '@repo/api/nova/product/note-assist.types'
import { NOTE_ASSIST_QUESTION_MAX } from '@repo/api/nova/product/note-assist.types'
import { updateNote } from './notes-api'

const ACTIONS: Array<{ action: Exclude<NoteAssistAction, 'ask'>; label: string }> = [
  { action: 'summarize', label: 'Summarise' },
  { action: 'structure', label: 'Suggest a structure' },
  { action: 'concepts',  label: 'Key concepts' },
  { action: 'links',     label: 'Suggest connections' },
]

const chip = 'rounded-full border border-white/12 px-3 py-1.5 text-xs text-foreground/80 transition-colors hover:border-keppel-400/50 hover:text-foreground disabled:opacity-50'

async function ask(noteId: string, body: { action: NoteAssistAction; question?: string }): Promise<NoteAssistResponse> {
  try {
    const res = await fetch(`/api/nova/notes/${encodeURIComponent(noteId)}/assist`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store',
    })
    if (res.status === 401) { window.location.href = '/signin'; return { ok: false, error: 'unauthenticated', message: 'Sign in again.' } }
    return await res.json() as NoteAssistResponse
  } catch {
    return { ok: false, error: 'failed', message: 'Could not reach the server. Check your connection and try again.' }
  }
}

const sourceHref = (s: NoteAssistSource) => (s.kind === 'note' ? `/notes/${encodeURIComponent(s.recordId)}` : `/saved?page=${encodeURIComponent(s.recordId)}`)

// Text with its [S#] marks drawn as links to the sources they name.
function cited(text: string, sources: NoteAssistSource[]): ReactNode[] {
  const out: ReactNode[] = []
  let i = 0, plain = '', n = 0
  while (i < text.length) {
    if (text[i] === '[' && text[i + 1] === 'S') {
      const close = text.indexOf(']', i)
      const src = close === -1 ? undefined : sources.find(s => s.id === text.slice(i + 1, close))
      if (src) {
        if (plain) { out.push(plain); plain = '' }
        out.push(<Link key={`c${n++}`} href={sourceHref(src)} title={src.title} className="mx-0.5 rounded bg-keppel-400/15 px-1 text-[11px] font-medium text-keppel-200 hover:bg-keppel-400/25">{src.id}</Link>)
        i = close + 1
        continue
      }
    }
    plain += text[i]
    i++
  }
  if (plain) out.push(plain)
  return out
}

export function NoteAssistPanel({ note, onNoteSaved, onUseDraft }: {
  note: NoteDetail
  onNoteSaved: (note: NoteDetail) => void
  onUseDraft: (body: string) => void
}) {
  const [busy, setBusy]         = useState<NoteAssistAction | null>(null)
  const [result, setResult]     = useState<Extract<NoteAssistResponse, { ok: true }> | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [notice, setNotice]     = useState<string | null>(null)
  const [adding, setAdding]     = useState<string | null>(null)

  async function run(action: NoteAssistAction) {
    setBusy(action); setError(null); setNotice(null)
    const res = await ask(note.id, action === 'ask' ? { action, question } : { action })
    setBusy(null)
    if (res.ok) setResult(res); else { setResult(null); setError(res.message) }
  }

  // Adds a line to the end of the note through the ordinary save, guarded on
  // the version on screen, so it never writes over a newer one.
  async function append(line: string, key: string, done: string) {
    setAdding(key); setNotice(null)
    const res = await updateNote(note.id, { body: `${note.body.replace(/\s+$/, '')}\n${line}\n`, baseUpdatedAt: note.updatedAt })
    setAdding(null)
    if (res.ok) { onNoteSaved(res.note); setNotice(done) }
    else setNotice(res.error === 'conflict' ? 'This note changed somewhere else. Reload it, then add the link again.' : res.message)
  }

  const linked = new Set(note.links.outgoing.map(l => l.title.trim().toLowerCase()))

  return (
    <section aria-labelledby="note-assist-heading" className="mt-6 rounded-2xl border border-white/8 bg-card/40 p-4 sm:p-5" data-note-assist>
      <h2 id="note-assist-heading" className="flex items-center gap-2 text-sm font-semibold text-foreground"><Sparkles className="size-4 text-keppel-300" /> Ask Nova about this note</h2>
      <p className="mt-1 text-xs leading-relaxed text-foreground/50">Nova reads this note and a few of your related notes and saved pages. It changes nothing unless you choose to.</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {ACTIONS.map(a => (
          <button key={a.action} type="button" className={chip} disabled={busy !== null} onClick={() => void run(a.action)} data-assist={a.action}>
            {busy === a.action ? <span className="inline-flex items-center gap-1.5"><Loader2 className="size-3 animate-spin" /> {a.label}</span> : a.label}
          </button>
        ))}
      </div>
      <form className="mt-3 flex gap-2" onSubmit={e => { e.preventDefault(); if (question.trim()) void run('ask') }}>
        <label htmlFor="note-question" className="sr-only">Ask a question about this note</label>
        <input id="note-question" value={question} maxLength={NOTE_ASSIST_QUESTION_MAX} onChange={e => setQuestion(e.target.value)}
          placeholder="Ask a question about this note"
          className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-transparent px-3 text-sm text-foreground placeholder:text-foreground/35 focus:border-keppel-400/60 focus:outline-none" />
        <button type="submit" disabled={busy !== null || !question.trim()} className="h-10 shrink-0 rounded-xl bg-keppel-400 px-4 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300 disabled:opacity-50">
          {busy === 'ask' ? <Loader2 className="size-4 animate-spin" /> : 'Ask'}
        </button>
      </form>

      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
      {notice && <p role="status" className="mt-3 text-sm text-foreground/70">{notice}</p>}

      {result && (
        <div className="mt-4 space-y-4" role="region" aria-label="Nova's answer" data-assist-result={result.action}>
          {result.notInSources && (
            <p className="rounded-xl border border-amber-300/25 bg-amber-300/5 p-3 text-xs text-foreground/75" data-not-in-sources>Your notes and saved pages here don&apos;t contain this. Anything below from Nova is its own knowledge, not your material.</p>
          )}
          {result.fromSources && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-foreground/40">From your notes and saved pages</p>
              <div className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground/85" data-from-sources>{cited(result.fromSources, result.sources)}</div>
            </div>
          )}
          {result.nova && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-foreground/40">Nova&apos;s own, not from your material</p>
              <div className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground/70" data-nova-own>{cited(result.nova, result.sources)}</div>
            </div>
          )}

          {result.concepts.length > 0 && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-foreground/40">Concepts in this note (suggested)</p>
              <ul className="mt-1.5 space-y-1.5">
                {result.concepts.map(c => (
                  <li key={c} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-foreground/85">{c}</span>
                    {linked.has(c.toLowerCase())
                      ? <span className="text-xs text-foreground/45">already linked</span>
                      : <button type="button" className={chip} disabled={adding !== null} onClick={() => void append(`[[${c}]]`, `c:${c}`, `Added [[${c}]] to this note.`)}>{adding === `c:${c}` ? 'Adding…' : 'Link it here'}</button>}
                    <Link className={chip} href={`/notes/new?title=${encodeURIComponent(c)}${note.subjectId ? `&subjectId=${encodeURIComponent(note.subjectId)}` : ''}`}>Write a note on it</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.links.length > 0 && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-foreground/40">Might connect (suggested, not linked)</p>
              <ul className="mt-1.5 space-y-2">
                {result.links.map(l => {
                  const src = result.sources.find(s => s.id === l.sourceId)!
                  const already = src.kind === 'note' && linked.has(src.title.trim().toLowerCase())
                  return (
                    <li key={l.sourceId} className="text-sm" data-suggested-link={src.kind}>
                      <Link href={sourceHref(src)} className="text-keppel-300 hover:underline">{src.title}</Link>
                      <span className="ml-2 text-xs text-foreground/40">{src.kind === 'note' ? 'note' : src.domain ?? 'saved page'}</span>
                      {l.why && <p className="mt-0.5 text-xs leading-relaxed text-foreground/55">{l.why}</p>}
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {src.kind === 'note' ? (
                          already ? <span className="text-xs text-foreground/45">Already linked</span> : (
                            <button type="button" className={chip} disabled={adding !== null} onClick={() => void append(`[[${src.title}]]`, l.sourceId, `Linked [[${src.title}]] from this note.`)}>
                              {adding === l.sourceId ? 'Adding…' : 'Add the link'}
                            </button>
                          )
                        ) : (
                          <button type="button" className={chip} disabled={adding !== null || !src.url} onClick={() => void append(`- Source: ${src.title} ${src.url}`, l.sourceId, 'Added the page to this note.')}>
                            {adding === l.sourceId ? 'Adding…' : 'Add it as a source'}
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {result.draft && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-foreground/40">Suggested structure</p>
              <pre className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-white/8 p-3 text-xs leading-relaxed text-foreground/75">{result.draft}</pre>
              <button type="button" className={`${chip} mt-2`} onClick={() => onUseDraft(result.draft!)}>Open it in the editor (not saved until you save)</button>
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-foreground/40">
            Sources Nova was given: {result.sources.map((s, i) => <span key={s.id}>{i > 0 && ', '}<Link href={sourceHref(s)} className="hover:underline">{s.id} {s.title}</Link></span>)}.
          </p>
        </div>
      )}
    </section>
  )
}
