// ─── The learner's own music ──────────────────────────────────────────────────
// A link the learner pastes from Spotify, Apple Music or YouTube, turned into
// that service's own embedded player. Nothing is fetched and nothing leaves
// the browser: the address is read with URL, and the player is the
// provider's, so playback follows the learner's sign-in with that provider
// (whole tracks when signed in, previews otherwise).
//
// Pure, so the tests can hold every shape of link.

export type MusicKind = 'spotify' | 'apple' | 'youtube'

export type MusicSource = {
  id:   string
  kind: MusicKind
  name: string
  by:   string
  // The embedded player's address.
  src:  string
  // Where the same thing opens in the provider's own app or site.
  href: string
}

export type MusicLinkResult =
  | { ok: true; source: MusicSource }
  | { ok: false; message: string }

export const MUSIC_KIND_LABEL: Record<MusicKind, string> = { spotify: 'Spotify', apple: 'Apple Music', youtube: 'YouTube' }

const SPOTIFY_TYPES = ['playlist', 'album', 'track', 'artist', 'show', 'episode'] as const
const APPLE_TYPES = ['playlist', 'album', 'song', 'music-video'] as const
const UNSUPPORTED = 'Paste a link to a playlist, album or song from Spotify, Apple Music or YouTube.'

const isIdChar = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '_' || c === '-' || c === '.'
const isId = (s: string | null | undefined, min = 6): s is string => !!s && s.length >= min && s.length <= 80 && [...s].every(isIdChar)

// "pure-focus" → "Pure focus"
function nameFromSlug(slug: string | undefined): string | null {
  if (!slug) return null
  let text: string
  try { text = decodeURIComponent(slug) } catch { text = slug }
  text = text.split('-').filter(Boolean).join(' ').trim()
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : null
}

function spotify(url: URL | null, raw: string): MusicLinkResult | null {
  let type: string | undefined, id: string | undefined
  if (raw.startsWith('spotify:')) {
    [, type, id] = raw.split(':')
  } else if (url && url.hostname === 'open.spotify.com') {
    // open.spotify.com/intl-de/playlist/<id>, or /embed/playlist/<id>
    const parts = url.pathname.split('/').filter(p => p && !p.startsWith('intl-') && p !== 'embed')
    ;[type, id] = parts
  } else {
    return null
  }
  if (!SPOTIFY_TYPES.includes(type as typeof SPOTIFY_TYPES[number]) || !isId(id, 10)) return { ok: false, message: 'That Spotify link isn’t a playlist, album, song, artist or podcast.' }
  return { ok: true, source: {
    id: `spotify:${type}:${id}`, kind: 'spotify', name: `Spotify ${type === 'track' ? 'song' : type}`, by: 'Your Spotify',
    src: `https://open.spotify.com/embed/${type}/${id}?theme=0`, href: `https://open.spotify.com/${type}/${id}`,
  } }
}

function apple(url: URL | null): MusicLinkResult | null {
  if (!url || (url.hostname !== 'music.apple.com' && url.hostname !== 'embed.music.apple.com')) return null
  // music.apple.com/<country>/<type>/<name>/<id>[?i=<song>]
  const [country, type, slug, id] = url.pathname.split('/').filter(Boolean)
  const song = url.searchParams.get('i')
  if (!country || country.length !== 2 || !APPLE_TYPES.includes(type as typeof APPLE_TYPES[number]) || !isId(id ?? slug, 3)) {
    return { ok: false, message: 'That Apple Music link isn’t a playlist, album or song.' }
  }
  const path = id ? `${country}/${type}/${slug}/${id}` : `${country}/${type}/${slug}`
  const query = song && isId(song, 3) ? `?i=${song}` : ''
  return { ok: true, source: {
    id: `apple:${path}${query}`, kind: 'apple', name: (id ? nameFromSlug(slug) : null) ?? `Apple Music ${type}`, by: 'Your Apple Music',
    src: `https://embed.music.apple.com/${path}${query}`, href: `https://music.apple.com/${path}${query}`,
  } }
}

function youtube(url: URL | null): MusicLinkResult | null {
  if (!url) return null
  const host = url.hostname.startsWith('www.') ? url.hostname.slice(4) : url.hostname
  if (!['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'youtube-nocookie.com'].includes(host)) return null
  const parts = url.pathname.split('/').filter(Boolean)
  const list = url.searchParams.get('list')
  let video: string | null = null
  if (host === 'youtu.be') video = parts[0] ?? null
  else if (parts[0] === 'watch') video = url.searchParams.get('v')
  else if (['live', 'embed', 'shorts'].includes(parts[0] ?? '')) video = parts[1] ?? null

  if (isId(video, 11) && video.length === 11) {
    return { ok: true, source: {
      id: `youtube:${video}`, kind: 'youtube', name: 'YouTube video', by: 'Your YouTube',
      src: `https://www.youtube-nocookie.com/embed/${video}?autoplay=1&rel=0${isId(list, 10) ? `&list=${list}` : ''}`,
      href: `https://www.youtube.com/watch?v=${video}`,
    } }
  }
  if (isId(list, 10)) {
    return { ok: true, source: {
      id: `youtube:list:${list}`, kind: 'youtube', name: 'YouTube playlist', by: 'Your YouTube',
      src: `https://www.youtube-nocookie.com/embed/videoseries?list=${list}&autoplay=1&rel=0`,
      href: `https://www.youtube.com/playlist?list=${list}`,
    } }
  }
  return { ok: false, message: 'That YouTube link isn’t a video or playlist.' }
}

export function parseMusicLink(input: string): MusicLinkResult {
  const raw = input.trim()
  if (!raw) return { ok: false, message: UNSUPPORTED }
  let url: URL | null = null
  try {
    url = new URL(raw.includes('://') || raw.startsWith('spotify:') ? raw : `https://${raw}`)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') url = null
  } catch { url = null }
  return spotify(url, raw) ?? apple(url) ?? youtube(url) ?? { ok: false, message: UNSUPPORTED }
}

// The learner's saved list, read back from storage: anything that no longer
// reads as a link of ours is dropped, so a stored address is always one this
// file built.
export const MUSIC_MAX = 12

export function sourcesFromStorage(raw: string | null): MusicSource[] {
  if (!raw) return []
  try {
    const stored = JSON.parse(raw) as unknown
    if (!Array.isArray(stored)) return []
    const out: MusicSource[] = []
    for (const item of stored) {
      if (!item || typeof item !== 'object') continue
      const { href, name } = item as { href?: unknown; name?: unknown }
      if (typeof href !== 'string') continue
      const parsed = parseMusicLink(href)
      if (!parsed.ok || out.some(s => s.id === parsed.source.id)) continue
      const label = typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : parsed.source.name
      out.push({ ...parsed.source, name: label })
      if (out.length === MUSIC_MAX) break
    }
    return out
  } catch {
    return []
  }
}

// A YouTube player's address on either of YouTube's hosts, set up to tell
// this page when it is ready. Privacy mode (youtube-nocookie.com) is the
// default; some content blockers stop it, and then the page offers the
// ordinary host. Other providers' addresses are returned as they are.
const NOCOOKIE = 'https://www.youtube-nocookie.com/'
const YOUTUBE = 'https://www.youtube.com/'

export function youtubePlayerSrc(src: string, host: 'nocookie' | 'youtube', origin: string): string {
  if (!src.startsWith(NOCOOKIE)) return src
  const url = new URL(host === 'youtube' ? YOUTUBE + src.slice(NOCOOKIE.length) : src)
  url.searchParams.set('enablejsapi', '1')
  url.searchParams.set('origin', origin)
  return url.toString()
}

// What a YouTube player's message says, from its own origin only.
export function youtubeSignal(origin: string, data: unknown): 'ready' | 'error' | null {
  if (origin !== 'https://www.youtube-nocookie.com' && origin !== 'https://www.youtube.com') return null
  let message: unknown = data
  if (typeof data === 'string') { try { message = JSON.parse(data) } catch { return null } }
  const event = message && typeof message === 'object' ? (message as { event?: unknown }).event : null
  if (event === 'onError') return 'error'
  return event === 'onReady' || event === 'initialDelivery' || event === 'infoDelivery' ? 'ready' : null
}
