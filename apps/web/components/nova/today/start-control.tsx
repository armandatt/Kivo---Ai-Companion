'use client'

// Starting a focus session on an item: one click starts it at the suggested
// length; the chevron opens a small chooser for a length for this session
// only, or no time limit. What is chosen here is this session's length: the
// item's time for today and the task's own estimate stay as they are.
//
// Suggested: the item's time for today, else its own estimate (a task's, a
// planned block's), else a standard block, said as such.

import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, Infinity as Unlimited, Loader2, Play } from 'lucide-react'
import { cn } from '@/lib/utils'

export const STANDARD_BLOCK = 25

export function suggestedFor(item: { minutes: number | null; ref: { minutes: number | null } | null }): { minutes: number; basis: 'today' | 'estimate' | 'standard' } {
  if (item.minutes) return { minutes: item.minutes, basis: 'today' }
  if (item.ref?.minutes) return { minutes: item.ref.minutes, basis: 'estimate' }
  return { minutes: STANDARD_BLOCK, basis: 'standard' }
}

// Quick lengths around the suggestion, not a fixed list: a shorter and a
// longer one either side of it, rounded to five minutes.
export function quickLengths(suggested: number): number[] {
  const all = [10, 15, 20, 25, 30, 45, 60, 90, 120]
  const lower = all.filter(m => m < suggested).slice(-2)
  const higher = all.filter(m => m > suggested).slice(0, 2)
  return [...lower, ...higher]
}

const label = (m: number) => (m >= 60 && m % 60 === 0 ? `${m / 60} h` : m > 60 ? `${Math.floor(m / 60)} h ${m % 60}` : `${m} min`)

export function StartControl({ item, onStart, disabled, busy, size = 'sm' }: {
  item: { id: string; title: string; minutes: number | null; ref: { minutes: number | null } | null }
  // minutes: this session's length; 0: no time limit.
  onStart: (minutes: number) => void
  disabled?: boolean
  busy?: boolean
  // lg: the next-focus card's own button.
  size?: 'sm' | 'lg'
}) {
  const lg = size === 'lg'
  const s = suggestedFor(item)
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const panel = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    panel.current?.querySelector<HTMLElement>('button')?.focus()
    const onDown = (e: PointerEvent) => { if (!panel.current?.contains(e.target as Node) && e.target !== toggle.current) setOpen(false) }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])

  const start = (m: number) => { setOpen(false); onStart(m) }
  const customMinutes = Number(custom)
  const customOk = Number.isInteger(customMinutes) && customMinutes >= 5 && customMinutes <= 240

  return (
    <div className="relative inline-flex shrink-0" data-start-control={item.id}>
      <button type="button" disabled={disabled} onClick={() => start(s.minutes)}
        className={cn('inline-flex items-center gap-1.5 rounded-l-lg bg-action font-semibold text-action-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.16)] transition-colors hover:bg-action-hover disabled:opacity-50',
          lg ? 'h-11 gap-2 rounded-l-xl pl-4 pr-3.5 text-[15px]' : 'h-8 pl-2.5 pr-2 text-xs')}
        title={`Start ${item.title} for ${label(s.minutes)}`} data-start-suggested>
        {busy ? <Loader2 className={lg ? 'size-4 animate-spin' : 'size-3.5 animate-spin'} /> : <Play className={lg ? 'size-4 fill-current' : 'size-3.5'} />} {lg ? `Start ${label(s.minutes)} focus` : `Start · ${label(s.minutes)}`}
      </button>
      <button ref={toggle} type="button" disabled={disabled} onClick={() => setOpen(o => !o)} aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
        className={cn('inline-flex items-center border-l border-action-foreground/20 bg-action text-action-foreground transition-colors hover:bg-action-hover disabled:opacity-50', lg ? 'h-11 rounded-r-xl px-2.5' : 'h-8 rounded-r-lg px-1.5')}
        aria-label={`Choose how long to focus on ${item.title}`} data-start-options>
        <ChevronDown className="size-3.5" />
      </button>
      {open && (
        <div ref={panel} id={id} role="dialog" aria-label={`How long for ${item.title}`}
          onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); toggle.current?.focus() } }}
          className={cn('absolute z-30 w-64 rounded-xl border border-white/10 bg-card p-3 text-sm shadow-float', lg ? 'left-0 top-12' : 'right-0 top-9')} data-start-panel>
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-subtle">This session</p>
          <button type="button" onClick={() => start(s.minutes)} className="mt-2 flex w-full items-center justify-between rounded-lg bg-nova/10 px-2.5 py-2 text-left hover:bg-nova/15" data-duration="suggested">
            <span className="font-medium text-foreground">Suggested: {label(s.minutes)}</span>
            <span className="text-[11px] text-subtle">{s.basis === 'today' ? 'today’s time' : s.basis === 'estimate' ? 'its estimate' : 'a standard block'}</span>
          </button>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {quickLengths(s.minutes).map(m => (
              <button key={m} type="button" onClick={() => start(m)} className="rounded-full border border-white/12 px-2.5 py-1 text-xs text-foreground/85 hover:border-nova/50" data-duration={m}>{label(m)}</button>
            ))}
          </div>
          <form className="mt-2 flex items-center gap-1.5" onSubmit={e => { e.preventDefault(); if (customOk) start(customMinutes) }}>
            <label className="sr-only" htmlFor={`${id}-custom`}>Minutes</label>
            <input id={`${id}-custom`} inputMode="numeric" value={custom} onChange={e => setCustom(e.target.value.slice(0, 3))} placeholder="Custom"
              className="h-8 w-20 rounded-lg border border-white/10 bg-transparent px-2 text-xs text-foreground focus:border-nova/60 focus:outline-none" data-duration-custom />
            <span className="text-xs text-subtle">min</span>
            <button type="submit" disabled={!customOk} className="ml-auto rounded-lg border border-white/12 px-2.5 py-1 text-xs font-medium text-foreground/85 disabled:opacity-40">Start</button>
          </form>
          <button type="button" onClick={() => start(0)} className={cn('mt-2 flex w-full items-center gap-2 rounded-lg border border-white/10 px-2.5 py-2 text-left hover:bg-white/5')} data-duration="untimed">
            <Unlimited className="size-4 text-nova-ink" aria-hidden />
            <span><span className="block font-medium text-foreground">No time limit</span><span className="block text-[11px] text-subtle">No countdown. Finish whenever you like.</span></span>
          </button>
          <p className="mt-2 text-[11px] leading-relaxed text-subtle">Only this session. {item.ref?.minutes ? 'The task’s own estimate stays as it is.' : ''}</p>
        </div>
      )}
    </div>
  )
}
