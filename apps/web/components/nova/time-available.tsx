'use client'

import { cn } from '@/lib/utils'
import { minutesLabel } from './format'

const CHOICES = [20, 40, 60, 90]

type Props = {
  minutes:  number | null          // null: the student has not said
  onChange: (minutes: number | null) => void
  busy?:    boolean
}

// The student says how long they have; Nova's plan is fitted to it by the
// server. Unset means "no limit", which is also what the page starts with:
// nothing about availability is assumed.
export function TimeAvailable({ minutes, onChange, busy }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <p className="text-sm text-foreground/60" aria-live="polite">
        {minutes ? <>You have about <span className="text-foreground">{minutesLabel(minutes)}</span>.</> : 'How long do you have?'}
      </p>
      <div role="group" aria-label="Time available" className={cn('flex flex-wrap gap-1.5 transition-opacity', busy && 'opacity-60')}>
        {CHOICES.map(choice => (
          <Chip key={choice} active={minutes === choice} onClick={() => onChange(minutes === choice ? null : choice)}>
            {minutesLabel(choice)}
          </Chip>
        ))}
        {minutes !== null && <Chip active={false} onClick={() => onChange(null)}>No limit</Chip>}
      </div>
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'h-8 rounded-full border px-3 text-xs font-medium transition-colors',
        active
          ? 'border-keppel-400/60 bg-keppel-400/15 text-keppel-200'
          : 'border-white/10 text-foreground/60 hover:border-white/20 hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
