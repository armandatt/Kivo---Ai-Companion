// How long a session on a Today item is offered for (start-control.tsx).
// Pure, so it is tested without a page (start-length.test.ts).

export const STANDARD_BLOCK = 25

// "Remaining" is today's planned minutes for the item less the focus time
// already finished on it today (product/day-flow.ts: spentOn, completed
// sessions only). The same numbers give "N focused today" on the list, so the
// two can never disagree.
//
// Bug batch 28 Nov, item 2: with today's time used up (28 focused of 25) the
// suggestion used to floor 0 at 5 and say "5 minutes left". Now it says the
// day's time is done and offers a fresh round instead.
export const SHORTEST_SESSION = 5

export function suggestedFor(item: { minutes: number | null; ref: { minutes: number | null } | null; spentMinutes?: number | null; remainingMinutes?: number | null }): { minutes: number; basis: 'today' | 'remaining' | 'again' | 'estimate' | 'standard' } {
  if (item.minutes && item.spentMinutes && item.remainingMinutes != null) {
    // Today's time is used up (or all but a sliver of it): another round, not "time left".
    if (item.remainingMinutes < SHORTEST_SESSION) return { minutes: Math.min(item.minutes, STANDARD_BLOCK), basis: 'again' }
    return { minutes: item.remainingMinutes, basis: 'remaining' }
  }
  if (item.minutes) return { minutes: item.minutes, basis: 'today' }
  if (item.ref?.minutes) return { minutes: item.ref.minutes, basis: 'estimate' }
  return { minutes: STANDARD_BLOCK, basis: 'standard' }
}

// Quick lengths around the suggestion, not a fixed list: a shorter and a
// longer one either side of it, rounded to five minutes.
export function quickLengths(suggested: number): number[] {
  const all = [10, 15, 20, 25, 30, 45, 60, 90, 120]
  const lower = all.filter(m => m < suggested).slice(-2)
  const higher = all.filter(m => m > suggested).slice(0, 2)
  return [...lower, ...higher]
}

