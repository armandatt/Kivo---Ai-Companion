'use client'

// Kivo Connect's consent screen. An assistant (ChatGPT, Claude, …) sent the
// learner here to ask for access. The page shows who is asking and for what,
// and sends the learner's answer to the API, which issues a one-time code
// bound to this account and the assistant's registered return address.
// Signed-out visitors are sent to sign in first by the middleware.

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AuthError, AuthShell, authPrimaryButtonClass } from '@/components/auth/auth-shell'

type Info =
  | { ok: true; client: string; scopes: Array<{ scope: string; description: string }>; redirectHost: string; account: string | null }
  | { ok: false; show?: string; redirect?: string; message?: string }

function Consent() {
  const q = useSearchParams()
  const query = useMemo(() => q.toString(), [q])
  const [info, setInfo] = useState<Info | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    fetch(`/api/connect/authorize?${query}`, { cache: 'no-store' })
      .then(async r => {
        if (r.status === 401) { window.location.href = `/signin?from=${encodeURIComponent(`/connect/authorize?${query}`)}`; return null }
        return (await r.json()) as Info
      })
      .then(i => { if (live && i) setInfo(i) })
      .catch(() => live && setError("Couldn't reach Kivo. Reload to try again."))
    return () => { live = false }
  }, [query])

  async function answer(approve: boolean) {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/connect/authorize', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approve, params: Object.fromEntries(q.entries()) }),
      })
      const body = await res.json()
      if (body.redirect) { window.location.href = body.redirect; return }
      setError(body.show ?? body.message ?? 'Nothing was shared. Start again from your assistant.')
    } catch {
      setError("Couldn't reach Kivo. Nothing was shared; try again.")
    }
    setBusy(false)
  }

  if (!info) return <AuthShell title="Connect an assistant">{error ? <AuthError>{error}</AuthError> : <p className="text-sm text-ink-300">Checking the request…</p>}</AuthShell>
  if (!info.ok) {
    return (
      <AuthShell title="This request can't be used">
        <AuthError>{info.show ?? info.message ?? 'Something is wrong with this request. Nothing was shared.'}</AuthError>
        {info.redirect && <a className="mt-4 block text-sm text-keppel-300 underline" href={info.redirect}>Return to the assistant</a>}
      </AuthShell>
    )
  }
  return (
    <AuthShell title={`Allow ${info.client} to use your Kivo?`} subtitle={info.account ? `Signed in as ${info.account}` : undefined}>
      <div className="space-y-5 text-sm text-ink-200">
        <p>{info.client} is asking to:</p>
        <ul className="space-y-2">
          {info.scopes.map(s => (
            <li key={s.scope} className="flex gap-2"><span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-keppel-400" /><span>{s.description}</span></li>
          ))}
        </ul>
        <p className="text-ink-300">
          Deleting notes and large or restructuring changes always come back to you to approve first.
          You can disconnect it at any time from Settings. It will return you to <span className="font-medium text-ink-100">{info.redirectHost}</span>.
        </p>
        <p className="text-ink-300">The name &ldquo;{info.client}&rdquo; is how the assistant describes itself. Only allow it if you started this from your assistant just now.</p>
        {error && <AuthError>{error}</AuthError>}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <button type="button" disabled={busy} onClick={() => answer(true)} className={authPrimaryButtonClass}>Allow</button>
          <button type="button" disabled={busy} onClick={() => answer(false)} className="h-11 w-full rounded-lg border border-white/15 font-medium text-ink-100 hover:bg-white/5 disabled:opacity-60">Don&rsquo;t allow</button>
        </div>
      </div>
    </AuthShell>
  )
}

export default function Page() {
  return <Suspense><Consent /></Suspense>
}
