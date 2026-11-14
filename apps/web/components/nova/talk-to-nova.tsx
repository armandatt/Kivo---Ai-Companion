'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowUp, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { sendNovaMessage } from './nova-api'

type Turn = { from: 'nova' | 'you'; text: string; link?: { label: string; path: string } }

type Props = {
  // Shown before the first message. Not sent anywhere.
  opening?:     string
  placeholder:  string
  // Called after Nova has replied and saved the turn, so the page can re-read state.
  onReplied?:   () => void
  className?:   string
  // What the conversation is about (the Knowledge Map's topic), said to Nova
  // before each message; the learner's own words are shown as they typed them.
  about?:       string
  // The Knowledge Map card it is asked from ("topic:<id>"): Nova is given what
  // that card holds, read on the server from the learner's own map.
  aboutNode?:   string
  // Questions to start with, shown until the first message; one tap sends it.
  suggestions?: string[]
  // More room to read and write: a taller conversation, wider spacing,
  // larger text and input (the Knowledge Map's Nova).
  roomy?:       boolean
}

// A short conversation with Nova through POST /api/nova/message: the same
// turn Telegram runs, for the same learner.
export function TalkToNova({ opening, placeholder, onReplied, className, about, aboutNode, suggestions, roomy }: Props) {
  const [turns, setTurns]     = useState<Turn[]>(opening ? [{ from: 'nova', text: opening }] : [])
  const [draft, setDraft]     = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [turns, sending])

  async function send(e: React.FormEvent | null, said?: string) {
    e?.preventDefault()
    const text = (said ?? draft).trim()
    if (!text || sending) return
    setDraft('')
    setError(null)
    setTurns(t => [...t, { from: 'you', text }])
    setSending(true)
    const res = await sendNovaMessage(about ? `About ${about}: ${text}` : text, aboutNode)
    setSending(false)
    if (res.ok) {
      setTurns(t => [...t, { from: 'nova', text: res.reply, ...(res.link ? { link: res.link } : {}) }])
      onReplied?.()
    } else {
      setError(res.message)
      setDraft(text)
    }
  }

  return (
    <div className={cn('rounded-2xl border border-white/8 bg-white/3', className)}>
      {turns.length > 0 && (
        <div className={cn('overflow-y-auto', roomy ? 'max-h-[min(30rem,52vh)] space-y-4 p-5' : 'max-h-80 space-y-3 p-4 sm:p-5')} aria-live="polite">
          {turns.map((turn, i) => (
            <div key={i} className={cn('flex', turn.from === 'you' && 'justify-end')}>
              <p className={cn(
                'whitespace-pre-wrap rounded-2xl',
                roomy ? 'max-w-[92%] px-4 py-3 text-[14.5px] leading-7' : 'max-w-[85%] px-3.5 py-2.5 text-sm leading-relaxed',
                turn.from === 'you' ? 'bg-keppel-400/15 text-foreground' : 'bg-white/5 text-foreground/85',
              )}>
                {turn.text}
                {/* Only a path on this site: the server names it, never a full address. */}
                {turn.link && turn.link.path.startsWith('/') && !turn.link.path.startsWith('//') && (
                  <Link href={turn.link.path} className="mt-2 block w-fit rounded-lg bg-action px-3 py-1.5 text-xs font-semibold text-action-foreground hover:bg-action-hover">{turn.link.label}</Link>
                )}
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

      {suggestions && suggestions.length > 0 && !turns.some(t => t.from === 'you') && (
        <div className={cn('flex flex-wrap gap-1.5 pb-0', roomy ? 'p-4' : 'p-2.5')} data-nova-suggestions>
          {suggestions.map(q => (
            <button key={q} type="button" disabled={sending} onClick={() => void send(null, q)}
              className="rounded-full border border-white/10 bg-white/4 px-2.5 py-1 text-xs text-foreground/75 transition-colors hover:border-keppel-400/40 hover:text-foreground disabled:opacity-50">{q}</button>
          ))}
        </div>
      )}
      <form onSubmit={send} className={cn('flex items-center gap-2 border-t border-white/8 first:border-t-0', roomy ? 'p-3' : 'p-2.5')}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={placeholder}
          maxLength={2000}
          aria-label="Message Nova"
          className={cn('min-w-0 flex-1 rounded-lg bg-transparent px-3 text-foreground placeholder:text-foreground/35 focus:outline-none', roomy ? 'h-12 text-[15px]' : 'h-10 text-sm')}
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          aria-label="Send"
          className={cn('inline-flex shrink-0 items-center justify-center bg-keppel-400 text-keppel-950 transition-colors hover:bg-keppel-300 disabled:opacity-40', roomy ? 'size-12 rounded-xl' : 'size-10 rounded-lg')}
        >
          <ArrowUp className="size-4" />
        </button>
      </form>
      {error && <p role="alert" className="px-4 pb-3 text-xs text-red-300">{error}</p>}
    </div>
  )
}
