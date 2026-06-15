'use client'

import { ShieldCheck, ShieldAlert, ShieldOff, Lock } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { CoachPageData } from './use-coach-data'

type Props = { recovery: CoachPageData['recovery']; loading: boolean }

function StatusIcon({ status }: { status: "ready" | "limited" | "rest" | null }) {
  if (status === 'ready')   return <ShieldCheck  className="w-5 h-5 text-emerald-400" />
  if (status === 'limited') return <ShieldAlert  className="w-5 h-5 text-amber-400" />
  if (status === 'rest')    return <ShieldOff    className="w-5 h-5 text-red-400" />
  return <ShieldCheck className="w-5 h-5 text-white/20" />
}

function statusColor(s: "ready" | "limited" | "rest" | null) {
  if (s === 'ready')   return 'text-emerald-400'
  if (s === 'limited') return 'text-amber-400'
  if (s === 'rest')    return 'text-red-400'
  return 'text-white/30'
}

function scoreColor(score: number) {
  if (score >= 80) return 'text-emerald-400'
  if (score >= 50) return 'text-amber-400'
  return 'text-red-400'
}

function ScoreBar({ score }: { score: number }) {
  const w = Math.min(100, score)
  const color = score >= 80 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="h-2 rounded-full bg-white/8 overflow-hidden">
      <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${w}%` }} />
    </div>
  )
}

function ConstraintTag({ label, active }: { label: string; active: boolean }) {
  if (!active) return null
  return (
    <div className="flex items-center gap-1.5 bg-red-500/10 border border-red-500/20 rounded-lg px-2.5 py-1.5">
      <Lock className="w-3 h-3 text-red-400 shrink-0" />
      <span className="text-[10px] text-red-400 font-medium">{label}</span>
    </div>
  )
}

export function RecoveryAnalysis({ recovery, loading }: Props) {
  if (loading) {
    return <div className="rounded-2xl border border-white/5 bg-white/3 h-44 animate-pulse" />
  }

  const hc = recovery.hardConstraints
  const anyConstraint = hc.noChallenge || hc.noAccountability || hc.noPlan || hc.trainingBlocked || hc.intensityReduced

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Recovery</p>
        <div className="flex items-center gap-2">
          <StatusIcon status={recovery.status} />
          <span className={`text-sm font-bold capitalize ${statusColor(recovery.status)}`}>
            {recovery.status ?? 'Not assessed'}
          </span>
        </div>
      </div>

      {/* Score */}
      {recovery.score !== null && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] text-white/40">Recovery score</span>
            <span className={`text-lg font-bold tabular-nums ${scoreColor(recovery.score)}`}>
              {recovery.score}<span className="text-xs text-white/25">/100</span>
            </span>
          </div>
          <ScoreBar score={recovery.score} />
        </div>
      )}

      {/* Constraint level */}
      {recovery.constraintLevel && (
        <p className="text-[11px] text-white/35 mb-4 capitalize">
          Constraint: <span className="font-medium text-white/55">{recovery.constraintLevel.replace('_', ' ')}</span>
        </p>
      )}

      {/* Factors */}
      {recovery.factors.length > 0 && (
        <div className="mb-4">
          <p className="text-[10px] font-semibold text-white/25 uppercase tracking-wider mb-2">Factors</p>
          <div className="space-y-1.5">
            {recovery.factors.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-1 h-1 rounded-full bg-white/30 shrink-0" />
                <p className="text-[11px] text-white/50">{f}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hard constraints */}
      {anyConstraint && (
        <div>
          <p className="text-[10px] font-semibold text-white/25 uppercase tracking-wider mb-2">Active Constraints</p>
          <div className="flex flex-wrap gap-2">
            <ConstraintTag label="Training blocked"      active={hc.trainingBlocked} />
            <ConstraintTag label="Intensity reduced"     active={hc.intensityReduced && !hc.trainingBlocked} />
            <ConstraintTag label="No challenge"          active={hc.noChallenge} />
            <ConstraintTag label="No accountability"     active={hc.noAccountability} />
            <ConstraintTag label="No new plans"          active={hc.noPlan} />
            {hc.toneFloor && (
              <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1.5">
                <span className="text-[10px] text-amber-400 font-medium capitalize">
                  Tone floor: {hc.toneFloor}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {!recovery.score && !anyConstraint && (
        <p className="text-sm text-white/25">No recovery data yet. Log sessions to enable recovery tracking.</p>
      )}
    </Card>
  )
}
