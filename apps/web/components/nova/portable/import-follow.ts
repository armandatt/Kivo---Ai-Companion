// Following a map import to its end (P0, 28 Nov). The import runs on the
// server after the upload's response; the page learns how it ended only from
// GET /api/nova/portable/import/:id, never from a timer. Pure of React and
// the DOM (fetch and sleep are given), so it is tested on its own
// (import-follow.test.ts).
//
//   running  → wait, read again (a little slower each time, up to 4 s)
//   stalled  → the run stopped (its lease lapsed): ask the server to resume
//              it once; a map with images needs its file again (file_needed)
//   complete → the map's canonical ids
//   failed / not found → the server's message

export type Followed =
  | { status: 'complete'; jobId: string; rootSubjectId: string; rootSubjectIds: string[]; counts: Record<string, number | undefined> }
  | { status: 'failed'; jobId: string; message: string; fileNeeded?: boolean }
  | { status: 'cancelled'; jobId: string }

type Status =
  | { ok: true; status: 'complete'; jobId: string; rootSubjectId: string; rootSubjectIds: string[]; counts: Record<string, number | undefined> }
  | { ok: true; status: 'running'; jobId: string; stage: string | null; stalled: boolean }
  | { ok: true; status: 'failed'; jobId: string; message: string }
  | { ok: false; message: string; reason?: string }

export interface FollowDeps {
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  sleep: (ms: number) => Promise<void>
  onStage?: (stage: string | null) => void
  signal?: { aborted: boolean }
}

export const STAGE_WORDS: Record<string, string> = {
  structure: 'Adding subjects and topics…', details: 'Adding what each topic covers…', notes: 'Adding notes…',
  links: 'Adding saved pages…', tasks: 'Adding tasks…', about: 'Finishing up…', verify: 'Checking everything arrived…',
}

export async function followImport(jobId: string, deps: FollowDeps): Promise<Followed> {
  let wait = 800
  let resumed = false
  let misses = 0
  for (;;) {
    if (deps.signal?.aborted) return { status: 'cancelled', jobId }
    let s: Status
    try {
      const res = await deps.fetch(`/api/nova/portable/import/${encodeURIComponent(jobId)}`, { cache: 'no-store' })
      s = await res.json() as Status
      misses = 0
    } catch {
      // A dropped connection is not an outcome: read again, a little later.
      if (++misses >= 30) return { status: 'failed', jobId, message: 'Kivo couldn’t be reached. Your import keeps going; come back to this page to see it finish.' }
      await deps.sleep(Math.min(4000, wait *= 1.5)); continue
    }
    if (!s.ok) return { status: 'failed', jobId, message: s.message }
    if (s.status === 'complete') {
      const roots = s.rootSubjectIds?.length ? s.rootSubjectIds : s.rootSubjectId ? [s.rootSubjectId] : []
      if (roots.length === 0) return { status: 'failed', jobId, message: 'The import finished but its map couldn’t be found. Open your Knowledge Map.' }
      return { status: 'complete', jobId, rootSubjectId: s.rootSubjectId, rootSubjectIds: roots, counts: s.counts ?? {} }
    }
    if (s.status === 'failed') return { status: 'failed', jobId, message: s.message }
    deps.onStage?.(s.stage)
    // Stalled again after a resume: say so, with Try again, instead of waiting forever.
    if (s.stalled && resumed) return { status: 'failed', jobId, message: 'The import stopped before it finished. Nothing is lost: Try again continues where it stopped.' }
    if (s.stalled && !resumed) {
      resumed = true
      try {
        const res = await deps.fetch(`/api/nova/portable/import/${encodeURIComponent(jobId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        const r = await res.json() as { ok: boolean; reason?: string; message?: string }
        if (!r.ok && r.reason === 'file_needed') return { status: 'failed', jobId, message: r.message ?? 'Choose the same file again to finish.', fileNeeded: true }
      } catch { /* read again below */ }
    }
    await deps.sleep(wait)
    wait = Math.min(4000, Math.round(wait * 1.4))
  }
}

// The import this tab is following, kept across a reload (an id, nothing secret).
export const ACTIVE_IMPORT_KEY = 'kivo-active-import'
