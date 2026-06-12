import { describe, it, expect } from "vitest";
import {
  calculateProgressPercent,
  calculateGoalStatus,
  resolveGoalType,
} from "../../services/goalProgress.service";

// ─── resolveGoalType ──────────────────────────────────────────────────────────

describe("resolveGoalType", () => {
  it("maps muscle → muscle", () => expect(resolveGoalType("muscle")).toBe("muscle"));
  it("maps bulk → muscle",   () => expect(resolveGoalType("bulk")).toBe("muscle"));
  it("maps fat_loss → fat_loss", () => expect(resolveGoalType("fat_loss")).toBe("fat_loss"));
  it("maps cut → fat_loss",  () => expect(resolveGoalType("cut")).toBe("fat_loss"));
  it("maps strength → strength", () => expect(resolveGoalType("strength")).toBe("strength"));
  it("returns null for recomp",  () => expect(resolveGoalType("recomp")).toBeNull());
  it("returns null for habit",   () => expect(resolveGoalType("habit")).toBeNull());
  it("returns null for empty",   () => expect(resolveGoalType("")).toBeNull());
});

// ─── calculateProgressPercent ────────────────────────────────────────────────

describe("calculateProgressPercent", () => {
  it("returns 0 at baseline", () => {
    expect(calculateProgressPercent(72, 72, 82)).toBe(0);
  });

  it("returns 100 at target", () => {
    expect(calculateProgressPercent(72, 82, 82)).toBe(100);
  });

  it("returns 30% for muscle gain progress", () => {
    // baseline 72, current 75, target 82 → (75-72)/(82-72) = 30%
    expect(calculateProgressPercent(72, 75, 82)).toBe(30);
  });

  it("returns 50% for fat loss progress", () => {
    // baseline 90, current 85, target 80 → (85-90)/(80-90) = 50%
    expect(calculateProgressPercent(90, 85, 80)).toBe(50);
  });

  it("returns 40% for strength progress", () => {
    // baseline 100, current 120, target 150 → (120-100)/(150-100) = 40%
    expect(calculateProgressPercent(100, 120, 150)).toBe(40);
  });

  it("clamps to 0 when current regresses past baseline", () => {
    expect(calculateProgressPercent(72, 70, 82)).toBe(0);
  });

  it("clamps to 100 when current exceeds target", () => {
    expect(calculateProgressPercent(72, 90, 82)).toBe(100);
  });

  it("returns 100 when baseline === target (avoid divide-by-zero)", () => {
    expect(calculateProgressPercent(80, 80, 80)).toBe(100);
  });
});

// ─── calculateGoalStatus ─────────────────────────────────────────────────────

describe("calculateGoalStatus", () => {
  const start      = new Date("2025-01-01");
  const targetDate = new Date("2025-07-01");  // 6-month window

  it("returns unknown when targetDate is null", () => {
    const mid = new Date("2025-04-01");
    expect(calculateGoalStatus(50, start, null, mid)).toBe("unknown");
  });

  it("returns ahead when progress significantly exceeds elapsed %", () => {
    // 3 months elapsed = 50% time, 70% progress → ahead
    const now = new Date("2025-04-01");
    expect(calculateGoalStatus(70, start, targetDate, now)).toBe("ahead");
  });

  it("returns on_track when progress is within ±10% of elapsed %", () => {
    // 3 months elapsed = 50% time, 45% progress → on_track (within -10% band)
    const now = new Date("2025-04-01");
    expect(calculateGoalStatus(45, start, targetDate, now)).toBe("on_track");
  });

  it("returns behind when progress is more than 10% below elapsed %", () => {
    // 3 months elapsed = 50% time, 20% progress → behind
    const now = new Date("2025-04-01");
    expect(calculateGoalStatus(20, start, targetDate, now)).toBe("behind");
  });

  it("returns unknown when targetDate is in the past before start", () => {
    // targetDate < startDate → total <= 0
    const pastTarget = new Date("2024-12-01");
    const now        = new Date("2025-04-01");
    expect(calculateGoalStatus(50, start, pastTarget, now)).toBe("unknown");
  });

  it("returns on_track at day 0 with 0% progress (elapsed = 0%)", () => {
    // elapsed = 0% → elapsedPct = 0, progressPercent 0 ≥ 0-10 → on_track
    expect(calculateGoalStatus(0, start, targetDate, start)).toBe("on_track");
  });
});
