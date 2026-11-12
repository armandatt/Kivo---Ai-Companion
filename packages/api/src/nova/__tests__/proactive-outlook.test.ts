// Could a tick send a Nova learner anything? (proactive/proactive-outlook.ts)
// The scheduler skips a tick only when the answer is no for every learner, so
// "no" must never be said where decideProactive would approve a message.
// Checked over many random learners and moments: whenever the decision (or
// holdReason, for a message waiting to be retried) lets something go out at
// t, proactiveMayActAt says yes at t, from what an earlier tick that day saw.

import {
  CHECKIN_WINDOW_MINUTES, decideProactive, generateCandidates, holdReason, MAX_PER_DAY,
  type ProactiveFacts, type ProactiveGates,
} from "../decision/proactive-decision";
import { earlyOutlook, outlookOf, proactiveMayActAt, STOPPED } from "../proactive/proactive-outlook";
import type { ProactiveType } from "../types/proactive.types";

const DAY  = "2026-11-12";
const ZONE = "UTC";
const atClock = (minuteOfDay: number) => new Date(Date.UTC(2026, 10, 12, 0, minuteOfDay));

// A small seeded generator, so a failure can be replayed.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

const TYPES: ProactiveType[] = ["exam_countdown", "missed_plan_recovery", "task_due", "review_due", "daily_checkin", "daily_nudge"];

function randomLearner(r: () => number) {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const from = Math.floor(r() * 21);
  const checkinMinute = r() < 0.5 ? null : Math.floor(r() * 24 * 60);
  const sentToday = TYPES.filter(() => r() < 0.15).slice(0, Math.floor(r() * (MAX_PER_DAY + 1))).map(type => ({ type, at: atClock(0) }));
  const base: Omit<ProactiveFacts, "localHour" | "localMinute"> = {
    localDay: DAY, checkinMinute,
    window: { from, to: Math.min(24, from + 1 + Math.floor(r() * 4)), basis: "stated" },
    studiedToday: r() < 0.3,
    daysSinceLastSession: r() < 0.3 ? null : Math.floor(r() * 9),
    lastSessionDay: "2026-11-08",
    exams: r() < 0.5 ? [] : [{ id: "e", title: "Exam", daysUntil: Math.floor(r() * 7) - 1 }],
    reviewDueCount: r() < 0.5 ? 0 : 3,
    hasPlan: r() < 0.7,
    tasksDueToday: r() < 0.4 ? [{ id: "t", title: "Task" }] : [],
  };
  const gates = (now: Date): ProactiveGates => ({
    proactiveEnabled: true, paused: false, undeliverable: false, hasTimezone: true,
    activeSession: false, messagedRecently: false, messagedSinceCheckin: r() < 0.2,
    sentToday, lastSentAt: null,
    realityCategories: r() < 0.15 ? [pick(["life_constraint", "health"])] : [],
    now,
  });
  return { base, gates };
}

const factsAt = (base: Omit<ProactiveFacts, "localHour" | "localMinute">, minuteOfDay: number): ProactiveFacts =>
  ({ ...base, localHour: Math.floor(minuteOfDay / 60), localMinute: minuteOfDay % 60 });

test("whenever a message could go out, the outlook says the tick may act", () => {
  const r = rng(20261112);
  let approvals = 0, checked = 0;
  for (let i = 0; i < 20_000; i++) {
    const { base, gates } = randomLearner(r);
    // A full tick earlier in the day saw the learner; a later tick decides.
    const seenAt = Math.floor(r() * 24 * 60);
    const laterAt = seenAt + Math.floor(r() * (24 * 60 - seenAt));
    const outlook = outlookOf(factsAt(base, seenAt), gates(atClock(seenAt)), ZONE);
    const facts = factsAt(base, laterAt);
    const g = gates(atClock(laterAt));
    // A waiting message goes out only if its reason still holds (the tick
    // looks for its occurrence among today's candidates, else drops it) and
    // holdReason lets it through.
    const candidates = generateCandidates(facts);
    const approved = decideProactive(facts, g).chosen !== null
      || candidates.some(c => holdReason(c.type, facts, g) === null);
    checked++;
    if (!approved) continue;
    approvals++;
    if (!proactiveMayActAt(outlook, atClock(laterAt))) {
      throw new Error(`outlook said no where a message could go: ${JSON.stringify({ seenAt, laterAt, facts, sentToday: g.sentToday, reality: g.realityCategories, outlook })}`);
    }
  }
  expect(checked).toBe(20_000);
  expect(approvals).toBeGreaterThan(1_000);   // the property was actually exercised
});

test("it does say no outside every window, in quiet hours, and once the day is closed", () => {
  const { base, gates } = randomLearner(rng(1));
  const facts = { ...factsAt({ ...base, checkinMinute: null, window: { from: 18, to: 21, basis: "stated" as const }, exams: [], studiedToday: false }, 10 * 60) };
  const outlook = outlookOf(facts, { ...gates(atClock(600)), sentToday: [] }, ZONE);
  expect(proactiveMayActAt(outlook, atClock(10 * 60))).toBe(false);   // morning, window is evening, no exam
  expect(proactiveMayActAt(outlook, atClock(19 * 60))).toBe(true);    // inside the window
  expect(proactiveMayActAt(outlook, atClock(23 * 60 + 30))).toBe(false); // quiet hours

  const closed = outlookOf(facts, { ...gates(atClock(600)), sentToday: [{ type: "daily_nudge", at: atClock(0) }] }, ZONE);
  expect(proactiveMayActAt(closed, atClock(19 * 60))).toBe(false);    // the day's push already went
});

test("a check-in time the learner chose inside quiet hours is honoured", () => {
  const o = earlyOutlook(ZONE, DAY, 6 * 60 + 30);
  expect(proactiveMayActAt(o, atClock(6 * 60 + 30))).toBe(true);
  expect(proactiveMayActAt(o, atClock(6 * 60 + 30 + CHECKIN_WINDOW_MINUTES - 1))).toBe(true);
  expect(proactiveMayActAt(o, atClock(5 * 60))).toBe(false);
});

test("a new local day, a learner not judged: yes; stopped: no", () => {
  const { base, gates } = randomLearner(rng(2));
  const closed = outlookOf(factsAt(base, 600), { ...gates(atClock(600)), sentToday: [{ type: "daily_nudge", at: atClock(0) }, { type: "exam_countdown", at: atClock(0) }] }, ZONE);
  expect(proactiveMayActAt(closed, new Date(Date.UTC(2026, 10, 13, 10, 0)))).toBe(true);
  expect(proactiveMayActAt(null, atClock(600))).toBe(true);
  expect(proactiveMayActAt(STOPPED, atClock(600))).toBe(false);
});
