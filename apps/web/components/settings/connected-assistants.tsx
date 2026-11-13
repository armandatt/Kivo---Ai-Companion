'use client'

// Kivo Connect: the AI assistants (ChatGPT, Claude, …) this account allowed
// to reach its Kivo, and Disconnect, which stops their access at once.
// How to connect one: the MCP address below, added in the assistant's own
// connector settings; the assistant then sends you to Kivo to allow it.

import { useEffect, useState } from 'react'

type Connection = { id: string; client: string; scopes: string[]; connectedAt: string; lastUsedAt: string | null }

export function ConnectedAssistants() {
  const [list, setList] = useState<Connection[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // Set after mounting, so the server's render and the browser's agree.
  const [address, setAddress] = useState('')
  useEffect(() => { setAddress(`${window.location.origin}/api/mcp`) }, [])

  useEffect(() => {
    fetch('/api/connect/connections', { cache: 'no-store' })
      .then(r => r.json())
      .then(b => (b.ok ? setList(b.connections) : setError(b.message ?? "Couldn't load connected assistants.")))
      .catch(() => setError("Couldn't load connected assistants."))
  }, [])

  async function disconnect(id: string) {
    setBusy(id); setError('')
    const r = await fetch('/api/connect/connections', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => null)
    const b = r ? await r.json().catch(() => null) : null
    if (b?.ok) setList(b.connections); else setError(b?.message ?? "Couldn't disconnect. Try again.")
    setBusy(null)
  }

  return (
    <section className="rounded-3xl border border-white/8 bg-card/70 p-6">
      <h2 className="text-base font-semibold text-foreground">AI assistants</h2>
      <p className="mt-1 text-sm text-foreground/55">
        Let ChatGPT or Claude search your notes, save what you learn in a conversation and build your Knowledge Map. Add this address as a custom connector in the assistant, then allow it here when it asks.
      </p>
      <div className="mt-4 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground/80">{address || '…/api/mcp'}</code>
        <button type="button" className="shrink-0 rounded-lg border border-white/12 px-3 py-2 text-sm text-foreground/80 hover:bg-white/5"
          onClick={() => { void navigator.clipboard?.writeText(address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="mt-5">
        {error && <p role="alert" className="text-sm text-coral-300">{error}</p>}
        {list === null && !error && <div aria-busy="true" className="h-10 animate-pulse rounded-xl bg-white/5" />}
        {list?.length === 0 && <p className="text-sm text-foreground/50">No assistant is connected.</p>}
        <ul className="divide-y divide-white/6">
          {list?.map(c => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-3">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">{c.client}</span>
                <span className="block text-xs text-foreground/50">
                  Connected {new Date(c.connectedAt).toLocaleDateString()}{c.lastUsedAt ? ` · last used ${new Date(c.lastUsedAt).toLocaleDateString()}` : ''} · {c.scopes.some(s => s.endsWith(':write')) ? 'can read and change' : 'read only'}
                </span>
              </span>
              <button type="button" disabled={busy === c.id} onClick={() => disconnect(c.id)} className="shrink-0 rounded-lg border border-white/12 px-3 py-1.5 text-sm text-foreground/80 hover:bg-white/5 disabled:opacity-50">
                {busy === c.id ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
