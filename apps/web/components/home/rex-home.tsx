'use client'

import { TelegramConnect } from '@/components/home/telegram-connect'
import { HeroCard }        from '@/components/home/hero-card'
import { TodaysMission }   from '@/components/home/todays-mission'
import { Bottleneck }      from '@/components/home/bottleneck'
import { Momentum }        from '@/components/home/momentum'
import { QuickStats }      from '@/components/home/quick-stats'
import { AskRex }          from '@/components/home/ask-rex'
import { useHomeData }     from '@/components/home/use-home-data'

// Home for a Rex account. Unchanged; it moved here when Home learned to
// render Nova for Nova learners.
export function RexHome() {
  const { data, loading } = useHomeData()

  return (
    <div className="w-full max-w-2xl mx-auto px-4 pt-6 pb-16 space-y-4">
      <TelegramConnect />

      <HeroCard
        hero={data?.hero ?? null}
        loading={loading}
      />

      <TodaysMission
        mission={data?.mission ?? null}
        loading={loading}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Bottleneck bottleneck={data?.bottleneck ?? null} loading={loading} />
        <Momentum   momentum={data?.momentum    ?? null} loading={loading} />
      </div>

      <QuickStats stats={data?.stats ?? null} loading={loading} />

      <AskRex
        chat={data?.chat ?? null}
        telegramConnected={data?.telegramConnected ?? false}
        loading={loading}
      />
    </div>
  )
}
