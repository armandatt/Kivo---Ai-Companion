'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, BookOpen, Check, Expand, Headphones, Image as ImageIcon, Loader2, Pause, Play, Shrink, Square, X } from 'lucide-react'
import type { NovaSessionOutcome } from '@repo/api/nova/product/today.types'
import { cn } from '@/lib/utils'
import { clock, minutesLabel } from './format'
import { StudyRequest } from './saved/study-request'
import { useNovaSession } from './use-nova-session'
import { FocusContext, hasFocusContext, useFocusContext } from './focus-context'
import { SessionNote } from './session-note'
import { RecordLine, useTopicRecord } from './topic-record'
import { FocusScene, SCENES, type SceneId } from './focus/focus-scene'
import { SoundPanel, useSoundMix } from './focus/sound-panel'

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

// How this browser likes the room: its scene and how the clock counts. A
// convenience only; without storage the defaults are used.
const PREFS = 'kivo-focus-room'
type RoomPrefs = { scene: SceneId; countDown: boolean }
const DEFAULT_PREFS: RoomPrefs = { scene: 'aurora', countDown: true }
function readPrefs(): RoomPrefs { try { const raw = localStorage.getItem(PREFS); return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) as Partial<RoomPrefs> } : DEFAULT_PREFS } catch { return DEFAULT_PREFS } }
function writePrefs(p: RoomPrefs) { try { localStorage.setItem(PREFS, JSON.stringify(p)) } catch { /* storage off */ } }

const glassButton = 'focus-glass inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium text-white/85 transition-colors hover:text-white'

// The session screen: a room to study in. A scene behind, the clock in the
// middle, sound at the left, what is on record for the topic at the right.
// Topic, planned length, the clock, pause / resume and end: each control is
// a server command on the session Nova is tracking; the room only adds a
// backdrop and sound, which are this browser's own.
export function FocusSession() {
  const { loading, session, elapsedSeconds, ended, pending, error, blocked, command, end, retry } = useNovaSession()
  const [ending, setEnding] = useState(false)
  // A page the learner asked to study, from the browser extension or Saved.
  const studyId = useSearchParams().get('study')
  // Starting from the card moves to /focus with no query: read the session again at once.
  useEffect(() => { void retry() }, [studyId, retry])
  // What the learner has filed under this session's topic. Asked for only
  // while a session is running, and again when it is a different session.
  const context = useFocusContext(null, session?.id ?? null, session !== null)
  // Where this topic stands on the record, and the way to it in the Knowledge
  // Space and on the map. Read once per session, never polled.
  const record = useTopicRecord({ subjectName: session?.subjectName ?? null, topicName: session?.topicName ?? null }, session?.id ?? null, session !== null)

  const room = useRef<HTMLDivElement>(null)
  const [prefs, setPrefsState] = useState<RoomPrefs>(DEFAULT_PREFS)
  useEffect(() => { setPrefsState(readPrefs()) }, [])
  const setPrefs = useCallback((change: Partial<RoomPrefs>) => setPrefsState(p => { const n = { ...p, ...change }; writePrefs(n); return n }), [])
  const [panel, setPanel] = useState<'sound' | 'scene' | 'topic' | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const sound = useSoundMix()

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === room.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void room.current?.requestFullscreen?.().catch(() => { /* not allowed here */ })
  }, [])

  const paused = session?.status === 'paused'

  // Space pauses and resumes, F is fullscreen, M mutes, S opens sound.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(e.target.tagName))
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === ' ' && session && !ending && pending === null) { e.preventDefault(); void command(paused ? 'resume' : 'pause') }
      else if (key === 'f') { e.preventDefault(); toggleFullscreen() }
      else if (key === 'm') { e.preventDefault(); void sound.toggleMute() }
      else if (key === 's') { e.preventDefault(); setPanel(p => p === 'sound' ? null : 'sound') }
      else if (key === 'escape') setPanel(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session, ending, pending, paused, command, toggleFullscreen, sound])

  // ── The room around every state ──
  // A function, not a component: the room keeps its scene and sound across
  // the clock's ticks instead of being built anew each second.
  const roomView = (children: React.ReactNode, topicPanel?: React.ReactNode) => (
    <div ref={room} onPointerDown={sound.resumeSaved}
      className="kivo-dark focus-room relative -m-6 h-[calc(100%+3rem)] min-h-136 overflow-hidden bg-black text-white" data-focus-room data-scene={prefs.scene}>
      <FocusScene scene={prefs.scene} />

      <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 p-4 pl-16 sm:p-5 lg:pl-5">
        <Link href="/home" className={glassButton}><ArrowLeft className="size-4" /> Home</Link>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setPanel(p => p === 'scene' ? null : 'scene')} aria-expanded={panel === 'scene'} className={glassButton} title="Scene">
            <ImageIcon className="size-4" /> <span className="hidden sm:inline">{SCENES.find(s => s.id === prefs.scene)?.name}</span>
          </button>
          <button type="button" onClick={toggleFullscreen} className={cn(glassButton, 'w-10 justify-center px-0')} title={fullscreen ? 'Leave fullscreen (F)' : 'Fullscreen (F)'}>
            {fullscreen ? <Shrink className="size-4" /> : <Expand className="size-4" />}
          </button>
        </div>
      </div>

      {panel === 'scene' && (
        <div className="focus-glass absolute right-4 top-20 z-20 w-64 rounded-2xl p-2 sm:right-5" role="dialog" aria-label="Choose a scene">
          <p className="px-2 pb-1.5 pt-1 text-[11px] uppercase tracking-[0.14em] text-white/50">Scene</p>
          <div className="grid grid-cols-2 gap-1.5">
            {SCENES.map(s => (
              <button key={s.id} type="button" onClick={() => { setPrefs({ scene: s.id }); setPanel(null) }} aria-pressed={prefs.scene === s.id}
                className={cn('overflow-hidden rounded-xl border text-left text-xs transition-colors', prefs.scene === s.id ? 'border-keppel-300/80' : 'border-white/10 hover:border-white/30')}>
                <span className="block h-14" style={{ background: s.swatch }} />
                <span className="block px-2 py-1.5 text-white/85">{s.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="relative z-5 flex h-full flex-col items-center justify-center px-4 pb-24 pt-20 text-center">
        {children}
      </div>

      <div className="absolute bottom-4 left-4 z-20 flex flex-col items-start gap-2 sm:bottom-5 sm:left-5">
        {/* Kept mounted while music plays, so closing the panel never stops it. */}
        {(panel === 'sound' || sound.music.stream) && <SoundPanel sound={sound} open={panel === 'sound'} onClose={() => setPanel(null)} />}
        <button type="button" onClick={() => setPanel(p => p === 'sound' ? null : 'sound')} aria-expanded={panel === 'sound'} className={cn(glassButton, 'max-w-[min(18rem,calc(100vw-2rem))]')} title="Sound (S)">
          {(sound.mix.on.length > 0 && !sound.mix.muted && sound.armed) || sound.music.stream ? <span className="focus-eq" aria-hidden><i /><i /><i /></span> : <Headphones className="size-4" />}
          <span className="truncate">{[
            sound.music.stream?.name,
            sound.mix.on.length > 0 ? `${sound.mix.on.length} sound${sound.mix.on.length === 1 ? '' : 's'}` : null,
          ].filter(Boolean).join(' + ') || 'Sound'}</span>
        </button>
      </div>

      {topicPanel && (
        <div className="absolute bottom-4 right-4 z-20 flex flex-col items-end gap-2 sm:bottom-5 sm:right-5">
          {panel === 'topic' && (
            <div className="focus-glass max-h-[60vh] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl p-4 text-left" role="dialog" aria-label="On this topic">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-[0.14em] text-white/50">On this topic</p>
                <button type="button" onClick={() => setPanel(null)} className="inline-flex size-7 items-center justify-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white" title="Close"><X className="size-4" /></button>
              </div>
              {topicPanel}
            </div>
          )}
          <button type="button" onClick={() => setPanel(p => p === 'topic' ? null : 'topic')} aria-expanded={panel === 'topic'} className={glassButton}>
            <BookOpen className="size-4" /> On this topic
          </button>
        </div>
      )}
    </div>
  )

  const primary = 'inline-flex h-14 min-w-44 items-center justify-center gap-2 rounded-full bg-white px-9 text-lg font-semibold text-[#0b0d12] shadow-[0_10px_40px_-10px_rgba(255,255,255,0.45)] transition-transform hover:scale-[1.03] active:scale-[0.98] disabled:opacity-70'
  const quiet = 'focus-glass inline-flex h-14 items-center justify-center gap-2 rounded-full px-7 text-base font-medium text-white/85 transition-colors hover:text-white'

  if (blocked) {
    return (
      roomView(<>
        <h1 className="text-3xl font-semibold tracking-tight">Nova isn&apos;t set up yet</h1>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/65">{blocked}</p>
        <Link href="/home" className={cn(primary, 'mt-8 h-12 text-base')}>Back to Home</Link>
      </>)
    )
  }

  if (ended && !session) {
    return (
      roomView(<>
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-keppel-400/20 text-keppel-200 ring-1 ring-keppel-300/30">
          <Check className="size-6" />
        </div>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">Session logged</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-white/70">
          {minutesLabel(ended.minutes)}{ended.topicName ? ` on ${ended.topicName}` : ''}
          {ended.outcome ? <>. You said {OUTCOME_SAID[ended.outcome]}.</> : '.'}
          {' '}
          {ended.counted === false
            ? 'That was under ten minutes, so Nova kept it as a session but changed nothing in Knowledge or Progress.'
            : ended.topicRecorded
            ? 'Nova has updated this topic and when to revisit it.'
            : "Nova logged the session, but couldn't tie this topic to one of your subjects, so it isn't in Knowledge yet."}
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/home" className={cn(primary, 'h-12 text-base')}>See what&apos;s next</Link>
          <Link href="/knowledge" className={cn(quiet, 'h-12 text-sm')}>Open Knowledge</Link>
        </div>
        <div className="mt-6 w-full max-w-md text-left"><SessionNote sessionId={ended.sessionId} /></div>
      </>)
    )
  }

  if (loading) {
    return (
      roomView(<>
        <div className="flex flex-col items-center gap-6" aria-busy="true" aria-label="Loading session">
          <div className="h-6 w-48 animate-pulse rounded-lg bg-white/10" />
          <div className="h-28 w-80 max-w-full animate-pulse rounded-3xl bg-white/8" />
        </div>
      </>)
    )
  }

  if (!session) {
    if (error) {
      return (
        roomView(<>
          <h1 className="text-3xl font-semibold tracking-tight">Couldn&apos;t load your session</h1>
          <p className="mt-3 text-sm text-white/65">{error}</p>
          <button type="button" onClick={() => void retry()} className={cn(primary, 'mt-8 h-12 text-base')}>Try again</button>
        </>)
      )
    }
    if (studyId) return roomView(<><div className="focus-glass w-full max-w-xl rounded-3xl p-6 text-left"><StudyRequest id={studyId} /></div></>)
    return (
      roomView(<>
        <p className="text-sm uppercase tracking-[0.2em] text-white/55">Focus</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">No session running</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-white/65">Start one from Home. Nova will have picked what matters most right now. Pick a scene and a sound meanwhile.</p>
        <Link href="/home" className={cn(primary, 'mt-8 h-12 text-base')}>Back to Home</Link>
      </>)
    )
  }

  const planned  = session.plannedDurationMinutes * 60
  const over     = planned > 0 && elapsedSeconds > planned
  const countDown = prefs.countDown && planned > 0 && !over
  const shown    = countDown ? Math.max(0, planned - elapsedSeconds) : elapsedSeconds
  const progress = planned > 0 ? Math.min(1, elapsedSeconds / planned) : 0
  const started  = new Date(session.startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

  const topicPanel = (record || hasFocusContext(context) || session.confusionPoints.length > 0) ? (
    <div className="space-y-4 text-sm text-white/80">
      {record && <RecordLine record={record} />}
      {hasFocusContext(context) && <FocusContext view={context} />}
      {session.confusionPoints.length > 0 && <p className="text-white/65">Flagged as confusing this session: {session.confusionPoints.join(', ')}</p>}
      <p className="text-xs leading-relaxed text-white/45">Nova sees this session on Telegram too. Stuck on something? Ask it there and it will pick up from here.</p>
    </div>
  ) : undefined

  return (
    roomView(<>
      {studyId && (
        <p role="status" className="focus-glass mb-6 max-w-md rounded-xl px-4 py-3 text-xs leading-relaxed text-white/75" data-study-waiting>
          You already have a session running. Finish this one first; the page you picked is in <Link href="/saved" className="text-keppel-200 underline">Saved</Link>.
        </p>
      )}

      <p className="text-sm font-medium uppercase tracking-[0.22em] text-white/60">{session.subjectName ?? 'Focus'}</p>
      <h1 className="mt-2 max-w-3xl text-balance text-2xl font-semibold leading-tight tracking-tight text-white/95 sm:text-3xl">
        {session.topicName ?? 'Study session'}
      </h1>

      <button type="button" onClick={() => setPrefs({ countDown: !prefs.countDown })} disabled={planned === 0}
        className="group mt-6 rounded-3xl px-4 outline-none focus-visible:ring-2 focus-visible:ring-white/50" title={planned === 0 ? undefined : countDown ? 'Show time studied' : 'Show time left'}>
        <span role="timer" aria-label={countDown ? 'Time left' : 'Time studied'}
          className={cn('block font-semibold leading-none tracking-[-0.04em] tabular-nums transition-opacity text-[clamp(5.5rem,17vw,11.5rem)] [text-shadow:0_8px_60px_rgba(0,0,0,0.45)]', paused && 'opacity-55')}>
          {clock(shown)}
        </span>
      </button>

      {planned > 0 && (
        <div className="mt-5 h-1 w-[min(22rem,70vw)] overflow-hidden rounded-full bg-white/15" aria-hidden>
          <div className={cn('h-full rounded-full transition-[width] duration-1000 ease-linear', paused ? 'bg-amber-300/80' : 'bg-keppel-300')} style={{ width: `${progress * 100}%` }} />
        </div>
      )}
      <p className="mt-3 text-sm text-white/65">
        {paused ? 'Paused'
          : planned === 0 ? 'Open session, no planned length'
          : over ? `${clock(elapsedSeconds - planned)} past your ${minutesLabel(session.plannedDurationMinutes)}`
          : countDown ? `left of ${minutesLabel(session.plannedDurationMinutes)}`
          : `studied of ${minutesLabel(session.plannedDurationMinutes)}`}
      </p>

      {ending ? (
        // One tap ends the session and tells Nova how it went.
        <div className="mt-10 w-full max-w-xl" role="group" aria-labelledby="how-did-it-go">
          <p id="how-did-it-go" className="text-lg font-medium">How did it go?</p>
          <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {OUTCOMES.map(o => (
              <button key={o.value} type="button" data-outcome={o.value} onClick={() => void end(o.value)} disabled={pending !== null}
                className="focus-glass inline-flex h-12 items-center justify-center rounded-2xl px-3 text-[15px] font-medium text-white transition-colors hover:bg-white/20 disabled:opacity-60">
                {o.label}
              </button>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-center gap-3 text-sm">
            {pending === 'end'
              ? <span className="inline-flex items-center gap-2 text-white/65"><Loader2 className="size-4 animate-spin" /> Logging your session…</span>
              : <button type="button" onClick={() => setEnding(false)} className="text-white/65 transition-colors hover:text-white">Keep going</button>}
          </div>
        </div>
      ) : (
        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <button type="button" onClick={() => void command(paused ? 'resume' : 'pause')} disabled={pending !== null} className={primary} title={paused ? 'Resume (Space)' : 'Pause (Space)'}>
            {pending === 'pause' || pending === 'resume'
              ? <Loader2 className="size-5 animate-spin" />
              : paused ? <><Play className="size-5" /> Resume</> : <><Pause className="size-5" /> Pause</>}
          </button>
          <button type="button" onClick={() => setEnding(true)} className={quiet}>
            <Square className="size-4" /> End session
          </button>
        </div>
      )}

      {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}

      <dl className="mt-10 flex flex-wrap items-center justify-center gap-2 text-xs">
        {[['Started', started], ['Planned', session.plannedDurationMinutes > 0 ? minutesLabel(session.plannedDurationMinutes) : 'Open'], ['Breaks', String(session.pauseCount)]].map(([label, value]) => (
          <div key={label} className="focus-glass flex items-center gap-1.5 rounded-full px-3 py-1.5">
            <dt className="text-white/50">{label}</dt><dd className="font-medium text-white/85">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 hidden text-[11px] text-white/40 sm:block">Space pause · F fullscreen · S sound · M mute</p>
    </>, topicPanel)
  )
}
