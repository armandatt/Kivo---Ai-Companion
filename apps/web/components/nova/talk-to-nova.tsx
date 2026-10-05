'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { sendNovaMessage } from './nova-api'

type Turn = { from: 'nova' | 'you'; text: string }

type Props = {
  // Shown before the first message. Not sent anywhere.
  opening?:     string
  placeholder:  string
  // Called after Nova has replied and saved the turn, so the page can re-read state.
  onReplied?:   () => void
  className?:   string
}

// A short conversation with Nova through POST /api/nova/message: the same
// turn Telegram runs, for the same learner.
export function TalkToNova({ opening, placeholder, onReplied, className }: Props) {
  const [turns, setTurns]     = useState<Turn[]>(opening ? [{ from: 'nova', text: opening }] : [])
  const [draft, setDraft]     = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [turns, sending])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text || sending) return
    setDraft('')
    setError(null)
    setTurns(t => [...t, { from: 'you', text }])
    setSending(true)
    const res = await sendNovaMessage(text)
    setSending(false)
    if (res.ok) {
      setTurns(t => [...t, { from: 'nova', text: res.reply }])
      onReplied?.()
    } else {
      setError(res.message)
      setDraft(text)
    }
  }

  return (
    <div className={cn('rounded-2xl border border-white/8 bg-white/3', className)}>
      {turns.length > 0 && (
        <div className="max-h-80 space-y-3 overflow-y-auto p-4 sm:p-5" aria-live="polite">
          {turns.map((turn, i) => (
            <div key={i} className={cn('flex', turn.from === 'you' && 'justify-end')}>
              <p className={cn(
                'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
                turn.from === 'you' ? 'bg-keppel-400/15 text-foreground' : 'bg-white/5 text-foreground/85',
              )}>
                {turn.text}
              </p>
            </div>
          ))}
          {sending && (
            <p className="flex items-center gap-2 text-xs text-foreground/45">
              <Loader2 className="size-3 animate-spin" /> Nova is thinking…
            </p>
          )}
          <div ref={end} />
        </div>
      )}

      <form onSubmit={send} className="flex items-center gap-2 border-t border-white/8 p-2.5 first:border-t-0">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={placeholder}
          maxLength={2000}
          aria-label="Message Nova"
          className="h-10 min-w-0 flex-1 rounded-lg bg-transparent px-3 text-sm text-foreground placeholder:text-foreground/35 focus:outline-none"
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          aria-label="Send"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-keppel-400 text-keppel-950 transition-colors hover:bg-keppel-300 disabled:opacity-40"
        >
          <ArrowUp className="size-4" />
        </button>
      </form>
      {error && <p role="alert" className="px-4 pb-3 text-xs text-red-300">{error}</p>}
    </div>
  )
}
