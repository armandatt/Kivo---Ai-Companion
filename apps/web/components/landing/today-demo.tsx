'use client'

// Today, on the landing page, the way the studio works (nova-home.tsx,
// today/playground.tsx, today/start-control.tsx): the day starts empty, the
// learner says what it is about, Nova proposes a flow marked "Not applied
// yet", the learner reorders it and changes the times, applies it, and starts
// a focus session at the suggested length, their own, or with no time limit.
// Nothing is decided before the visitor chooses. Local state only.

import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowDown, ArrowUp, Check, Clock, List, Minus, Play, Plus, Sparkles, Square, Timer } from 'lucide-react'
import { KioMark } from '@/components/brand/kio-brand'
import { subjectColor } from '@/components/nova/subject-color'
import { cn } from '@/lib/utils'
import { AppWindow, ReplayButton } from './frame'

type Item = { id: string; title: string; subject: string; kind: 'Topic' | 'Task'; minutes: number }
const OFFER: Record<string, Item[]> = {
  'Operating Systems': [
    { id: 'dead', title: 'Deadlocks', subject: 'Operating Systems', kind: 'Topic', minutes: 40 },
    { id: 'ps3', title: 'Problem set 3', subject: 'Operating Systems', kind: 'Task', minutes: 30 },
  ],
  'Machine Learning': [{ id: 'gd', title: 'Gradient descent', subject: 'Machine Learning', kind: 'Topic', minutes: 30 }],
  'Corporate Finance': [{ id: 'wacc', title: 'WACC', subject: 'Corporate Finance', kind: 'Topic', minutes: 25 }],
}
const SUBJECTS = Object.keys(OFFER)
const TIMES = [60, 90, 120]
const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`)
const clock = (start: number) => { const h = Math.floor(start / 60), m = start % 60; return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}` }

type Stage = 'choose' | 'thinking' | 'proposal' | 'saved'

export function TodayDemo() {
  const reduced = useReducedMotion()
  const [picked, setPicked] = useState<string[]>([])
  const [time, setTime] = useState<number | null>(null)
  const [stage, setStage] = useState<Stage>('choose')
  const [items, setItems] = useState<Item[]>([])
  const [view, setView] = useState<'list' | 'schedule'>('list')
  const [focus, setFocus] = useState<{ item: Item; minutes: number; started: number } | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [custom, setCustom] = useState('')
  const [now, setNow] = useState(0)

  // Nova's proposal: what the visitor chose, fitted into the time they gave.
  const proposal = useMemo(() => {
    const out: Item[] = []
    let left = time ?? 0
    for (const s of picked) for (const i of OFFER[s] ?? []) if (i.minutes <= left) { out.push(i); left -= i.minutes }
    return out
  }, [picked, time])

  useEffect(() => {
    if (stage !== 'thinking') return
    const t = window.setTimeout(() => { setItems(proposal); setStage('proposal') }, reduced ? 0 : 900)
    return () => window.clearTimeout(t)
  }, [stage, proposal, reduced])
  useEffect(() => {
    if (!focus) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [focus])

  const toggle = (s: string) => setPicked(p => (p.includes(s) ? p.filter(x => x !== s) : [...p, s]))
  const move = (i: number, by: number) => setItems(list => { const next = [...list]; const j = i + by; if (j < 0 || j >= next.length) return list; [next[i], next[j]] = [next[j]!, next[i]!]; return next })
  const minutes = (i: number, by: number) => setItems(list => list.map((x, k) => (k === i ? { ...x, minutes: Math.max(10, Math.min(120, x.minutes + by)) } : x)))
  const total = items.reduce((s, i) => s + i.minutes, 0)
  const reset = () => { setPicked([]); setTime(null); setStage('choose'); setItems([]); setFocus(null); setMenu(null); setView('list') }
  const start = (item: Item, m: number) => { setFocus({ item, minutes: m, started: Date.now() }); setNow(Date.now()); setMenu(null) }
  const elapsed = focus ? Math.max(0, Math.floor((now - focus.started) / 1000)) : 0
  const shownClock = focus ? (focus.minutes ? Math.max(0, focus.minutes * 60 - elapsed) : elapsed) : 0
  const mmss = `${Math.floor(shownClock / 60)}:${String(shownClock % 60).padStart(2, '0')}`

  const nova = (
    <section aria-label="Nova" className="flex h-full min-h-0 flex-col bg-gradient-to-b from-nova/[0.05] to-transparent">
      <div className="flex items-center gap-2.5 border-b border-white/6 px-4 py-3">
        <span aria-hidden className="grid size-8 place-items-center rounded-xl bg-nova/15 ring-1 ring-nova/30"><KioMark size={14} className="text-nova-ink" /></span>
        <div><p className="text-sm font-semibold text-foreground">Nova</p><p className="text-[11px] text-foreground/55">Plans today with you · nothing changes without your yes</p></div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 text-[13px] leading-relaxed" aria-live="polite">
        <p className="text-foreground/90">What do you want today to be about?</p>
        <div>
          <p className="text-[11px] text-foreground/55">Pick the subjects (one or more)</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {SUBJECTS.map(s => (
              <button key={s} type="button" aria-pressed={picked.includes(s)} disabled={stage !== 'choose'} onClick={() => toggle(s)} data-today-demo-subject={s}
                className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-60', picked.includes(s) ? 'border-nova/60 bg-nova/12 text-foreground' : 'border-white/12 text-foreground/75 hover:border-nova/40')}>
                <span aria-hidden className={cn('size-1.5 rounded-full', subjectColor(s).dot)} />{s}{picked.includes(s) && <Check aria-hidden className="size-3" />}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[11px] text-foreground/55">How much time do you have?</p>
          <div className="mt-1.5 flex gap-1.5">
            {TIMES.map(t => (
              <button key={t} type="button" aria-pressed={time === t} disabled={stage !== 'choose'} onClick={() => setTime(t)} data-today-demo-time={t}
                className={cn('rounded-full border px-2.5 py-1 text-xs disabled:opacity-60', time === t ? 'border-nova/60 bg-nova/12 text-foreground' : 'border-white/12 text-foreground/75 hover:border-nova/40')}>{hm(t)}</button>
            ))}
          </div>
        </div>
        {stage === 'choose' && (
          <button type="button" disabled={!picked.length || !time} onClick={() => setStage('thinking')} data-today-demo-ask
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-action px-3.5 text-xs font-semibold text-action-foreground hover:bg-action-hover disabled:opacity-40">
            <Sparkles aria-hidden className="size-3.5" /> Propose a flow
          </button>
        )}
        {stage === 'thinking' && <p className="text-xs text-foreground/60">Nova is thinking…</p>}
        {stage === 'proposal' && <p className="text-foreground/85">Here’s a flow from what you chose, in {hm(time!)}. It’s in the playground, not applied yet. Reorder it or change the times, then apply it.</p>}
        {stage === 'saved' && <p className="inline-flex items-center gap-1.5 text-nova-ink"><Check aria-hidden className="size-3.5" /> Applied and saved. Your day is yours to change.</p>}
      </div>
    </section>
  )

  const row = (it: Item, i: number, at: number) => {
    const c = subjectColor(it.subject)
    return (
      <motion.li key={it.id} layout={!reduced} initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: stage === 'proposal' && !reduced ? i * 0.08 : 0 }}
        className={cn('relative flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-card/70 py-2.5 pl-4 pr-2.5', stage === 'proposal' ? 'border-dashed border-nova/40' : 'border-white/8')} data-today-demo-item={it.id}>
        <span aria-hidden className={cn('absolute inset-y-2 left-1.5 w-1 rounded-full', c.bar)} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{it.title}</p>
          <p className="text-[11px]"><span className={c.text}>{it.subject}</span> <span className="text-foreground/45">· {it.kind}{view === 'schedule' && stage === 'saved' ? ` · ${clock(at)}` : ''}</span></p>
        </div>
        {stage === 'proposal' ? (
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => minutes(i, -5)} aria-label={`Five minutes less for ${it.title}`} className="grid size-7 place-items-center rounded-md text-foreground/60 hover:bg-white/6"><Minus className="size-3.5" /></button>
            <span className="w-14 text-center text-xs tabular-nums text-foreground/85">{hm(it.minutes)}</span>
            <button type="button" onClick={() => minutes(i, 5)} aria-label={`Five minutes more for ${it.title}`} className="grid size-7 place-items-center rounded-md text-foreground/60 hover:bg-white/6"><Plus className="size-3.5" /></button>
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${it.title} up`} className="grid size-7 place-items-center rounded-md text-foreground/60 hover:bg-white/6 disabled:opacity-30" data-today-demo-up><ArrowUp className="size-3.5" /></button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label={`Move ${it.title} down`} className="grid size-7 place-items-center rounded-md text-foreground/60 hover:bg-white/6 disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
          </div>
        ) : (
          <div className="relative">
            <span className="mr-2 text-xs text-foreground/55">{hm(it.minutes)}</span>
            <button type="button" disabled={!!focus} onClick={() => start(it, it.minutes)} className="inline-flex h-8 items-center gap-1.5 rounded-l-lg bg-action px-2.5 text-xs font-semibold text-action-foreground hover:bg-action-hover disabled:opacity-40" data-today-demo-start>
              <Play aria-hidden className="size-3 fill-current" /> Start · {hm(it.minutes)}
            </button>
            <button type="button" disabled={!!focus} onClick={() => setMenu(m => (m === it.id ? null : it.id))} aria-expanded={menu === it.id} aria-label={`Choose how long to focus on ${it.title}`}
              className="inline-flex h-8 items-center rounded-r-lg border-l border-black/20 bg-action px-1.5 text-action-foreground hover:bg-action-hover disabled:opacity-40" data-today-demo-options>▾</button>
            {menu === it.id && (
              <div role="dialog" aria-label={`How long for ${it.title}`} className="absolute right-0 top-10 z-20 w-60 rounded-xl border border-white/10 bg-popover p-3 text-xs shadow-float">
                <button type="button" onClick={() => start(it, it.minutes)} className="flex w-full justify-between rounded-lg bg-nova/10 px-2.5 py-2 text-left hover:bg-nova/15"><span className="font-medium text-foreground">Suggested: {hm(it.minutes)}</span><span className="text-subtle">today’s time</span></button>
                <form className="mt-2 flex items-center gap-1.5" onSubmit={e => { e.preventDefault(); const m = Number(custom); if (m >= 5 && m <= 240) start(it, m) }}>
                  <label className="sr-only" htmlFor={`custom-${it.id}`}>Minutes</label>
                  <input id={`custom-${it.id}`} inputMode="numeric" value={custom} onChange={e => setCustom(e.target.value.slice(0, 3))} placeholder="Custom" className="h-8 w-20 rounded-lg border border-white/10 bg-transparent px-2 text-foreground focus:outline-none" />
                  <span className="text-subtle">min</span>
                  <button type="submit" className="ml-auto rounded-lg border border-white/12 px-2.5 py-1 text-foreground/85">Start</button>
                </form>
                <button type="button" onClick={() => start(it, 0)} className="mt-2 flex w-full items-center gap-2 rounded-lg border border-white/10 px-2.5 py-2 text-left hover:bg-white/5" data-today-demo-untimed>
                  <Timer aria-hidden className="size-4 text-nova-ink" /><span><span className="block font-medium text-foreground">No time limit</span><span className="block text-[11px] text-subtle">No countdown. Finish whenever you like.</span></span>
                </button>
              </div>
            )}
          </div>
        )}
      </motion.li>
    )
  }

  let at = 16 * 60
  return (
    <div className="space-y-4">
      <AppWindow label="Kio · Today" className="h-[46rem] lg:h-[34rem]">
        <div className="grid h-full lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-h-0 overflow-y-auto px-4 py-4 sm:px-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-subtle">Tuesday</p>
            <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">Good afternoon</p>
            <AnimatePresence>
              {focus && (
                <motion.div initial={reduced ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-nova/30 bg-nova/[0.07] px-4 py-3" role="status" data-today-demo-focus>
                  <Clock aria-hidden className="size-4 text-nova-ink" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">Focusing on {focus.item.title}</p>
                    <p className="text-[11px] text-foreground/60">{focus.minutes ? `${hm(focus.minutes)} session · time left` : 'No time limit · time focused so far'} <span className="font-mono text-foreground/85">{mmss}</span></p>
                  </div>
                  <button type="button" onClick={() => setFocus(null)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/12 px-3 text-xs text-foreground/85 hover:bg-white/5" data-today-demo-end><Square aria-hidden className="size-3" /> End session</button>
                </motion.div>
              )}
            </AnimatePresence>
            <div className={cn('mt-4 rounded-2xl border p-4 transition-colors', stage === 'proposal' ? 'border-nova/40 bg-nova/[0.04]' : 'border-white/8 bg-card/40')}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">{stage === 'proposal' ? 'Nova’s proposal' : stage === 'saved' ? 'Your flow for today' : 'Let’s design your day.'}</p>
                {stage === 'proposal' && <span className="rounded-full bg-amber-300/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-200">Not applied yet</span>}
                {stage === 'saved' && (
                  <div role="group" aria-label="View" className="inline-flex rounded-lg border border-white/10 p-0.5 text-xs">
                    {(['list', 'schedule'] as const).map(v => (
                      <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn('inline-flex h-7 items-center gap-1 rounded-md px-2', view === v ? 'bg-white/10 text-foreground' : 'text-foreground/55')} data-today-demo-view={v}>
                        {v === 'list' ? <List aria-hidden className="size-3.5" /> : <Clock aria-hidden className="size-3.5" />}{v === 'list' ? 'List' : 'Schedule'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {stage === 'choose' || stage === 'thinking' ? (
                <p className="mt-3 max-w-md text-sm leading-relaxed text-foreground/55">Nothing is in your day until you choose it. Tell Nova what today is about, or add things yourself.</p>
              ) : (
                <>
                  <ol className="mt-3 space-y-2">{items.map((it, i) => { const r = row(it, i, at); at += it.minutes; return r })}</ol>
                  <p className="mt-2 text-[11px] text-foreground/50">{hm(total)} planned of {hm(time ?? 0)}</p>
                  {stage === 'proposal' && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={() => setStage('saved')} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-action px-3.5 text-xs font-semibold text-action-foreground hover:bg-action-hover" data-today-demo-apply><Check aria-hidden className="size-3.5" /> Apply plan</button>
                      <button type="button" onClick={() => { setStage('choose'); setItems([]) }} className="inline-flex h-9 items-center rounded-xl px-3 text-xs text-foreground/60 hover:text-foreground">Discard</button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="min-h-0 border-white/6 max-lg:border-t lg:border-l">{nova}</div>
        </div>
      </AppWindow>
      <div className="flex justify-end"><ReplayButton onClick={reset} /></div>
    </div>
  )
}
