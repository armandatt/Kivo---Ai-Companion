// A request to Nova that is answered as it is written: one JSON object per
// line, { text } with the words so far and last { final, status } with the
// answer itself (apps/api/lib/nova/stream-answer.ts). A server or proxy that
// answers plainly is read as the plain answer it is, so the page asks one way
// and copes with both. The final answer is the only thing a page may keep.

export type StreamFailure = { ok: false; error: 'failed' | 'unauthenticated' | 'aborted'; message: string }

const FAILED = 'Could not reach the server. Check your connection and try again.'

// Complete lines out of what has arrived; the rest waits for the next chunk.
export function splitLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split('\n')
  const rest = parts.pop() ?? ''
  return { lines: parts.map(l => l.trim()).filter(Boolean), rest }
}

export type StreamLine = { text?: unknown; final?: unknown; status?: unknown }

export function readLine(line: string): StreamLine | null {
  try { const v = JSON.parse(line) as unknown; return v && typeof v === 'object' ? v as StreamLine : null } catch { return null }
}

export async function streamPost<T>(url: string, body: unknown, opts: { signal?: AbortSignal; onText?: (text: string) => void } = {}): Promise<T | StreamFailure> {
  try {
    const res = await fetch(url, {
      method: 'POST', cache: 'no-store', signal: opts.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson, application/json' },
      body: JSON.stringify(body),
    })
    if (res.status === 401) { window.location.href = '/signin'; return { ok: false, error: 'unauthenticated', message: 'Sign in again.' } }
    const tooLong = res.status === 504 || res.status === 502
    if (!(res.headers.get('content-type') ?? '').includes('ndjson') || !res.body) {
      const data = await res.json().catch(() => null) as (T & { ok?: boolean }) | null
      if (!data || typeof data.ok !== 'boolean') return { ok: false, error: 'failed', message: tooLong ? 'That took too long to come back. Try again.' : FAILED }
      return data
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    let final: unknown = null
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      const { lines, rest } = splitLines(buffer + value)
      buffer = rest
      for (const raw of lines) {
        const line = readLine(raw)
        if (!line) continue
        if (typeof line.text === 'string') opts.onText?.(line.text)
        if (line.final !== undefined) final = line.final
      }
    }
    const data = final as (T & { ok?: boolean }) | null
    // The connection ended before the answer did: nothing is assumed from the words so far.
    if (!data || typeof data.ok !== 'boolean') return { ok: false, error: 'failed', message: 'The answer was cut off on the way. Try again.' }
    return data
  } catch (err) {
    if ((err as Error).name === 'AbortError') return { ok: false, error: 'aborted', message: 'Stopped.' }
    return { ok: false, error: 'failed', message: FAILED }
  }
}
