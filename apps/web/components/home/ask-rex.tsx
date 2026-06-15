'use client'

import { MessageSquare } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { TELEGRAM_BOT_URL } from '@/lib/telegram'
import type { HomePageData } from './use-home-data'

type Props = {
  chat:              HomePageData['chat'] | null
  telegramConnected: boolean
  loading:           boolean
}

export function AskRex({ chat, telegramConnected, loading }: Props) {
  if (loading) {
    return <div className="rounded-2xl border border-white/5 bg-white/3 h-28 animate-pulse" />
  }

  if (!telegramConnected) return null

  const lastMessage = chat?.lastMessage ?? null
  const ts = lastMessage
    ? new Date(lastMessage.timestamp).toLocaleString('en', {
        weekday: 'short', hour: '2-digit', minute: '2-digit',
      })
    : null

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">Ask Rex</h3>
        <a
          href={TELEGRAM_BOT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Open chat
        </a>
      </div>

      {lastMessage ? (
        <a
          href={TELEGRAM_BOT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="block bg-white/4 hover:bg-white/6 transition-colors rounded-lg px-3 py-2.5"
        >
          <p className="text-xs text-white/45 leading-relaxed line-clamp-3">{lastMessage.text}</p>
          {ts && <p className="text-[10px] text-white/20 mt-1.5">{ts}</p>}
        </a>
      ) : (
        <p className="text-sm text-white/20">No messages yet. Start a conversation on Telegram.</p>
      )}
    </Card>
  )
}
