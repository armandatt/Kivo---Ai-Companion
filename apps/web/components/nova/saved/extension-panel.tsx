'use client'

// Connecting a browser: Nova shows a one-time code here, and the learner
// types it into the extension. The code is made for the signed-in account
// and goes nowhere but this screen.
//
// One hook holds the connection state (the server's list of this account's
// browsers, the only thing the page knows for sure about the extension), so
// the header's status, the setup steps and the browser list all read the same.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, Laptop, X } from 'lucide-react'
import type { ExtensionConnectionView } from '@repo/api/nova/product/learning-events.types'
import { relativeDay } from '../format'
import { disconnectBrowser, fetchConnections, requestPairingCode } from './saved-api'
import { recordFunnel } from '@/lib/extension-funnel'

export type ConnectionState = 'checking' | 'none' | 'connected'

export interface ExtensionConnection {
  state: ConnectionState
  connections: ExtensionConnectionView[]
  code: { code: string; expiresAt: string } | null
  busy: boolean
  error: string | null
  getCode: () => Promise<void>
  cancelCode: () => void
  disconnect: (id: string) => Promise<void>
}

export function useExtensionConnection(): ExtensionConnection {
  const [connections, setConnections] = useState<ExtensionConnectionView[] | null>(null)
  const [code, setCode]   = useState<{ code: string; expiresAt: string } | null>(null)
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => { setConnections(await fetchConnections()) }, [])
  useEffect(() => { void load() }, [load])
  // While a code is showing, watch for the browser that redeems it.
  useEffect(() => {
    if (!code) return
    const timer = setInterval(() => { void load() }, 3000)
    return () => clearInterval(timer)
  }, [code, load])

  const known = connections?.length ?? 0
  // A browser redeemed the code on screen: that is a connection completed.
  const shownFor = useRef<number | null>(null)
  useEffect(() => {
    if (shownFor.current !== null && known > shownFor.current) recordFunnel('Extension connected', 'saved-panel')
    shownFor.current = null
    setCode(null)
  }, [known])

  const getCode = useCallback(async () => {
    setBusy(true); setError(null)
    const res = await requestPairingCode()
    setBusy(false)
    if (res.ok) { shownFor.current = known; setCode({ code: res.code, expiresAt: res.expiresAt }); recordFunnel('Extension code requested', 'saved-panel') }
    else setError(res.message)
  }, [known])

  const disconnect = useCallback(async (id: string) => {
    if (await disconnectBrowser(id)) void load()
    else setError("That browser didn't disconnect. Try again.")
  }, [load])

  return {
    state: connections === null ? 'checking' : known > 0 ? 'connected' : 'none',
    connections: connections ?? [], code, busy, error, getCode,
    cancelCode: () => setCode(null), disconnect,
  }
}

// The status, said in words as well as colour.
export function ConnectionStatus({ state, count }: { state: ConnectionState; count: number }) {
  const on = state === 'connected'
  return (
    <span role="status" data-connection-state={state}
      className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium ${on ? 'border-keppel-400/35 bg-keppel-400/10 text-keppel-300' : 'border-white/12 text-foreground/60'}`}>
      <span aria-hidden className={`size-1.5 rounded-full ${on ? 'bg-keppel-400' : state === 'checking' ? 'animate-pulse bg-foreground/40 motion-reduce:animate-none' : 'border border-current'}`} />
      {state === 'checking' ? 'Checking…' : on ? `Connected · ${count} ${count === 1 ? 'browser' : 'browsers'}` : 'Not connected'}
    </span>
  )
}

// The code to type into the extension, while it is valid.
export function PairingCode({ code, onCancel }: { code: { code: string; expiresAt: string }; onCancel: () => void }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try { await navigator.clipboard.writeText(code.code); setCopied(true); window.setTimeout(() => setCopied(false), 1600) } catch { /* the code is on screen to type */ }
  }
  return (
    <div className="rounded-xl border border-keppel-400/30 bg-keppel-400/[0.06] p-4" data-pairing>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-foreground/65">Type this into the extension</p>
        <button type="button" onClick={onCancel} aria-label="Hide the code" className="-mr-1 -mt-1 grid size-7 place-items-center rounded-md text-subtle hover:bg-white/5 hover:text-foreground"><X className="size-3.5" /></button>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <p className="select-all font-mono text-[22px] font-semibold tracking-[0.12em] text-foreground" data-pairing-code>{code.code}</p>
        <button type="button" onClick={() => void copy()} aria-label="Copy the code" className="grid size-8 place-items-center rounded-md text-subtle hover:bg-white/5 hover:text-foreground">
          {copied ? <Check className="size-4 text-keppel-300" /> : <Copy className="size-4" />}
        </button>
      </div>
      <p className="mt-2 flex items-center gap-2 text-xs text-foreground/55" role="status">
        <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-keppel-400 motion-reduce:animate-none" /> Waiting for the extension · works once, for 10 minutes
      </p>
    </div>
  )
}

// The browsers connected to this account, each with Disconnect.
export function BrowserList({ connections, onDisconnect }: { connections: ExtensionConnectionView[]; onDisconnect: (id: string) => void }) {
  if (!connections.length) return null
  return (
    <ul className="divide-y divide-white/6" data-connections>
      {connections.map(c => (
        <li key={c.id} data-connection={c.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
          <span className="flex min-w-0 items-center gap-3">
            <Laptop aria-hidden className="size-4 shrink-0 text-subtle" />
            <span className="min-w-0">
              <span className="block truncate font-medium text-foreground/90">{c.label ?? 'A browser'}</span>
              <span className="block text-xs text-subtle">Connected {relativeDay(c.connectedAt).toLowerCase()}</span>
            </span>
          </span>
          <button type="button" onClick={() => onDisconnect(c.id)} aria-label={`Disconnect ${c.label ?? 'this browser'}`}
            className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs text-foreground/60 transition-colors hover:bg-white/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
            Disconnect
          </button>
        </li>
      ))}
    </ul>
  )
}
