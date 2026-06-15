'use client'

import { BookMarked, Clock } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { CoachPageData } from './use-coach-data'

type Props = { activeMemories: CoachPageData['activeMemories']; loading: boolean }

const TYPE_LABEL: Record<string, string> = {
  promise:            'Promise',
  commitment:         'Commitment',
  goal:               'Goal',
  achievement:        'Achievement',
  excuse_pattern:     'Excuse pattern',
  anchor:             'Anchor',
  preference:         'Preference',
  injury:             'Injury',
  nutrition_adherence: 'Nutrition',
}

const TYPE_COLOR: Record<string, string> = {
  promise:            'text-violet-400 bg-violet-400/10 border-violet-400/25',
  commitment:         'text-sky-400 bg-sky-400/10 border-sky-400/25',
  goal:               'text-emerald-400 bg-emerald-400/10 border-emerald-400/25',
  achievement:        'text-amber-400 bg-amber-400/10 border-amber-400/25',
  excuse_pattern:     'text-red-400 bg-red-400/10 border-red-400/25',
  anchor:             'text-white/50 bg-white/5 border-white/10',
  preference:         'text-white/40 bg-white/5 border-white/10',
  injury:             'text-orange-400 bg-orange-400/10 border-orange-400/25',
  nutrition_adherence: 'text-teal-400 bg-teal-400/10 border-teal-400/25',
}

const IMPORTANCE_DOT: Record<string, string> = {
  high:   'bg-red-400',
  medium: 'bg-amber-400',
  low:    'bg-white/25',
}

function ageLabel(ageHours: number): string {
  if (ageHours < 24)   return `${ageHours}h ago`
  const days = Math.floor(ageHours / 24)
  if (days < 7)        return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}

export function MemoryBoard({ activeMemories, loading }: Props) {
  if (loading) {
    return <div className="rounded-2xl border border-white/5 bg-white/3 h-44 animate-pulse" />
  }

  if (activeMemories.length === 0) {
    return (
      <Card className="border-white/8 bg-slate-900/50 p-5">
        <div className="flex items-center gap-2 mb-2">
          <BookMarked className="w-4 h-4 text-white/20" />
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Memory</p>
        </div>
        <p className="text-sm text-white/25">No coaching memories stored yet.</p>
      </Card>
    )
  }

  return (
    <Card className="border-white/8 bg-slate-900/50 p-5">
      <div className="flex items-center gap-2 mb-4">
        <BookMarked className="w-4 h-4 text-white/30" />
        <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider">Memory</p>
        <span className="ml-auto text-[10px] text-white/20">{activeMemories.length} active</span>
      </div>

      <div className="space-y-3">
        {activeMemories.map(m => {
          const typeColor = TYPE_COLOR[m.type] ?? 'text-white/30 bg-white/5 border-white/10'
          const typeLabel = TYPE_LABEL[m.type] ?? m.type.replace('_', ' ')

          return (
            <div key={m.id} className="border-b border-white/5 last:border-0 pb-3 last:pb-0">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${IMPORTANCE_DOT[m.importanceLabel]}`} />
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border capitalize ${typeColor}`}>
                    {typeLabel}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Clock className="w-3 h-3 text-white/20" />
                  <span className="text-[10px] text-white/25">{ageLabel(m.ageHours)}</span>
                </div>
              </div>
              <p className="text-[11px] text-white/65 leading-relaxed mb-1 pl-3.5">{m.value}</p>
              <p className="text-[10px] text-white/25 italic pl-3.5">{m.whySurfaced}</p>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
