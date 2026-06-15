'use client'

import { ShieldCheck, ShieldAlert, ShieldOff } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { LineChart, Line, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import type { ProgressPageData } from './use-progress-data'

type Props = { recoveryTrend: ProgressPageData['recoveryTrend']; loading: boolean }

const STATUS_CFG = {
  ready:   { Icon: ShieldCheck, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', label: 'Ready' },
  limited: { Icon: ShieldAlert, color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/20',   label: 'Limited' },
  rest:    { Icon: ShieldOff,   color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/20',     label: 'Rest' },
} as const

function ScoreBar({ value, label, invert = false }: { value: number; label: string; invert?: boolean }) {
  const color = invert
    ? value >= 70 ? 'bg-red-500' : value >= 50 ? 'bg-amber-500' : 'bg-emerald-500'
    : value >= 70 ? 'bg-emerald-500' : value >= 40 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-white/30 w-20 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-white/8 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <span className="text-[10px] text-white/40 tabular-nums w-7 text-right shrink-0">{Math.round(value)}</span>
    </div>
  )
}

export function RecoveryTrend({ recoveryTrend, loading }: Props) {
  if (loading) {
    return <div className="h-56 rounded-2xl border border-white/5 bg-white/3 animate-pulse" />
  }

  if (!recoveryTrend) {
    return (
      <Card className="border-white/8 bg-slate-900/50 p-5">
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck className="w-4 h-4 text-white/20" />
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Recovery</p>
        </div>
        <p className="text-sm text-white/25">No recovery data yet.</p>
      </Card>
    )
  }

  const { currentScore, status, factors, history, burnoutRisk, motivation, momentum } = recoveryTrend
  const cfg = STATUS_CFG[status]

  // Build burnout history chart (inverted to show as "wellbeing")
  const chartData = history.map(s => ({
    date:      new Date(s.timestamp).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
    burnout:   Math.round(s.burnoutRisk),
    wellbeing: Math.round(100 - s.burnoutRisk),
  }))

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-white/30" />
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Recovery</p>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${cfg.bg} ${cfg.border}`}>
          <cfg.Icon className={`w-3 h-3 ${cfg.color}`} />
          <span className={`text-[10px] font-semibold ${cfg.color}`}>{cfg.label}</span>
        </div>
      </div>

      {/* Score */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 h-2.5 rounded-full bg-white/8 overflow-hidden">
          <div
            className={`h-full rounded-full ${currentScore >= 70 ? 'bg-emerald-500' : currentScore >= 45 ? 'bg-amber-500' : 'bg-red-500'}`}
            style={{ width: `${currentScore}%` }}
          />
        </div>
        <span className="text-sm font-bold text-white tabular-nums">{Math.round(currentScore)}/100</span>
      </div>

      {/* Wellbeing history chart (when we have data) */}
      {chartData.length >= 2 && (
        <div className="h-24 -mx-1 mb-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 10 }}
                labelStyle={{ color: 'rgba(255,255,255,0.3)' }}
                itemStyle={{ color: '#f59e0b' }}
                formatter={(v: number) => [`${v}`, 'Burnout risk']}
              />
              <ReferenceLine y={70} stroke="rgba(239,68,68,0.2)" strokeDasharray="3 3" />
              <Line type="monotone" dataKey="burnout" stroke="#f59e0b" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
          <p className="text-[9px] text-white/20 text-center -mt-1">Burnout risk over time</p>
        </div>
      )}

      {/* Mentor scores */}
      <div className="space-y-2 mb-4">
        <ScoreBar value={motivation}  label="Motivation" />
        <ScoreBar value={momentum}    label="Momentum" />
        <ScoreBar value={burnoutRisk} label="Burnout risk" invert />
      </div>

      {/* Factors */}
      {factors.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-white/25 uppercase tracking-wider mb-2">Key factors</p>
          <div className="space-y-1">
            {factors.slice(0, 3).map((f, i) => (
              <p key={i} className="text-[11px] text-white/40">· {f}</p>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
