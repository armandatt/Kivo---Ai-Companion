import { NextResponse } from "next/server"

// One answer, sent as the model writes it when the page asks for that
// (Accept: application/x-ndjson): one JSON object per line, { text } with the
// words so far and last { final, status } with exactly what the route would
// have answered. Without that header the route answers as it always has.
//
// The first line goes out at once, so a proxy sees the response start. Text
// is sent at most every LIVE_MS. Nothing is decided here: the page shows the
// text while it waits and keeps only `final`.
const LIVE_MS = 60

export const wantsStream = (req: Request) => (req.headers.get("accept") ?? "").includes("application/x-ndjson")

export async function answerLive(
  req: Request,
  work: (onLive: ((text: string) => void) | null) => Promise<NextResponse>,
  failed: () => NextResponse,
): Promise<Response> {
  if (!wantsStream(req)) return work(null)
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true
      const line = (value: unknown) => { if (open) { try { controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`)) } catch { open = false } } }
      line({ started: true })
      let waiting: string | null = null
      let sentAt = 0
      let timer: ReturnType<typeof setTimeout> | null = null
      const flush = () => { timer = null; if (waiting !== null) { line({ text: waiting }); waiting = null; sentAt = Date.now() } }
      const onLive = (text: string) => {
        waiting = text
        const wait = LIVE_MS - (Date.now() - sentAt)
        if (wait <= 0) flush()
        else if (!timer) timer = setTimeout(flush, wait)
      }
      let res: NextResponse
      try {
        res = await work(onLive)
      } catch (err) {
        console.error("[nova/stream-answer]", (err as Error).name)
        res = failed()
      }
      if (timer) clearTimeout(timer)
      line({ final: await res.json().catch(() => null), status: res.status })
      open = false
      try { controller.close() } catch { /* the page has gone */ }
    },
    cancel() { /* The page stopped reading. The model call ends at its own deadline; nothing is stored either way. */ },
  })
  return new Response(body, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      // Not cached, not compressed, not held back by a proxy: each line goes when it is written.
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  })
}
