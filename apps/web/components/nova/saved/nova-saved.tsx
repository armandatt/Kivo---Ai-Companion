'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LearningResource, NovaSavedResourcesReady } from '@repo/api/nova/product/learning-events.types'
import { BookmarkletPanel } from './bookmarklet-panel'
import { ExtensionPanel } from './extension-panel'
import { ExtensionFaq, ExtensionIntro, HowItWorks, WhatYouCanSave, type ConnectionState } from './extension-install'
import { takeCapture, type Capture } from './pending-capture'
import { SaveLink } from './save-link'
import { SavedLibrary } from './saved-library'

// The Browser Extension page: getting the extension, connecting it, and the learner's
// inbox of saved pages and passages (pasted here, sent by the bookmark, or
// sent by the extension) with what Nova found each connects to. One page,
// because what the extension saves lands here; the address stays /saved. A saved page is a bookmark with a subject,
// nothing more: Nova learns nothing about the learner from it until they study it.
export function NovaSaved({ view, connect, onChanged }: { view: NovaSavedResourcesReady; connect: boolean; onChanged: () => void }) {
  // A page the bookmark brought, read once when the screen opens.
  // Taking it empties the address, so it is taken exactly once per visit.
  const [capture, setCapture] = useState<Capture | null>(null)
  const taken = useRef(false)
  useEffect(() => {
    if (taken.current) return
    taken.current = true
    setCapture(takeCapture())
  }, [])

  // The library reloads after a save here; what it shows is what Save a link
  // checks for "already saved" (the server checks again).
  const [refreshKey, setRefreshKey] = useState(0)
  const [shown, setShown] = useState<LearningResource[]>(view.resources)
  const keep = useCallback((items: LearningResource[]) => setShown(items), [])
  const saved = () => { setRefreshKey(k => k + 1); onChanged() }

  // Whether a browser is connected, from the server's list (ExtensionPanel).
  // Until one is, the page leads with installing and connecting; after, with
  // the saved pages, and the steps and questions move below them.
  const [conn, setConn] = useState<{ state: ConnectionState; count: number }>({ state: 'checking', count: 0 })
  const onState = useCallback((state: ConnectionState, count: number) => setConn({ state, count }), [])
  const connected = conn.state === 'connected'
  const guide = <div className="mt-12 space-y-12"><HowItWorks /><WhatYouCanSave /></div>

  return (
    <div className="mx-auto w-full max-w-7xl pb-20 pt-10 lg:pt-4" data-saved={view.resources.length > 0 ? 'ready' : 'empty'}>
      <ExtensionIntro state={conn.state} count={conn.count} />

      {/* The library takes the full width: with hundreds of pages, room to read
          them matters more than the side notes, which sit beside the extension panel. */}
      <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <ExtensionPanel open={connect} onState={onState} />
        <aside className="space-y-6">
          <BookmarkletPanel />
          <details className="group rounded-2xl border border-white/8 bg-card/50 p-5">
            <summary className="cursor-pointer list-none text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">What Nova keeps <span className="font-normal text-subtle group-open:hidden">· show</span></summary>
            <ul className="mt-3 list-disc space-y-2 pl-4 text-sm leading-relaxed text-foreground/60 marker:text-foreground/30">
              <li>The page&apos;s address and title, where you filed it, and what the page says about itself in its public metadata tags (a description, a preview image, its author, date and kind, a video&apos;s length). From its text, only a passage you selected and chose to save.</li>
              <li>Preview images load from the page&apos;s own site, with no referrer.</li>
              <li>To suggest where a page belongs, Nova reads its title and your selected passage alongside the names of your subjects and topics. It never opens the page.</li>
              <li>Only pages you save or ask to study. Nova does not see your other tabs or your history.</li>
              <li>Saving a page changes nothing in Knowledge. A finished study session does.</li>
            </ul>
          </details>
        </aside>
      </div>

      {!connected && guide}

      <section className="mt-12 space-y-5 border-t border-white/6 pt-8" aria-labelledby="saved-heading">
        <h2 id="saved-heading" className="text-lg font-semibold tracking-tight text-foreground" data-saved-heading>Saved pages</h2>
        <SaveLink subjects={view.subjects} resources={shown} capture={capture} onSaved={saved} />
        <SavedLibrary refreshKey={refreshKey} onItems={keep} />
      </section>

      {connected && guide}
      <div className="mt-12"><ExtensionFaq /></div>
    </div>
  )
}
