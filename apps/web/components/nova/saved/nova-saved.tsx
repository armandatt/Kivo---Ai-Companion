'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LearningResource, NovaSavedResourcesReady } from '@repo/api/nova/product/learning-events.types'
import { BookmarkletPanel } from './bookmarklet-panel'
import { useExtensionConnection } from './extension-panel'
import { BrowsersPanel, ExtensionHeader, ExtensionHelp, SetupSteps } from './extension-install'
import { takeCapture, type Capture } from './pending-capture'
import { SaveLink } from './save-link'
import { SavedLibrary } from './saved-library'

// The Browser Extension page: getting the extension, connecting it, and the learner's
// inbox of saved pages and passages (pasted here, sent by the bookmark, or
// sent by the extension). One page, because what the extension saves lands
// here; the address stays /saved. A saved page is a bookmark with a subject,
// nothing more: Nova learns nothing about the learner from it until they study it.
//
// Order, by what the learner needs now:
//   not connected: header (status, Add to Chrome) → setup → saved pages → other ways → help
//   connected:     header (status) → saved pages → browsers → other ways → help
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

  const connection = useExtensionConnection()
  const connected = connection.state === 'connected'

  // Arriving from the extension's "Get a code from Nova" (?connect): the
  // connect controls are brought into view (and opened, once connected).
  const pointed = useRef(false)
  useEffect(() => {
    if (!connect || pointed.current || connection.state === 'checking') return
    pointed.current = true
    const target = document.getElementById('connect')
    if (target instanceof HTMLDetailsElement) target.open = true
    target?.scrollIntoView({ block: 'start' })
  }, [connect, connection.state])

  return (
    <div className="mx-auto w-full max-w-6xl space-y-10 pb-20 pt-10 lg:pt-4" data-saved={view.resources.length > 0 ? 'ready' : 'empty'}>
      <ExtensionHeader connection={connection} />

      {!connected && connection.state !== 'checking' && <SetupSteps connection={connection} />}
      {/* Sent here to connect (?connect) with a browser already connected: the
          browsers come first, above the library that loads after them. */}
      {connected && connect && <BrowsersPanel connection={connection} />}

      <section className="space-y-4" aria-labelledby="saved-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="saved-heading" className="text-lg font-semibold tracking-tight text-foreground" data-saved-heading>Saved pages</h2>
        </div>
        <SaveLink subjects={view.subjects} resources={shown} capture={capture} onSaved={saved} />
        <SavedLibrary refreshKey={refreshKey} onItems={keep} />
      </section>

      {connected && !connect && <BrowsersPanel connection={connection} />}

      <section aria-labelledby="elsewhere-heading" className="space-y-4 border-t border-white/6 pt-8">
        <h2 id="elsewhere-heading" className="text-base font-semibold tracking-tight text-foreground">Other ways to save</h2>
        <BookmarkletPanel />
      </section>

      <ExtensionHelp />
    </div>
  )
}
