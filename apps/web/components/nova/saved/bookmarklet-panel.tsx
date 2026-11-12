'use client'

import { useEffect, useRef, useState } from 'react'
import { Bookmark, ChevronRight } from 'lucide-react'
import { bookmarkletCode } from '@repo/api/nova/product/resource-link'

// The "Save to Kivo" bookmark: a browser bookmark whose address is a line of
// script. Pressed on any page, it opens Saved with that page's address and
// title ready to review. It holds no credential; the page it opens uses the
// learner's ordinary sign-in. Shown as one compact row: the button to drag,
// one line, and the phone steps behind a disclosure.
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
    <section className="flex flex-col gap-4 sm:flex-row sm:items-start" data-section="bookmarklet">
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-card/60 text-subtle"><Bookmark className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-foreground">Save to Kivo bookmark</h3>
        <p className="mt-0.5 text-sm text-foreground/60">For any browser, Safari included. Drag the button to your bookmarks bar, then click it on any page.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            ref={link} href="#" draggable onClick={e => { e.preventDefault(); setHint(true) }}
            className="inline-flex h-9 cursor-grab items-center justify-center rounded-lg border border-dashed border-keppel-400/50 bg-keppel-400/8 px-3.5 text-[13px] font-semibold text-keppel-300 active:cursor-grabbing"
            data-bookmarklet
          >
            Save to Kivo
          </a>
          <button type="button" onClick={() => void copy()} disabled={!code} className="inline-flex h-9 items-center rounded-lg px-3 text-xs text-foreground/65 transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-50" data-bookmarklet-copy>
            {copied === 'yes' ? 'Copied' : 'Copy code'}
          </button>
          {copied === 'no' && <span role="alert" className="text-xs text-amber-300/90">Your browser did not allow copying.</span>}
        </div>
        {hint && <p role="status" className="mt-2 text-xs text-foreground/55">Drag it to your bookmarks bar instead of clicking it (Ctrl+Shift+B, or ⌘⇧B, shows the bar).</p>}
        <details className="group mt-3 text-sm text-foreground/60">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-foreground/60 hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden className="size-3.5 transition-transform group-open:rotate-90 motion-reduce:transition-none" /> On a phone or tablet
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] leading-relaxed">
            <li>Copy the code with the button above.</li>
            <li>Bookmark this page, then edit that bookmark: name it “Save to Kivo” and replace its address with the code.</li>
            <li>Safari: open it from your bookmarks. Chrome: type “Save to Kivo” in the address bar and pick it.</li>
          </ol>
          <p className="mt-2 text-xs text-subtle">Some sites and in-app browsers block bookmarks like this. Pasting the link always works.</p>
        </details>
      </div>
    </section>
  )
}
