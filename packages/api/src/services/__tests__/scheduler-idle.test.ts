// Skipping the database on idle ticks (services/schedulerIdle.ts): when a tick
// may be skipped, and the controller's three modes.
//
// The session predicate is its module's own (held by the integration test);
// here it reports work only for what a test puts in the cache.

jest.mock("../../nova/persistence/nova-persistence", () => ({
  anySessionAbandonableAt: (rows: unknown[]) => rows.length > 0,
}));

import {
  IdleScheduler, RECONCILE_MS, TICK_MS, decideTick, idleModeOf, nextDueWithin,
  type DueSources, type FullRunReport, type IdleCache, type IdleMode,
} from "../schedulerIdle";

const T0 = Date.UTC(2026, 10, 12, 10, 30, 40);   // 16:00:40 IST
const at = (ms: number) => new Date(T0 + ms);
const MIN = 60_000;

function cache(over: Partial<IdleCache> = {}): IdleCache {
  return { fullRunStartedAt: T0, writesAtStart: 0, windows: [], sessions: [], nova: [], ...over };
}

describe("decideTick", () => {
  test("nothing known: full", () => {
    expect(decideTick({ now: at(0), cache: null, writes: 0 })).toEqual({ run: "full", reasons: ["no_cache"] });
  });

  test("nothing due, nothing written, inside the interval: skip", () => {
    expect(decideTick({ now: at(5 * MIN), cache: cache(), writes: 0 })).toEqual({ run: "skip", reasons: [] });
  });

  test("reconciles at the tick ten minutes on, even a little early", () => {
    expect(decideTick({ now: at(RECONCILE_MS - 1_000), cache: cache(), writes: 0 }).reasons).toEqual(["reconcile"]);
    expect(decideTick({ now: at(RECONCILE_MS - 60_000), cache: cache(), writes: 0 }).run).toBe("skip");
  });

  test("any committed write since the last full tick began: full", () => {
    expect(decideTick({ now: at(5 * MIN), cache: cache({ writesAtStart: 7 }), writes: 8 }).reasons).toEqual(["write"]);
    expect(decideTick({ now: at(5 * MIN), cache: cache({ writesAtStart: 7 }), writes: 7 }).run).toBe("skip");
  });

  test("a clock that went backwards: full", () => {
    expect(decideTick({ now: at(-MIN), cache: cache(), writes: 0 }).reasons).toContain("clock_went_back");
  });

  test("a graced window is due from its moment to the end of its grace, inclusive", () => {
    const from = T0 + 3 * MIN, grace = 12 * MIN;
    const c = cache({ windows: [{ source: "custom_reminder", from, until: from + grace + 1 }] });
    expect(decideTick({ now: new Date(from - 1), cache: c, writes: 0 }).run).toBe("skip");
    expect(decideTick({ now: new Date(from), cache: c, writes: 0 }).reasons).toEqual(["due:custom_reminder"]);
    expect(decideTick({ now: new Date(from + grace), cache: c, writes: 0 }).run).toBe("full");
    // Past the grace (judged from a full tick recent enough not to reconcile).
    const later = { ...c, fullRunStartedAt: from + grace - 2 * MIN };
    expect(decideTick({ now: new Date(from + grace), cache: later, writes: 0 }).run).toBe("full");
    expect(decideTick({ now: new Date(from + grace + 1), cache: later, writes: 0 }).run).toBe("skip");
  });

  test("an open-ended window stays due until a full tick deals with it", () => {
    const c = cache({ windows: [{ source: "consolidation_retry", from: T0 - 60 * MIN, until: null }] });
    expect(decideTick({ now: at(5 * MIN), cache: c, writes: 0 }).reasons).toEqual(["due:consolidation_retry"]);
  });

  test("Nova not read, or a learner not judged: full", () => {
    expect(decideTick({ now: at(5 * MIN), cache: cache({ nova: null }), writes: 0 }).reasons).toEqual(["nova:unknown"]);
    expect(decideTick({ now: at(5 * MIN), cache: cache({ nova: [null] }), writes: 0 }).reasons).toEqual(["nova"]);
  });

  test("nextDueWithin finds the first minute something is due", () => {
    const c = cache({ windows: [{ source: "dynamic_checkin", from: T0 + 7 * MIN + 5_000, until: T0 + 20 * MIN }] });
    expect(nextDueWithin(c, at(0))?.at.toISOString()).toBe(at(8 * MIN).toISOString());
    expect(nextDueWithin(cache(), at(0))).toBeNull();
  });
});

test("SCHEDULER_IDLE_SKIP: shadow unless on or off", () => {
  expect(idleModeOf({})).toBe("shadow");
  expect(idleModeOf({ SCHEDULER_IDLE_SKIP: "ON" })).toBe("on");
  expect(idleModeOf({ SCHEDULER_IDLE_SKIP: "off" })).toBe("off");
  expect(idleModeOf({ SCHEDULER_IDLE_SKIP: "yes" })).toBe("shadow");
});

// ── The controller ────────────────────────────────────────────────────────────

function controller(opts: { mode: IdleMode; work?: (now: Date) => Record<string, number>; due?: (now: Date) => DueSources; dueFails?: () => boolean }) {
  let writes = 0;
  const runs: string[] = [], lines: Array<Record<string, unknown>> = [];
  let dueReads = 0;
  const report = (now: Date): FullRunReport => ({ work: opts.work?.(now) ?? {}, nova: [] });
  const idle = new IdleScheduler({
    runFull: async now => { runs.push(now.toISOString()); return report(now); },
    loadDue: async now => { dueReads++; if (opts.dueFails?.()) throw new Error("db asleep"); return opts.due?.(now) ?? { windows: [], sessions: [] }; },
    mode:    () => opts.mode,
    log:     line => lines.push(line),
    quietly: work => work(),
    writes:  () => writes,
  });
  return { idle, runs, lines, write: () => { writes++; }, dueReads: () => dueReads };
}

test("on: first tick full, idle ticks between reconciliations skipped", async () => {
  const c = controller({ mode: "on" });
  const ran: boolean[] = [];
  for (let i = 0; i < 6; i++) ran.push((await c.idle.tick(at(i * TICK_MS))).ran);
  expect(ran).toEqual([true, false, true, false, true, false]);
  expect(c.idle.status()).toMatchObject({ fullRuns: 3, skipped: 3, unpredictedWork: 0 });
});

test("on: a write makes the next tick full", async () => {
  const c = controller({ mode: "on" });
  await c.idle.tick(at(0));
  c.write();
  expect((await c.idle.tick(at(TICK_MS))).decision.reasons).toEqual(["write"]);
});

test("on: a failed read of upcoming work makes the next tick full", async () => {
  let fail = true;
  const c = controller({ mode: "on", dueFails: () => fail });
  await c.idle.tick(at(0));
  fail = false;
  expect((await c.idle.tick(at(TICK_MS))).decision.reasons).toEqual(["no_cache"]);
  expect(c.lines.some(l => l.event === "due_read_failed")).toBe(true);
  expect(c.idle.status().cacheReadFailed).toBe(1);
});

test("a restart (a new controller) starts with a full tick", async () => {
  const a = controller({ mode: "on" });
  await a.idle.tick(at(0));
  const b = controller({ mode: "on" });
  expect((await b.idle.tick(at(TICK_MS))).decision.reasons).toEqual(["no_cache"]);
});

test("shadow: every tick runs in full, and work a skip would have missed is reported", async () => {
  // Work turns up at the 5-minute tick that the cache did not know about.
  const c = controller({ mode: "shadow", work: now => (now.getTime() === T0 + TICK_MS ? { custom_reminder: 1 } : {} as Record<string, number>) });
  await c.idle.tick(at(0));
  const second = await c.idle.tick(at(TICK_MS));
  expect(second.ran).toBe(true);
  expect(second.decision.run).toBe("skip");
  expect(c.idle.status().unpredictedWork).toBe(1);
  expect(c.lines.find(l => l.event === "unpredicted_work")).toMatchObject({ wouldSkip: true, work: { custom_reminder: 1 } });
});

test("shadow: predicted work is not reported", async () => {
  const c = controller({
    mode: "shadow",
    due:  () => ({ windows: [{ source: "custom_reminder", from: T0 + 4 * MIN, until: T0 + 17 * MIN }], sessions: [] }),
    work: now => (now.getTime() === T0 + TICK_MS ? { custom_reminder: 1 } : {} as Record<string, number>),
  });
  await c.idle.tick(at(0));
  const second = await c.idle.tick(at(TICK_MS));
  expect(second.decision.reasons).toEqual(["due:custom_reminder"]);
  expect(c.idle.status().unpredictedWork).toBe(0);
});

test("on: work found by a reconciliation tick alone is reported as unpredicted", async () => {
  const c = controller({ mode: "on", work: now => (now.getTime() === T0 + 2 * TICK_MS ? { calendar_reminder: 1 } : {} as Record<string, number>) });
  await c.idle.tick(at(0));
  await c.idle.tick(at(TICK_MS));
  const third = await c.idle.tick(at(2 * TICK_MS));
  expect(third.decision.reasons).toEqual(["reconcile"]);
  expect(c.idle.status().unpredictedWork).toBe(1);
});

test("off: every tick full, nothing extra read", async () => {
  const c = controller({ mode: "off" });
  for (let i = 0; i < 3; i++) expect((await c.idle.tick(at(i * TICK_MS))).ran).toBe(true);
  expect(c.dueReads()).toBe(0);
});

test("work nobody announced is found within the reconciliation interval, under every grace", async () => {
  // A day of five-minute ticks with nothing known in advance and nothing
  // written by this process: the worst case, an item another process wrote.
  // Every item must be looked at by a full tick no later than RECONCILE_MS
  // after it became due, which is under the 12-minute grace.
  const c = controller({ mode: "on" });
  const fullTicks: number[] = [];
  for (let i = 0; i < 288; i++) {
    const now = at(i * TICK_MS);
    if ((await c.idle.tick(now)).ran) fullTicks.push(now.getTime());
  }
  let worst = 0;
  for (let k = 0; k < 200; k++) {
    const due = T0 + Math.floor(Math.random() * 284 * TICK_MS);
    const seen = fullTicks.find(t => t >= due)!;
    worst = Math.max(worst, seen - due);
  }
  expect(worst).toBeLessThanOrEqual(RECONCILE_MS);
  expect(worst).toBeLessThan(12 * MIN);
});
