// How long a session on a Today item is offered for (start-control.tsx).
// Pure, so it is tested without a page (start-length.test.ts).

export const STANDARD_BLOCK = 25

export function suggestedFor(item: { minutes: number | null; ref: { minutes: number | null } | null; spentMinutes?: number | null; remainingMinutes?: number | null }): { minutes: number; basis: 'today' | 'remaining' | 'estimate' | 'standard' } {
  // What is left, never under the shortest session (5 minutes).
  if (item.minutes && item.spentMinutes && item.remainingMinutes != null) return { minutes: Math.max(5, item.remainingMinutes), basis: 'remaining' }
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

