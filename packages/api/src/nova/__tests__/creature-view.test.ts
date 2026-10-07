// The Creature page for a Nova learner: its numbers are ones Nova already
// shows, or follow from them by a stated rule. No database.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCreatureView, creatureHealth, creatureLevel, creatureSeed } from "../product/creature";
import type { NovaProgressReady, ProgressWeek } from "../product/progress.types";

const read = (file: string) => readFileSync(join(__dirname, "..", file), "utf8");
const web  = (file: string) => readFileSync(join(__dirname, "../../../../../apps/web", file), "utf8");
const api  = (file: string) => readFileSync(join(__dirname, "../../../../../apps/api", file), "utf8");

const week = (activeDays: number, over: Partial<ProgressWeek> = {}): ProgressWeek =>
  ({ weekStart: "2026-09-28", sessions: activeDays, minutes: activeDays * 25, activeDays, current: false, beforeStart: false, ...over });

const progress = (activeDays: number, weeks: ProgressWeek[]): NovaProgressReady => ({
  status: "ready", generatedAt: "", hasEvidence: activeDays > 0,
  overview: { since: null, sessions: activeDays, learningMinutes: activeDays * 25, activeDays, topicsImproved: 0, notCounted: { selfReported: 0, underTenMinutes: 0 } },
  changes: [], growth: { improving: [], steady: [], needsAttention: [], justStarted: [] },
  consistency: { timezone: "Asia/Kolkata", weeks, trend: "not_enough_history", trendBasis: null, lastActiveDay: null, daysSinceLastActive: null, comebacks: [] },
  journey: [], goals: [], nextExam: null, usualSession: null,
});

describe("level", () => {
  it("starts at 1 and rises one for every five active days", () => {
    expect(creatureLevel(0)).toBe(1);
    expect(creatureLevel(4)).toBe(1);
    expect(creatureLevel(5)).toBe(2);
    expect(creatureLevel(27)).toBe(6);
    expect(creatureLevel(-3)).toBe(1);
  });
});

describe("world health", () => {
  it("is 40 with no recent study, and never lower", () => {
    expect(creatureHealth([])).toBe(40);
    expect(creatureHealth([week(0), week(0, { current: true })])).toBe(40);
  });

  it("adds ten for each active day in this week and the last one", () => {
    expect(creatureHealth([week(5), week(3), week(1, { current: true })])).toBe(80);
    expect(creatureHealth([week(2, { current: true })])).toBe(60);
  });

  it("stops at 100", () => {
    expect(creatureHealth([week(7), week(5, { current: true })])).toBe(100);
  });

  it("does not count weeks from before the learner started", () => {
    expect(creatureHealth([week(0, { beforeStart: true }), week(0, { beforeStart: true }), week(2, { current: true })])).toBe(60);
  });
});

describe("the view", () => {
  it("carries Home's streak and Progress's active days unchanged", () => {
    const view = buildCreatureView({ seed: "nova-abc", streakDays: 4, progress: progress(12, [week(4), week(2, { current: true })]) });
    expect(view).toEqual({ status: "ready", seed: "nova-abc", streakDays: 4, activeDays: 12, level: 3, worldHealth: 100 });
  });

  it("is an untouched world for a learner with no counted session", () => {
    const view = buildCreatureView({ seed: "nova-abc", streakDays: 0, progress: progress(0, []) });
    expect(view).toMatchObject({ streakDays: 0, activeDays: 0, level: 1, worldHealth: 40 });
  });

  it("gives each learner a stable seed that does not contain their id", () => {
    expect(creatureSeed("123456789")).toBe(creatureSeed("123456789"));
    expect(creatureSeed("123456789")).not.toBe(creatureSeed("web:abc"));
    expect(creatureSeed("123456789")).not.toContain("123456789");
    expect(creatureSeed("web:abc")).not.toContain("abc");
  });
});

describe("where the numbers come from", () => {
  const source = read("product/creature.ts");

  it("reads the two existing views and nothing else", () => {
    expect(source).toContain("today.progress.streakDays");
    expect(source).toContain("loadNovaProgress(platformChatId");
    // No query, no write and no model of its own.
    expect(source).not.toContain("prisma");
    expect(source).not.toContain("openai");
    expect(source).not.toContain("novaStudySession");
  });

  it("takes the learner from the session, never from the request", () => {
    const route = api("app/api/nova/creature/route.ts");
    expect(route).toContain("resolveNovaLearner()");
    expect(route).toContain("export async function GET()");
    expect(route).not.toContain("searchParams");
    expect(route).not.toContain("req.json");
  });

  it("the page draws a Nova learner's world from the server's numbers, and Rex's from its own", () => {
    const page = web("app/(dashboard)/creature/page.tsx");
    expect(page).toContain("fetch('/api/nova/creature'");
    expect(page).toContain("if (view.status === 'not_nova') return REX_WORLD");
    expect(page).toContain("streak: view.streakDays, totalDays: view.activeDays, level: view.level, health: view.worldHealth");
    // Nothing is drawn, and no number shown, before the server has answered.
    expect(page).toContain("if (!world) return");
    expect(page).toContain("Couldn&apos;t load your world");
  });

  it("is in Nova's navigation", () => {
    expect(read("product/companion.ts")).toContain('{ path: "/creature", label: "Creature" }');
    expect(web("components/sidebar.tsx")).toContain("'/creature': Map");
  });
});
