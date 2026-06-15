'use client'

import { AlertTriangle, TrendingDown, ShieldAlert, Utensils, CheckCircle2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { HomePageData } from './use-home-data'

type BottleneckData = NonNullable<HomePageData['bottleneck']>

const LIMITER_CONFIG = {
  recovery:   { Icon: ShieldAlert,   color: 'text-red-400',    label: 'Recovery'    },
  training:   { Icon: TrendingDown,  color: 'text-amber-400',  label: 'Training'    },
  nutrition:  { Icon: Utensils,      color: 'text-orange-400', label: 'Nutrition'   },
  adherence:  { Icon: AlertTriangle, color: 'text-yellow-400', label: 'Consistency' },
  unknown:    { Icon: CheckCircle2,  color: 'text-white/30',   label: 'None'        },
} as const

const STATUS_COLOR = {
  critical: 'text-red-400',
  behind:   'text-amber-400',
  on_track: 'text-emerald-400',
  unknown:  'text-white/30',
} as const

type Props = { bottleneck: HomePageData['bottleneck']; loading: boolean }

export function Bottleneck({ bottleneck, loading }: Props) {
  if (loading) {
    return <div className="rounded-2xl border border-white/5 bg-white/3 h-36 animate-pulse" />
  }

  if (!bottleneck || bottleneck.overallStatus === 'on_track') {
    return (
      <Card className="border-white/8 bg-slate-900/50 p-5">
        <h3 className="text-sm font-semibold text-white mb-3">Bottleneck</h3>
        <div className="flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <p className="text-sm text-white/40">On track. No blockers.</p>
        </div>
      </Card>
    )
  }

  const cfg         = LIMITER_CONFIG[bottleneck.primaryLimiter]
  const statusColor = STATUS_COLOR[bottleneck.overallStatus]

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">Bottleneck</h3>
        <span className={`text-xs font-medium capitalize ${statusColor}`}>
          {bottleneck.overallStatus.replace('_', ' ')}
        </span>
      </div>

      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-white/5 shrink-0">
          <cfg.Icon className={`w-4 h-4 ${cfg.color}`} />
        </div>
        <div className="min-w-0">
          <p className={`text-sm font-semibold ${cfg.color}`}>{cfg.label}</p>
          <p className="text-xs text-white/35 mt-0.5 leading-relaxed">{bottleneck.narrative}</p>

          {/* Recovery factors — shown only when recovery is the limiter */}
          {bottleneck.primaryLimiter === 'recovery' && bottleneck.recoveryFactors.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {bottleneck.recoveryFactors.slice(0, 2).map((f, i) => (
                <p key={i} className="text-[10px] text-white/25">{f}</p>
              ))}
            </div>
          )}

          {/* Recovery score badge */}
          {bottleneck.recoveryScore !== null && (
            <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/5">
              <div className={[
                'w-1.5 h-1.5 rounded-full',
                bottleneck.recoveryStatusLabel === 'rest'    ? 'bg-red-400'    :
                bottleneck.recoveryStatusLabel === 'limited' ? 'bg-amber-400'  :
                                                               'bg-emerald-400',
              ].join(' ')} />
              <span className="text-[10px] text-white/40 capitalize">
                Recovery {bottleneck.recoveryStatusLabel ?? '—'} · {bottleneck.recoveryScore}/100
              </span>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
