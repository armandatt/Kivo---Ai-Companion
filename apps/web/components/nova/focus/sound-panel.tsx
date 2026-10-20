'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, Headphones, ListMusic, Plus, Trash2, Volume2, VolumeX, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SOUNDS, SoundEngine, type SoundId } from '@/lib/focus/soundscapes'
import { MUSIC_KIND_LABEL, MUSIC_MAX, parseMusicLink, sourcesFromStorage, type MusicSource } from '@/lib/focus/music-links'

// What the learner listens to while they focus: soundscapes made in the
// browser, mixed at their own volumes, and a stream or their own playlist
// from YouTube, Spotify or Apple Music in that provider's player. The mix
// and their own links are remembered in this browser only.
//
// The player belongs to the hook, not to the panel: the room keeps the panel
// mounted (hidden) while something plays, so closing it never stops the music.

const STORE = 'kivo-focus-sound'
type Mix = { on: SoundId[]; volume: Partial<Record<SoundId, number>>; master: number; muted: boolean }
const DEFAULT_MIX: Mix = { on: [], volume: {}, master: 0.8, muted: false }
function readMix(): Mix { try { const raw = localStorage.getItem(STORE); return raw ? { ...DEFAULT_MIX, ...JSON.parse(raw) as Partial<Mix> } : DEFAULT_MIX } catch { return DEFAULT_MIX } }
function writeMix(m: Mix) { try { localStorage.setItem(STORE, JSON.stringify(m)) } catch { /* storage off */ } }

// Streams that play inside their own provider's player. Lofi Girl restarts
// its streams now and then under a new address; `href` is where to find the
// one that is live. Found on 21 October: the old lofi hip hop radio address
// (jfKfPfyJRdk) had ended and the player said "Video unavailable".
const PLAYLISTS: MusicSource[] = [
  { id: 'lofi-girl',  name: 'lofi hip hop radio', by: 'Lofi Girl · YouTube live', kind: 'youtube', src: 'https://www.youtube-nocookie.com/embed/rFZHOHl-L8A?autoplay=1&rel=0', href: 'https://www.youtube.com/@LofiGirl/streams' },
  { id: 'synthwave',  name: 'synthwave radio',    by: 'Lofi Girl · YouTube live', kind: 'youtube', src: 'https://www.youtube-nocookie.com/embed/4xDzrJKXOOY?autoplay=1&rel=0', href: 'https://www.youtube.com/@LofiGirl/streams' },
  { id: 'deep-focus', name: 'Deep Focus',         by: 'Spotify',                  kind: 'spotify', src: 'https://open.spotify.com/embed/playlist/37i9dQZF1DWZeKCadgRdKQ?theme=0', href: 'https://open.spotify.com/playlist/37i9dQZF1DWZeKCadgRdKQ' },
  { id: 'lofi-beats', name: 'lofi beats',         by: 'Spotify',                  kind: 'spotify', src: 'https://open.spotify.com/embed/playlist/37i9dQZF1DWWQRwui0ExPn?theme=0', href: 'https://open.spotify.com/playlist/37i9dQZF1DWWQRwui0ExPn' },
  { id: 'piano',      name: 'Peaceful Piano',     by: 'Spotify',                  kind: 'spotify', src: 'https://open.spotify.com/embed/playlist/37i9dQZF1DX4sWSpwq3LiO?theme=0', href: 'https://open.spotify.com/playlist/37i9dQZF1DX4sWSpwq3LiO' },
]

const MUSIC_STORE = 'kivo-focus-music'
function readMusic(): MusicSource[] { try { return sourcesFromStorage(localStorage.getItem(MUSIC_STORE)) } catch { return [] } }
function writeMusic(list: MusicSource[]) { try { localStorage.setItem(MUSIC_STORE, JSON.stringify(list.map(({ href, name }) => ({ href, name })))) } catch { /* storage off */ } }

export function useSoundMix() {
  const engine = useRef<SoundEngine | null>(null)
  const [mix, setMix] = useState<Mix>(DEFAULT_MIX)
  // Sound can start only after a click: until then the saved mix waits.
  const [armed, setArmed] = useState(false)

  // What plays in a provider's player, if anything. Not remembered across
  // visits: a browser will not start it without a click anyway.
  const [playing, setPlaying] = useState<string | null>(null)
  const [mine, setMine] = useState<MusicSource[]>([])

  useEffect(() => { setMix(readMix()); setMine(readMusic()) }, [])
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

  const updateMine = useCallback((change: (list: MusicSource[]) => MusicSource[]) => setMine(list => { const n = change(list); writeMusic(n); return n }), [])
  const addMine = useCallback((source: MusicSource) => updateMine(list => [source, ...list.filter(s => s.id !== source.id)].slice(0, MUSIC_MAX)), [updateMine])
  const removeMine = useCallback((id: string) => { updateMine(list => list.filter(s => s.id !== id)); setPlaying(p => (p === id ? null : p)) }, [updateMine])
  const stream = [...mine, ...PLAYLISTS].find(p => p.id === playing) ?? null

  return {
    mix, armed, toggle, setVolume, setMaster, toggleMute, resumeSaved, stopAll: () => update(m => ({ ...m, on: [] })),
    music: { playing, stream, play: setPlaying, mine, addMine, removeMine },
  }
}

// `open` false keeps the panel, and the player in it, mounted but out of
// sight: an embedded player stops for good when it is removed.
export function SoundPanel({ sound, open, onClose }: { sound: ReturnType<typeof useSoundMix>; open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<'sounds' | 'playlists'>(() => (sound.music.playing ? 'playlists' : 'sounds'))
  const { mix, music } = sound
  const current = music.stream

  return (
    <section aria-label="Sound" aria-hidden={!open} inert={!open}
      className={cn('focus-glass max-h-[calc(100dvh-8rem)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl p-3 text-white',
        !open && 'pointer-events-none fixed -left-[200vw] top-0 opacity-0')} data-focus-sound>
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
      ) : null}
      {/* The playlists stay rendered on the sounds tab too, hidden, so the
          player keeps playing while the learner mixes soundscapes. */}
      <div hidden={tab !== 'playlists'}>
        <AddMusic onAdd={source => { music.addMine(source); music.play(source.id) }} />
        {music.mine.length > 0 && (
          <>
            <p className="mt-3 px-1 text-[11px] uppercase tracking-[0.14em] text-white/50">Your music</p>
            <ul className="mt-1 grid grid-cols-1 gap-1">
              {music.mine.map(p => (
                <PlaylistRow key={p.id} source={p} on={music.playing === p.id} onToggle={() => music.play(music.playing === p.id ? null : p.id)}
                  onRemove={() => music.removeMine(p.id)} />
              ))}
            </ul>
          </>
        )}
        <p className="mt-3 px-1 text-[11px] uppercase tracking-[0.14em] text-white/50">Streams</p>
        <ul className="mt-1 grid grid-cols-1 gap-1">
          {PLAYLISTS.map(p => (
            <PlaylistRow key={p.id} source={p} on={music.playing === p.id} onToggle={() => music.play(music.playing === p.id ? null : p.id)} />
          ))}
        </ul>
        {current && (
          <div className="mt-2 overflow-hidden rounded-xl bg-black/40">
            <iframe key={current.id} src={current.src} title={current.name}
              className={cn('w-full', current.kind === 'youtube' ? 'aspect-video' : current.kind === 'apple' ? 'h-[175px]' : 'h-[152px]')}
              allow={current.kind === 'apple' ? 'autoplay *; encrypted-media *; clipboard-write' : 'autoplay; encrypted-media; picture-in-picture'}
              sandbox={current.kind === 'apple' ? 'allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation' : undefined}
              referrerPolicy="strict-origin-when-cross-origin" />
            <a href={current.href} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-white/55 hover:text-white">
              <ExternalLink className="size-3" /> {current.id === 'lofi-girl' || current.id === 'synthwave' ? 'Not playing? Find the live stream on YouTube' : `Open in ${MUSIC_KIND_LABEL[current.kind]}`}
            </a>
          </div>
        )}
        <p className="mt-2 px-1 text-[11px] leading-relaxed text-white/45">Music plays in Spotify&apos;s, Apple Music&apos;s or YouTube&apos;s own player and keeps playing when you close this panel. Spotify and Apple Music play whole songs when you&apos;re signed in to them in this browser, otherwise short previews.</p>
      </div>
    </section>
  )
}

function PlaylistRow({ source, on, onToggle, onRemove }: { source: MusicSource; on: boolean; onToggle: () => void; onRemove?: () => void }) {
  return (
    <li className={cn('flex items-center gap-1 rounded-xl transition-colors', on ? 'bg-white/10' : 'hover:bg-white/5')}>
      <button type="button" onClick={onToggle} aria-pressed={on} className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left">
        <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg', on ? 'bg-keppel-400 text-keppel-950' : 'bg-white/8 text-white/60')}>
          {on ? <span className="focus-eq" aria-hidden><i /><i /><i /></span> : <ListMusic className="size-3.5" />}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium leading-tight">{source.name}</span>
          <span className="block truncate text-[11px] text-white/45">{source.by}</span>
        </span>
      </button>
      {onRemove && (
        <button type="button" onClick={onRemove} className="mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-white/45 hover:bg-white/10 hover:text-white" title={`Remove ${source.name}`}>
          <Trash2 className="size-3.5" />
        </button>
      )}
    </li>
  )
}

// Paste a Spotify, Apple Music or YouTube link; it is checked here and kept
// in this browser.
function AddMusic({ onAdd }: { onAdd: (source: MusicSource) => void }) {
  const [link, setLink] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = parseMusicLink(link)
    if (!parsed.ok) { setError(parsed.message); return }
    onAdd({ ...parsed.source, name: name.trim().slice(0, 60) || parsed.source.name })
    setLink(''); setName(''); setError(null)
  }
  const field = 'w-full rounded-lg border border-white/10 bg-white/6 px-2.5 py-1.5 text-sm text-white placeholder:text-white/40 focus:border-keppel-300/70 focus:outline-none'
  return (
    <form onSubmit={submit} className="mt-3 rounded-xl bg-white/5 p-2" aria-label="Add your own music">
      <p className="px-0.5 pb-1.5 text-xs font-medium text-white/80">Play your own playlist</p>
      <input value={link} onChange={e => { setLink(e.target.value); setError(null) }} className={field} inputMode="url" autoComplete="off" spellCheck={false}
        placeholder="Paste a Spotify, Apple Music or YouTube link" aria-label="Playlist link" aria-invalid={error !== null} />
      <div className="mt-1.5 flex gap-1.5">
        <input value={name} onChange={e => setName(e.target.value)} className={field} maxLength={60} placeholder="Name (optional)" aria-label="Name" />
        <button type="submit" disabled={!link.trim()} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-keppel-400 px-2.5 text-xs font-semibold text-keppel-950 hover:bg-keppel-300 disabled:opacity-40">
          <Plus className="size-3.5" /> Add
        </button>
      </div>
      {error && <p role="alert" className="mt-1.5 px-0.5 text-[11px] text-rose-200">{error}</p>}
    </form>
  )
}
