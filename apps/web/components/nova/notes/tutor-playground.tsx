'use client'

// What one of Nova's replies looks like beside the note, and what the
// learner can do with it: read an explanation part by part, try each step
// of a walk-through before it is shown, answer an exercise and have it
// checked, take a quiz (answers are checked here, with why), keep the ideas
// worth keeping, flip flashcards, take an organised version. Every way into
// the note goes through onInsert, which shows the text and asks first.
// What the notes say and what Nova adds of its own are labelled apart.

import type { ReactNode } from 'react'
import Link from 'next/link'
import { Check, ChevronDown, Eye, FilePlus2, Link2, Lightbulb, RotateCcw, X } from 'lucide-react'
import type { NoteAssistSource } from '@repo/api/nova/product/note-assist.types'
import type { TutorBasis, TutorMode, TutorReply } from '@repo/api/nova/product/note-tutor.types'
import { NoteBody } from './note-body'
import { MODE_LABEL, insertFor, type InsertPart, type TutorAsk, type TutorWork } from './tutor-session'

export type Insert = (markdown: string, label: string, opts?: { title?: string }) => void

const chip = 'inline-flex items-center gap-1.5 rounded-full border border-white/12 px-3 py-1.5 text-xs text-foreground/80 transition-colors hover:border-nova/50 hover:text-foreground disabled:opacity-50'
const small = 'inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-nova-ink transition-colors hover:bg-nova/10 disabled:opacity-50'
const field = 'w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-foreground/35 focus:border-nova/60 focus:outline-none'

export const sourceHref = (s: NoteAssistSource) => (s.kind === 'note' ? `/notes/${encodeURIComponent(s.recordId)}` : `/saved?page=${encodeURIComponent(s.recordId)}`)

function Basis({ basis }: { basis: TutorBasis }) {
  return basis === 'notes'
    ? <span className="rounded-full bg-nova/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-nova-ink" data-basis="notes">From your notes</span>
    : <span className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-subtle" data-basis="nova">Nova&apos;s own</span>
}

function Text({ text, sources }: { text: string; sources: NoteAssistSource[] }) {
  const cite = (label: string, key: string) => {
    const s = sources.find(x => x.id === label)
    return s ? <Link key={key} href={sourceHref(s)} title={s.title} className="mx-0.5 rounded bg-nova/15 px-1 align-[0.1em] font-sans text-[10px] font-semibold text-nova-ink no-underline hover:bg-nova/25">{s.id === 'S1' ? 'note' : s.title.slice(0, 24)}</Link> : null
  }
  return <NoteBody body={text} links={[]} cite={cite} compact />
}

// A block that came in with a fresh reply eases in after the one before it.
function Reveal({ i, fresh, children }: { i: number; fresh: boolean; children: ReactNode }) {
  return <div className={fresh ? 'nova-reveal' : ''} style={fresh ? { ['--i' as string]: Math.min(i, 8) } : undefined}>{children}</div>
}

export function ReplyView({ reply, work, fresh, busy, onWork, onAsk, onInsert, onUseTitle }: {
  reply: TutorReply
  work: TutorWork
  fresh: boolean
  busy: boolean
  onWork: (change: Partial<TutorWork>) => void
  onAsk: (ask: TutorAsk) => void
  onInsert: Insert
  onUseTitle: (title: string) => void
}) {
  const insert = (part: InsertPart, label: string, index = 0) => {
    const md = insertFor(reply, work, part, index)
    if (md) onInsert(md, label)
  }
  const whole = insertFor(reply, work, 'all')
  let n = 0

  return (
    <div className="space-y-3" data-tutor-reply={reply.mode}>
      {(reply.notInSources || reply.partial || reply.versionDiffers || (reply.passage && !reply.passage.found)) && (
        <div className="space-y-1.5 rounded-xl border border-amber-300/20 bg-amber-300/[0.04] px-3 py-2 text-xs leading-relaxed text-foreground/70" data-tutor-notices>
          {reply.notInSources && <p data-not-in-sources>Your notes don&apos;t cover this. What Nova says here is its own knowledge, labelled as such.</p>}
          {reply.partial && <p>This note is long: Nova read the part around what you asked about, not all of it.</p>}
          {reply.versionDiffers && <p>Nova read the saved version of this note, which differs from the one on screen.</p>}
          {reply.passage && !reply.passage.found && <p>The passage you chose isn&apos;t in the saved note, so it was read as you sent it.</p>}
        </div>
      )}

      {reply.sections.map((s, i) => (
        <Reveal key={`s${i}`} i={n++} fresh={fresh}>
          <details open className="group rounded-xl border border-white/6 bg-white/[0.02] px-3 py-2.5" data-tutor-section={s.basis}>
            <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
              <Basis basis={s.basis} />
              {s.heading && <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{s.heading}</span>}
              <ChevronDown className="ml-auto size-3.5 shrink-0 text-subtle transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="mt-2"><Text text={s.text} sources={reply.sources} /></div>
            {reply.sections.length > 1 && (
              <button type="button" className={`${small} mt-1`} onClick={() => insert('section', s.heading ?? 'This part', i)}><FilePlus2 className="size-3.5" /> Add this part</button>
            )}
          </details>
        </Reveal>
      ))}

      {reply.steps.length > 0 && <Reveal i={n++} fresh={fresh}><Steps reply={reply} work={work} onWork={onWork} /></Reveal>}
      {reply.exercise && <Reveal i={n++} fresh={fresh}><Exercise reply={reply} work={work} busy={busy} onWork={onWork} onAsk={onAsk} /></Reveal>}
      {reply.verdict && <Reveal i={n++} fresh={fresh}><Verdict reply={reply} /></Reveal>}
      {reply.quiz.length > 0 && <Reveal i={n++} fresh={fresh}><Quiz reply={reply} work={work} onWork={onWork} onAsk={onAsk} busy={busy} /></Reveal>}
      {reply.ideas.length > 0 && <Reveal i={n++} fresh={fresh}><Ideas reply={reply} work={work} onWork={onWork} onAdd={() => insert('ideas', 'Ideas')} /></Reveal>}
      {reply.cards.length > 0 && <Reveal i={n++} fresh={fresh}><Cards reply={reply} work={work} onWork={onWork} /></Reveal>}
      {reply.organize && <Reveal i={n++} fresh={fresh}><Organize reply={reply} onUseTitle={onUseTitle} insert={insert} /></Reveal>}

      {reply.related.length > 0 && (
        <Reveal i={n++} fresh={fresh}>
          <div className="rounded-xl border border-white/6 px-3 py-2.5" data-tutor-related>
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-subtle">Connects to</p>
            <ul className="mt-1.5 space-y-2">
              {reply.related.map(r => {
                const s = reply.sources.find(x => x.id === r.sourceId)!
                return (
                  <li key={r.sourceId} className="text-sm">
                    <div className="flex items-center gap-2">
                      <Link href={sourceHref(s)} className="min-w-0 flex-1 truncate text-nova-ink hover:underline">{s.title}</Link>
                      {s.kind === 'note' && <button type="button" className={small} onClick={() => onInsert(`Related: [[${s.title}]]${r.why ? ` (${r.why})` : ''}`, `A link to ${s.title}`)}><Link2 className="size-3.5" /> Link it</button>}
                    </div>
                    {r.why && <p className="mt-0.5 text-xs leading-relaxed text-foreground/60">{r.why}</p>}
                  </li>
                )
              })}
            </ul>
          </div>
        </Reveal>
      )}

      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        {whole && !reply.organize && reply.mode !== 'evaluate' && (
          <button type="button" className={chip} onClick={() => onInsert(whole, MODE_LABEL[reply.mode])} data-tutor-insert>
            <FilePlus2 className="size-3.5" /> Add to note
          </button>
        )}
        {reply.followUps.map(f => (
          <button key={f} type="button" className={chip} disabled={busy} onClick={() => onAsk({ mode: 'explain', message: f, passage: reply.passage?.text })} data-follow-up>{f}</button>
        ))}
      </div>
    </div>
  )
}

function Steps({ reply, work, onWork }: { reply: TutorReply; work: TutorWork; onWork: (c: Partial<TutorWork>) => void }) {
  const shown = work.stepsShown ?? 0
  const next = reply.steps[shown]
  return (
    <ol className="space-y-2" data-tutor-steps>
      {reply.steps.slice(0, shown).map((s, i) => (
        <li key={i} className="nova-reveal rounded-xl border border-white/6 px-3 py-2.5">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-foreground"><span className="grid size-5 place-items-center rounded-full bg-nova/15 text-[11px] text-nova-ink">{i + 1}</span>{s.title}</p>
          {work.tries?.[i] && <p className="mt-1.5 rounded-lg bg-white/4 px-2.5 py-1.5 text-xs text-foreground/70"><span className="text-subtle">Your try:</span> {work.tries[i]}</p>}
          <div className="mt-1.5"><Text text={s.text} sources={reply.sources} /></div>
        </li>
      ))}
      {next && (
        <li className="rounded-xl border border-dashed border-nova/30 px-3 py-2.5" data-step-next={shown}>
          <p className="text-[13px] font-semibold text-foreground">Step {shown + 1} of {reply.steps.length}{next.prompt ? ': try it first' : ''}</p>
          {next.prompt && (
            <>
              <p className="mt-1 text-sm text-foreground/75">{next.prompt}</p>
              <textarea rows={2} className={`${field} mt-2`} placeholder="Your attempt (optional)" value={work.tries?.[shown] ?? ''}
                onChange={e => onWork({ tries: { ...work.tries, [shown]: e.target.value } })} aria-label={`Your attempt at step ${shown + 1}`} />
            </>
          )}
          <div className="mt-2 flex gap-2">
            <button type="button" className={small} onClick={() => onWork({ stepsShown: shown + 1 })}><Eye className="size-3.5" /> Show step {shown + 1}</button>
            {reply.steps.length - shown > 1 && <button type="button" className={`${small} text-subtle`} onClick={() => onWork({ stepsShown: reply.steps.length })}>Show all</button>}
          </div>
        </li>
      )}
    </ol>
  )
}

function Exercise({ reply, work, busy, onWork, onAsk }: { reply: TutorReply; work: TutorWork; busy: boolean; onWork: (c: Partial<TutorWork>) => void; onAsk: (a: TutorAsk) => void }) {
  const ex = reply.exercise!
  const answer = work.answer ?? ''
  return (
    <div className="rounded-xl border border-nova/25 bg-nova/[0.04] px-3 py-3" data-tutor-exercise={ex.kind}>
      <div className="flex items-center gap-2"><Basis basis={ex.basis} /><span className="text-[11px] font-medium uppercase tracking-[0.12em] text-subtle">{reply.mode === 'check' ? 'Check your understanding' : 'Practice'}</span></div>
      <div className="mt-2"><Text text={ex.question} sources={reply.sources} /></div>
      {ex.kind === 'choice' ? (
        <div className="mt-2 space-y-1.5" role="radiogroup" aria-label="Choices">
          {ex.choices.map(c => (
            <label key={c} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-sm ${answer === c ? 'border-nova/60 bg-nova/10' : 'border-white/10 hover:border-white/20'}`}>
              <input type="radio" name={`ex-${ex.question.slice(0, 20)}`} className="mt-1 accent-[var(--nova)]" checked={answer === c} disabled={work.checked} onChange={() => onWork({ answer: c })} />
              <span>{c}</span>
            </label>
          ))}
        </div>
      ) : (
        <textarea rows={3} className={`${field} mt-2`} placeholder="Your answer, in your own words" value={answer} disabled={work.checked}
          onChange={e => onWork({ answer: e.target.value })} aria-label="Your answer" data-exercise-answer />
      )}
      {work.hint && ex.hint && <p className="mt-2 flex gap-1.5 text-xs text-foreground/70"><Lightbulb className="mt-0.5 size-3.5 shrink-0 text-amber-300" /> {ex.hint}</p>}
      {work.shown && <p className="mt-2 rounded-lg bg-white/4 px-2.5 py-2 text-xs text-foreground/75"><span className="font-semibold text-foreground">Expected:</span> {ex.answer}</p>}
      {!work.checked && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy || !answer.trim()} onClick={() => onAsk({ mode: 'evaluate', exercise: ex, answer: answer.trim() })}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-action px-3 text-xs font-semibold text-action-foreground transition-colors hover:bg-action-hover disabled:opacity-50" data-check-answer>
            <Check className="size-3.5" /> Check my answer
          </button>
          {ex.hint && !work.hint && <button type="button" className={small} onClick={() => onWork({ hint: true })}>Hint</button>}
          {!work.shown && <button type="button" className={`${small} text-subtle`} onClick={() => onWork({ shown: true })}>Show the answer</button>}
        </div>
      )}
    </div>
  )
}

const VERDICT = {
  correct:   { label: 'Correct',        tone: 'border-emerald-400/40 bg-emerald-400/[0.06] text-emerald-300' },
  partly:    { label: 'Partly there',   tone: 'border-amber-300/40 bg-amber-300/[0.06] text-amber-300' },
  incorrect: { label: 'Not quite',      tone: 'border-red-400/40 bg-red-400/[0.06] text-red-300' },
} as const

function Verdict({ reply }: { reply: TutorReply }) {
  const v = reply.verdict!
  const style = VERDICT[v.result]
  return (
    <div className={`rounded-xl border px-3 py-3 ${style.tone}`} data-verdict={v.result} role="status">
      <p className="text-sm font-semibold">{style.label}</p>
      <div className="mt-1.5 text-foreground/85"><Text text={v.feedback} sources={reply.sources} /></div>
      {v.next && <p className="mt-2 text-xs text-foreground/65"><span className="font-semibold text-foreground/80">Next:</span> {v.next}</p>}
    </div>
  )
}

function Quiz({ reply, work, onWork, onAsk, busy }: { reply: TutorReply; work: TutorWork; onWork: (c: Partial<TutorWork>) => void; onAsk: (a: TutorAsk) => void; busy: boolean }) {
  const picks = work.picks ?? {}
  const answered = Object.keys(picks).length
  const right = reply.quiz.filter((q, i) => picks[i] === q.answer).length
  return (
    <div className="space-y-2.5" data-tutor-quiz>
      {reply.quiz.map((q, i) => {
        const pick = picks[i]
        const done = pick !== undefined
        return (
          <fieldset key={i} className="rounded-xl border border-white/8 px-3 py-2.5" data-quiz-item={i}>
            <legend className="sr-only">Question {i + 1}</legend>
            <div className="flex items-center gap-2"><span className="text-[11px] font-medium text-subtle">{i + 1} / {reply.quiz.length}</span><Basis basis={q.basis} /></div>
            <p className="mt-1.5 text-sm font-medium text-foreground">{q.question}</p>
            <div className="mt-2 space-y-1.5">
              {q.choices.map((c, k) => {
                const isRight = k === q.answer
                const tone = !done ? 'border-white/10 hover:border-white/25' : isRight ? 'border-emerald-400/50 bg-emerald-400/[0.07]' : k === pick ? 'border-red-400/50 bg-red-400/[0.07]' : 'border-white/6 opacity-70'
                return (
                  <button key={k} type="button" disabled={done} onClick={() => onWork({ picks: { ...picks, [i]: k } })}
                    className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition-colors ${tone}`} aria-pressed={pick === k} data-quiz-choice={k}>
                    {done && isRight ? <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-300" /> : done && k === pick ? <X className="mt-0.5 size-3.5 shrink-0 text-red-300" /> : <span className="mt-1 size-2.5 shrink-0 rounded-full border border-foreground/30" />}
                    <span>{c}</span>
                  </button>
                )
              })}
            </div>
            {done && q.why && <div className="mt-2 text-xs text-foreground/70" data-quiz-why><span className="font-semibold text-foreground/85">{pick === q.answer ? 'Right. ' : 'Why: '}</span><Text text={q.why} sources={reply.sources} /></div>}
          </fieldset>
        )
      })}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-foreground/70" data-quiz-score>{answered === reply.quiz.length ? `${right} of ${reply.quiz.length} right` : `${answered} of ${reply.quiz.length} answered`}</span>
        {answered > 0 && <button type="button" className={small} onClick={() => onWork({ picks: {} })}><RotateCcw className="size-3.5" /> Try again</button>}
        {answered === reply.quiz.length && <button type="button" className={small} disabled={busy} onClick={() => onAsk({ mode: right === reply.quiz.length ? 'practice' : 'explain', message: right === reply.quiz.length ? undefined : `Explain what I got wrong: ${reply.quiz.filter((q, i) => picks[i] !== q.answer).map(q => q.question).join(' / ')}`.slice(0, 900) })}>{right === reply.quiz.length ? 'Something harder' : 'Explain what I missed'}</button>}
      </div>
    </div>
  )
}

function Ideas({ reply, work, onWork, onAdd }: { reply: TutorReply; work: TutorWork; onWork: (c: Partial<TutorWork>) => void; onAdd: () => void }) {
  const chosen = work.chosen ?? {}
  const count = reply.ideas.filter((_, i) => chosen[i]).length
  return (
    <div className="rounded-xl border border-white/8 px-3 py-2.5" data-tutor-ideas>
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-subtle">Tick the ideas worth keeping</p>
      <ul className="mt-2 space-y-1.5">
        {reply.ideas.map((idea, i) => (
          <li key={i}>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-white/3">
              <input type="checkbox" className="mt-1 accent-[var(--nova)]" checked={!!chosen[i]} onChange={e => onWork({ chosen: { ...chosen, [i]: e.target.checked } })} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">{idea.title} <Basis basis={idea.basis} /></span>
                {idea.text && <span className="mt-0.5 block text-xs leading-relaxed text-foreground/65"><Text text={idea.text} sources={reply.sources} /></span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <button type="button" className={`${small} mt-1.5`} onClick={onAdd} data-ideas-add><FilePlus2 className="size-3.5" /> {count ? `Add ${count} to note` : 'Add all to note'}</button>
    </div>
  )
}

function Cards({ reply, work, onWork }: { reply: TutorReply; work: TutorWork; onWork: (c: Partial<TutorWork>) => void }) {
  const flipped = work.flipped ?? {}
  return (
    <div className="grid gap-2 sm:grid-cols-2" data-tutor-cards>
      {reply.cards.map((c, i) => (
        <button key={i} type="button" onClick={() => onWork({ flipped: { ...flipped, [i]: !flipped[i] } })} aria-pressed={!!flipped[i]}
          className={`min-h-20 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${flipped[i] ? 'border-nova/40 bg-nova/[0.06] text-foreground/85' : 'border-white/10 text-foreground hover:border-white/20'}`} data-card={i}>
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-subtle">{flipped[i] ? 'Answer' : `Card ${i + 1} · tap to flip`}</span>
          <span className="mt-1 block">{flipped[i] ? c.back : c.front}</span>
        </button>
      ))}
    </div>
  )
}

function Organize({ reply, onUseTitle, insert }: { reply: TutorReply; onUseTitle: (t: string) => void; insert: (part: InsertPart, label: string) => void }) {
  const o = reply.organize!
  const row = (label: string, body: ReactNode, action: ReactNode) => (
    <div className="border-t border-white/6 py-2.5 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-2"><p className="text-[11px] font-medium uppercase tracking-[0.12em] text-subtle">{label}</p>{action}</div>
      <div className="mt-1">{body}</div>
    </div>
  )
  return (
    <div className="rounded-xl border border-white/8 px-3 py-3" data-tutor-organize>
      <p className="mb-2 text-xs leading-relaxed text-foreground/60">Suggestions only. Your text stays as it is; add the parts you want.</p>
      {o.title && row('Title', <p className="text-sm font-medium text-foreground">{o.title}</p>, <button type="button" className={small} onClick={() => onUseTitle(o.title!)}>Use as title</button>)}
      {o.overview && row('Overview', <Text text={o.overview} sources={reply.sources} />, <button type="button" className={small} onClick={() => insert('overview', 'Overview')}><FilePlus2 className="size-3.5" /> Add</button>)}
      {o.concepts.length > 0 && row('Key concepts', <div className="flex flex-wrap gap-1.5">{o.concepts.map(c => <span key={c} className="rounded-full bg-white/6 px-2 py-0.5 text-xs text-foreground/80">{c}</span>)}</div>, <button type="button" className={small} onClick={() => insert('concepts', 'Key concepts')}><FilePlus2 className="size-3.5" /> Add</button>)}
      {o.questions.length > 0 && row('Questions to explore', <ul className="list-disc space-y-0.5 pl-4 text-sm text-foreground/80">{o.questions.map(q => <li key={q}>{q}</li>)}</ul>, <button type="button" className={small} onClick={() => insert('questions', 'Questions')}><FilePlus2 className="size-3.5" /> Add</button>)}
      {o.tags.length > 0 && row('Tags', <div className="flex flex-wrap gap-1.5">{o.tags.map(t => <span key={t} className="rounded-full bg-orange-400/12 px-2 py-0.5 text-[11px] font-medium text-orange-300">#{t}</span>)}</div>, <button type="button" className={small} onClick={() => insert('tags', 'Tags')}><FilePlus2 className="size-3.5" /> Add</button>)}
      {o.outline && row('Organised version', (
        <details className="group">
          <summary className="cursor-pointer text-xs text-nova-ink">Preview the organised version</summary>
          <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-white/6 px-3 py-2"><NoteBody body={o.outline} links={[]} compact /></div>
        </details>
      ), <button type="button" className={small} onClick={() => insert('outline', 'Organised version')}><FilePlus2 className="size-3.5" /> Add below</button>)}
    </div>
  )
}

export const modeLabel = (m: TutorMode) => MODE_LABEL[m]
