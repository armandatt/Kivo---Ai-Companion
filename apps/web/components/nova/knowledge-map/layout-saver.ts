import type { MapPosition } from '@repo/api/nova/product/map-layout.types'

// Saving where the learner put their cards, in batches. A move is queued and
// sent with the others a moment later, never one request per pointer move.
// One save is in flight at a time; what is moved meanwhile goes in the next.
// A failed save keeps its positions queued (unless the card was moved again
// since, when the newer position wins) and waits for Retry or the next move,
// so a failure loses nothing that was moved. No React and no fetch: the page
// gives it how to send, so it can be tested on its own.

export type SendResult = { ok: true } | { ok: false; message: string }
export type SaverStatus = 'saved' | 'pending' | 'saving' | 'failed'
export interface SaverState { status: SaverStatus; unsaved: number; message: string | null }

interface Timers { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void }
const REAL_TIMERS: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: h => clearTimeout(h as ReturnType<typeof setTimeout>) }

export class LayoutSaver {
  private queued = new Map<string, MapPosition>()
  private timer: unknown = null
  private inFlight: Promise<void> | null = null
  private failure: string | null = null

  constructor(
    private readonly send: (positions: MapPosition[]) => Promise<SendResult>,
    private readonly onState: (state: SaverState) => void,
    private readonly delayMs = 800,
    private readonly timers: Timers = REAL_TIMERS,
  ) {}

  state(): SaverState {
    const status: SaverStatus = this.inFlight ? 'saving' : this.failure ? 'failed' : this.queued.size > 0 ? 'pending' : 'saved'
    return { status, unsaved: this.queued.size, message: this.failure }
  }

  private emit() { this.onState(this.state()) }

  // A card was put somewhere. Sent with the others after a short pause.
  queue(node: string, x: number, y: number) {
    this.queued.set(node, { node, x, y })
    this.schedule()
    this.emit()
  }

  private schedule() {
    if (this.timer !== null) this.timers.clear(this.timer)
    this.timer = this.timers.set(() => { this.timer = null; void this.flush() }, this.delayMs)
  }

  // Send what is queued now. Waits for a save already in flight first.
  async flush(): Promise<void> {
    if (this.timer !== null) { this.timers.clear(this.timer); this.timer = null }
    while (this.inFlight) await this.inFlight
    if (this.queued.size === 0) { this.emit(); return }
    const batch = new Map(this.queued)
    this.queued.clear()
    this.failure = null
    let done!: () => void
    this.inFlight = new Promise<void>(resolve => { done = resolve })
    this.emit()
    let result: SendResult
    try { result = await this.send([...batch.values()]) } catch { result = { ok: false, message: "Your layout didn't save." } }
    if (!result.ok) {
      // Put back what was not saved, unless it was moved again meanwhile.
      for (const [node, p] of batch) if (!this.queued.has(node)) this.queued.set(node, p)
      this.failure = result.message
    }
    this.inFlight = null
    done()
    this.emit()
    // Moved while that save was in flight: send it too.
    if (result.ok && this.queued.size > 0) this.schedule()
  }

  retry() { return this.flush() }

  // For a reset: forget what is queued and wait until nothing is in flight,
  // so no save lands after the positions are removed.
  async discard(): Promise<void> {
    if (this.timer !== null) { this.timers.clear(this.timer); this.timer = null }
    this.queued.clear()
    this.failure = null
    while (this.inFlight) await this.inFlight
    this.queued.clear()
    this.failure = null
    this.emit()
  }

  pending(): MapPosition[] { return [...this.queued.values()] }
}
