// Reads a page will need, started before the part of the page that needs
// them has mounted (K-18). Home waited for Today's view, then mounted the
// flow, the board and the recovery card, and only then asked for their data:
// a second round trip on every first visit. Now the page starts those reads
// with Today's, and each hook takes the answer already on its way.
//
// A read is taken once, and only while fresh (EARLY_FRESH_MS); otherwise the
// hook reads as it always did. GET only, same request as the hook's own.

const EARLY_FRESH_MS = 8_000
const early = new Map<string, { at: number; response: Promise<Response> }>()

export function startEarly(urls: readonly string[]): void {
  if (typeof window === 'undefined') return
  const now = Date.now()
  for (const url of urls) {
    const had = early.get(url)
    if (had && now - had.at < EARLY_FRESH_MS) continue
    const response = fetch(url, { cache: 'no-store' })
    response.catch(() => {})   // a failed early read is only a missed head start
    early.set(url, { at: now, response })
  }
}

// The early read for this url, once; null when there is none or it is stale.
export function takeEarly(url: string): Promise<Response> | null {
  const had = early.get(url)
  if (!had) return null
  early.delete(url)
  return Date.now() - had.at < EARLY_FRESH_MS ? had.response : null
}

// fetch, through an early read when there is one.
export function readGet(url: string): Promise<Response> {
  return takeEarly(url) ?? fetch(url, { cache: 'no-store' })
}
