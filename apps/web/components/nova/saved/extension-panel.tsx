'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ExtensionConnectionView } from '@repo/api/nova/product/learning-events.types'
import { relativeDay } from '../format'
import { disconnectBrowser, fetchConnections, requestPairingCode } from './saved-api'

// Connecting a browser: Nova shows a one-time code here, and the learner
// types it into the extension. The code is made for the signed-in account
// and goes nowhere but this screen.
export function ExtensionPanel({ open }: { open: boolean }) {
  const [connections, setConnections] = useState<ExtensionConnectionView[] | null>(null)
  const [code, setCode]       = useState<{ code: string; expiresAt: string } | null>(null)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => { setConnections(await fetchConnections()) }, [])
  useEffect(() => { void load() }, [load])
  // While a code is showing, watch for the browser that redeems it.
  useEffect(() => {
    if (!code) return
    const timer = setInterval(() => { void load() }, 3000)
    return () => clearInterval(timer)
  }, [code, load])
  const known = connections?.length ?? 0
  useEffect(() => { setCode(null) }, [known])

  async function getCode() {
    setBusy(true); setError(null)
    const res = await requestPairingCode()
    setBusy(false)
    if (res.ok) setCode({ code: res.code, expiresAt: res.expiresAt })
    else setError(res.message)
  }

  async function disconnect(id: string) {
    if (await disconnectBrowser(id)) void load()
    else setError("That browser didn't disconnect. Try again.")
  }

  const state = connections === null ? 'checking' : known > 0 ? 'connected' : 'none'
  return (
    <section className="rounded-2xl border border-white/8 bg-card/50 p-5 sm:p-6" data-section="extension" data-open={open} aria-labelledby="extension-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="extension-heading" className="text-base font-semibold tracking-tight text-foreground">Browser extension</h2>
        {/* Said in words as well as colour. */}
        <span role="status" data-connection-state={state}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${state === 'connected' ? 'border-keppel-400/35 bg-keppel-400/10 text-keppel-300' : 'border-white/12 text-foreground/55'}`}>
          <span aria-hidden className={`size-1.5 rounded-full ${state === 'connected' ? 'bg-keppel-400' : 'border border-current'}`} />
          {state === 'checking' ? 'Checking…' : state === 'connected' ? `Connected · ${known} ${known === 1 ? 'browser' : 'browsers'}` : 'Not connected'}
        </span>
      </div>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-foreground/60">
        Save a page to Nova, or study it, from wherever you are reading. Nova sees a page only when you click its button on that page.
      </p>

      {connections && connections.length > 0 && (
        <ul className="mt-5 divide-y divide-white/6 rounded-xl border border-white/8" data-connections>
          {connections.map(c => (
            <li key={c.id} data-connection={c.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="flex min-w-0 items-center gap-3">
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-keppel-400" />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground/90">{c.label ?? 'A browser'}</span>
                  <span className="block text-xs text-foreground/50">Connected {relativeDay(c.connectedAt)}</span>
                </span>
              </span>
              <button type="button" onClick={() => void disconnect(c.id)} aria-label={`Disconnect ${c.label ?? 'this browser'}`}
                className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs text-foreground/60 transition-colors hover:bg-white/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-keppel-400">
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}

      {code ? (
        <div className="mt-5 rounded-xl border border-keppel-400/25 bg-keppel-400/5 p-4 sm:p-5" data-pairing>
          <p className="text-sm text-foreground/70">Open the Nova extension and type this code:</p>
          <p className="mt-2 select-all font-mono text-2xl font-semibold tracking-[0.14em] text-foreground" data-pairing-code>{code.code}</p>
          <p className="mt-3 flex items-center gap-2 text-xs text-foreground/55" role="status">
            <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-keppel-400 motion-reduce:animate-none" /> Waiting for the extension…
          </p>
          <p className="mt-2 text-xs leading-relaxed text-foreground/45">It works once and stops working in ten minutes. Don&apos;t share it: whoever enters it can save pages to your Nova.</p>
        </div>
      ) : (
        <button type="button" onClick={() => void getCode()} disabled={busy} className="mt-5 inline-flex h-10 items-center justify-center rounded-xl bg-keppel-400 px-4 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-keppel-400 disabled:opacity-60" data-get-code>
          {busy ? 'One moment…' : known > 0 ? 'Connect another browser' : 'Connect a browser'}
        </button>
      )}
      {error && <p role="alert" className="mt-3 text-xs text-amber-300/90">{error}</p>}
    </section>
  )
}
