import Link from 'next/link'
import type { PlanShortfallView, ShortfallChoiceKind } from '@repo/api/nova/product/today.types'

// "This does not fit", as the server worked it out. Nova never lengthens a
// day to make an exam fit: it says what is short and what the learner can do.
// Every sentence and figure here is the server's; the page adds only where a
// choice leads.

type Props = {
  shortfall: PlanShortfallView
  // Where the learner can say how long they have today, when that control is
  // not on this page.
  timeHref?: string
}

export function ShortfallNote({ shortfall, timeHref }: Props) {
  const href: Record<ShortfallChoiceKind, string | undefined> = {
    keep_time:         undefined,
    add_time_today:    timeHref,
    change_usual_time: '/settings/study',
  }

  return (
    <section
      aria-labelledby="plan-shortfall" data-section="shortfall"
      className="rounded-2xl border border-amber-300/25 bg-amber-300/5 p-5"
    >
      <h3 id="plan-shortfall" className="text-[11px] font-medium uppercase tracking-[0.2em] text-amber-300/90">Not everything fits</h3>
      <p className="mt-3 text-sm leading-relaxed text-foreground/85">{shortfall.summary}</p>

      <p className="mt-4 text-xs font-medium text-foreground/55">What you can do</p>
      <ul className="mt-2 space-y-2.5">
        {shortfall.choices.map(choice => (
          <li key={choice.kind} data-choice={choice.kind} className="text-sm leading-relaxed">
            {href[choice.kind]
              ? <Link href={href[choice.kind]!} className="font-medium text-foreground underline decoration-white/25 underline-offset-4 hover:decoration-white/60">{choice.label}</Link>
              : <span className="font-medium text-foreground">{choice.label}</span>}
            <span className="text-foreground/60">. {choice.detail}</span>
          </li>
        ))}
      </ul>

      {shortfall.assumptions.length > 0 && (
        <ul className="mt-4 space-y-1 border-t border-white/8 pt-3">
          {shortfall.assumptions.map(a => <li key={a} className="text-xs leading-relaxed text-foreground/50">{a}</li>)}
        </ul>
      )}
    </section>
  )
}
