'use client'

import { useEffect, useState } from 'react'
import { CalendarDays, Check, Loader2 } from 'lucide-react'
import { EXAM_TITLE_MAX, type ExamResponse, type NovaExamItem, type NovaExamsView } from '@repo/api/nova/product/exams.types'
import { DEADLINE_RULES, DEADLINE_TYPES, type DeadlineType } from '@repo/api/nova/product/deadline-types'
import { inDays } from './format'

// The learner's exam dates, each one movable and removable. The page collects
// and shows; the server validates and saves (PATCH / DELETE
// /api/nova/exams/:id) and answers with the list as it now stands. Nothing
// counts as changed until the server says so. Adding an exam stays in the
// setup form below.

const FIELD = 'h-11 rounded-xl border border-white/10 bg-transparent px-3.5 text-sm text-foreground placeholder:text-foreground/35 focus:border-keppel-400/60 focus:outline-none'

type Draft = { title: string; date: string; type: DeadlineType }

export function ExamsEditor() {
  // null: not loaded yet. What the server last confirmed.
  const [stored, setStored] = useState<NovaExamItem[] | null>(null)
  const [state, setState]   = useState<'loading' | 'ready' | 'failed' | 'unavailable'>('loading')
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [busy, setBusy]     = useState<string | null>(null)        // the exam a request is out for
  const [removing, setRemoving] = useState<string | null>(null)    // the exam being confirmed for removal
  const [note, setNote]     = useState<{ id: string | null; ok: boolean; text: string } | null>(null)
  // Where the keyboard goes once the control it was on has been replaced or
  // disabled: an element id inside this section. Without it a Save, a Remove
  // or a Keep would leave a keyboard user at the top of the page.
  const [focusNext, setFocusNext] = useState<string | null>(null)

  useEffect(() => {
    if (!focusNext || busy !== null) return
    document.getElementById(focusNext)?.focus()
    setFocusNext(null)
  }, [focusNext, busy])

  const take = (exams: NovaExamItem[]) => {
    setStored(exams)
    setDrafts(Object.fromEntries(exams.map(e => [e.id, { title: e.title, date: e.date, type: e.type }])))
  }

  useEffect(() => {
    let live = true
    fetch('/api/nova/exams', { cache: 'no-store' })
      .then(async r => {
        if (r.status === 401) { window.location.href = '/signin'; return null }
        if (!r.ok) throw new Error(String(r.status))
        return await r.json() as NovaExamsView
      })
      .then(view => {
        if (!live || !view) return
        if (view.status !== 'ready') { setState('unavailable'); return }
        take(view.exams)
        setState('ready')
      })
      .catch(() => { if (live) setState('failed') })
    return () => { live = false }
  }, [])

  const send = async (exam: NovaExamItem, method: 'PATCH' | 'DELETE', body: Draft | null, done: string) => {
    setBusy(exam.id)
    setNote(null)
    try {
      const res  = await fetch(`/api/nova/exams/${encodeURIComponent(exam.id)}`, {
        method, cache: 'no-store',
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      })
      const data = await res.json().catch(() => null) as ExamResponse | null
      if (res.ok && data?.ok) {
        take(data.exams)
        setNote({ id: null, ok: true, text: done })
        // Still there: back to its name. Gone: to the section's heading.
        setFocusNext(data.exams.some(e => e.id === exam.id) ? `exam-title-${exam.id}` : 'exams-heading')
      } else {
        setNote({ id: exam.id, ok: false, text: data && !data.ok ? data.message : "That didn't go through. Nothing was changed; try again." })
        setFocusNext(`exam-title-${exam.id}`)
      }
    } catch {
      setNote({ id: exam.id, ok: false, text: 'Network error. Nothing was changed; check your connection and try again.' })
      setFocusNext(`exam-title-${exam.id}`)
    } finally {
      setBusy(null)
      setRemoving(null)
    }
  }

  if (state === 'unavailable') return null
  if (state === 'failed') {
    return (
      <section role="alert" id="exams" className="rounded-3xl border border-white/8 bg-card/70 p-6">
        <p className="text-sm text-foreground/65">Couldn&apos;t load your dates. Reload the page to try again.</p>
      </section>
    )
  }
  if (state === 'loading' || stored === null) {
    return <div id="exams" aria-busy="true" aria-label="Loading your dates" className="h-32 animate-pulse rounded-3xl border border-white/5 bg-white/3" />
  }

  return (
    <section id="exams" aria-labelledby="exams-heading" className="scroll-mt-24 rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-9" data-section="exams-editor">
      <div className="flex items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-white/4">
          <CalendarDays className="size-5 text-keppel-300" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="exams-heading" tabIndex={-1} className="outline-none text-lg font-semibold tracking-tight text-foreground">Your dates</h2>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-foreground/65">
Exams, interviews and things due. Move or remove one and your plan, the countdown and Nova&apos;s reminders follow it from the next time they are worked out. What kind it is matters: Nova prepares your topics for an exam, a certification or an interview, and only an exam or a certification can take a whole day. An assignment or a project is a date and nothing more. Removing one removes only the date: nothing you studied changes.
          </p>

          {stored.length === 0 ? (
            <p className="mt-5 text-sm leading-relaxed text-foreground/55">No date on record. Add one in the form below.</p>
          ) : (
            <ul className="mt-5 space-y-4">
              {stored.map(exam => {
                const draft   = drafts[exam.id] ?? { title: exam.title, date: exam.date, type: exam.type }
                const title   = draft.title.trim()
                const changed = title !== exam.title || draft.date !== exam.date || draft.type !== exam.type
                const working = busy === exam.id
                const setDraft = (patch: Partial<Draft>) => { setNote(null); setDrafts(d => ({ ...d, [exam.id]: { ...draft, ...patch } })) }
                return (
                  <li key={exam.id} data-exam={exam.id} className="rounded-2xl border border-white/8 p-4">
                    <form
                      className="flex flex-col gap-2 sm:flex-row sm:items-center"
                      onSubmit={e => { e.preventDefault(); if (changed && title && draft.date && busy === null) void send(exam, 'PATCH', { title, date: draft.date, type: draft.type }, 'Saved. Your plan follows it.') }}
                    >
                      <label htmlFor={`exam-title-${exam.id}`} className="sr-only">Exam name</label>
                      <input id={`exam-title-${exam.id}`} value={draft.title} maxLength={EXAM_TITLE_MAX} disabled={busy !== null}
                        onChange={e => setDraft({ title: e.target.value })} className={`${FIELD} min-w-0 sm:flex-1`} />
                      <label htmlFor={`exam-kind-${exam.id}`} className="sr-only">What kind of date {exam.title} is</label>
                      <select id={`exam-kind-${exam.id}`} value={draft.type} disabled={busy !== null}
                        onChange={e => setDraft({ type: e.target.value as DeadlineType })} className={`${FIELD} sm:w-40`}>
                        {DEADLINE_TYPES.map(t => <option key={t} value={t} className="bg-card text-foreground">{DEADLINE_RULES[t].label}</option>)}
                      </select>
                      <label htmlFor={`exam-day-${exam.id}`} className="sr-only">Date of {exam.title}</label>
                      <input id={`exam-day-${exam.id}`} type="date" value={draft.date} disabled={busy !== null}
                        onChange={e => setDraft({ date: e.target.value })} className={`${FIELD} sm:w-44`} />
                      <button type="submit" disabled={busy !== null || !changed || !title || !draft.date}
                        className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-keppel-400 px-4 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300 disabled:opacity-40">
                        {working && removing !== exam.id ? <><Loader2 className="size-4 animate-spin" /> Saving…</> : 'Save'}
                      </button>
                    </form>

                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-xs">
                      <p className="text-foreground/50">{exam.subjectName ?? 'No subject'} · {inDays(exam.daysUntil)}</p>
                      {removing === exam.id ? (
                        <span className="flex items-center gap-3 text-sm">
                          <span className="text-foreground/65">Remove this date?</span>
                          <button type="button" disabled={busy !== null} onClick={() => void send(exam, 'DELETE', null, `Removed ${exam.title}. It no longer shapes your plan.`)}
                            className="font-medium text-red-300 hover:text-red-200 disabled:opacity-50" data-remove-exam>
                            {working ? 'Removing…' : 'Remove'}
                          </button>
                          <button type="button" autoFocus disabled={busy !== null} onClick={() => { setRemoving(null); setFocusNext(`exam-remove-${exam.id}`) }} className="text-foreground/55 hover:text-foreground">Keep</button>
                        </span>
                      ) : (
                        <button type="button" id={`exam-remove-${exam.id}`} disabled={busy !== null} onClick={() => { setNote(null); setRemoving(exam.id) }}
                          className="text-sm text-foreground/55 underline decoration-white/20 underline-offset-4 hover:text-foreground disabled:opacity-40">
                          Remove
                        </button>
                      )}
                    </div>
                    {note && note.id === exam.id && <p role="alert" className="mt-2 text-sm leading-relaxed text-red-300">{note.text}</p>}
                  </li>
                )
              })}
            </ul>
          )}

          {note && note.id === null && (
            <p role="status" className="mt-4 flex items-center gap-1.5 text-sm text-foreground/75">
              <Check className="size-4 text-keppel-300" />{note.text}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
