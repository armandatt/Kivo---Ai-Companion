'use client'

import { useGoalsData }             from '@/components/goals/use-goals-data'
import { PrimaryGoal }              from '@/components/goals/primary-goal'
import { GoalForecast }             from '@/components/goals/goal-forecast'
import { RexVerdict }               from '@/components/goals/rex-verdict'
import { GoalHealth }               from '@/components/goals/goal-health'
import { BiggestLimiter }           from '@/components/goals/biggest-limiter'
import { WhatMustChange }           from '@/components/goals/what-must-change'
import { GoalRisks }                from '@/components/goals/goal-risks'
import { GoalTimeline }             from '@/components/goals/goal-timeline'
import { AlternativeScenarios }     from '@/components/goals/alternative-scenarios'
import { GoalHistory }              from '@/components/goals/goal-history'
import { Target, MessageSquare, Dumbbell } from 'lucide-react'

const BOT = process.env.NEXT_PUBLIC_BOT_USERNAME ?? 'kevo_companion_bot'

function NoGoalCallout() {
  return (
    <div className="border border-white/8 bg-slate-900/50 rounded-2xl p-5 flex items-start gap-3">
      <Target className="w-5 h-5 text-white/25 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-semibold text-white/60 mb-1">No goal set yet</p>
        <p className="text-[12px] text-white/35 leading-relaxed mb-3">
          Tell Rex what you&apos;re working toward and by when. Examples:
        </p>
        <ul className="text-[11px] text-white/30 space-y-1 mb-3">
          <li>• "I want to lose 8kg by August."</li>
          <li>• "Goal: bench 140kg by year end."</li>
          <li>• "Help me gain 5kg of muscle in 6 months."</li>
        </ul>
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

function NoSessionsCallout() {
  return (
    <div className="border border-white/8 bg-slate-900/50 rounded-2xl p-5 flex items-start gap-3">
      <Dumbbell className="w-5 h-5 text-white/25 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-semibold text-white/60 mb-1">Start logging workouts to unlock forecasting</p>
        <p className="text-[12px] text-white/35 leading-relaxed">
          Your goal is set but Rex needs workout data to forecast your pace. Log your first session with Rex to see projections and scenario modelling.
        </p>
      </div>
    </div>
  )
}

function NotConnectedCallout() {
  return (
    <div className="border border-white/8 bg-slate-900/50 rounded-2xl p-5">
      <p className="text-sm font-semibold text-white/60 mb-1">Connect Telegram to unlock goals</p>
      <p className="text-[12px] text-white/35 leading-relaxed">
        Goals forecasting requires Rex via Telegram. Connect in Settings to get started.
      </p>
    </div>
  )
}

export default function GoalsPage() {
  const { data, loading } = useGoalsData()

  const telegramConnected = data?.telegramConnected ?? false
  const isRexUser         = data?.isRexUser         ?? false
  const hasGoal           = data?.hasGoal            ?? false
  const hasSessions       = data?.hasSessions        ?? false

  return (
    <div className="w-full max-w-2xl mx-auto px-4 pt-6 pb-16 space-y-4">
      <div className="mb-2">
        <h1 className="text-lg font-bold text-white">Goals</h1>
        <p className="text-xs text-white/30 mt-0.5">Am I on track?</p>
      </div>

      {/* Not connected to Telegram */}
      {!loading && !telegramConnected && (
        <NotConnectedCallout />
      )}

      {/* S1 — Primary Goal */}
      <PrimaryGoal
        primaryGoal={data?.primaryGoal ?? null}
        loading={loading}
      />

      {/* No goal callout */}
      {!loading && telegramConnected && !hasGoal && (
        <NoGoalCallout />
      )}

      {/* LB3: Chat-only user with goal but no sessions */}
      {!loading && hasGoal && !hasSessions && (
        <NoSessionsCallout />
      )}

      {/* S2 — Forecast */}
      <GoalForecast
        forecast={data?.forecast ?? null}
        loading={loading}
      />

      {/* S10 — Rex's Verdict */}
      <RexVerdict
        verdict={data?.verdict ?? {
          headline: '—',
          detail:   'Loading goal data…',
          limiter:  null,
          outlook:  'neutral',
        }}
        loading={loading}
      />

      {/* S3 — Goal Health */}
      <GoalHealth
        goalHealth={data?.goalHealth ?? {
          recovery:    { status: 'watch', note: '—' },
          nutrition:   { status: 'watch', note: '—' },
          consistency: { status: 'watch', note: '—' },
          training:    { status: 'watch', note: '—' },
        }}
        loading={loading}
      />

      {/* S4 — Biggest Limiter */}
      <BiggestLimiter
        biggestLimiter={data?.biggestLimiter ?? null}
        loading={loading}
      />

      {/* S5 — What Must Change */}
      <WhatMustChange
        whatMustChange={data?.whatMustChange ?? null}
        loading={loading}
      />

      {/* S6 — Risks */}
      <GoalRisks
        risks={data?.risks ?? []}
        loading={loading}
      />

      {/* S7 — Goal Timeline */}
      <GoalTimeline
        timeline={data?.timeline ?? null}
        loading={loading}
      />

      {/* S8 — Alternative Scenarios */}
      <AlternativeScenarios
        scenarios={data?.scenarios ?? []}
        loading={loading}
      />

      {/* S9 — Goal History */}
      <GoalHistory
        goalHistory={data?.goalHistory ?? []}
        loading={loading}
      />
    </div>
  )
}
