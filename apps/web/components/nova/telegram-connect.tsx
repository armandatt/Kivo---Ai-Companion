'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, Check, Loader2, Send, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTelegramLink } from './use-telegram-link'

type Link = ReturnType<typeof useTelegramLink>

const primary = 'inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-keppel-400 px-5 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300 disabled:opacity-60'

// The button that connects Telegram, in its three states: ask for a link,
// open it, wait for the chat to appear. Shared by Settings and Home.
function ConnectAction({ link, className }: { link: Link; className?: string }) {
  return (
    <div className={className}>
      {link.deeplink ? (
        <>
          <a href={link.deeplink} target="_blank" rel="noopener noreferrer" className={primary}>
            Open Telegram <ArrowRight className="size-4" />
          </a>
          <p className="mt-3 flex items-center gap-2 text-xs text-foreground/50">
            <Loader2 className="size-3 animate-spin" />
            Press Start in the chat. This page updates when it is connected. The link works for 15 minutes.
          </p>
        </>
      ) : (
        <button type="button" onClick={() => void link.connect()} disabled={link.busy} className={primary}>
          {link.busy ? <><Loader2 className="size-4 animate-spin" /> Creating link…</> : <>Connect Telegram <ArrowRight className="size-4" /></>}
        </button>
      )}
      {link.error && <p role="alert" className="mt-3 text-sm text-red-300">{link.error}</p>}
    </div>
  )
}

// Settings → Telegram. `companion` is who the learner talks to there.
export function TelegramSettings({ companion }: { companion: string }) {
  const link = useTelegramLink()
  const mentor = companion === 'Rex' ? 'coach' : 'mentor'

  return (
    <section id="telegram" aria-labelledby="telegram-heading" className="rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-8">
      <div className="flex items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-white/4">
          <Send className="size-5 text-keppel-300" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="telegram-heading" className="text-lg font-semibold tracking-tight text-foreground">Telegram</h2>

          {link.connection === null ? (
            <div aria-busy="true" aria-label="Checking Telegram" className="mt-3 h-5 w-56 animate-pulse rounded bg-white/5" />
          ) : link.connection.connected ? (
            <>
              <p className="mt-2 flex items-center gap-2 text-sm font-medium text-keppel-200">
                <Check className="size-4" /> Telegram connected
              </p>
              <p className="mt-1 text-sm text-foreground/65">{companion} is ready on Telegram.</p>
              {link.connection.botUrl && (
                <a href={link.connection.botUrl} target="_blank" rel="noopener noreferrer"
                  className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/12 px-5 text-sm font-medium text-foreground transition-colors hover:bg-white/5">
                  Open Telegram <ArrowRight className="size-4" />
                </a>
              )}
            </>
          ) : (
            <>
              <p className="mt-2 max-w-prose text-sm leading-relaxed text-foreground/65">
                Take {companion} with you. Talk to your {mentor}, start sessions, check what to study, and get useful nudges from Telegram.
              </p>
              <ConnectAction link={link} className="mt-5" />
              <p className="mt-4 text-xs text-foreground/40">Optional. Everything here works without it.</p>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

const DISMISSED = 'kivo.telegram-card.dismissed'

// Home: a small card for a learner with no Telegram chat. It blocks nothing
// and goes away when closed, for this browser session only; nothing about
// it is saved to the account.
export function TelegramCard({ className }: { className?: string }) {
  const link = useTelegramLink()
  const [dismissed, setDismissed] = useState(true)   // hidden until the browser has been asked

  useEffect(() => {
    try { setDismissed(window.sessionStorage.getItem(DISMISSED) === '1') } catch { setDismissed(false) }
  }, [])

  // Shown only when the server has said there is no chat.
  if (dismissed || link.connection === null || link.connection.connected) return null

  const dismiss = () => {
    setDismissed(true)
    try { window.sessionStorage.setItem(DISMISSED, '1') } catch { /* the card is closed for this view either way */ }
  }

  return (
    <aside aria-label="Connect Telegram" className={cn('relative rounded-2xl border border-white/8 bg-white/3 p-5', className)}>
      <button type="button" onClick={dismiss} aria-label="Dismiss"
        className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-lg text-foreground/40 hover:bg-white/5 hover:text-foreground/70">
        <X className="size-4" />
      </button>
      <p className="pr-8 text-sm font-medium text-foreground">Take Nova with you</p>
      <p className="mt-1 text-sm text-foreground/60">Your mentor is also available on Telegram.</p>
      <ConnectAction link={link} className="mt-4" />
    </aside>
  )
}
