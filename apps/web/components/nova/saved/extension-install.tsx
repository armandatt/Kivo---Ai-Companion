'use client'

// The Browser Extension page's frame: a compact header with the connection
// (one control that is also where browsers are managed), a short start for
// anyone not set up yet (three steps and the "See how it works" video), other
// ways to save, and help. Saved pages, the page's main content, sit between
// them (saved-library.tsx).
//
// What the page can know, and so what it says:
//   - Whether a browser is connected: yes, from the server's list of this
//     account's connections (useExtensionConnection). Nothing else is used.
//   - Whether the extension is installed: no. It has no content script and
//     does not talk to web pages, so the page never claims it is, and the
//     store button is always there while nothing is connected.
//   - This browser: only to word a note beside the store button, and only
//     while nothing is connected (a connected account never sees "needs
//     Chrome" beside "Connected").
// Everything described is what the extension in apps/extension does, in its
// own words. It is listed in the store as "Nova".

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Bookmark, Check, ChevronDown, ChevronRight, CircleHelp, Laptop, Link2, Loader2, Play, Plus, ShieldCheck, Unplug, X } from 'lucide-react'
import type { ExtensionConnectionView } from '@repo/api/nova/product/learning-events.types'
import { StoreButton } from '@/components/extension/store-button'
import { currentBrowserSupport, type BrowserSupport } from '@/lib/browser-support'
import { CHROME_STORE_URL, STORE_LISTING_NAME } from '@/lib/extension-store'
import { recordFunnel } from '@/lib/extension-funnel'
import { relativeDay } from '../format'
import { PairingCode, type ExtensionConnection } from './extension-panel'
import { BookmarkletPanel } from './bookmarklet-panel'
import { cn } from '@/lib/utils'

const BTN = 'inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60'
export const PRIMARY = `${BTN} bg-action font-semibold text-action-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.16)] hover:bg-action-hover`
export const SECONDARY = `${BTN} border border-white/12 text-foreground/85 hover:border-white/25 hover:bg-white/5 hover:text-foreground`
const UNSET = 'inline-flex h-9 items-center justify-center rounded-lg border border-dashed border-white/15 px-3.5 text-sm text-foreground/60'

// The short introduction video: real recordings of the product, with captions.
export const INTRO_VIDEO = { src: '/extension/how-it-works.webm', poster: '/extension/how-it-works.png', captions: '/extension/how-it-works.vtt', seconds: 48 }
const INTRO_HIDDEN = 'kivo-saved-intro-hidden'

function useBrowserSupport(): BrowserSupport {
  const [support, setSupport] = useState<BrowserSupport>('unknown')
  useEffect(() => { setSupport(currentBrowserSupport()) }, [])
  return support
}

// A note beside the store button for a browser that can't, or hasn't been
// tested to, add the extension. Only while nothing is connected.
export function BrowserNote({ support }: { support: BrowserSupport }) {
  if (support === 'chrome' || support === 'unknown') return null
  const words: Record<Exclude<BrowserSupport, 'chrome' | 'unknown'>, string> = {
    mobile: 'The extension is for Chrome on a computer. On this device, paste a link or use the bookmark.',
    chromium: 'Made and tested for Google Chrome.',
    other: 'The extension needs Google Chrome. Here, paste a link or use the bookmark.',
  }
  return <p role="note" className="text-xs text-foreground/55" data-browser-note={support}>{words[support]}</p>
}

const browserName = (c: ExtensionConnectionView) => c.label?.trim() || 'Chrome browser'

// ── Header ───────────────────────────────────────────────────────────────────

export function ExtensionHeader({ connection, onShowIntro }: { connection: ExtensionConnection; onShowIntro: () => void }) {
  const support = useBrowserSupport()
  const connected = connection.state === 'connected'
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3" data-extension-intro={connected ? 'connected' : connection.state === 'checking' ? 'checking' : 'install'}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">Browser Extension</h1>
        <p className="mt-1 text-sm text-foreground/60">Save pages while you browse. Read and study them here.</p>
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {connected && <button type="button" onClick={onShowIntro} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-foreground/60 hover:bg-white/5 hover:text-foreground" data-show-intro><Play aria-hidden className="size-3.5" /> How it works</button>}
          <ConnectionMenu connection={connection} />
          {connection.state === 'none' && <StoreButton from="saved-intro" label="Add to Chrome" className={PRIMARY} unsetClassName={UNSET} />}
        </div>
        {connection.state === 'none' && <BrowserNote support={support} />}
      </div>
    </header>
  )
}

// The connection, said once, and where browsers are managed: a status that
// opens a small panel (each browser, Disconnect, Connect another).
function ConnectionMenu({ connection }: { connection: ExtensionConnection }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])

  if (connection.state === 'checking') return <span role="status" className="inline-flex h-9 w-36 animate-pulse rounded-full bg-white/5" data-connection-state="checking" aria-label="Checking the connection" />
  const list = connection.connections
  const on = connection.state === 'connected'
  return (
    <div ref={box} className="relative" id="connect">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="dialog" aria-label={on ? `Connected: ${list.map(browserName).join(', ')}. Manage browsers` : 'Not connected. Connect a browser'} data-connection-state={connection.state}
        className={cn('inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors',
          on ? 'border-keppel-400/35 bg-keppel-400/10 text-foreground hover:bg-keppel-400/15' : 'border-white/12 text-foreground/70 hover:bg-white/5')}>
        <span aria-hidden className={cn('size-2 rounded-full', on ? 'bg-keppel-400 shadow-[0_0_0_3px_rgb(63_182_168/0.18)]' : 'border border-current')} />
        {on ? <span className="max-w-[14rem] truncate">{browserName(list[0]!)}{list.length > 1 ? ` +${list.length - 1}` : ''}</span> : 'Not connected'}
        <ChevronDown aria-hidden className={cn('size-3.5 text-foreground/50 transition-transform motion-reduce:transition-none', open && 'rotate-180')} />
      </button>
      {open && (
        <div role="dialog" aria-label="Connected browsers" className="absolute right-0 top-11 z-30 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-card p-2 shadow-float motion-safe:animate-[subject-pop_160ms_ease-out]" data-section="browsers">
          {on ? (
            <ul className="divide-y divide-white/6" data-connections>
              {list.map(c => <BrowserRow key={c.id} c={c} onDisconnect={() => void connection.disconnect(c.id)} />)}
            </ul>
          ) : (
            <p className="px-2.5 py-2 text-sm text-foreground/65">No browser is connected yet. Add the extension to Chrome, then connect it with a code.</p>
          )}
          <div className="mt-1 border-t border-white/6 p-2">
            {connection.code
              ? <PairingCode code={connection.code} onCancel={connection.cancelCode} />
              : <button type="button" onClick={() => void connection.getCode()} disabled={connection.busy} className={cn(SECONDARY, 'w-full')} data-get-code>
                  {connection.busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Plus aria-hidden className="size-4" />} {on ? 'Connect another browser' : 'Get a code to connect'}
                </button>}
            {connection.error && <p role="alert" className="mt-2 text-xs text-amber-300/90">{connection.error}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

function BrowserRow({ c, onDisconnect }: { c: ExtensionConnectionView; onDisconnect: () => void }) {
  const [sure, setSure] = useState(false)
  return (
    <li data-connection={c.id} className="flex items-center gap-3 px-2.5 py-2.5 text-sm">
      <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-foreground/60"><Laptop className="size-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground/90">{browserName(c)}</span>
        <span className="block text-xs text-foreground/50">{c.lastUsedAt ? `Used ${relativeDay(c.lastUsedAt).toLowerCase()}` : `Connected ${relativeDay(c.connectedAt).toLowerCase()}`}</span>
      </span>
      {sure ? (
        <span className="flex items-center gap-1">
          <button type="button" onClick={onDisconnect} className="inline-flex h-8 items-center gap-1 rounded-lg bg-rose-500/90 px-2.5 text-xs font-semibold text-white hover:bg-rose-500" data-disconnect-confirm><Unplug aria-hidden className="size-3.5" /> Disconnect</button>
          <button type="button" onClick={() => setSure(false)} className="h-8 rounded-lg px-2 text-xs text-foreground/60 hover:text-foreground">Keep</button>
        </span>
      ) : (
        <button type="button" onClick={() => setSure(true)} aria-label={`Disconnect ${browserName(c)}`} className="rounded-lg px-2 py-1.5 text-xs text-foreground/55 hover:bg-white/5 hover:text-foreground" data-disconnect>Disconnect</button>
      )}
    </li>
  )
}

// ── Getting started: until a browser is connected or a page is saved ───────

export function useIntroVisibility(connected: boolean, hasPages: boolean, checking: boolean) {
  const [hidden, setHidden] = useState(true)
  const [forced, setForced] = useState(false)
  useEffect(() => { try { setHidden(localStorage.getItem(INTRO_HIDDEN) === '1') } catch { setHidden(false) } }, [])
  return {
    // Not connected: always. Connected with nothing saved yet: until hidden.
    // Set up and saving: only when asked for (How it works, Help).
    shown: forced || (!checking && (!connected || (!hasPages && !hidden))),
    // Once set up, the start can be put away; it stays a click away.
    dismissible: connected,
    dismiss: () => { setForced(false); setHidden(true); try { localStorage.setItem(INTRO_HIDDEN, '1') } catch { /* storage off */ } },
    show: () => { setForced(true); window.setTimeout(() => document.getElementById('get-started')?.scrollIntoView({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }), 0) },
  }
}

function Step({ n, done, title, children }: { n: number; done?: boolean; title: string; children: ReactNode }) {
  return (
    <li className="relative flex gap-3" data-step={n} data-step-done={done || undefined}>
      <span aria-hidden className={cn('mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold',
        done ? 'bg-keppel-400 text-keppel-950' : 'bg-white/[0.08] text-foreground/70')}>{done ? <Check className="size-3.5" /> : n}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <div className="mt-1 space-y-2 text-[13px] text-foreground/60">{children}</div>
      </div>
    </li>
  )
}

export function GetStarted({ connection, hasPages, dismissible, onDismiss }: { connection: ExtensionConnection; hasPages: boolean; dismissible: boolean; onDismiss: () => void }) {
  const connected = connection.state === 'connected'
  return (
    <section id="get-started" aria-labelledby="start-heading" className="scroll-mt-20 grid gap-6 rounded-2xl border border-white/8 bg-card/50 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]" data-section="setup">
      <div>
        <div className="flex items-start justify-between gap-3">
          <h2 id="start-heading" className="text-base font-semibold text-foreground">{connected ? 'You’re connected. Save your first page' : 'Get started in a minute'}</h2>
          {dismissible && <button type="button" onClick={onDismiss} aria-label="Hide getting started" className="-mr-1 -mt-1 grid size-8 place-items-center rounded-lg text-foreground/45 hover:bg-white/5 hover:text-foreground" data-hide-intro><X className="size-4" /></button>}
        </div>
        <ol className="mt-4 space-y-4">
          <Step n={1} done={connected} title="Add Kivo to Chrome">
            <p>It’s called “{STORE_LISTING_NAME}” in the Chrome Web Store. Pin it from the puzzle icon so it’s one click away.</p>
            {!connected && <StoreButton from="saved-steps" label="Open Chrome Web Store" className={cn(SECONDARY, 'h-8 text-[13px]')} unsetClassName="inline-flex h-8 items-center rounded-lg border border-dashed border-white/15 px-3 text-xs text-foreground/60" />}
          </Step>
          <Step n={2} done={connected} title="Connect it to your account">
            {connected ? <p>Done. This account’s pages are saved from {browserName(connection.connections[0]!)}.</p> : <>
              <p>Get a code here and type it into the extension.</p>
              {connection.code
                ? <PairingCode code={connection.code} onCancel={connection.cancelCode} />
                : <button type="button" onClick={() => void connection.getCode()} disabled={connection.busy} className={cn(PRIMARY, 'h-8 text-[13px]')} data-get-code>{connection.busy ? 'One moment…' : 'Get a code'}</button>}
              {connection.error && <p role="alert" className="text-xs text-amber-300/90">{connection.error}</p>}
            </>}
          </Step>
          <Step n={3} done={hasPages} title="Save as you read">
            <p>On any page, click {STORE_LISTING_NAME} in the toolbar and press <span className="font-medium text-foreground/80">Save page</span>. It shows up below, ready to study.</p>
          </Step>
        </ol>
      </div>
      <IntroVideo />
    </section>
  )
}

// ── "See how it works": a poster that opens the video ───────────────────────
// Nothing of the video loads until it is opened (preload none, the element
// itself made on open). No autoplay; captions on by default; Escape closes.

export function IntroVideo({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => { setOpen(true); recordFunnel('Extension video opened', 'saved-intro') }}
        className={cn('group relative block w-full overflow-hidden rounded-xl border border-white/10 bg-black/40 text-left', compact ? 'aspect-[1280/712] max-w-sm' : 'aspect-[1280/712]')} data-intro-video>
        {/* eslint-disable-next-line @next/next/no-img-element -- a still from the video, from this site */}
        <img src={INTRO_VIDEO.poster} alt="" loading="lazy" className="size-full object-cover opacity-85 transition-opacity group-hover:opacity-100" />
        <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" aria-hidden />
        <span className="absolute left-1/2 top-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/95 text-black shadow-lg transition-transform group-hover:scale-105 motion-reduce:group-hover:scale-100" aria-hidden><Play className="ml-0.5 size-5 fill-current" /></span>
        <span className="absolute inset-x-0 bottom-0 p-3">
          <span className="block text-sm font-semibold text-white">See how it works</span>
          <span className="block text-xs text-white/75">Connect, save a page, find it here, study it · {INTRO_VIDEO.seconds} s</span>
        </span>
      </button>
      {open && <VideoDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function VideoDialog({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('keydown', esc); opener?.focus?.() }
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="How the Browser Extension works">
      <div aria-hidden className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-4xl motion-safe:animate-[subject-pop_200ms_ease-out]">
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Close video" className="absolute -top-11 right-0 grid size-9 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"><X className="size-4" /></button>
        <video controls preload="none" playsInline poster={INTRO_VIDEO.poster} className="aspect-[1280/712] w-full rounded-xl bg-black shadow-2xl" data-intro-player>
          <source src={INTRO_VIDEO.src} type="video/webm" />
          <track kind="captions" src={INTRO_VIDEO.captions} srcLang="en" label="English" default />
          Your browser can’t play this video.
        </video>
      </div>
    </div>
  )
}

// ── Other ways to save: secondary, folded ───────────────────────────────────

export function OtherWays() {
  return (
    <details className="group rounded-2xl border border-white/8 bg-card/30" data-section="other-ways">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="grid size-8 place-items-center rounded-lg bg-white/[0.05] text-foreground/60"><Bookmark className="size-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground/90">Other ways to save</span>
          <span className="block text-xs text-foreground/50">A bookmark for Safari, Firefox and phones · or paste a link above</span>
        </span>
        <ChevronRight aria-hidden className="size-4 text-foreground/40 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
      </summary>
      <div className="border-t border-white/6 px-4 pb-4 pt-4"><BookmarkletPanel /></div>
    </details>
  )
}

// ── Help and privacy ─────────────────────────────────────────────────────────

const FAQ: Array<{ q: string; a: ReactNode }> = [
  { q: 'How do I install it?', a: CHROME_STORE_URL
    ? <>Open <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" onClick={() => recordFunnel('Extension store opened', 'saved-faq')} className="text-action-ink underline underline-offset-4">“{STORE_LISTING_NAME}” in the Chrome Web Store</a> and press Add to Chrome. It works in Google Chrome on a computer.</>
    : <>The store link will be here soon. Meanwhile, pasting a link or the bookmark saves any page.</> },
  { q: 'How do I connect it?', a: 'Press Get a code here (or “Get a code from Nova” in the extension) and type the code into the extension. A code works once, for ten minutes.' },
  { q: 'How do I save an article, a video or a passage?', a: 'Open it, click the extension and press Save page. To keep one passage, select it first and press Capture selection: it goes to Drafts, where you can turn it into a note. A YouTube video is saved as a video, with its thumbnail.' },
  { q: 'Where do saved pages go?', a: 'Here, under Saved pages. A page filed under a subject also shows on your Knowledge Map and beside its topic in Focus. Press Study on a page to start a focus session on it.' },
  { q: 'It won’t connect.', a: 'Codes last ten minutes and work once, so get a new one and type it exactly. A browser also disconnects after thirty days unused, or when you disconnect it from the status at the top of this page.' },
  { q: 'A page didn’t save.', a: 'Chrome keeps extensions out of its own pages (settings, New Tab, the Web Store). About twenty saves a minute is the limit. Pasting the link above always works.' },
]

const KEEPS = [
  'The page’s address and title, and where you filed it.',
  'What the page says about itself in its public tags: description, preview image, author, date, kind.',
  'A passage, only when you select it and choose to save it.',
  'Nova never opens the page, and never sees your other tabs or your history.',
]

export function ExtensionHelp({ onShowIntro }: { onShowIntro: () => void }) {
  return (
    <section aria-labelledby="help-heading" className="grid gap-6 border-t border-white/6 pt-6 lg:grid-cols-[minmax(0,1fr)_20rem]" data-section="extension-faq">
      <div>
        <h2 id="help-heading" className="flex items-center gap-2 text-sm font-semibold text-foreground"><CircleHelp aria-hidden className="size-4 text-foreground/50" /> Help</h2>
        <div className="mt-1 divide-y divide-white/6">
          {FAQ.map(item => (
            <details key={item.q} className="group py-3" data-faq>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm text-foreground/80 hover:text-foreground [&::-webkit-details-marker]:hidden">
                {item.q}<ChevronRight aria-hidden className="size-4 shrink-0 text-foreground/40 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
              </summary>
              <div className="mt-2 max-w-prose text-sm leading-relaxed text-foreground/60">{item.a}</div>
            </details>
          ))}
        </div>
        <button type="button" onClick={onShowIntro} className="mt-3 inline-flex items-center gap-1.5 text-sm text-action-ink hover:underline" data-help-video><Play aria-hidden className="size-3.5" /> Watch how it works ({INTRO_VIDEO.seconds} s)</button>
      </div>
      <div className="rounded-2xl bg-white/[0.02] p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><ShieldCheck aria-hidden className="size-4 text-keppel-300" /> What Nova keeps when you save</h2>
        <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-foreground/60">
          {KEEPS.map(k => <li key={k} className="flex gap-2.5"><span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-foreground/30" />{k}</li>)}
        </ul>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-foreground/45"><Link2 aria-hidden className="size-3.5" /> More in the <a href="/guide#extension" className="underline underline-offset-4 hover:text-foreground">Docs</a></p>
      </div>
    </section>
  )
}
