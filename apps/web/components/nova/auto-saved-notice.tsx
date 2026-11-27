'use client'

// A paused session that was left paused past the limit is saved for the
// learner with the time studied before the pause (bug batch 28 Nov, item 1).
// This says so, once, wherever the learner comes back: Home and Focus.

import Link from 'next/link'
import { X } from 'lucide-react'
import type { NovaAutoSavedSession } from '@repo/api/nova/product/today.types'
import { ConfirmTime } from './confirm-time'

export function AutoSavedNotice({ saved, onDismiss, tone = 'page' }: { saved: NovaAutoSavedSession; onDismiss: () => void; tone?: 'page' | 'room' }) {
  return (
    <section role="status" data-auto-saved={saved.sessionId}
      className={tone === 'room'
        ? 'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-white/15 bg-black/40 px-4 py-3 text-sm text-white/90 backdrop-blur'
        : 'mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-nova/25 bg-nova/[0.05] px-4 py-3 text-sm'}>
      <span className={tone === 'room' ? '' : 'text-foreground'}>
        {saved.label ? <><span className="font-medium">{saved.label}</span>: </> : null}{saved.message}
      </span>
      {saved.needsConfirm && <div className="w-full"><ConfirmTime sessionId={saved.sessionId} recorded={saved.minutes} dark={tone === 'room'} /></div>}
      <Link href="/progress#recent-sessions" className={tone === 'room' ? 'font-medium underline-offset-4 hover:underline' : 'font-medium text-nova-ink hover:underline'}>Recent sessions</Link>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="ml-auto opacity-70 hover:opacity-100"><X className="size-3.5" /></button>
    </section>
  )
}
