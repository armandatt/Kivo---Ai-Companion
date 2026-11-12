// ─── Skipping the database on idle ticks ──────────────────────────────────────
// The scheduler ticks every five minutes, and a tick that reads Postgres keeps
// Neon's compute awake. Most ticks find nothing to do. This decides, without
// touching the database, whether a tick can be skipped, and runs the full
// tick otherwise. apps/api/lib/internal-checkin-scheduler.ts drives it.
//
// A tick runs in full when any of these holds (decideTick):
//   no_cache    nothing is known yet: the first tick after a start, or the
//               last full tick's read of upcoming work failed
//   reconcile   RECONCILE_MS since the last full tick began (10 minutes,
//               the owner's choice). Work this process could not see coming,
//               such as a row another process wrote, is found within it:
//               well inside the 30-minute grace of a calendar reminder
//   write       this process committed a write since the last full tick
//               began reading (@repo/db/write-signal, noted at the driver
//               after commit, for every write whatever made it). A write
//               that changes nothing about timing costs one extra full tick.
//   due:*       Nova work the last full tick read is due at this moment: a
//               calendar reminder inside its grace or a retry of one, a
//               consolidation retry, a saved page waiting, a study session
//               to close as abandoned
//   nova        a Nova learner could be sent something now
//               (proactiveMayActAt)
// Otherwise the tick is skipped: no query at all.
//
// Nova only. Rex is not part of Kivo: none of its jobs run in the tick
// (apps/api/lib/checkin-cron.ts), and its Telegram path's writes are not
// counted by the write signal (apps/api/app/api/telegram/route.ts).
//
// Correctness never rests on what is in memory: a restart starts with
// no_cache; every full tick is the same tick as before (idempotent: Nova's
// outbox claims for proactive messages and calendar reminders, guarded writes
// for sessions, consolidation and saved pages); and the predicates mirror
// Nova's own selections, erring towards
// "due". Modes (SCHEDULER_IDLE_SKIP): off (every tick in full, nothing extra
// read), shadow (every tick in full, and each one is checked against what a
// skip would have missed), on (skip).

import { databaseWriteState } from "@repo/db/write-signal";
import { anySessionAbandonableAt, type OpenSessionRow } from "../nova/persistence/nova-persistence";
import { proactiveMayActAt, type ProactiveOutlook } from "../nova/proactive/proactive-outlook";

export type IdleMode = "off" | "shadow" | "on";

// Default shadow: nothing is skipped until someone turns it on, and the logs
// say what skipping would have done. "off" is the emergency switch: exactly
// the scheduler as before, with nothing extra read.
export function idleModeOf(env: Record<string, string | undefined> = process.env): IdleMode {
  const raw = (env.SCHEDULER_IDLE_SKIP ?? "").trim().toLowerCase();
  return raw === "on" || raw === "off" ? raw : "shadow";
}

export const RECONCILE_MS = 10 * 60_000;
// Ticks are five minutes apart; without slack a full tick at T and a tick at
// T + 10 min a few milliseconds early would wait until T + 15.
export const RECONCILE_SLACK_MS = 30_000;
export const TICK_MS = 5 * 60_000;

// Something becomes due at `from`, and stays due until `until` (exclusive;
// null: until a full tick deals with it).
export interface DueWindow { source: string; from: number; until: number | null }

export interface DueSources {
  windows:  DueWindow[];
  sessions: OpenSessionRow[];
}

// What a full tick learned about the work still to come.
export interface IdleCache {
  fullRunStartedAt: number;
  writesAtStart:    number;
  windows:          DueWindow[];
  sessions:         OpenSessionRow[];
  nova:             Array<ProactiveOutlook | null> | null;  // null: not read, so "due"
}

export interface TickDecision { run: "full" | "skip"; reasons: string[] }

function dueAt(cache: IdleCache, t: Date): string[] {
  const reasons: string[] = [];
  const ms = t.getTime();
  const sources = new Set<string>();
  for (const w of cache.windows) if (w.from <= ms && (w.until === null || ms < w.until)) sources.add(w.source);
  for (const s of sources) reasons.push(`due:${s}`);
  if (anySessionAbandonableAt(cache.sessions, t)) reasons.push("due:session_abandon");
  if (cache.nova === null) reasons.push("nova:unknown");
  else if (cache.nova.some(o => proactiveMayActAt(o, t))) reasons.push("nova");
  return reasons;
}

export function decideTick(input: { now: Date; cache: IdleCache | null; writes: number }): TickDecision {
  const { now, cache } = input;
  if (!cache) return { run: "full", reasons: ["no_cache"] };
  const reasons: string[] = [];
  const since = now.getTime() - cache.fullRunStartedAt;
  if (since < 0) reasons.push("clock_went_back");
  if (since >= RECONCILE_MS - RECONCILE_SLACK_MS) reasons.push("reconcile");
  if (input.writes > cache.writesAtStart) reasons.push("write");
  reasons.push(...dueAt(cache, now));
  return { run: reasons.length ? "full" : "skip", reasons };
}

// The first minute within `horizonMs` at which something the cache knows of
// becomes due (writes and reconciliation aside), for the logs. null: nothing
// before the horizon.
export function nextDueWithin(cache: IdleCache, now: Date, horizonMs = RECONCILE_MS): { at: Date; reasons: string[] } | null {
  for (let ms = 0; ms <= horizonMs; ms += 60_000) {
    const t = new Date(now.getTime() + ms);
    const reasons = dueAt(cache, t);
    if (reasons.length) return { at: t, reasons };
  }
  return null;
}

// ── The controller ────────────────────────────────────────────────────────────

export interface FullRunReport {
  // What Nova's jobs did this tick: messages sent, reminders found due, pages
  // looked at, sessions closed... Any non-zero count is work.
  work: Record<string, number>;
  nova: Array<ProactiveOutlook | null> | null;
}

export interface IdleDeps {
  runFull:  (now: Date) => Promise<FullRunReport>;
  loadDue:  (now: Date) => Promise<DueSources>;
  mode:     () => IdleMode;
  log:      (line: Record<string, unknown>) => void;
  // Runs work with its own database writes not counted (write-signal).
  quietly:  <T>(work: () => Promise<T>) => Promise<T>;
  writes?:  () => number;
}

export interface IdleStats {
  mode:            IdleMode;
  fullRuns:        number;
  skipped:         number;
  // Full ticks that found work a skip would have missed or delayed: in
  // shadow, ticks it would have skipped; when on, ticks run only to reconcile.
  unpredictedWork: number;
  lastFullRunAt:   string | null;
  lastSkipAt:      string | null;
  lastReasons:     string[];
  nextDueAt:       string | null;
  cacheReadFailed: number;
  writesSeen:      number;
}

const total = (work: Record<string, number>) => Object.values(work).reduce((a, b) => a + (b > 0 ? b : 0), 0);

export class IdleScheduler {
  private cache: IdleCache | null = null;
  private stats: IdleStats = {
    mode: "shadow", fullRuns: 0, skipped: 0, unpredictedWork: 0, lastFullRunAt: null, lastSkipAt: null,
    lastReasons: [], nextDueAt: null, cacheReadFailed: 0, writesSeen: 0,
  };

  constructor(private readonly deps: IdleDeps) {}

  private writes(): number {
    return this.deps.writes ? this.deps.writes() : databaseWriteState().writes;
  }

  status(): IdleStats {
    return { ...this.stats, mode: this.deps.mode(), writesSeen: this.writes() };
  }

  // One tick. Returns what it did; never throws for a failed read of
  // upcoming work (the next tick then runs in full).
  async tick(now: Date): Promise<{ ran: boolean; decision: TickDecision; report: FullRunReport | null }> {
    const mode = this.deps.mode();
    this.stats.mode = mode;

    if (mode === "off") {
      this.cache = null;
      const report = await this.deps.quietly(() => this.deps.runFull(now));
      this.stats.fullRuns += 1;
      this.stats.lastFullRunAt = now.toISOString();
      this.stats.lastReasons = ["mode_off"];
      return { ran: true, decision: { run: "full", reasons: ["mode_off"] }, report };
    }

    const writes   = this.writes();
    const decision = decideTick({ now, cache: this.cache, writes });
    const next     = this.cache ? nextDueWithin(this.cache, now) : null;
    this.stats.lastReasons = decision.reasons;
    this.stats.nextDueAt   = next ? next.at.toISOString() : null;

    if (mode === "on" && decision.run === "skip") {
      this.stats.skipped += 1;
      this.stats.lastSkipAt = now.toISOString();
      this.deps.log({ ts: now.toISOString(), layer: "scheduler", mode, tick: "skipped", nextDueAt: this.stats.nextDueAt, nextDueReasons: next?.reasons ?? [] });
      return { ran: false, decision, report: null };
    }

    const writesAtStart = writes;
    const startedAt     = now.getTime();
    const report = await this.deps.quietly(() => this.deps.runFull(now));
    this.stats.fullRuns += 1;
    this.stats.lastFullRunAt = now.toISOString();

    try {
      const due = await this.deps.quietly(() => this.deps.loadDue(now));
      this.cache = { fullRunStartedAt: startedAt, writesAtStart, windows: due.windows, sessions: due.sessions, nova: report.nova };
    } catch (err) {
      this.cache = null;
      this.stats.cacheReadFailed += 1;
      this.deps.log({ ts: now.toISOString(), layer: "scheduler", mode, event: "due_read_failed", error: err instanceof Error ? err.name : "unknown" });
    }

    // Would a skip have lost this work? In shadow, this tick would have been
    // skipped; when on, it ran only because the reconciliation interval was up.
    const work = total(report.work);
    const notPredicted = decision.run === "skip" || (decision.reasons.length === 1 && decision.reasons[0] === "reconcile");
    if (notPredicted && work > 0) {
      this.stats.unpredictedWork += 1;
      this.deps.log({ ts: now.toISOString(), layer: "scheduler", mode, event: "unpredicted_work", wouldSkip: decision.run === "skip", reasons: decision.reasons, work: report.work });
    }
    this.deps.log({
      ts: now.toISOString(), layer: "scheduler", mode, tick: "full",
      wouldSkip: decision.run === "skip", reasons: decision.reasons, writesSinceLastFull: this.cacheWritesDelta(writes),
      work, nextDueAt: this.stats.nextDueAt,
    });
    return { ran: true, decision, report };
  }

  private lastWritesAtStart: number | null = null;
  private cacheWritesDelta(writes: number): number {
    const delta = this.lastWritesAtStart === null ? 0 : writes - this.lastWritesAtStart;
    this.lastWritesAtStart = writes;
    return delta;
  }
}
