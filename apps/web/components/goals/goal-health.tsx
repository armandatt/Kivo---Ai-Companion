'use client'

import { Heart, Utensils, CalendarCheck, Dumbbell, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { GoalsPageData, HealthStatus } from './use-goals-data'

type Props = { goalHealth: GoalsPageData['goalHealth']; loading: boolean }

const STATUS_ICON = {
  healthy:  CheckCircle2,
  watch:    AlertTriangle,
  limiting: XCircle,
}

const STATUS_COLOR: Record<HealthStatus, string> = {
  healthy:  'text-emerald-400',
  watch:    'text-amber-400',
  limiting: 'text-red-400',
}

const STATUS_BG: Record<HealthStatus, string> = {
  healthy:  'bg-emerald-400/8 border-emerald-400/15',
  watch:    'bg-amber-400/8 border-amber-400/15',
  limiting: 'bg-red-400/8 border-red-400/15',
}

const STATUS_LABEL: Record<HealthStatus, string> = {
  healthy:  'Healthy',
  watch:    'Watch',
  limiting: 'Limiting',
}

type Pillar = {
  key:   keyof GoalsPageData['goalHealth']
  label: string
  Icon:  typeof Heart
}

const PILLARS: Pillar[] = [
  { key: 'recovery',    label: 'Recovery',    Icon: Heart },
  { key: 'nutrition',   label: 'Nutrition',   Icon: Utensils },
  { key: 'consistency', label: 'Consistency', Icon: CalendarCheck },
  { key: 'training',    label: 'Training',    Icon: Dumbbell },
]

export function GoalHealth({ goalHealth, loading }: Props) {
  if (loading) {
    return <div className="h-52 rounded-2xl border border-white/5 bg-white/3 animate-pulse" />
  }

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      <div className="flex items-center gap-2 mb-4">
        <CheckCircle2 className="w-4 h-4 text-white/30" />
        <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Goal Health</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {PILLARS.map(({ key, label, Icon }) => {
          const { status, note } = goalHealth[key]
          const SIcon  = STATUS_ICON[status]
          const color  = STATUS_COLOR[status]
          const bg     = STATUS_BG[status]
          const slabel = STATUS_LABEL[status]

          return (
            <div key={key} className={`rounded-xl border p-3 ${bg}`}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <Icon className={`w-3.5 h-3.5 ${color}`} />
                  <span className={`text-[11px] font-semibold ${color}`}>{label}</span>
                </div>
                <SIcon className={`w-3 h-3 ${color}`} />
              </div>
              <p className="text-[10px] text-white/40 leading-relaxed">{note}</p>
              <p className={`text-[10px] font-medium mt-1 ${color}`}>{slabel}</p>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
