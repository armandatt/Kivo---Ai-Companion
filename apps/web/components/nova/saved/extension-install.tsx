'use client'

// The Browser Extension page's own pieces: the header with the connection
// status and the one action that matters now, the three setup steps (shown
// until a browser is connected), the connected browsers, and help.
//
// What the page can know, and so what it says:
//   - Whether a browser is connected: yes, from the server's list of this
//     account's connections (useExtensionConnection). Nothing else is used.
//   - Whether the extension is installed: no. It has no content script and
//     does not talk to web pages, so the page never claims it is, and the
//     install button is always there.
//   - The browser: only to word a note beside the button (browser-support.ts).
// Everything described is what the extension in apps/extension does, in its
// own words ("Get a code from Nova", "Save to Nova", "Study this", "Save
// selection", "Add to notes"). It is listed in the store as "Nova".

import { useEffect, useState, type ReactNode } from 'react'
import { ChevronRight, Puzzle } from 'lucide-react'
import { StoreButton } from '@/components/extension/store-button'
import { currentBrowserSupport, type BrowserSupport } from '@/lib/browser-support'
import { CHROME_STORE_URL, STORE_LISTING_NAME } from '@/lib/extension-store'
import { recordFunnel } from '@/lib/extension-funnel'
import { BrowserList, ConnectionStatus, PairingCode, type ExtensionConnection } from './extension-panel'

// The page's buttons. Scoped here: the rest of the app keeps its own.
const BTN = 'inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60'
export const PRIMARY = `${BTN} bg-action font-semibold text-action-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.16)] hover:bg-action-hover`
export const SECONDARY = `${BTN} border border-white/12 text-foreground/85 hover:border-white/25 hover:bg-white/5 hover:text-foreground`
const UNSET = 'inline-flex h-10 items-center justify-center rounded-lg border border-dashed border-white/15 px-4 text-sm text-foreground/60'

function useBrowserSupport(): BrowserSupport {
  const [support, setSupport] = useState<BrowserSupport>('unknown')
  useEffect(() => { setSupport(currentBrowserSupport()) }, [])
  return support
}

// A note beside the button for a browser that can't, or hasn't been tested
// to, add it. Says nothing in Chrome on a computer.
export function BrowserNote({ support }: { support: BrowserSupport }) {
  if (support === 'chrome' || support === 'unknown') return null
  const words: Record<Exclude<BrowserSupport, 'chrome' | 'unknown'>, string> = {
    mobile: 'Extensions need Chrome on a computer. On this device, use the Save to Kivo bookmark below.',
    chromium: 'Made and tested for Google Chrome on a computer.',
    other: 'Needs Google Chrome on a computer. In this browser, use the Save to Kivo bookmark below.',
  }
  return <p role="note" className="text-xs text-amber-200/85" data-browser-note={support}>{words[support]}</p>
}

// ── Header ───────────────────────────────────────────────────────────────────

export function ExtensionHeader({ connection }: { connection: ExtensionConnection }) {
  const support = useBrowserSupport()
  const connected = connection.state === 'connected'
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5" data-extension-intro={connected ? 'connected' : 'install'}>
      <div className="min-w-0 max-w-xl">
        <h1 className="text-[1.9rem] font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-[2.2rem]">Browser Extension</h1>
        <p className="mt-2 text-[15px] text-foreground/65">Save what you discover. Continue learning in Kivo.</p>
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
        <div className="flex flex-wrap items-center gap-2">
          <ConnectionStatus state={connection.state} count={connection.connections.length} />
          {!connected && <StoreButton from="saved-intro" label="Add to Chrome" className={PRIMARY} unsetClassName={UNSET} />}
        </div>
        <BrowserNote support={support} />
      </div>
    </header>
  )
}

// ── Setup: until a browser is connected ──────────────────────────────────────

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3.5" data-step={n}>
      <span aria-hidden className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-action/15 text-[13px] font-semibold text-action-ink">{n}</span>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <div className="mt-1 space-y-2.5 text-sm text-foreground/60">{children}</div>
      </div>
    </li>
  )
}

export function SetupSteps({ connection }: { connection: ExtensionConnection }) {
  return (
    <section id="connect" aria-labelledby="setup-heading" className="scroll-mt-24 overflow-hidden rounded-2xl border border-white/8 bg-card/60" data-section="setup">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="p-5 sm:p-7">
          <h2 id="setup-heading" className="text-base font-semibold tracking-tight text-foreground">Set up in a minute</h2>
          <ol className="mt-5 space-y-5">
            <Step n={1} title="Add it to Chrome">
              <p>It&apos;s listed as “{STORE_LISTING_NAME}”. Pin it from the puzzle icon <Puzzle aria-hidden className="inline size-3.5 align-[-2px]" /> in the toolbar.</p>
              <StoreButton from="saved-steps" label="Open Chrome Web Store" className={`${SECONDARY} h-9 text-[13px]`} unsetClassName="inline-flex h-9 items-center rounded-lg border border-dashed border-white/15 px-3 text-xs text-foreground/60" />
            </Step>
            <Step n={2} title="Connect your account">
              <p>Get a code and type it into the extension.</p>
              {connection.code
                ? <PairingCode code={connection.code} onCancel={connection.cancelCode} />
                : <button type="button" onClick={() => void connection.getCode()} disabled={connection.busy} className={`${PRIMARY} h-9 text-[13px]`} data-get-code>{connection.busy ? 'One moment…' : 'Get a code'}</button>}
              {connection.error && <p role="alert" className="text-xs text-amber-300/90">{connection.error}</p>}
            </Step>
            <Step n={3} title="Save as you read">
              <p>On any page, click {STORE_LISTING_NAME} in the toolbar and press <span className="font-medium text-foreground/80">Save to Nova</span>.</p>
            </Step>
          </ol>
        </div>
        {/* The real popup, captured from the extension itself. */}
        <div className="hidden items-end justify-center border-l border-white/6 bg-[radial-gradient(120%_80%_at_50%_100%,rgb(63_182_168/0.16),transparent)] px-6 pt-7 lg:flex">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/extension/popup.png" alt="The Nova extension's popup on a research paper, ready to save it to a subject" width={420} height={479}
            className="w-full max-w-[17rem] rounded-t-xl border border-b-0 border-white/10 shadow-float" loading="lazy" />
        </div>
      </div>
    </section>
  )
}

// ── Connected browsers, once there is one ────────────────────────────────────

export function BrowsersPanel({ connection }: { connection: ExtensionConnection }) {
  return (
    <details id="connect" className="group scroll-mt-24 rounded-xl border border-white/8 bg-card/40" data-section="browsers">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2 font-medium text-foreground/85">
          <ChevronRight aria-hidden className="size-4 text-subtle transition-transform group-open:rotate-90 motion-reduce:transition-none" />
          Connected browsers
          <span className="text-subtle">{connection.connections.length}</span>
        </span>
        <span className="text-xs text-subtle group-open:hidden">Manage</span>
      </summary>
      <div className="space-y-3 border-t border-white/6 px-4 pb-4 pt-1">
        <BrowserList connections={connection.connections} onDisconnect={id => void connection.disconnect(id)} />
        {connection.code
          ? <PairingCode code={connection.code} onCancel={connection.cancelCode} />
          : <button type="button" onClick={() => void connection.getCode()} disabled={connection.busy} className={`${SECONDARY} h-9 text-[13px]`} data-get-code>{connection.busy ? 'One moment…' : 'Connect another browser'}</button>}
        {connection.error && <p role="alert" className="text-xs text-amber-300/90">{connection.error}</p>}
      </div>
    </details>
  )
}

// ── Help ─────────────────────────────────────────────────────────────────────

const FAQ: Array<{ q: string; a: ReactNode }> = [
  { q: 'How do I install it?', a: CHROME_STORE_URL
    ? <>Press <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" onClick={() => recordFunnel('Extension store opened', 'saved-faq')} className="text-action-ink underline underline-offset-4">Add to Chrome</a> and add “{STORE_LISTING_NAME}” from the Chrome Web Store. It works in Google Chrome on a computer.</>
    : <>The store link will be here soon. Meanwhile, the Save to Kivo bookmark and pasting a link save any page.</> },
  { q: 'How do I connect it?', a: 'Press Get a code here, or Get a code from Nova in the extension. Type the code into the extension. It works once, for ten minutes.' },
  { q: 'How do I save an article or a video?', a: 'Open it, click the extension and press Save to Nova. To keep one passage, select it first and press Save selection. A YouTube video is saved as a video, with its thumbnail.' },
  { q: 'Where do saved pages go?', a: 'Into Saved pages on this page. A page filed under a subject also appears on your Knowledge Map, and beside its topic in Focus.' },
  { q: 'It won’t connect.', a: 'Codes last ten minutes and work once, so get a new one and type it exactly. A browser also disconnects after thirty days unused, or if you disconnect it here.' },
  { q: 'A page didn’t save.', a: 'Chrome keeps extensions out of its own pages (settings, New Tab, the Web Store). About twenty saves a minute is the limit. You can always paste the link into Save a link.' },
  { q: 'Do I need a Kivo account?', a: 'Yes, and you’re signed in to it. The account that makes the code is the one the browser saves to.' },
]

const KEEPS = [
  'The page’s address and title and where you filed it. From extension 1.3.0, also what the page says about itself in its public tags (description, preview image, author, date, kind).',
  'From the page’s text, only a passage you select and choose to save.',
  'Preview images load from the page’s own site, with no referrer.',
  'Nova never opens the page, and never sees your other tabs or your history.',
  'Saving a page changes nothing in Knowledge. A finished study session does.',
]

function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group py-3.5" data-faq>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-foreground/85 hover:text-foreground [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronRight aria-hidden className="size-4 shrink-0 text-subtle transition-transform group-open:rotate-90 motion-reduce:transition-none" />
      </summary>
      <div className="mt-2 max-w-prose text-sm leading-relaxed text-foreground/60">{children}</div>
    </details>
  )
}

export function ExtensionHelp() {
  return (
    <section aria-labelledby="help-heading" className="grid gap-x-12 gap-y-8 border-t border-white/6 pt-8 lg:grid-cols-[minmax(0,1fr)_20rem]" data-section="extension-faq">
      <div>
        <h2 id="help-heading" className="text-base font-semibold tracking-tight text-foreground">Help</h2>
        <div className="mt-2 divide-y divide-white/6">
          {FAQ.map(item => <Disclosure key={item.q} title={item.q}>{item.a}</Disclosure>)}
        </div>
      </div>
      <div>
        <h2 className="text-base font-semibold tracking-tight text-foreground">What Nova keeps</h2>
        <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-foreground/60">
          {KEEPS.map(k => <li key={k} className="flex gap-2.5"><span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-foreground/30" />{k}</li>)}
        </ul>
        <p className="mt-4 text-xs text-subtle">More in the <a href="/guide#extension" className="underline underline-offset-4 hover:text-foreground">Docs</a>.</p>
      </div>
    </section>
  )
}
