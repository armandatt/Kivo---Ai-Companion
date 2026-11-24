'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LearningResource, NovaSavedResourcesReady } from '@repo/api/nova/product/learning-events.types'
import { useExtensionConnection } from './extension-panel'
import { ExtensionHeader, ExtensionHelp, GetStarted, OtherWays, useIntroVisibility } from './extension-install'
import { takeCapture, type Capture } from './pending-capture'
import { SaveLink } from './save-link'
import { SavedLibrary } from './saved-library'

// The Browser Extension page (/saved). Saved pages are the page: what the
// learner kept from the web, to find, organise and study. Around them, only
// what is needed now:
//   header      title, the connection (which is also where browsers are
//               managed), and Add to Chrome while nothing is connected;
//   start       three steps and "See how it works", until a browser is
//               connected and a page saved (then a click away);
//   saved pages the library, with Save a link at its top;
//   other ways  the bookmark, folded;
//   help        questions and what Nova keeps, folded.
// The address stays /saved. A saved page is a bookmark with a subject: Nova
// learns nothing about the learner from it until they study it.
export function NovaSaved({ view, connect, onChanged }: { view: NovaSavedResourcesReady; connect: boolean; onChanged: () => void }) {
  // A page the bookmark brought, read once when the screen opens.
  const [capture, setCapture] = useState<Capture | null>(null)
  const taken = useRef(false)
  useEffect(() => {
    if (taken.current) return
    taken.current = true
    setCapture(takeCapture())
  }, [])

  const [refreshKey, setRefreshKey] = useState(0)
  const [shown, setShown] = useState<LearningResource[]>(view.resources)
  const keep = useCallback((items: LearningResource[]) => setShown(items), [])
  const saved = () => { setRefreshKey(k => k + 1); onChanged() }

  const connection = useExtensionConnection()
  const connected = connection.state === 'connected'
  const intro = useIntroVisibility(connected, view.resources.length > 0 || shown.length > 0, connection.state === 'checking')

  // Arriving from the extension's "Get a code from Nova" (?connect): the
  // connect controls are brought into view.
  const pointed = useRef(false)
  useEffect(() => {
    if (!connect || pointed.current || connection.state === 'checking') return
    pointed.current = true
    if (connected) intro.show()
    document.getElementById(connected ? 'connect' : 'get-started')?.scrollIntoView({ block: 'start' })
  }, [connect, connection.state]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 pb-20 pt-10 lg:pt-4" data-saved={view.resources.length > 0 ? 'ready' : 'empty'}>
      <ExtensionHeader connection={connection} onShowIntro={intro.show} />

      {intro.shown && <GetStarted connection={connection} hasPages={shown.length > 0} dismissible={intro.dismissible} onDismiss={intro.dismiss} />}

      <section className="space-y-4" aria-labelledby="saved-heading">
        <SavedLibrary refreshKey={refreshKey} onItems={keep}
          saveLink={<SaveLink subjects={view.subjects} resources={shown} capture={capture} onSaved={saved} />} />
      </section>

      <OtherWays />
      <ExtensionHelp onShowIntro={intro.show} />
    </div>
  )
}
