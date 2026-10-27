'use client'

import { BookOpen } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { JourneyPageData } from './use-journey-data'

type Props = { story: JourneyPageData['story']; loading: boolean }

export function KivoStory({ story, loading }: Props) {
  if (loading) {
    return <div className="h-28 rounded-2xl border border-white/5 bg-white/3 animate-pulse" />
  }
  if (story.lines.length === 0) return null

  return (
    <Card className="border border-white/8 bg-slate-900/50 p-5">
      {/* accent bar */}
      <div className="w-6 h-1 rounded-full mb-4 bg-violet-400" />
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-xl bg-white/6 border border-white/10 flex items-center justify-center shrink-0">
          <BookOpen className="w-4 h-4 text-white/40" />
        </div>
        <div className="flex-1">
          <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider mb-3">
            Kivo&apos;s Story
          </p>
          <div className="space-y-2">
            {story.lines.map((line, i) => (
              <p
                key={i}
                className={`leading-relaxed ${
                  i === 0
                    ? 'text-sm font-semibold text-white/75'
                    : 'text-[12px] text-white/50'
                }`}
              >
                {line}
              </p>
            ))}
          </div>
        </div>
      </div>
    </Card>
  )
}
