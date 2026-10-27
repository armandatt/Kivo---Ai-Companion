// The learner's own music links. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseMusicLink, sourcesFromStorage, youtubePlayerSrc, youtubeSignal, MUSIC_MAX } from './music-links'

const src = (link: string) => { const r = parseMusicLink(link); assert.ok(r.ok, r.ok ? '' : r.message); return r.source }
const refused = (link: string) => { const r = parseMusicLink(link); assert.equal(r.ok, false, `accepted ${link}`) }

test('a Spotify playlist, album or song becomes Spotify’s player', () => {
  const p = src('https://open.spotify.com/playlist/37i9dQZF1DWZeKCadgRdKQ?si=abc123')
  assert.equal(p.kind, 'spotify')
  assert.equal(p.src, 'https://open.spotify.com/embed/playlist/37i9dQZF1DWZeKCadgRdKQ?theme=0')
  assert.equal(p.href, 'https://open.spotify.com/playlist/37i9dQZF1DWZeKCadgRdKQ')
  assert.equal(src('open.spotify.com/intl-de/album/4aawyAB9vmqN3uQ7FjRGTy').src, 'https://open.spotify.com/embed/album/4aawyAB9vmqN3uQ7FjRGTy?theme=0')
  assert.equal(src('spotify:track:11dFghVXANMlKmJXsNCbNl').src, 'https://open.spotify.com/embed/track/11dFghVXANMlKmJXsNCbNl?theme=0')
  assert.equal(src('https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl').name, 'Spotify song')
})

test('an Apple Music playlist, album or song becomes Apple’s player', () => {
  const p = src('https://music.apple.com/in/playlist/pure-focus/pl.f54198ad42404535be13eabf3835fb22')
  assert.equal(p.kind, 'apple')
  assert.equal(p.src, 'https://embed.music.apple.com/in/playlist/pure-focus/pl.f54198ad42404535be13eabf3835fb22')
  assert.equal(p.name, 'Pure focus')
  // One song in an album keeps its ?i=.
  const song = src('https://music.apple.com/us/album/glory/1440818890?i=1440819201&ls=1')
  assert.equal(song.src, 'https://embed.music.apple.com/us/album/glory/1440818890?i=1440819201')
})

test('a YouTube video, live stream or playlist becomes YouTube’s player', () => {
  assert.equal(src('https://www.youtube.com/watch?v=rFZHOHl-L8A&t=30').src, 'https://www.youtube-nocookie.com/embed/rFZHOHl-L8A?autoplay=1&rel=0')
  assert.equal(src('https://youtu.be/rFZHOHl-L8A').id, 'youtube:rFZHOHl-L8A')
  assert.equal(src('https://www.youtube.com/live/rFZHOHl-L8A?si=x').id, 'youtube:rFZHOHl-L8A')
  assert.equal(src('https://music.youtube.com/playlist?list=PLOzDu-MXXLliO9fBNZOQTBDddoA3FzZUo').src,
    'https://www.youtube-nocookie.com/embed/videoseries?list=PLOzDu-MXXLliO9fBNZOQTBDddoA3FzZUo&autoplay=1&rel=0')
})

test('anything else is refused with a reason', () => {
  refused('')
  refused('lofi')
  refused('https://example.com/playlist/abc')
  refused('javascript:alert(1)')
  refused('https://open.spotify.com/user/someone')
  refused('https://open.spotify.com/playlist/<script>')
  refused('https://music.apple.com/in/browse')
  refused('https://www.youtube.com/@LofiGirl')
  refused('https://evil.com/?u=https://open.spotify.com/playlist/37i9dQZF1DWZeKCadgRdKQ')
})

test('the saved list keeps only links that still read, once each, with the learner’s names', () => {
  const raw = JSON.stringify([
    { href: 'https://open.spotify.com/playlist/37i9dQZF1DWZeKCadgRdKQ', name: 'My focus mix' },
    { href: 'https://open.spotify.com/playlist/37i9dQZF1DWZeKCadgRdKQ', name: 'again' },
    { href: 'https://example.com/x', name: 'bad' },
    { href: 'https://music.apple.com/in/playlist/pure-focus/pl.f54198ad42404535be13eabf3835fb22' },
    'nonsense',
  ])
  const list = sourcesFromStorage(raw)
  assert.deepEqual(list.map(s => s.name), ['My focus mix', 'Pure focus'])
  assert.deepEqual(sourcesFromStorage('{not json'), [])
  assert.deepEqual(sourcesFromStorage(null), [])
  const many = JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ href: `https://www.youtube.com/watch?v=abcdefghi${String(i).padStart(2, '0')}` })))
  assert.equal(sourcesFromStorage(many).length, MUSIC_MAX)
})

test('a YouTube player can move to the ordinary host and reports when it is ready', () => {
  const src = 'https://www.youtube-nocookie.com/embed/rFZHOHl-L8A?autoplay=1&rel=0'
  const own = 'https://www.thekio.in'
  assert.equal(youtubePlayerSrc(src, 'nocookie', own), 'https://www.youtube-nocookie.com/embed/rFZHOHl-L8A?autoplay=1&rel=0&enablejsapi=1&origin=https%3A%2F%2Fwww.thekio.in')
  assert.equal(youtubePlayerSrc(src, 'youtube', own), 'https://www.youtube.com/embed/rFZHOHl-L8A?autoplay=1&rel=0&enablejsapi=1&origin=https%3A%2F%2Fwww.thekio.in')
  const spotify = 'https://open.spotify.com/embed/playlist/37i9dQZF1DWZeKCadgRdKQ?theme=0'
  assert.equal(youtubePlayerSrc(spotify, 'youtube', own), spotify)
  assert.equal(youtubeSignal('https://www.youtube-nocookie.com', '{"event":"onReady","id":1}'), 'ready')
  assert.equal(youtubeSignal('https://www.youtube.com', JSON.stringify({ event: 'infoDelivery', info: {} })), 'ready')
  assert.equal(youtubeSignal('https://www.youtube.com', '{"event":"onError","info":150}'), 'error')
  assert.equal(youtubeSignal('https://evil.example', '{"event":"onReady"}'), null)
  assert.equal(youtubeSignal('https://www.youtube.com', 'not json'), null)
})
