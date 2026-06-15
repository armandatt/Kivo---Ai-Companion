'use client'

import { Dumbbell, Clock, ShieldCheck, ShieldAlert, ShieldOff, AlertCircle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { PlannerPageData, TrainingDayStatus } from './use-planner-data'

type Props = {
  today:             PlannerPageData['today'] | null
  telegramConnected: boolean
  loading:           boolean
}

function StatusPill({ status }: { status: TrainingDayStatus }) {
  const cfg: Record<TrainingDayStatus, { label: string; cls: string }> = {
    due:                  { label: 'Due today',          cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
    completed:            { label: 'Completed',          cls: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
    skipped:              { label: 'Skipped',            cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
    pending_confirmation: { label: 'Confirm session',    cls: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
    upcoming:             { label: 'Rest day',           cls: 'bg-white/5 text-white/40 border-white/10' },
    unknown:              { label: 'Not tracked',        cls: 'bg-white/5 text-white/20 border-white/8' },
  }
  const { label, cls } = cfg[status]
  return (
    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${cls}`}>
      {label}
    </span>
  )
}

function RecoveryIcon({ label }: { label: "ready" | "limited" | "rest" | null }) {
  if (label === 'ready')   return <ShieldCheck  className="w-4 h-4 text-emerald-400" />
  if (label === 'limited') return <ShieldAlert  className="w-4 h-4 text-amber-400" />
  if (label === 'rest')    return <ShieldOff    className="w-4 h-4 text-red-400" />
  return null
}

function recoveryColor(label: "ready" | "limited" | "rest" | null) {
  if (label === 'ready')   return 'text-emerald-400'
  if (label === 'limited') return 'text-amber-400'
  if (label === 'rest')    return 'text-red-400'
  return 'text-white/30'
}

function gymTimeLabel(minsUntilGym: number | null, gymTimeStr: string | null): string | null {
  if (minsUntilGym !== null) {
    if (minsUntilGym > 0) {
      const h = Math.floor(minsUntilGym / 60)
      const m = minsUntilGym % 60
      return h > 0 ? `${h}h ${m}m until gym` : `${m}m until gym`
    }
    if (minsUntilGym > -120) return 'Gym time — go'
    return null
  }
  return gymTimeStr ?? null
}

export function TodayCard({ today, telegramConnected, loading }: Props) {
  if (loading) {
    return <div className="rounded-2xl border border-white/5 bg-white/3 h-52 animate-pulse" />
  }

  if (!today || !telegramConnected) {
    return (
      <Card className="border-white/8 bg-slate-900/50 p-5">
        <p className="text-sm text-white/40">
          Connect Telegram to unlock scheduling insights.
        </p>
      </Card>
    )
  }

  const timeLabel = gymTimeLabel(today.minutesUntilGym, today.gymTimeStr)
  const recoveryCaption =
    today.recoveryStatusLabel === 'ready'   ? 'Ready to train' :
    today.recoveryStatusLabel === 'limited' ? 'Limited recovery' :
    today.recoveryStatusLabel === 'rest'    ? 'Rest required'   : null

  return (
    <Card className="border-white/8 bg-linear-to-br from-slate-900 to-slate-950 p-5 space-y-4">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
            <Dumbbell className="w-4.5 h-4.5 text-emerald-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] text-white/30 font-medium uppercase tracking-wider mb-0.5">Today</p>
            <p className="text-base font-bold text-white leading-tight truncate">
              {today.muscles ?? 'Rest Day'}
            </p>
          </div>
        </div>
        <StatusPill status={today.trainingStatus} />
      </div>

      {/* Rex directive */}
      <div className="flex items-start gap-2.5 bg-white/4 rounded-xl px-3.5 py-3">
        <AlertCircle className="w-3.5 h-3.5 text-white/30 mt-0.5 shrink-0" />
        <p className="text-sm text-white/70 leading-snug">{today.rexDirective}</p>
      </div>

      {/* Recovery + gym time row */}
      <div className="flex items-center gap-4">
        {today.recoveryStatusLabel && (
          <div className="flex items-center gap-1.5">
            <RecoveryIcon label={today.recoveryStatusLabel} />
            <span className={`text-xs font-medium ${recoveryColor(today.recoveryStatusLabel)}`}>
              {recoveryCaption}
            </span>
            {today.recoveryScore !== null && (
              <span className="text-[11px] text-white/30 tabular-nums">({today.recoveryScore})</span>
            )}
          </div>
        )}
        {timeLabel && (
          <div className="flex items-center gap-1.5 ml-auto">
            <Clock className="w-3.5 h-3.5 text-white/30" />
            <span className="text-xs text-white/40">{timeLabel}</span>
          </div>
        )}
      </div>

      {/* Recovery factors */}
      {today.recoveryFactors.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {today.recoveryFactors.map(f => (
            <span key={f} className="text-[10px] text-white/30 bg-white/5 px-2 py-0.5 rounded-full">
              {f}
            </span>
          ))}
        </div>
      )}

      {/* Avg duration */}
      {today.avgDurationMin > 0 && (
        <p className="text-[11px] text-white/20">
          Avg session: {today.avgDurationMin} min
        </p>
      )}
    </Card>
  )
}
