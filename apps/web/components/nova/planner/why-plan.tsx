'use client'

import type { NovaPlannerReady } from '@repo/api/nova/product/planner.types'
import { minutesLabel, sentenceCase } from '../format'

// Why the plan looks the way it does. Every line is a fact the server sent:
// the rule that set today's length, what changed it, and the evidence behind
// each subject's share of the time.
export function WhyPlan({ reasoning }: { reasoning: NovaPlannerReady['reasoning'] }) {
  const { budget, adjustments, subjects, constraints, assumptions } = reasoning

  return (
    <section aria-labelledby="planner-why" className="rounded-2xl border border-white/8 bg-card/50 p-5">
      <h2 id="planner-why" className="text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">Why this plan</h2>

      <div className="mt-4" data-section="adjustments">
        {adjustments.length > 0 ? (
          <ul className="space-y-2.5">
            {adjustments.map(a => (
              <li key={a.text} data-adjustment={a.kind} className="flex gap-2.5 text-sm leading-relaxed text-foreground/80">
                <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-keppel-400/80" />
                {a.text}
              </li>
            ))}
          </ul>
        ) : budget.plannedMinutes === 0 ? (
          <p className="text-sm leading-relaxed text-foreground/60">There is no plan to explain yet.</p>
        ) : (
          <p className="text-sm leading-relaxed text-foreground/60">
            No adjustments today. This is your usual day: {minutesLabel(budget.usualMinutes)} of study time, filled in priority order.
          </p>
        )}
      </div>

      {subjects.length > 0 && (
        <div className="mt-6 border-t border-white/8 pt-5" data-section="subjects">
          <h3 className="text-xs font-medium text-foreground/55">Where the time goes</h3>
          <ul className="mt-3 space-y-4">
            {subjects.map(s => (
              <li key={s.subjectName} data-subject={s.subjectName}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-sm font-medium text-foreground/90">{s.subjectName}</p>
                  <p className="shrink-0 text-xs tabular-nums text-foreground/55">{minutesLabel(s.minutes)} · {s.sharePercent}%</p>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/6" aria-hidden>
                  <div className="h-full rounded-full bg-keppel-400/70" style={{ width: `${s.sharePercent}%` }} />
                </div>
                {s.reasons.length > 0 && (
                  <p className="mt-1.5 text-xs leading-relaxed text-foreground/50">{s.reasons.map(sentenceCase).join(' · ')}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {constraints.length > 0 && (
        <div className="mt-6 border-t border-white/8 pt-5" data-section="constraints">
          <h3 className="text-xs font-medium text-foreground/55">Nova is accounting for</h3>
          <ul className="mt-2 space-y-1.5">
            {constraints.map(c => (
              <li key={`${c.category}:${c.description}`} className="text-sm leading-relaxed text-foreground/70">{c.description}</li>
            ))}
          </ul>
        </div>
      )}

      {assumptions.length > 0 && (
        <div className="mt-6 border-t border-white/8 pt-5" data-section="assumptions">
          <h3 className="text-xs font-medium text-foreground/55">The plan assumes</h3>
          <ul className="mt-2 space-y-1.5">
            {assumptions.map(a => <li key={a} className="text-sm leading-relaxed text-foreground/60">{a}</li>)}
          </ul>
        </div>
      )}
    </section>
  )
}
