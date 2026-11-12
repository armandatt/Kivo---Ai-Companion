'use client'

// Getting the extension and connecting it, on the Browser Extension page.
// What the page can know, and so what it says:
//   - Whether a browser is connected: yes, from the server's list of this
//     account's connections (ExtensionPanel loads it). Nothing else is used.
//   - Whether the extension is installed: no. It has no content script and
//     does not talk to web pages, so the page never claims it is, and the
//     install button is always there.
//   - The browser: only to word a note beside the button (browser-support.ts).
// Everything described here is what the extension in apps/extension does, in
// its own words ("Get a code from Nova", "Save to Nova", "Study this",
// "Save selection", "Add to notes"). It is listed in the store as "Nova".

import { useEffect, useState, type ReactNode } from 'react'
import { BookOpen, FileText, GraduationCap, Globe, Newspaper, PlaySquare, Quote } from 'lucide-react'
import { StoreButton } from '@/components/extension/store-button'
import { BUTTON_PRIMARY, BUTTON_QUIET } from '@/components/nova/workspace/ui'
import { currentBrowserSupport, type BrowserSupport } from '@/lib/browser-support'
import { CHROME_STORE_URL, STORE_LISTING_NAME } from '@/lib/extension-store'
import { recordFunnel } from '@/lib/extension-funnel'

export type ConnectionState = 'checking' | 'none' | 'connected'

const BIG_PRIMARY = `${BUTTON_PRIMARY} h-11 w-full px-5 text-[15px] sm:w-auto`
const BIG_QUIET = 'inline-flex h-11 w-full items-center justify-center rounded-lg border border-white/12 px-5 text-[15px] font-medium text-foreground/80 transition-colors hover:border-white/25 hover:bg-white/4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:w-auto'
const UNSET = 'inline-flex h-11 w-full items-center justify-center rounded-lg border border-dashed border-white/15 px-5 text-sm text-foreground/65 sm:w-auto'

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
    mobile: 'Phones and tablets can’t add browser extensions. Open this page in Chrome on a computer to install it. Here, the Save to Kivo bookmark below saves any page.',
    chromium: 'Kivo’s extension is made and tested for Google Chrome on a computer. Other browsers aren’t supported yet.',
    other: 'Kivo’s extension needs Google Chrome on a computer. This browser can’t add it, but the Save to Kivo bookmark below works here.',
  }
  return <p role="note" className="mt-3 max-w-prose text-sm leading-relaxed text-amber-200/85" data-browser-note={support}>{words[support]}</p>
}

// The top of the page. With nothing connected: what the extension is for,
// Add Kivo to Chrome and How it works. With a browser connected: one line
// saying so, so the saved pages come first.
export function ExtensionIntro({ state, count }: { state: ConnectionState; count: number }) {
  const support = useBrowserSupport()

  if (state === 'connected') {
    return (
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4" data-extension-intro="connected">
        <div className="min-w-0 max-w-2xl">
          <h1 className="text-[1.9rem] font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-[2.4rem]">Browser Extension</h1>
          <p className="mt-2.5 text-[15px] leading-relaxed text-foreground/65">
            Connected in {count} {count === 1 ? 'browser' : 'browsers'}. On any page, click the {STORE_LISTING_NAME} icon in Chrome’s toolbar and press Save to Nova. What you save appears below.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <a href="#how-it-works" className={BUTTON_QUIET}>How it works</a>
          <StoreButton from="saved-connected" label="Chrome Web Store" className={BUTTON_QUIET} unsetClassName="hidden" />
        </div>
      </header>
    )
  }

  return (
    <header className="relative overflow-hidden rounded-3xl border border-white/8 bg-card/60 px-5 py-8 sm:px-10 sm:py-12" data-extension-intro="install">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-action/10 blur-3xl" />
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-subtle">Browser Extension</p>
      <h1 className="mt-3 max-w-3xl text-[2rem] font-semibold leading-[1.06] tracking-[-0.03em] text-foreground sm:text-[2.8rem]">
        Your browser. Connected to your second brain.
      </h1>
      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-foreground/70 sm:text-base">
        Save anything worth learning from the web. Send articles, videos, documentation and research straight into Kivo, filed under your subjects, so your knowledge stays organised and connected.
      </p>
      <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
        <StoreButton from="saved-intro" className={BIG_PRIMARY} unsetClassName={UNSET} />
        <a href="#how-it-works" className={BIG_QUIET}>How it works</a>
      </div>
      <p className="mt-3 text-sm text-subtle">
        {CHROME_STORE_URL
          ? <>Opens the Chrome Web Store in a new tab, where it’s listed as “{STORE_LISTING_NAME}”. Then connect it here with a one-time code.</>
          : <>Until the store link is here, the Save to Kivo bookmark and Save a link on this page save any page.</>}
      </p>
      <BrowserNote support={support} />
    </header>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="relative rounded-2xl border border-white/8 bg-card/50 p-5" data-step={n}>
      <span aria-hidden className="grid size-8 place-items-center rounded-full bg-action/15 text-sm font-semibold text-action-ink">{n}</span>
      <h3 className="mt-3 text-[15px] font-semibold text-foreground">{title}</h3>
      <div className="mt-1.5 space-y-2 text-sm leading-relaxed text-foreground/65">{children}</div>
    </li>
  )
}

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-heading" className="scroll-mt-24" data-section="how-it-works">
      <h2 id="how-heading" className="text-lg font-semibold tracking-tight text-foreground">How it works</h2>
      <ol className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Step n={1} title="Install it from the Chrome Web Store">
          <p>Press Add to Chrome on the listing (it’s called “{STORE_LISTING_NAME}” there). To keep it in reach, click the puzzle piece in Chrome’s toolbar and pin it.</p>
          <StoreButton from="saved-steps" className={`${BUTTON_QUIET} mt-1`} unsetClassName="mt-1 inline-flex h-9 items-center rounded-lg border border-dashed border-white/15 px-3 text-xs text-foreground/60" />
        </Step>
        <Step n={2} title="Connect your Kivo account">
          <p>Click the icon and choose Get a code from Nova, which opens this page. Or press Connect a browser here. Type the code into the extension.</p>
          <p>The code works once, for ten minutes, and connects that browser to the account you’re signed in to now.</p>
          <a href="#connect" className="inline-block text-sm font-medium text-action-ink underline-offset-4 hover:underline">Get a code</a>
        </Step>
        <Step n={3} title="Save as you read">
          <p>On a page worth keeping, click the icon and press Save to Nova, or Study this to start a session on it. File it under a subject and topic if you like.</p>
          <p>It appears in Saved pages below, and under that subject on your Knowledge Map.</p>
        </Step>
      </ol>
    </section>
  )
}

const KINDS: Array<{ icon: typeof FileText; title: string; body: string }> = [
  { icon: Newspaper,     title: 'Articles and blog posts', body: 'Any article you’re reading, kept with its title and address, under the subject you choose.' },
  { icon: PlaySquare,    title: 'YouTube videos',          body: 'Recognised as videos from the address, shown with the video’s own thumbnail.' },
  { icon: GraduationCap, title: 'Research papers',         body: 'arXiv, DOI and PubMed links are recognised as papers.' },
  { icon: BookOpen,      title: 'Documentation',           body: 'Documentation sites such as MDN, Read the Docs, and addresses starting with docs., are filed as documentation.' },
  { icon: FileText,      title: 'Tutorials and courses',   body: 'Saved like any page, with its title and address, under the subject and topic you choose.' },
  { icon: Quote,         title: 'A passage',               body: 'Select text first, then Save selection keeps that passage with its page, or Add to notes puts it in a note.' },
  { icon: Globe,         title: 'Any useful page',         body: 'Whatever else is worth coming back to. Search, tag and sort it all below.' },
]

export function WhatYouCanSave() {
  return (
    <section aria-labelledby="kinds-heading" data-section="what-you-can-save">
      <h2 id="kinds-heading" className="text-lg font-semibold tracking-tight text-foreground">What you can save</h2>
      <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {KINDS.map(k => (
          <li key={k.title} className="rounded-2xl border border-white/8 bg-card/40 p-4">
            <k.icon aria-hidden className="size-5 text-action-ink" />
            <h3 className="mt-2.5 text-sm font-semibold text-foreground">{k.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-foreground/60">{k.body}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-subtle">Nova never opens or reads the page itself. It keeps what the extension sends when you press a button: the address, the title, and a passage only if you selected one.</p>
    </section>
  )
}

const FAQ: Array<{ q: string; a: ReactNode }> = [
  { q: 'How do I install Kivo?', a: CHROME_STORE_URL
    ? <>Press <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" onClick={() => recordFunnel('Extension store opened', 'saved-faq')} className="text-action-ink underline underline-offset-4">Add Kivo to Chrome</a>. It opens the Chrome Web Store, where it’s listed as “{STORE_LISTING_NAME}”; press Add to Chrome there. It installs in Google Chrome on a computer.</>
    : <>The Chrome Web Store link will be on this page soon. Until then, the Save to Kivo bookmark and Save a link on this page save any page, in any browser.</> },
  { q: 'Do I need a Kivo account?', a: 'Yes. The extension saves into a Kivo account, and you’re signed in to yours now. The page you connect from decides which account a browser saves to.' },
  { q: 'How do I connect my account?', a: 'Click the extension’s icon and choose Get a code from Nova, or press Connect a browser on this page. Type the code shown here into the extension. It works once, for ten minutes. The extension then shows Connected with your name, and this page lists that browser.' },
  { q: 'How do I save an article?', a: 'Open the article, click the extension’s icon, choose a subject and topic if you like, and press Save to Nova. To keep one passage, select it first and press Save selection.' },
  { q: 'How do I save a YouTube video?', a: 'Open the video’s own page (not the YouTube home page), click the icon and press Save to Nova. It’s filed as a video, with its thumbnail.' },
  { q: 'Where do my saved pages appear?', a: 'In Saved pages on this page, where you can search, tag and sort them. Pages filed under a subject also appear on your Knowledge Map, and beside that topic when you study it in Focus.' },
  { q: 'The extension isn’t connecting.', a: 'A code works once and stops working after ten minutes: press Connect a browser for a new one and type it exactly. “Can’t reach Nova” means the extension couldn’t reach Kivo: check your connection and try again. A browser is also disconnected if you disconnect it here or leave it unused for thirty days; connect it again the same way.' },
  { q: 'A page didn’t save.', a: 'Chrome doesn’t let extensions into its own pages (settings, the New Tab page, the Chrome Web Store): open an ordinary web page. “That’s a lot at once” means about twenty saves in a minute: wait a minute. If the extension says it was disconnected, connect it again. You can always paste the link into Save a link on this page.' },
  { q: 'Which browsers does it work in?', a: 'Google Chrome on a computer. Phones and tablets can’t add browser extensions; there, the Save to Kivo bookmark on this page saves any page.' },
]

export function ExtensionFaq() {
  return (
    <section aria-labelledby="faq-heading" data-section="extension-faq">
      <h2 id="faq-heading" className="text-lg font-semibold tracking-tight text-foreground">Questions</h2>
      <div className="mt-4 divide-y divide-white/6 rounded-2xl border border-white/8 bg-card/40">
        {FAQ.map(item => (
          <details key={item.q} className="group px-5 py-4" data-faq>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-foreground/90 [&::-webkit-details-marker]:hidden">
              {item.q}
              <span aria-hidden className="text-subtle transition-transform group-open:rotate-45">+</span>
            </summary>
            <div className="mt-2 max-w-prose text-sm leading-relaxed text-foreground/65">{item.a}</div>
          </details>
        ))}
      </div>
      <p className="mt-3 text-xs text-subtle">More in the <a href="/guide#extension" className="underline underline-offset-4 hover:text-foreground">Docs</a>.</p>
    </section>
  )
}
