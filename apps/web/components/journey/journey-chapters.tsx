'use client'

import { Card } from '@/components/ui/card'
import type { JourneyPageData, ChapterType } from './use-journey-data'

type Props = { chapters: JourneyPageData['chapters']; loading: boolean }

const CHAPTER_COLORS: Record<ChapterType, { bar: string; badge: string; label: string }> = {
  start:       { bar: 'bg-sky-400',     badge: 'bg-sky-400/10 text-sky-300',      label: 'Start'       },
  consistency: { bar: 'bg-violet-400',  badge: 'bg-violet-400/10 text-violet-300', label: 'Consistency' },
  strength:    { bar: 'bg-amber-400',   badge: 'bg-amber-400/10 text-amber-300',   label: 'Strength'    },
  bulk:        { bar: 'bg-emerald-400', badge: 'bg-emerald-400/10 text-emerald-300', label: 'Bulk'      },
  cut:         { bar: 'bg-orange-400',  badge: 'bg-orange-400/10 text-orange-300', label: 'Cut'         },
  comeback:    { bar: 'bg-pink-400',    badge: 'bg-pink-400/10 text-pink-300',     label: 'Comeback'    },
  recovery:    { bar: 'bg-white/20',    badge: 'bg-white/8 text-white/40',         label: 'Recovery'    },
  maintenance: { bar: 'bg-white/15',    badge: 'bg-white/6 text-white/30',         label: 'Maintenance' },
}

function fmtRange(start: string, end: string) {
  const s = new Date(start).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
  const e = new Date(end).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
  return s === e ? s : `${s} – ${e}`
}

export function JourneyChapters({ chapters, loading }: Props) {
  if (loading) {
    return <div className="h-40 rounded-2xl border border-white/5 bg-white/3 animate-pulse" />
  }
  if (chapters.length === 0) return null

  return (
    <Card className="border border-white/8 bg-slate-900/50 p-5">
      <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider mb-4">Chapters</p>
      <div className="space-y-3">
        {chapters.map((ch, i) => {
          const cfg = CHAPTER_COLORS[ch.type]
          return (
            <div key={i} className="flex items-start gap-3">
              <div className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${cfg.bar}`} />
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[12px] font-semibold text-white/80">{ch.title}</p>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${cfg.badge}`}>
                    {cfg.label}
                  </span>
                  <span className="text-[10px] text-white/25 ml-auto">{fmtRange(ch.startDate, ch.endDate)}</span>
                </div>
                <p className="text-[11px] text-white/35 mt-0.5">{ch.summary}</p>
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
