'use client'

import { MessageSquare }      from 'lucide-react'
import { useJourneyData }     from '@/components/journey/use-journey-data'
import { JourneySummary }     from '@/components/journey/journey-summary'
import { JourneyTimeline }    from '@/components/journey/journey-timeline'
import { JourneyChapters }    from '@/components/journey/journey-chapters'
import { BiggestWins }        from '@/components/journey/biggest-wins'
import { Comebacks }          from '@/components/journey/comebacks'
import { Breakthroughs }      from '@/components/journey/breakthroughs'
import { MilestoneWall }      from '@/components/journey/milestone-wall'
import { YearInReview }       from '@/components/journey/year-in-review'
import { JourneyMemories }    from '@/components/journey/journey-memories'
import { KivoStory }          from '@/components/journey/kivo-story'

const BOT = process.env.NEXT_PUBLIC_BOT_USERNAME ?? 'kevo_companion_bot'

function NotConnectedCallout() {
  return (
    <div className="border border-white/8 bg-slate-900/50 rounded-2xl p-5">
      <p className="text-sm font-semibold text-white/60 mb-1">Connect Telegram to unlock your journey</p>
      <p className="text-[12px] text-white/35 leading-relaxed">
        Your fitness story lives in Rex. Connect via Telegram to start writing it.
      </p>
    </div>
  )
}

function NoDataCallout() {
  return (
    <div className="border border-white/8 bg-slate-900/50 rounded-2xl p-5 flex items-start gap-3">
      <MessageSquare className="w-5 h-5 text-white/25 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-semibold text-white/60 mb-1">Your story hasn&apos;t started yet</p>
        <p className="text-[12px] text-white/35 leading-relaxed mb-3">
          Log your first workout with Rex and come back here — this page fills in as you train.
        </p>
        <a
          href={`https://t.me/${BOT}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-sky-400 hover:text-sky-300 transition-colors"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Open Rex in Telegram
        </a>
      </div>
    </div>
  )
}

export default function JourneyPage() {
  const { data, loading } = useJourneyData()

  const telegramConnected = data?.telegramConnected ?? false
  const hasAnyData        = data?.hasAnyData        ?? false

  return (
    <div className="w-full max-w-2xl mx-auto px-4 pt-6 pb-16 space-y-4">
      <div className="mb-2">
        <h1 className="text-lg font-bold text-white">Journey</h1>
        <p className="text-xs text-white/30 mt-0.5">Your fitness story</p>
      </div>

      {/* Not connected */}
      {!loading && !telegramConnected && <NotConnectedCallout />}

      {/* No data yet */}
      {!loading && telegramConnected && !hasAnyData && <NoDataCallout />}

      {/* S1 — Journey Summary */}
      <JourneySummary
        summary={data?.summary ?? {
          daysWithKivo: 0, sessionsCompleted: 0, weightChangeTotalKg: null,
          strengthChangeSummary: null, longestStreak: 0, currentStreak: 0,
          joinedDate: new Date().toISOString().slice(0, 10), latestSessionDate: null,
        }}
        loading={loading}
      />

      {/* S10 — Kivo Story (high up — narrative hook) */}
      <KivoStory story={data?.story ?? { lines: [] }} loading={loading} />

      {/* S4 — Biggest Wins */}
      <BiggestWins biggestWins={data?.biggestWins ?? []} loading={loading} />

      {/* S3 — Chapters */}
      <JourneyChapters chapters={data?.chapters ?? []} loading={loading} />

      {/* S7 — Milestone Wall */}
      <MilestoneWall milestones={data?.milestones ?? []} loading={loading} />

      {/* S5 — Comebacks */}
      <Comebacks comebacks={data?.comebacks ?? []} loading={loading} />

      {/* S6 — Breakthroughs */}
      <Breakthroughs breakthroughs={data?.breakthroughs ?? []} loading={loading} />

      {/* S8 — Year In Review */}
      <YearInReview
        yearInReview={data?.yearInReview ?? {
          thisMonth:   { sessions: 0, weightDelta: null, topLiftLabel: null },
          last3Months: { sessions: 0, weightDelta: null, topLiftLabel: null },
          allTime:     { sessions: 0, weightDeltaKg: null, longestStreak: 0, totalPRs: 0 },
        }}
        loading={loading}
      />

      {/* S9 — Memories */}
      <JourneyMemories memories={data?.memories ?? []} loading={loading} />

      {/* S2 — Timeline (at bottom — chronological story) */}
      <JourneyTimeline timeline={data?.timeline ?? []} loading={loading} />
    </div>
  )
}
