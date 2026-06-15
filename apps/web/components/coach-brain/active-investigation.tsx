'use client'

import { Search, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { CoachPageData } from './use-coach-data'

type Props = { activeInvestigation: CoachPageData['activeInvestigation']; loading: boolean }

const STATUS_CFG = {
  open:      { Icon: Search,       color: 'text-sky-400',    label: 'Open'      },
  resolved:  { Icon: CheckCircle2, color: 'text-emerald-400', label: 'Resolved' },
  abandoned: { Icon: XCircle,      color: 'text-white/30',   label: 'Abandoned' },
} as const

export function ActiveInvestigation({ activeInvestigation, loading }: Props) {
  if (loading) {
    return <div className="rounded-2xl border border-white/5 bg-white/3 h-36 animate-pulse" />
  }

  if (!activeInvestigation || activeInvestigation.status !== 'open') {
    return (
      <Card className="border-white/8 bg-slate-900/50 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Search className="w-4 h-4 text-white/20" />
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Investigation</p>
        </div>
        <p className="text-sm text-white/25">No active investigation.</p>
      </Card>
    )
  }

  const inv    = activeInvestigation
  const cfg    = STATUS_CFG[inv.status]
  const pct    = Math.round((inv.attemptCount / inv.maxAttempts) * 100)
  const evKeys = Object.keys(inv.evidenceCollected)

  return (
    <Card className="border-sky-500/20 bg-sky-500/5 p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-sky-500/10 flex items-center justify-center border border-sky-500/20">
            <cfg.Icon className={`w-4 h-4 ${cfg.color}`} />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider mb-0.5">Investigation</p>
            <p className="text-sm font-bold text-white">{inv.topic}</p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-[11px] font-semibold ${cfg.color}`}>{cfg.label}</p>
          <div className="flex items-center gap-1 mt-0.5 justify-end">
            <Clock className="w-3 h-3 text-white/25" />
            <span className="text-[10px] text-white/25">{inv.daysOpen}d open</span>
          </div>
        </div>
      </div>

      {/* Attempt progress */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] text-white/30 uppercase tracking-wider font-medium">Progress</span>
          <span className="text-[11px] text-white/40">
            Attempt {inv.attemptCount} of {inv.maxAttempts}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
          <div
            className="h-full rounded-full bg-sky-400/60 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Hypotheses */}
      {inv.hypotheses.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] font-semibold text-white/25 uppercase tracking-wider mb-1.5">What Rex thinks</p>
          {inv.hypotheses.map((h, i) => (
            <div key={i} className="flex items-start gap-2 mb-1">
              <div className="w-1 h-1 rounded-full bg-sky-400/60 mt-1.5 shrink-0" />
              <p className="text-[11px] text-white/55 leading-relaxed">{h}</p>
            </div>
          ))}
        </div>
      )}

      {/* Missing evidence */}
      {inv.missingData.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] font-semibold text-white/25 uppercase tracking-wider mb-1.5">Still needed</p>
          {inv.missingData.map((d, i) => (
            <div key={i} className="flex items-start gap-2 mb-1">
              <div className="w-1 h-1 rounded-full bg-amber-400/50 mt-1.5 shrink-0" />
              <p className="text-[11px] text-white/45 leading-relaxed">{d}</p>
            </div>
          ))}
        </div>
      )}

      {/* Evidence collected */}
      {evKeys.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-white/25 uppercase tracking-wider mb-1.5">Evidence collected</p>
          {evKeys.map(k => (
            <div key={k} className="flex items-start gap-2 mb-1">
              <div className="w-1 h-1 rounded-full bg-emerald-400/50 mt-1.5 shrink-0" />
              <p className="text-[11px] text-white/45 leading-relaxed">
                <span className="text-white/35 font-medium">{k}:</span> {inv.evidenceCollected[k]}
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
