'use client'

import { useState, useEffect } from 'react'
import { TELEGRAM_BOT_URL } from '@/lib/telegram'

export function TelegramConnect() {
  const [status, setStatus] = useState<'loading' | 'connected' | 'disconnected'>('loading')
  const [connecting, setConnecting] = useState(false)
  const [deeplink, setDeeplink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/me')
      .then(r => r.json())
      .then(d => setStatus(d.telegramConnected ? 'connected' : 'disconnected'))
      .catch(() => setStatus('disconnected'))
  }, [])

  async function connect() {
    setConnecting(true)
    setDeeplink(null)
    setError(null)
    try {
      const res = await fetch('/api/telegram/generate-token', { method: 'POST' })
      const data = await res.json()
      if (data.deeplink) {
        setDeeplink(data.deeplink)
      } else {
        setError('Could not generate link. Try again.')
      }
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setConnecting(false)
    }
  }

  // Already connected — small pill indicator
  if (status === 'connected') {
    return (
      <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-emerald-950/40 border border-emerald-800/30">
        <div className="flex items-center gap-2.5">
          <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
          <span className="text-sm text-emerald-300/80 font-medium">Rex is active on Telegram</span>
        </div>
        <a
          href={TELEGRAM_BOT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-emerald-400/60 hover:text-emerald-300 transition-colors"
        >
          Open chat →
        </a>
      </div>
    )
  }

  // Not connected — prominent card
  if (status === 'disconnected') {
    return (
      <div className="rounded-2xl border border-white/8 bg-gradient-to-br from-slate-900 to-slate-950 overflow-hidden">
        {/* Top accent bar */}
        <div className="h-0.5 bg-gradient-to-r from-transparent via-emerald-500/60 to-transparent" />

        <div className="px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <TelegramIcon className="text-sky-400" />
                <span className="text-xs font-semibold tracking-widest text-white/40 uppercase">Connect Rex</span>
              </div>
              <p className="text-base font-semibold text-white mb-1">
                Rex coaches you on Telegram
              </p>
              <p className="text-sm text-white/40 leading-relaxed">
                Pre-session reminders, post-workout logging, weekly reviews — all in your chat.
              </p>
            </div>

            {/* Right side action */}
            <div className="flex-shrink-0 pt-1">
              {!deeplink ? (
                <button
                  onClick={connect}
                  disabled={connecting}
                  className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
                >
                  {connecting ? 'Generating…' : 'Connect'}
                </button>
              ) : (
                <a
                  href={deeplink}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setStatus('connected')}
                  className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-semibold transition-colors inline-block"
                >
                  Open Telegram →
                </a>
              )}
            </div>
          </div>

          {/* What you get */}
          {!deeplink && (
            <div className="mt-4 pt-4 border-t border-white/5 grid grid-cols-3 gap-3">
              {[
                { label: 'Pre-session', desc: '30 min before gym' },
                { label: 'Daily check-in', desc: '9am every day' },
                { label: 'Weekly review', desc: 'Every Sunday 8pm' },
              ].map(item => (
                <div key={item.label}>
                  <p className="text-xs font-semibold text-white/60">{item.label}</p>
                  <p className="text-xs text-white/25 mt-0.5">{item.desc}</p>
                </div>
              ))}
            </div>
          )}

          {/* Deeplink step 2 */}
          {deeplink && (
            <div className="mt-4 pt-4 border-t border-white/5">
              <p className="text-xs text-white/40">
                Click "Open Telegram →" above, then press <span className="text-white/60 font-mono">Start</span> in the bot. Rex will introduce himself.
              </p>
            </div>
          )}

          {error && (
            <p className="mt-3 text-xs text-red-400">{error}</p>
          )}
        </div>
      </div>
    )
  }

  // Loading skeleton
  return (
    <div className="rounded-2xl border border-white/5 bg-slate-950 h-24 animate-pulse" />
  )
}

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M21 5L2 12.5l7 1M21 5l-2.5 15L9 13.5M21 5L9 13.5m0 0V19l3.5-3" />
    </svg>
  )
}
