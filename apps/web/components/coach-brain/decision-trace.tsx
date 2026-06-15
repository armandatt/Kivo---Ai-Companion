'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Lock } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { CoachPageData } from './use-coach-data'

type Props = { decisionTrace: CoachPageData['decisionTrace']; loading: boolean }

const STEP_COLOR = {
  positive: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/8',
  warning:  'text-amber-400 border-amber-500/30 bg-amber-500/8',
  critical: 'text-red-400 border-red-500/30 bg-red-500/8',
  neutral:  'text-white/40 border-white/10 bg-white/4',
} as const

const STEP_DOT = {
  positive: 'bg-emerald-400',
  warning:  'bg-amber-400',
  critical: 'bg-red-400',
  neutral:  'bg-white/25',
} as const

function ScoreBar({ value, label }: { value: number; label: string }) {
  const isHighBad = label === 'Burnout' || label === 'Stress'
  const color = isHighBad
    ? value >= 70 ? 'bg-red-500' : value >= 50 ? 'bg-amber-500' : 'bg-emerald-500'
    : value >= 70 ? 'bg-emerald-500' : value >= 40 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[10px] text-white/30 w-18 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-white/8 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-[10px] text-white/40 tabular-nums w-7 text-right shrink-0">{value}</span>
    </div>
  )
}

export function DecisionTrace({ decisionTrace, loading }: Props) {
  const [open, setOpen] = useState(false)

  if (loading) return null

  const { steps, activeConstraints, mentorScores, activeFlags } = decisionTrace

  return (
    <Card className="border-white/8 bg-slate-900/50 overflow-hidden">
      {/* Toggle */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between p-5 text-left hover:bg-white/2 transition-colors"
      >
        <div>
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Decision Trace</p>
          <p className="text-[10px] text-white/20 mt-0.5">How Rex arrived at its conclusion</p>
        </div>
        {open
          ? <ChevronDown className="w-4 h-4 text-white/30" />
          : <ChevronRight className="w-4 h-4 text-white/30" />
        }
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-5 border-t border-white/5">
          {/* Decision chain */}
          {steps.length > 0 && (
            <div className="pt-4">
              <p className="text-[10px] font-semibold text-white/25 uppercase tracking-wider mb-3">Decision chain</p>
              <div className="space-y-2">
                {steps.map((step, i) => (
                  <div key={step.label} className="flex items-center gap-3">
                    <div className="flex flex-col items-center">
                      <div className={`w-2 h-2 rounded-full ${STEP_DOT[step.status]}`} />
                      {i < steps.length - 1 && (
                        <div className="w-px h-4 bg-white/10 mt-0.5" />
                      )}
                    </div>
                    <div className={`flex-1 flex items-center justify-between rounded-lg border px-3 py-2 ${STEP_COLOR[step.status]}`}>
                      <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">{step.label}</span>
                      <span className={`text-[11px] font-medium capitalize ${STEP_COLOR[step.status].split(' ')[0]}`}>
                        {step.value}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active constraints */}
          {activeConstraints.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-white/25 uppercase tracking-wider mb-2">Active constraints</p>
              <div className="space-y-1.5">
                {activeConstraints.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Lock className="w-3 h-3 text-red-400/70 shrink-0" />
                    <p className="text-[11px] text-white/45">{c}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Mentor scores */}
          <div>
            <p className="text-[10px] font-semibold text-white/25 uppercase tracking-wider mb-3">Mentor scores</p>
            <div className="space-y-2">
              <ScoreBar value={mentorScores.motivation}  label="Motivation" />
              <ScoreBar value={mentorScores.consistency} label="Consistency" />
              <ScoreBar value={mentorScores.discipline}  label="Discipline" />
              <ScoreBar value={mentorScores.momentum}    label="Momentum" />
              <ScoreBar value={mentorScores.capacity}    label="Capacity" />
              <ScoreBar value={mentorScores.burnoutRisk} label="Burnout" />
              <ScoreBar value={mentorScores.stress}      label="Stress" />
            </div>
          </div>

          {/* Active flags */}
          {activeFlags.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-white/25 uppercase tracking-wider mb-2">State flags</p>
              <div className="flex flex-wrap gap-1.5">
                {activeFlags.map(f => (
                  <span key={f} className="text-[9px] font-medium text-white/35 bg-white/5 border border-white/8 px-2 py-0.5 rounded-full">
                    {f.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
