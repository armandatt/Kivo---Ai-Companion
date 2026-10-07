'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { SetupForm } from './setup-form'

function SetupFrame({ step, title, children }: { step: string; title: string; children: React.ReactNode }) {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-9">
      <div aria-hidden className="pointer-events-none absolute -top-32 -right-24 size-80 rounded-full bg-keppel-500/10 blur-3xl" />
      <div className="relative">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-keppel-300/80">{step}</p>
        <h2 className="mt-5 text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl">{title}</h2>
        {children}
      </div>
    </section>
  )
}

// No Telegram chat is linked to this account, so there is no learner for
// Nova to reason about yet. Linking uses the existing connect-token flow.
export function ConnectNova({ onCheck }: { onCheck: () => void }) {
  const [deeplink, setDeeplink] = useState<string | null>(null)
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState<string | null>(null)

  // Once the link is out, keep checking until the chat is linked.
  useEffect(() => {
    if (!deeplink) return
    const interval = setInterval(onCheck, 4000)
    return () => clearInterval(interval)
  }, [deeplink, onCheck])

  async function connect() {
    setBusy(true)
    setError(null)
    try {
      const res  = await fetch('/api/telegram/generate-token', { method: 'POST' })
      const data = await res.json() as { deeplink?: string; error?: string }
      if (data.deeplink) setDeeplink(data.deeplink)
      else setError(data.error ?? 'Could not create a link. Try again.')
    } catch {
      setError('Network error. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SetupFrame step="Step 1 of 2" title="Connect Nova on Telegram">
      <p className="mt-3 max-w-prose text-sm leading-relaxed text-foreground/65">
        Nova keeps one picture of you across Telegram and this page: what you study, what stuck, what is due.
        Link your Telegram chat and both stay in step.
      </p>

      <div className="mt-7">
        {deeplink ? (
          <>
            <a
              href={deeplink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-keppel-400 px-6 text-[15px] font-semibold text-keppel-950 transition-colors hover:bg-keppel-300 sm:w-auto"
            >
              Open Telegram <ArrowRight className="size-4" />
            </a>
            <p className="mt-3 flex items-center gap-2 text-xs text-foreground/50">
              <Loader2 className="size-3 animate-spin" />
              Press Start in the chat. This page updates when the link is made.
            </p>
          </>
        ) : (
          <button
            type="button"
            onClick={connect}
            disabled={busy}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-keppel-400 px-6 text-[15px] font-semibold text-keppel-950 transition-colors hover:bg-keppel-300 disabled:opacity-70 sm:w-auto"
          >
            {busy ? <><Loader2 className="size-4 animate-spin" /> Creating link…</> : <>Connect Telegram <ArrowRight className="size-4" /></>}
          </button>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
      </div>
    </SetupFrame>
  )
}

// Nova has nothing to plan from yet. This is the study setup: what the
// learner is taking, what it covers, when the exams are and how they usually
// study. It is the same setup Telegram and the chat box add to; anything
// already said there is shown here. Telegram is optional and is connected
// from Settings. The personality quiz is separate and is not asked again.
export function NovaOnboarding({ onProgress }: { onProgress: () => void }) {
  return (
    <SetupFrame step="Getting started" title="Set up what you're studying">
      <p className="mt-3 max-w-prose text-sm leading-relaxed text-foreground/65">
        Nova plans from this and nothing else: your subjects, what each one covers, and any exam dates.
        Skip what you don&apos;t know yet. Everything else it learns from your sessions.
      </p>
      <SetupForm onSaved={onProgress} />
    </SetupFrame>
  )
}
