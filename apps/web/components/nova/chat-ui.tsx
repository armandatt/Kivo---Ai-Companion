'use client'

// What every conversation with Nova shares: the three dots and the line saying
// what Nova is doing, the words as they arrive, and following the conversation
// down without taking the page away from a learner who has scrolled up.

import { useCallback, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

// Stays with the newest message only while the reader is at the bottom.
const NEAR_BOTTOM_PX = 96
export function isNearBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
}

export function useFollowBottom(log: React.RefObject<HTMLElement | null>, deps: readonly unknown[]) {
  const following = useRef(true)
  useEffect(() => {
    const el = log.current
    if (!el) return
    const onScroll = () => { following.current = isNearBottom(el) }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [log])
  useEffect(() => {
    const el = log.current
    if (!el || !following.current) return
    const instant = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollTo({ top: el.scrollHeight, behavior: instant ? 'auto' : 'smooth' })
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  // A message the learner just sent always brings them back down.
  return useCallback(() => { following.current = true }, [])
}

// Nova at work: three dots, and what it is doing. Decoration only; the panel's
// own status line is what a screen reader hears.
export function ThinkingDots({ label, className }: { label?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)} data-thinking>
      <span aria-hidden className="nova-dots"><span /><span /><span /></span>
      {label && <span className="nova-shimmer text-[13px]">{label}</span>}
    </span>
  )
}

// The words so far, while the reply is being written. Plain text: the checked
// reply replaces it, with its formatting, when it is finished.
export function LiveText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('whitespace-pre-wrap break-words', className)} data-live-text>
      {text}<span aria-hidden className="nova-caret" />
    </div>
  )
}
