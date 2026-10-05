'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { minutesLabel } from './format'

const DEFAULT_CHOICES = [20, 40, 60, 90]
const MIN_CUSTOM = 5
const MAX_CUSTOM = 600

type Props = {
  minutes:      number | null          // null: the student has not said
  onChange:     (minutes: number | null) => void
  busy?:        boolean
  choices?:     number[]
  allowCustom?: boolean
}

// The student says how long they have; Nova's plan is fitted to it by the
// server. Unset means "no limit", which is also what the page starts with:
// nothing about availability is assumed.
export function TimeAvailable({ minutes, onChange, busy, choices = DEFAULT_CHOICES, allowCustom = false }: Props) {
  const [customOpen, setCustomOpen] = useState(false)
  const [draft, setDraft]           = useState('')
  const isCustom = minutes !== null && !choices.includes(minutes)

  function submitCustom(e: React.FormEvent) {
    e.preventDefault()
    const value = Math.round(Number(draft))
    if (!Number.isFinite(value) || value < MIN_CUSTOM) return
    onChange(Math.min(value, MAX_CUSTOM))
    setCustomOpen(false)
    setDraft('')
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <p className="text-sm text-foreground/60" aria-live="polite">
        {minutes ? <>You have about <span className="text-foreground">{minutesLabel(minutes)}</span>.</> : 'How long do you have?'}
      </p>
      <div role="group" aria-label="Time available" className={cn('flex flex-wrap items-center gap-1.5 transition-opacity', busy && 'opacity-60')}>
        {choices.map(choice => (
          <Chip key={choice} active={minutes === choice} onClick={() => onChange(minutes === choice ? null : choice)}>
            {minutesLabel(choice)}
          </Chip>
        ))}
        {allowCustom && (customOpen ? (
          <form onSubmit={submitCustom} className="flex items-center gap-1.5">
            <input
              autoFocus
              inputMode="numeric"
              value={draft}
              onChange={e => setDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
              onBlur={() => { if (!draft) setCustomOpen(false) }}
              placeholder="min"
              aria-label="Minutes available"
              className="h-8 w-16 rounded-full border border-keppel-400/50 bg-transparent px-3 text-xs text-foreground placeholder:text-foreground/35 focus:outline-none"
            />
            <button type="submit" className="h-8 rounded-full border border-white/10 px-3 text-xs font-medium text-foreground/70 hover:text-foreground">Set</button>
          </form>
        ) : (
          <Chip active={isCustom} onClick={() => setCustomOpen(true)}>
            {isCustom ? minutesLabel(minutes) : 'Custom'}
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
