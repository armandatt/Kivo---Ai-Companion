'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, Loader2, Pause, Play, Square } from 'lucide-react'
import type { NovaSessionOutcome } from '@repo/api/nova/product/today.types'
import { cn } from '@/lib/utils'
import { clock, minutesLabel } from './format'
import { useNovaSession } from './use-nova-session'

const RING = 2 * Math.PI * 54

// The four answers, in order. What each one does to the topic is decided on
// the server (SESSION_OUTCOME_CONFIDENCE); the page only sends the word.
const OUTCOMES: Array<{ value: NovaSessionOutcome; label: string }> = [
  { value: 'struggled',  label: 'Struggled' },
  { value: 'okay',       label: 'Okay' },
  { value: 'good',       label: 'Good' },
  { value: 'crushed_it', label: 'Crushed it' },
]

const OUTCOME_SAID: Record<NovaSessionOutcome, string> = {
  struggled: 'you struggled', okay: 'it went okay', good: 'it went well', crushed_it: 'you crushed it',
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-xl flex-col pb-16 pt-10 lg:pt-4">
      <Link href="/home" className="inline-flex items-center gap-1.5 self-start text-sm text-foreground/50 transition-colors hover:text-foreground">
        <ArrowLeft className="size-4" /> Home
      </Link>
      {children}
    </div>
  )
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
      <div className="mt-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-foreground/60">{body}</p>
        <Link href="/home" className="mt-8 inline-flex h-11 items-center justify-center rounded-xl bg-keppel-400 px-6 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300">
          Back to Home
        </Link>
      </div>
    </Shell>
  )
}

// The session screen. Topic, planned length, the clock, pause / resume and
// end: each control is a server command on the session Nova is tracking.
export function FocusSession() {
  const { loading, session, elapsedSeconds, ended, pending, error, blocked, command, end, retry } = useNovaSession()
  const [ending, setEnding] = useState(false)

  if (blocked) return <Notice title="Nova isn't set up yet" body={blocked} />

  if (ended && !session) {
    return (
      <Shell>
        <div className="mt-16 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-keppel-400/15 text-keppel-300">
            <Check className="size-5" />
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">Session logged</h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-foreground/60">
            {minutesLabel(ended.minutes)}{ended.topicName ? ` on ${ended.topicName}` : ''}
            {ended.outcome ? <>. You said {OUTCOME_SAID[ended.outcome]}.</> : '.'}
            {' '}
            {ended.topicRecorded
              ? 'Nova has updated this topic and when to revisit it.'
              : "Nova logged the session, but couldn't tie this topic to one of your subjects, so it isn't in Knowledge yet."}
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/home" className="inline-flex h-11 items-center justify-center rounded-xl bg-keppel-400 px-6 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300">
              See what&apos;s next
            </Link>
            <Link href="/knowledge" className="inline-flex h-11 items-center justify-center rounded-xl border border-white/12 px-6 text-sm font-medium text-foreground/80 transition-colors hover:bg-white/5">
              Open Knowledge
            </Link>
          </div>
        </div>
      </Shell>
    )
  }

  if (loading) {
    return (
      <Shell>
        <div className="mt-16 flex flex-col items-center gap-6" aria-busy="true" aria-label="Loading session">
          <div className="h-8 w-56 animate-pulse rounded-lg bg-white/5" />
          <div className="size-64 animate-pulse rounded-full bg-white/4" />
        </div>
      </Shell>
    )
  }

  if (!session) {
    if (error) {
      return (
        <Shell>
          <div className="mt-16 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Couldn&apos;t load your session</h1>
            <p className="mt-3 text-sm text-foreground/60">{error}</p>
            <button type="button" onClick={() => void retry()} className="mt-8 inline-flex h-11 items-center justify-center rounded-xl border border-white/12 px-6 text-sm font-medium text-foreground transition-colors hover:bg-white/5">
              Try again
            </button>
          </div>
        </Shell>
      )
    }
    return <Notice title="No session running" body="Start one from Home. Nova will have picked what matters most right now." />
  }

  const paused   = session.status === 'paused'
  const planned  = session.plannedDurationMinutes * 60
  const progress = planned > 0 ? Math.min(1, elapsedSeconds / planned) : 0
  const over     = planned > 0 && elapsedSeconds > planned
  const started  = new Date(session.startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

  return (
    <Shell>
      <div className="mt-10 text-center">
        {session.subjectName && <p className="text-sm text-foreground/55">{session.subjectName}</p>}
        <h1 className="mt-1 text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
          {session.topicName ?? 'Study session'}
        </h1>
      </div>

      <div className="relative mx-auto mt-10 size-64 sm:size-72">
        <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden>
          <circle cx="60" cy="60" r="54" fill="none" strokeWidth="3" className="stroke-white/6" />
          {planned > 0 && (
            <circle
              cx="60" cy="60" r="54" fill="none" strokeWidth="3" strokeLinecap="round"
              strokeDasharray={RING}
              strokeDashoffset={RING * (1 - progress)}
              className={cn('transition-[stroke-dashoffset] duration-1000 ease-linear', paused ? 'stroke-amber-300/70' : 'stroke-keppel-400')}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p role="timer" aria-label="Time studied" className={cn('font-mono text-5xl font-medium tabular-nums tracking-tight sm:text-6xl', paused ? 'text-foreground/50' : 'text-foreground')}>
            {clock(elapsedSeconds)}
          </p>
          <p className="mt-2 text-xs text-foreground/50">
            {paused ? 'Paused'
              : planned === 0 ? 'No planned length'
              : over ? `${clock(elapsedSeconds - planned)} past your ${minutesLabel(session.plannedDurationMinutes)}`
              : `of ${minutesLabel(session.plannedDurationMinutes)} planned`}
          </p>
        </div>
      </div>

      {ending ? (
        // One tap ends the session and tells Nova how it went.
        <div className="mt-10" role="group" aria-labelledby="how-did-it-go">
          <p id="how-did-it-go" className="text-center text-base font-medium text-foreground">How did it go?</p>
          <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {OUTCOMES.map(o => (
              <button
                key={o.value}
                type="button"
                data-outcome={o.value}
                onClick={() => void end(o.value)}
                disabled={pending !== null}
                className="inline-flex h-12 items-center justify-center rounded-xl border border-white/12 bg-white/4 px-3 text-[15px] font-medium text-foreground transition-colors hover:border-keppel-400/60 hover:bg-keppel-400/10 disabled:opacity-60"
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-center gap-3 text-sm">
            {pending === 'end'
              ? <span className="inline-flex items-center gap-2 text-foreground/55"><Loader2 className="size-4 animate-spin" /> Logging your session…</span>
              : <button type="button" onClick={() => setEnding(false)} className="text-foreground/55 transition-colors hover:text-foreground">Keep going</button>}
          </div>
        </div>
      ) : (
        <div className="mt-10 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => void command(paused ? 'resume' : 'pause')}
            disabled={pending !== null}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-keppel-400 px-7 text-[15px] font-semibold text-keppel-950 transition-colors hover:bg-keppel-300 disabled:opacity-70 sm:min-w-40"
          >
            {pending === 'pause' || pending === 'resume'
              ? <Loader2 className="size-4 animate-spin" />
              : paused ? <><Play className="size-4" /> Resume</> : <><Pause className="size-4" /> Pause</>}
          </button>
          <button
            type="button"
            onClick={() => setEnding(true)}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-white/12 px-7 text-[15px] font-medium text-foreground/80 transition-colors hover:bg-white/5 hover:text-foreground sm:min-w-40"
          >
            <Square className="size-3.5" /> End session
          </button>
        </div>
      )}

      {error && <p role="alert" className="mt-4 text-center text-sm text-red-300">{error}</p>}

      <dl className="mt-12 grid grid-cols-3 gap-4 border-t border-white/8 pt-6 text-center">
        <div>
          <dt className="text-[11px] uppercase tracking-[0.16em] text-foreground/40">Started</dt>
          <dd className="mt-1.5 text-sm text-foreground/85">{started}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-[0.16em] text-foreground/40">Planned</dt>
          <dd className="mt-1.5 text-sm text-foreground/85">{session.plannedDurationMinutes > 0 ? minutesLabel(session.plannedDurationMinutes) : 'Open'}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-[0.16em] text-foreground/40">Breaks</dt>
          <dd className="mt-1.5 text-sm text-foreground/85">{session.pauseCount}</dd>
        </div>
      </dl>

      {session.confusionPoints.length > 0 && (
        <p className="mt-6 text-center text-sm text-foreground/60">
          Flagged as confusing this session: {session.confusionPoints.join(', ')}
        </p>
      )}

      <p className="mt-6 text-center text-xs leading-relaxed text-foreground/40">
        Nova sees this session on Telegram too. Stuck on something? Ask it there and it will pick up from here.
      </p>
    </Shell>
  )
}
