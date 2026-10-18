'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Headphones, ListMusic, Volume2, VolumeX, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SOUNDS, SoundEngine, type SoundId } from '@/lib/focus/soundscapes'

// What the learner listens to while they focus: soundscapes made in the
// browser, mixed at their own volumes, or a lo-fi stream from YouTube or
// Spotify in its own player. The mix is remembered in this browser only.

const STORE = 'kivo-focus-sound'
type Mix = { on: SoundId[]; volume: Partial<Record<SoundId, number>>; master: number; muted: boolean }
const DEFAULT_MIX: Mix = { on: [], volume: {}, master: 0.8, muted: false }
function readMix(): Mix { try { const raw = localStorage.getItem(STORE); return raw ? { ...DEFAULT_MIX, ...JSON.parse(raw) as Partial<Mix> } : DEFAULT_MIX } catch { return DEFAULT_MIX } }
function writeMix(m: Mix) { try { localStorage.setItem(STORE, JSON.stringify(m)) } catch { /* storage off */ } }

// Streams that play inside their own provider's player. Spotify plays full
// tracks only for someone signed in to Spotify in this browser.
const PLAYLISTS: Array<{ id: string; name: string; by: string; src: string; kind: 'youtube' | 'spotify' }> = [
  { id: 'lofi-girl',   name: 'lofi hip hop radio', by: 'Lofi Girl · YouTube live', kind: 'youtube', src: 'https://www.youtube-nocookie.com/embed/jfKfPfyJRdk?autoplay=1&rel=0' },
  { id: 'synthwave',   name: 'synthwave radio',    by: 'Lofi Girl · YouTube live', kind: 'youtube', src: 'https://www.youtube-nocookie.com/embed/4xDzrJKXOOY?autoplay=1&rel=0' },
  { id: 'deep-focus',  name: 'Deep Focus',         by: 'Spotify',                  kind: 'spotify', src: 'https://open.spotify.com/embed/playlist/37i9dQZF1DWZeKCadgRdKQ?theme=0' },
  { id: 'lofi-beats',  name: 'lofi beats',         by: 'Spotify',                  kind: 'spotify', src: 'https://open.spotify.com/embed/playlist/37i9dQZF1DWWQRwui0ExPn?theme=0' },
  { id: 'piano',       name: 'Peaceful Piano',     by: 'Spotify',                  kind: 'spotify', src: 'https://open.spotify.com/embed/playlist/37i9dQZF1DX4sWSpwq3LiO?theme=0' },
]

export function useSoundMix() {
  const engine = useRef<SoundEngine | null>(null)
  const [mix, setMix] = useState<Mix>(DEFAULT_MIX)
  // Sound can start only after a click: until then the saved mix waits.
  const [armed, setArmed] = useState(false)

  useEffect(() => { setMix(readMix()) }, [])
  useEffect(() => () => engine.current?.dispose(), [])

  const ensure = useCallback(async () => {
    if (!engine.current) engine.current = new SoundEngine()
    await engine.current.resume()
    setArmed(true)
    return engine.current
  }, [])

  // Keep the engine in step with the mix.
  useEffect(() => {
    const e = engine.current
    if (!e || !armed) return
    e.setMaster(mix.muted ? 0 : mix.master)
    for (const id of SOUNDS.map(s => s.id)) {
      if (mix.on.includes(id)) e.start(id, mix.volume[id] ?? 0.6)
      else if (e.playing.includes(id)) e.stop(id)
    }
  }, [mix, armed])

  const update = useCallback((change: (m: Mix) => Mix) => setMix(m => { const n = change(m); writeMix(n); return n }), [])
  // The choice shows at once; the sound joins as soon as the browser lets audio start.
  const toggle = useCallback(async (id: SoundId) => { update(m => ({ ...m, on: m.on.includes(id) ? m.on.filter(x => x !== id) : [...m.on, id] })); await ensure() }, [ensure, update])
  const setVolume = useCallback((id: SoundId, v: number) => update(m => ({ ...m, volume: { ...m.volume, [id]: v } })), [update])
  const setMaster = useCallback((v: number) => update(m => ({ ...m, master: v, muted: false })), [update])
  const toggleMute = useCallback(async () => { update(m => ({ ...m, muted: !m.muted })); await ensure() }, [ensure, update])
  // A saved mix starts on the first click anywhere on the page.
  const resumeSaved = useCallback(() => { if (!armed && mix.on.length > 0) void ensure() }, [armed, mix.on.length, ensure])

  return { mix, armed, toggle, setVolume, setMaster, toggleMute, resumeSaved, stopAll: () => update(m => ({ ...m, on: [] })) }
}

export function SoundPanel({ sound, onClose }: { sound: ReturnType<typeof useSoundMix>; onClose: () => void }) {
  const [tab, setTab] = useState<'sounds' | 'playlists'>('sounds')
  const [playing, setPlaying] = useState<string | null>(null)
  const { mix } = sound
  const current = PLAYLISTS.find(p => p.id === playing)

  return (
    <section aria-label="Sound" className="focus-glass w-[min(22rem,calc(100vw-2rem))] rounded-2xl p-3 text-white" data-focus-sound>
      <div className="flex items-center gap-1">
        <div role="tablist" aria-label="Sound source" className="flex rounded-lg bg-white/6 p-0.5 text-xs">
          {([['sounds', 'Soundscapes', Headphones], ['playlists', 'Playlists', ListMusic]] as const).map(([id, label, Icon]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={cn('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium transition-colors', tab === id ? 'bg-white/14 text-white' : 'text-white/60 hover:text-white')}>
              <Icon className="size-3.5" /> {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => void sound.toggleMute()} className="ml-auto inline-flex size-8 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white" title={mix.muted ? 'Unmute (M)' : 'Mute (M)'} aria-pressed={mix.muted}>
          {mix.muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </button>
        <button type="button" onClick={onClose} className="inline-flex size-8 items-center justify-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white" title="Close">
          <X className="size-4" />
        </button>
      </div>

      {tab === 'sounds' ? (
        <>
          <label className="mt-3 flex items-center gap-3 px-1 text-[11px] uppercase tracking-[0.14em] text-white/50">
            Volume
            <input type="range" min={0} max={1} step={0.01} value={mix.muted ? 0 : mix.master} onChange={e => sound.setMaster(Number(e.target.value))} className="focus-range flex-1" aria-label="Master volume" />
          </label>
          <ul className="mt-2 grid grid-cols-1 gap-1">
            {SOUNDS.map(s => {
              const on = mix.on.includes(s.id)
              return (
                <li key={s.id} className={cn('rounded-xl px-2 py-1.5 transition-colors', on ? 'bg-white/10' : 'hover:bg-white/5')}>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => void sound.toggle(s.id)} aria-pressed={on}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left" data-sound={s.id}>
                      <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg text-xs transition-colors', on ? 'bg-keppel-400 text-keppel-950' : 'bg-white/8 text-white/60')}>
                        {on ? <span className="focus-eq" aria-hidden><i /><i /><i /></span> : <Headphones className="size-3.5" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium leading-tight">{s.name}</span>
                        <span className="block truncate text-[11px] text-white/45">{s.hint}</span>
                      </span>
                    </button>
                    {on && (
                      <input type="range" min={0} max={1} step={0.01} value={mix.volume[s.id] ?? 0.6} onChange={e => sound.setVolume(s.id, Number(e.target.value))}
                        className="focus-range w-24" aria-label={`${s.name} volume`} />
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          {mix.on.length > 0 && !sound.armed && (
            <p className="mt-2 px-1 text-[11px] text-white/50">Your last mix starts when you click anywhere.</p>
          )}
        </>
      ) : (
        <>
          <ul className="mt-3 grid grid-cols-1 gap-1">
            {PLAYLISTS.map(p => (
              <li key={p.id}>
                <button type="button" onClick={() => setPlaying(id => id === p.id ? null : p.id)} aria-pressed={playing === p.id}
                  className={cn('flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors', playing === p.id ? 'bg-white/10' : 'hover:bg-white/5')}>
                  <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg', playing === p.id ? 'bg-keppel-400 text-keppel-950' : 'bg-white/8 text-white/60')}>
                    {playing === p.id ? <span className="focus-eq" aria-hidden><i /><i /><i /></span> : <ListMusic className="size-3.5" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium leading-tight">{p.name}</span>
                    <span className="block truncate text-[11px] text-white/45">{p.by}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {current && (
            <div className="mt-2 overflow-hidden rounded-xl bg-black/40">
              <iframe key={current.id} src={current.src} title={current.name} className={cn('w-full', current.kind === 'youtube' ? 'aspect-video' : 'h-[152px]')}
                allow="autoplay; encrypted-media; picture-in-picture" loading="lazy" referrerPolicy="strict-origin-when-cross-origin" />
            </div>
          )}
          <p className="mt-2 px-1 text-[11px] leading-relaxed text-white/45">Streams play in YouTube&apos;s or Spotify&apos;s own player. Spotify plays whole tracks when you&apos;re signed in to it in this browser.</p>
        </>
      )}
    </section>
  )
}
