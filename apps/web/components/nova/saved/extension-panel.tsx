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

  return (
    <section className="rounded-2xl border border-white/8 bg-card/50 p-5" data-section="extension" data-open={open}>
      <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">Browser extension</h2>
      <p className="mt-3 text-sm leading-relaxed text-foreground/65">
        Save a page to Nova, or study it, from wherever you are reading. Nova sees a page only when you click its button on that page.
      </p>

      {connections && connections.length > 0 && (
        <ul className="mt-4 space-y-2.5" data-connections>
          {connections.map(c => (
            <li key={c.id} data-connection={c.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="block truncate text-foreground/85">{c.label ?? 'A browser'}</span>
                <span className="block text-xs text-foreground/45">Connected {relativeDay(c.connectedAt)}</span>
              </span>
              <button type="button" onClick={() => void disconnect(c.id)} className="shrink-0 rounded-lg border border-white/12 px-3 py-1.5 text-xs text-foreground/75 transition-colors hover:bg-white/5">
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}

      {code ? (
        <div className="mt-4 rounded-xl border border-keppel-400/25 bg-keppel-400/5 p-4" data-pairing>
          <p className="text-xs text-foreground/60">Type this into the Nova extension:</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold tracking-[0.12em] text-foreground" data-pairing-code>{code.code}</p>
          <p className="mt-2 text-xs leading-relaxed text-foreground/45">It works once and stops working in ten minutes. Don&apos;t share it: whoever enters it can save pages to your Nova.</p>
        </div>
      ) : (
        <button type="button" onClick={() => void getCode()} disabled={busy} className="mt-4 inline-flex h-10 items-center justify-center rounded-xl bg-keppel-400 px-4 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300 disabled:opacity-60" data-get-code>
          {busy ? 'One moment…' : known > 0 ? 'Connect another browser' : 'Connect a browser'}
        </button>
      )}
      {error && <p role="alert" className="mt-3 text-xs text-amber-300/90">{error}</p>}
    </section>
  )
}
