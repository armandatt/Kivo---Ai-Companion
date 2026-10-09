'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2, Plus, X } from 'lucide-react'
import type { SetupChanges, SetupDraft, SetupIssue, SetupView } from '@repo/api/nova/product/setup.types'
import { STUDY_TEMPLATES, templateTaskKey, type StudyTemplate } from '@repo/api/nova/product/templates'
import { cn } from '@/lib/utils'

// The first-run study setup. The page collects and shows; the server
// validates, previews and saves (POST /api/nova/setup). Nothing is saved
// until the learner confirms the review, and a value they do not give is
// sent as null and stays unknown.

type SubjectRow = { name: string; topics: string }
type ExamRow    = { subjectName: string; date: string }
type StudyTime  = NonNullable<SetupDraft['studyTime']>

const DAILY: Array<{ label: string; minutes: number | null }> = [
  { label: '30 min', minutes: 30 }, { label: '1 hour', minutes: 60 }, { label: '2 hours', minutes: 120 },
  { label: '3 hours', minutes: 180 }, { label: '4+ hours', minutes: 240 }, { label: 'Not sure', minutes: null },
]
const TIMES: Array<{ label: string; value: StudyTime | null }> = [
  { label: 'Morning', value: 'morning' }, { label: 'Afternoon', value: 'afternoon' },
  { label: 'Evening', value: 'evening' }, { label: 'Night', value: 'night' }, { label: 'It varies', value: null },
]

const splitTopics = (text: string) => text.split(/[\n,;]+/).map(t => t.trim()).filter(Boolean)

const field = 'w-full rounded-xl border border-white/10 bg-transparent px-3.5 text-sm text-foreground placeholder:text-foreground/35 focus:border-keppel-400/60 focus:outline-none'
const label = 'text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/45'

function Chips<T>({ options, value, onChange, name }: { options: Array<{ label: string; value: T }>; value: T; onChange: (v: T) => void; name: string }) {
  return (
    <div role="radiogroup" aria-label={name} className="mt-3 flex flex-wrap gap-2">
      {options.map(o => (
        <button
          key={o.label} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}
          className={cn(
            'h-9 rounded-full border px-4 text-sm transition-colors',
            o.value === value ? 'border-keppel-400 bg-keppel-400/15 text-keppel-200' : 'border-white/10 text-foreground/70 hover:bg-white/5',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// The tasks a template adds, created through the ordinary task route once the
// setup is saved. Each carries the template's own key, so choosing the same
// template again creates nothing twice. A task whose subject was renamed or
// removed in the form is still created, without a subject.
async function createTemplateTasks(template: StudyTemplate): Promise<void> {
  let subjects: Array<{ id: string; name: string }> = []
  try {
    const res  = await fetch('/api/nova/tasks', { cache: 'no-store' })
    const data = await res.json() as { status?: string; subjects?: Array<{ id: string; name: string }> }
    if (data.status === 'ready') subjects = data.subjects ?? []
  } catch { /* created without subjects */ }
  for (const task of template.tasks) {
    const subject = task.subject ? subjects.find(s => s.name.toLowerCase() === task.subject!.toLowerCase()) : undefined
    await fetch('/api/nova/tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: task.title, priority: task.priority ?? null, subjectId: subject?.id ?? null, clientKey: templateTaskKey(template.id, task.key) }),
    }).catch(() => {})
  }
}

function TemplatePicker({ chosen, onChoose }: { chosen: StudyTemplate | null; onChoose: (t: StudyTemplate | null) => void }) {
  return (
    <div className="mt-6">
      <p className={label}>Start from a template <span className="normal-case tracking-normal text-foreground/35">(optional)</span></p>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        {STUDY_TEMPLATES.map(t => {
          const on = chosen?.id === t.id
          return (
            <button
              key={t.id} type="button" aria-pressed={on} onClick={() => onChoose(on ? null : t)}
              className={cn('rounded-2xl border p-4 text-left transition-colors', on ? 'border-keppel-400 bg-keppel-400/10' : 'border-white/8 bg-white/3 hover:border-white/16')}
            >
              <span className="block text-sm font-semibold text-foreground">{t.name}</span>
              <span className="mt-1.5 block text-xs leading-relaxed text-foreground/55">{t.description}</span>
              <span className="mt-3 block text-[11px] font-medium uppercase tracking-[0.14em] text-foreground/40">Adds</span>
              <ul className="mt-1 space-y-0.5 text-xs text-foreground/65">{t.creates.map(c => <li key={c}>{c}</li>)}</ul>
            </button>
          )
        })}
      </div>
      {chosen && (
        <p className="mt-3 text-xs leading-relaxed text-foreground/50">
          {chosen.name} is in the form below. Edit anything; nothing is saved until you review and confirm. It adds no progress: every topic starts unstudied and every task as to do.
        </p>
      )}
    </div>
  )
}

function Review({ draft, changes }: { draft: SetupDraft; changes: SetupChanges }) {
  const rows: Array<[string, string]> = []
  for (const s of draft.subjects) {
    const fresh = changes.newTopics.find(t => t.subject.toLowerCase() === s.name.toLowerCase())?.topics ?? []
    const isNew = changes.newSubjects.some(n => n.toLowerCase() === s.name.toLowerCase())
    rows.push([`${s.name}${isNew ? '' : ' (already saved)'}`, fresh.length > 0 ? fresh.join(', ') : s.topics.length > 0 ? 'No new topics' : 'No topics yet'])
  }
  for (const e of changes.newExams) rows.push([`${e.subjectName} exam`, e.date])
  rows.push(['Normal day', draft.dailyMinutes !== null ? `About ${draft.dailyMinutes} min` : 'Not sure yet. Nova will assume about 3 hours and say so.'])
  rows.push(['Usual time', draft.studyTime ?? 'It varies'])
  return (
    <dl className="mt-6 divide-y divide-white/6 rounded-2xl border border-white/8">
      {rows.map(([k, v]) => (
        <div key={k} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:gap-6">
          <dt className="w-48 shrink-0 text-sm font-medium text-foreground">{k}</dt>
          <dd className="text-sm text-foreground/65">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function SetupForm({ onSaved, confirmLabel = 'Confirm and build my plan' }: { onSaved: () => void; confirmLabel?: string }) {
  const [template, setTemplate] = useState<StudyTemplate | null>(null)
  const [subjects, setSubjects] = useState<SubjectRow[]>([{ name: '', topics: '' }])
  const [exams, setExams]       = useState<ExamRow[]>([])
  const [daily, setDaily]       = useState<number | null>(null)
  const [time, setTime]         = useState<StudyTime | null>(null)
  const [review, setReview]     = useState<{ draft: SetupDraft; changes: SetupChanges } | null>(null)
  const [issues, setIssues]     = useState<SetupIssue[]>([])
  const [busy, setBusy]         = useState(false)
  const [failed, setFailed]     = useState(false)

  // What is already on record (said on Telegram, or a setup left half done)
  // is shown, so nothing has to be typed twice.
  useEffect(() => {
    let live = true
    fetch('/api/nova/setup', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((s: (SetupView & { status?: string }) | null) => {
        if (!live || !s || s.status !== 'ready') return
        if (s.subjects.length > 0) setSubjects(s.subjects.map(x => ({ name: x.name, topics: x.topics.join('\n') })))
        setDaily(s.dailyMinutes)
        setTime((s.studyTime as StudyTime | null) ?? null)
      })
      .catch(() => {})
    return () => { live = false }
  }, [])

  const named = subjects.map(s => s.name.trim()).filter(Boolean)

  // Choosing a template adds its subjects to the form. It never removes or
  // overwrites what is already there: a subject of the same name keeps its
  // own topics and gains the template's.
  const choose = (next: StudyTemplate | null) => {
    setTemplate(next)
    if (!next) return
    setSubjects(rows => {
      const kept = rows.filter(row => row.name.trim() || row.topics.trim())
      const out  = [...kept]
      for (const subject of next.subjects) {
        const at = subject.name ? out.findIndex(row => row.name.trim().toLowerCase() === subject.name.toLowerCase()) : -1
        if (at >= 0) {
          const have = new Set(splitTopics(out[at]!.topics).map(t => t.toLowerCase()))
          const add  = subject.topics.filter(t => !have.has(t.toLowerCase()))
          out[at] = { ...out[at]!, topics: [out[at]!.topics.trim(), ...add].filter(Boolean).join('\n') }
        } else {
          out.push({ name: subject.name, topics: subject.topics.join('\n') })
        }
      }
      return out.length > 0 ? out : [{ name: '', topics: '' }]
    })
    if (next.asksExamDate) setExams(rows => (rows.length > 0 ? rows : [{ subjectName: '', date: '' }]))
  }
  const draft = (): SetupDraft => ({
    subjects:     subjects.filter(s => s.name.trim()).map(s => ({ name: s.name.trim(), topics: splitTopics(s.topics) })),
    exams:        exams.filter(e => e.subjectName && e.date).map(e => ({ subjectName: e.subjectName, date: e.date, title: null })),
    dailyMinutes: daily,
    studyTime:    time,
  })

  async function send(confirm: boolean) {
    setBusy(true); setFailed(false)
    try {
      const res  = await fetch('/api/nova/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: review?.draft ?? draft(), confirm }) })
      if (res.status === 401) { window.location.href = '/signin'; return }
      const data = await res.json() as { ok: boolean; saved?: boolean; draft?: SetupDraft; changes?: SetupChanges; issues?: SetupIssue[] }
      if (confirm && data.ok && data.saved) {
        // The setup is saved; the template's tasks follow it.
        if (template) await createTemplateTasks(template)
        onSaved()
        return
      }
      setIssues(data.issues ?? [])
      if (!confirm && data.ok && data.draft && data.changes && (data.issues ?? []).length === 0) setReview({ draft: data.draft, changes: data.changes })
      else if (!data.ok && !data.issues) setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const setSubject = (i: number, patch: Partial<SubjectRow>) => setSubjects(rows => rows.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  const setExam    = (i: number, patch: Partial<ExamRow>) => setExams(rows => rows.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  const problems   = (
    <>
      {issues.length > 0 && (
        <ul role="alert" className="mt-5 space-y-1 text-sm text-red-300">{issues.map((i, k) => <li key={k}>{i.message}</li>)}</ul>
      )}
      {failed && <p role="alert" className="mt-5 text-sm text-red-300">That didn&apos;t go through. Nothing was saved; try again.</p>}
    </>
  )

  if (review) {
    return (
      <div className="mt-6">
        <p className="text-sm text-foreground/65">Check this is right. Nothing is saved until you confirm.</p>
        <Review draft={review.draft} changes={review.changes} />
        {template && template.tasks.length > 0 && (
          <div className="mt-4 rounded-2xl border border-white/8 px-4 py-3">
            <p className="text-sm font-medium text-foreground">Tasks from {template.name}</p>
            <ul className="mt-2 space-y-1 text-sm text-foreground/65">{template.tasks.map(t => <li key={t.key}>{t.title}</li>)}</ul>
            <p className="mt-2 text-xs text-foreground/45">Added to your task board as to do. Any you already have from this template are left as they are.</p>
          </div>
        )}
        {!review.changes.complete && (
          <p role="alert" className="mt-4 text-sm text-amber-300/90">Add at least one topic to one subject, so there is something to plan.</p>
        )}
        {problems}
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={() => { setReview(null); setIssues([]) }} disabled={busy}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-white/12 px-5 text-sm font-medium text-foreground transition-colors hover:bg-white/5">
            <ArrowLeft className="size-4" /> Change something
          </button>
          <button type="button" onClick={() => void send(true)} disabled={busy || !review.changes.complete}
            className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-keppel-400 px-6 text-[15px] font-semibold text-keppel-950 transition-colors hover:bg-keppel-300 disabled:opacity-50">
            {busy ? <><Loader2 className="size-4 animate-spin" /> Saving…</> : <>{confirmLabel} <ArrowRight className="size-4" /></>}
          </button>
        </div>
      </div>
    )
  }

  return (
    <form className="mt-6" onSubmit={e => { e.preventDefault(); void send(false) }}>
      <TemplatePicker chosen={template} onChoose={choose} />
      <p className={cn(label, 'mt-9')}>Your subjects, and what each covers</p>
      <div className="mt-3 space-y-4">
        {subjects.map((s, i) => (
          <div key={i} className="rounded-2xl border border-white/8 bg-white/3 p-4">
            <div className="flex gap-2">
              <label className="sr-only" htmlFor={`subject-${i}`}>Subject name</label>
              <input id={`subject-${i}`} value={s.name} maxLength={80} onChange={e => setSubject(i, { name: e.target.value })}
                placeholder={template?.namePrompt && !s.name ? template.namePrompt : 'Subject, e.g. Operating Systems'} className={cn(field, 'h-11')} />
              {subjects.length > 1 && (
                <button type="button" aria-label="Remove subject" onClick={() => setSubjects(rows => rows.filter((_, k) => k !== i))}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 text-foreground/50 hover:bg-white/5">
                  <X className="size-4" />
                </button>
              )}
            </div>
            <label className="sr-only" htmlFor={`topics-${i}`}>Topics</label>
            <textarea id={`topics-${i}`} value={s.topics} rows={3} onChange={e => setSubject(i, { topics: e.target.value })}
              placeholder="Topics or chapters, one per line or separated by commas. Paste your syllabus if you have it."
              className={cn(field, 'mt-2 py-2.5 leading-relaxed')} />
          </div>
        ))}
      </div>
      <button type="button" onClick={() => setSubjects(rows => [...rows, { name: '', topics: '' }])}
        className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 px-4 text-sm text-foreground/75 hover:bg-white/5">
        <Plus className="size-4" /> Add a subject
      </button>

      <p className={cn(label, 'mt-9')}>Exams and deadlines <span className="normal-case tracking-normal text-foreground/35">(optional)</span></p>
      <div className="mt-3 space-y-2">
        {exams.map((e, i) => (
          <div key={i} className="flex flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor={`exam-subject-${i}`}>Exam subject</label>
            <select id={`exam-subject-${i}`} value={e.subjectName} onChange={ev => setExam(i, { subjectName: ev.target.value })} className={cn(field, 'h-11 sm:flex-1')}>
              <option value="" className="bg-card">Subject…</option>
              {named.map(n => <option key={n} value={n} className="bg-card text-foreground">{n}</option>)}
            </select>
            <label className="sr-only" htmlFor={`exam-date-${i}`}>Exam date</label>
            <input id={`exam-date-${i}`} type="date" value={e.date} onChange={ev => setExam(i, { date: ev.target.value })} className={cn(field, 'h-11 sm:w-48')} />
            <button type="button" aria-label="Remove exam" onClick={() => setExams(rows => rows.filter((_, k) => k !== i))}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 text-foreground/50 hover:bg-white/5">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => setExams(rows => [...rows, { subjectName: named[0] ?? '', date: '' }])} disabled={named.length === 0}
        className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 px-4 text-sm text-foreground/75 hover:bg-white/5 disabled:opacity-40">
        <Plus className="size-4" /> Add an exam date
      </button>

      <p className={cn(label, 'mt-9')}>How long do you usually have on a normal day?</p>
      <Chips name="Normal day" options={DAILY.map(d => ({ label: d.label, value: d.minutes }))} value={daily} onChange={setDaily} />

      <p className={cn(label, 'mt-7')}>When do you usually study?</p>
      <Chips name="Usual time" options={TIMES} value={time} onChange={setTime} />

      {problems}
      <button type="submit" disabled={busy || named.length === 0}
        className="mt-8 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-keppel-400 px-6 text-[15px] font-semibold text-keppel-950 transition-colors hover:bg-keppel-300 disabled:opacity-50 sm:w-auto">
        {busy ? <><Loader2 className="size-4 animate-spin" /> Checking…</> : <>Review <ArrowRight className="size-4" /></>}
      </button>
    </form>
  )
}
