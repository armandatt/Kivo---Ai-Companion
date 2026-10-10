'use client'

import { useEffect, useRef, useState } from 'react'
import { bookmarkletCode } from '@repo/api/nova/product/resource-link'

// The "Save to Kivo" bookmark: a browser bookmark whose address is a line of
// script. Pressed on any page, it opens Saved with that page's address and
// title ready to review. It holds no credential; the page it opens uses the
// learner's ordinary sign-in.
export function BookmarkletPanel() {
  const link = useRef<HTMLAnchorElement>(null)
  const [code, setCode]     = useState<string | null>(null)
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null)
  const [hint, setHint]     = useState(false)

  // The address is this site's own. React refuses a script address in JSX,
  // so it is set on the element.
  useEffect(() => {
    const made = bookmarkletCode(window.location.origin)
    setCode(made)
    if (made) link.current?.setAttribute('href', made)
  }, [])

  async function copy() {
    if (!code) return
    try { await navigator.clipboard.writeText(code); setCopied('yes') } catch { setCopied('no') }
  }

  return (
    <section className="rounded-2xl border border-white/8 bg-card/50 p-5" data-section="bookmarklet">
      <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">Save from any page</h2>
      <p className="mt-3 text-sm leading-relaxed text-foreground/65">
        A bookmark that sends the page you are on to this screen, ready to review. Nothing to install.
      </p>

      <a
        ref={link} href="#" draggable onClick={e => { e.preventDefault(); setHint(true) }}
        className="mt-4 inline-flex h-10 cursor-grab items-center justify-center rounded-xl border border-dashed border-keppel-400/50 bg-keppel-400/8 px-4 text-sm font-semibold text-keppel-300 active:cursor-grabbing"
        data-bookmarklet
      >
        Save to Kivo
      </a>
      {hint && <p role="status" className="mt-2 text-xs text-foreground/55">Drag this button to your bookmarks bar instead of clicking it.</p>}

      <ol className="mt-4 list-decimal space-y-1.5 pl-4 text-sm leading-relaxed text-foreground/60">
        <li>Show your bookmarks bar (Ctrl+Shift+B, or ⌘⇧B on a Mac).</li>
        <li>Drag the button above onto it.</li>
        <li>On any page, click the bookmark, then confirm here.</li>
      </ol>

      <details className="mt-4 text-sm text-foreground/60">
        <summary className="cursor-pointer text-foreground/75">On a phone or tablet</summary>
        <div className="mt-3 space-y-2 leading-relaxed">
          <p>Phones cannot drag a bookmark, so it takes a minute to set up:</p>
          <ol className="list-decimal space-y-1.5 pl-4">
            <li>Copy the bookmark&apos;s code with the button below.</li>
            <li>Bookmark this page, then edit that bookmark: name it “Save to Kivo” and replace its address with the code.</li>
            <li>Safari: open it from your bookmarks. Chrome: type “Save to Kivo” in the address bar and pick the bookmark.</li>
          </ol>
          <p>Some browsers and in-app browsers do not run bookmarks like this. Copying the page&apos;s link and pasting it into Save a link always works.</p>
        </div>
      </details>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void copy()} disabled={!code} className="rounded-lg border border-white/12 px-3 py-1.5 text-xs text-foreground/75 transition-colors hover:bg-white/5 disabled:opacity-50" data-bookmarklet-copy>
          {copied === 'yes' ? 'Copied' : 'Copy bookmark code'}
        </button>
        {copied === 'no' && <span role="alert" className="text-xs text-amber-300/90">Your browser did not allow copying.</span>}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-foreground/45">
        A few sites block bookmarks from running. If nothing happens, paste the link instead.
      </p>
    </section>
  )
}
