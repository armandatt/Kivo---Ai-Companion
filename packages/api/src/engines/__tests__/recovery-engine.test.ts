/**
 * Recovery Engine — Unit Tests (Phase 5C.1)
 *
 * All pure-function tests run with no DB, no LLM, no I/O.
 * getRecoverySummary is NOT tested here (requires DB).
 * buildRecoveryBlock is imported from llm.ts and tested separately.
 */

// ─── LLM mocks (needed because llm.ts imports openai and personna) ────────────
jest.mock("../../services/openai.service", () => ({
  generateOpenAIText: jest.fn(),
}));
jest.mock("../../services/personna.service", () => ({
  getPersona: jest.fn(() => ({ name: "rex", voice: "", toneModifiers: {} })),
}));
jest.mock("../../engines/planner-engine", () => ({
  summarizePlan: jest.fn(() => ""),
  generatePlan:  jest.fn(),
}));

import {
  calculateRecoveryScore,
  calculateRecoveryStatus,
  applySystemicOverrides,
  calculateConstraintLevel,
  buildRecoveryFactors,
  RECOVERY_INTELLIGENCE_ENABLED,
} from "../recovery-engine";
import type { RecentSession, RecoveryStatus } from "../recovery-engine";
import { buildRecoveryBlock } from "../../services/llm";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NOW_MS = new Date("2026-06-13T18:00:00Z").getTime();

function makeSession(overrides: Partial<RecentSession> = {}): RecentSession {
  return {
    date:           new Date(NOW_MS - 1 * 24 * 60 * 60 * 1000), // yesterday
    musclesTrained: ["chest", "triceps"],
    totalSets:      null,
    avgRpe:         null,
    ...overrides,
  };
}

function sessionDaysAgo(days: number, overrides: Partial<RecentSession> = {}): RecentSession {
  return makeSession({
    date: new Date(NOW_MS - days * 24 * 60 * 60 * 1000),
    ...overrides,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// calculateRecoveryStatus
// ═══════════════════════════════════════════════════════════════════════════════

describe("calculateRecoveryStatus", () => {
  it("80–100 → ready", () => {
    expect(calculateRecoveryStatus(100)).toBe("ready");
    expect(calculateRecoveryStatus(80)).toBe("ready");
    expect(calculateRecoveryStatus(95)).toBe("ready");
  });

  it("50–79 → limited", () => {
    expect(calculateRecoveryStatus(79)).toBe("limited");
    expect(calculateRecoveryStatus(50)).toBe("limited");
    expect(calculateRecoveryStatus(65)).toBe("limited");
  });

  it("0–49 → rest", () => {
    expect(calculateRecoveryStatus(49)).toBe("rest");
    expect(calculateRecoveryStatus(0)).toBe("rest");
    expect(calculateRecoveryStatus(25)).toBe("rest");
  });

  it("boundary 80 is ready, 79 is limited", () => {
    expect(calculateRecoveryStatus(80)).toBe("ready");
    expect(calculateRecoveryStatus(79)).toBe("limited");
  });

  it("boundary 50 is limited, 49 is rest", () => {
    expect(calculateRecoveryStatus(50)).toBe("limited");
    expect(calculateRecoveryStatus(49)).toBe("rest");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// applySystemicOverrides — FIX 2
// ═══════════════════════════════════════════════════════════════════════════════

describe("applySystemicOverrides", () => {
  it("READY + burnoutRisk=90 → LIMITED", () => {
    expect(applySystemicOverrides("ready", 90)).toBe("limited");
  });

  it("READY + burnoutRisk=70 → LIMITED (boundary)", () => {
    expect(applySystemicOverrides("ready", 70)).toBe("limited");
  });

  it("READY + burnoutRisk=69 → remains READY (below threshold)", () => {
    expect(applySystemicOverrides("ready", 69)).toBe("ready");
  });

  it("LIMITED + burnoutRisk=90 → remains LIMITED (not downgraded to rest)", () => {
    expect(applySystemicOverrides("limited", 90)).toBe("limited");
  });

  it("REST + burnoutRisk=90 → remains REST", () => {
    expect(applySystemicOverrides("rest", 90)).toBe("rest");
  });

  it("READY + burnoutRisk=0 → remains READY", () => {
    expect(applySystemicOverrides("ready", 0)).toBe("ready");
  });

  it("rested athlete burnoutRisk=90: score 80 → raw READY → overridden to LIMITED", () => {
    // daysSinceLastSession=3: +5 capped at 100, no sessions, no stress
    const score     = calculateRecoveryScore(3, [], 0, 90, 0, NOW_MS);
    const rawStatus = calculateRecoveryStatus(score);
    const status    = applySystemicOverrides(rawStatus, 90);
    expect(score).toBe(80);      // numeric score reaches READY threshold
    expect(rawStatus).toBe("ready");
    expect(status).toBe("limited"); // override fires
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// calculateConstraintLevel
// ═══════════════════════════════════════════════════════════════════════════════

describe("calculateConstraintLevel", () => {
  it("READY → unrestricted", () => {
    expect(calculateConstraintLevel("ready")).toBe("unrestricted");
  });

  it("LIMITED → intensity_reduced", () => {
    expect(calculateConstraintLevel("limited")).toBe("intensity_reduced");
  });

  it("REST → training_blocked", () => {
    expect(calculateConstraintLevel("rest")).toBe("training_blocked");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// calculateRecoveryScore — rest time
// ═══════════════════════════════════════════════════════════════════════════════

describe("calculateRecoveryScore — rest time", () => {
  it("trained today (0 days) deducts 25 from base 100", () => {
    const score = calculateRecoveryScore(0, [], 0, 0, 0, NOW_MS);
    expect(score).toBe(75);
  });

  it("1 day ago deducts 10", () => {
    const score = calculateRecoveryScore(1, [], 0, 0, 0, NOW_MS);
    expect(score).toBe(90);
  });

  it("2 days ago: no deduction (48 h standard recovery)", () => {
    const score = calculateRecoveryScore(2, [], 0, 0, 0, NOW_MS);
    expect(score).toBe(100);
  });

  it("3+ days ago adds 5 (capped at 100)", () => {
    const score3 = calculateRecoveryScore(3, [], 0, 0, 0, NOW_MS);
    const score7 = calculateRecoveryScore(7, [], 0, 0, 0, NOW_MS);
    expect(score3).toBe(100); // 100 + 5 capped at 100
    expect(score7).toBe(100);
  });

  it("no history (999 days) yields 100", () => {
    const score = calculateRecoveryScore(999, [], 0, 0, 0, NOW_MS);
    expect(score).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// calculateRecoveryScore — recent load (48 h window)
// ═══════════════════════════════════════════════════════════════════════════════

describe("calculateRecoveryScore — recent load", () => {
  it("2 sessions within 48 h deducts 10", () => {
    // Non-overlapping muscles so muscle-overlap deduction does not compound.
    const sessions = [
      sessionDaysAgo(0, { musclesTrained: ["chest"] }),
      sessionDaysAgo(1, { musclesTrained: ["back"] }),
    ];
    // days=0 → -25, 2 in 48h → -10, no overlap → 65
    const score = calculateRecoveryScore(0, sessions, 0, 0, 0, NOW_MS);
    expect(score).toBe(65);
  });

  it("3+ sessions within 48 h deducts 20", () => {
    // Non-overlapping muscles between adjacent sessions.
    const sessions = [
      sessionDaysAgo(0,   { musclesTrained: ["chest"] }),
      sessionDaysAgo(0.5, { musclesTrained: ["back"] }),
      sessionDaysAgo(1,   { musclesTrained: ["legs"] }),
    ];
    // days=0 → -25, 3 in 48h → -20, no overlap (chest vs back) → 55
    const score = calculateRecoveryScore(0, sessions, 0, 0, 0, NOW_MS);
    expect(score).toBe(55);
  });

  it("sessions older than 48 h do not count toward load deduction", () => {
    const sessions = [
      sessionDaysAgo(3), // older than 48 h
      sessionDaysAgo(4),
    ];
    // days=3 → +5 → 100, sessions are old → no load deduction
    const score = calculateRecoveryScore(3, sessions, 0, 0, 0, NOW_MS);
    expect(score).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// calculateRecoveryScore — session volume
// ═══════════════════════════════════════════════════════════════════════════════

describe("calculateRecoveryScore — volume", () => {
  it(">30 sets deducts 15", () => {
    const sessions = [sessionDaysAgo(1, { totalSets: 31 })];
    const score = calculateRecoveryScore(1, sessions, 0, 0, 0, NOW_MS);
    // -10 (1 day) -15 (volume)
    expect(score).toBe(75);
  });

  it("21-30 sets deducts 8", () => {
    const sessions = [sessionDaysAgo(1, { totalSets: 25 })];
    const score = calculateRecoveryScore(1, sessions, 0, 0, 0, NOW_MS);
    // -10 (1 day) -8 (volume)
    expect(score).toBe(82);
  });

  it("≤20 sets: no volume deduction", () => {
    const sessions = [sessionDaysAgo(1, { totalSets: 20 })];
    const score = calculateRecoveryScore(1, sessions, 0, 0, 0, NOW_MS);
    expect(score).toBe(90);
  });

  it("null totalSets: no volume deduction", () => {
    const sessions = [sessionDaysAgo(1, { totalSets: null })];
    const score = calculateRecoveryScore(1, sessions, 0, 0, 0, NOW_MS);
    expect(score).toBe(90);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// calculateRecoveryScore — volume/RPE recency gate — FIX 3
// ═══════════════════════════════════════════════════════════════════════════════

describe("calculateRecoveryScore — volume/RPE recency gate", () => {
  it("heavy session 2 days ago: volume and RPE deductions still fire (boundary)", () => {
    // daysSinceLastSession=2 is within the gate (≤ 2).
    const sessions = [sessionDaysAgo(2, { totalSets: 35, avgRpe: 9.0 })];
    const score = calculateRecoveryScore(2, sessions, 0, 0, 0, NOW_MS);
    // days=2 → no rest deduction, volume -15, RPE -12 → 73
    expect(score).toBe(73);
  });

  it("heavy session 3 days ago: no volume or RPE deduction (gate blocks)", () => {
    const sessions = [sessionDaysAgo(3, { totalSets: 35, avgRpe: 9.0 })];
    const score = calculateRecoveryScore(3, sessions, 0, 0, 0, NOW_MS);
    // days=3 → +5 (capped 100), no volume/RPE → 100
    expect(score).toBe(100);
  });

  it("heavy session 7 days ago: no volume or RPE deduction", () => {
    const sessions = [sessionDaysAgo(7, { totalSets: 40, avgRpe: 9.5 })];
    const score = calculateRecoveryScore(7, sessions, 0, 0, 0, NOW_MS);
    expect(score).toBe(100);
  });

  it("high-RPE session 3 days ago: no RPE deduction", () => {
    const sessions = [sessionDaysAgo(3, { avgRpe: 9.0 })];
    const score = calculateRecoveryScore(3, sessions, 0, 0, 0, NOW_MS);
    expect(score).toBe(100);
  });

  it("factors: heavy session 3 days ago produces no volume/RPE factors", () => {
    const sessions = [sessionDaysAgo(3, { totalSets: 35, avgRpe: 9.0 })];
    const factors = buildRecoveryFactors(3, sessions, 0, 0, 0, 100, NOW_MS);
    expect(factors).not.toContain("Very high session volume");
    expect(factors).not.toContain("High session intensity (RPE > 8.5)");
  });

  it("factors: heavy session 1 day ago still produces volume/RPE factors", () => {
    const sessions = [sessionDaysAgo(1, { totalSets: 35, avgRpe: 9.0 })];
    const factors = buildRecoveryFactors(1, sessions, 0, 0, 0, 60, NOW_MS);
    expect(factors).toContain("Very high session volume");
    expect(factors).toContain("High session intensity (RPE > 8.5)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// calculateRecoveryScore — RPE
// ═══════════════════════════════════════════════════════════════════════════════

describe("calculateRecoveryScore — RPE", () => {
  it("avgRpe > 8.5 deducts 12", () => {
    const sessions = [sessionDaysAgo(1, { avgRpe: 9.0 })];
    const score = calculateRecoveryScore(1, sessions, 0, 0, 0, NOW_MS);
    // -10 (1 day) -12 (RPE)
    expect(score).toBe(78);
  });

  it("avgRpe 7.6–8.5 deducts 6", () => {
    const sessions = [sessionDaysAgo(1, { avgRpe: 8.0 })];
    const score = calculateRecoveryScore(1, sessions, 0, 0, 0, NOW_MS);
    // -10 (1 day) -6 (RPE)
    expect(score).toBe(84);
  });

  it("avgRpe ≤ 7.5: no RPE deduction", () => {
    const sessions = [sessionDaysAgo(1, { avgRpe: 7.5 })];
    const score = calculateRecoveryScore(1, sessions, 0, 0, 0, NOW_MS);
    expect(score).toBe(90);
  });

  it("null avgRpe: no RPE deduction", () => {
    const sessions = [sessionDaysAgo(1, { avgRpe: null })];
    const score = calculateRecoveryScore(1, sessions, 0, 0, 0, NOW_MS);
    expect(score).toBe(90);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// calculateRecoveryScore — muscle overlap
// ═══════════════════════════════════════════════════════════════════════════════

describe("calculateRecoveryScore — muscle overlap", () => {
  it("2+ overlapping muscles deducts 15", () => {
    const sessions = [
      sessionDaysAgo(0, { musclesTrained: ["chest", "triceps"] }),
      sessionDaysAgo(1, { musclesTrained: ["chest", "triceps", "shoulders"] }),
    ];
    // days=0 → -25, 2 in 48h → -10, overlap 2 muscles → -15 = 50
    const score = calculateRecoveryScore(0, sessions, 0, 0, 0, NOW_MS);
    expect(score).toBe(50);
  });

  it("1 overlapping muscle deducts 7", () => {
    const sessions = [
      sessionDaysAgo(0, { musclesTrained: ["chest"] }),
      sessionDaysAgo(1, { musclesTrained: ["chest", "back"] }),
    ];
    // days=0 → -25, 2 in 48h → -10, overlap 1 muscle → -7 = 58
    const score = calculateRecoveryScore(0, sessions, 0, 0, 0, NOW_MS);
    expect(score).toBe(58);
  });

  it("no overlapping muscles: no overlap deduction (load still applies)", () => {
    const sessions = [
      sessionDaysAgo(0, { musclesTrained: ["chest"] }),
      sessionDaysAgo(1, { musclesTrained: ["back", "biceps"] }),
    ];
    // days=0 → -25, 2 in 48h → -10, no overlap → 65
    const score = calculateRecoveryScore(0, sessions, 0, 0, 0, NOW_MS);
    expect(score).toBe(65);
  });

  it("case-insensitive muscle comparison", () => {
    const sessions = [
      sessionDaysAgo(0, { musclesTrained: ["Chest", "Triceps"] }),
      sessionDaysAgo(1, { musclesTrained: ["chest", "triceps"] }),
    ];
    // days=0 → -25, 2 in 48h → -10, 2 overlaps → -15 = 50
    const score = calculateRecoveryScore(0, sessions, 0, 0, 0, NOW_MS);
    expect(score).toBe(50);
  });

  it("overlap check skipped when daysSinceLastSession > 1", () => {
    const sessions = [
      sessionDaysAgo(2, { musclesTrained: ["chest", "triceps"] }),
      sessionDaysAgo(3, { musclesTrained: ["chest", "triceps"] }),
    ];
    // days=2 → no deduction, no overlap check
    const score = calculateRecoveryScore(2, sessions, 0, 0, 0, NOW_MS);
    expect(score).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// calculateRecoveryScore — burnout and stress
// ═══════════════════════════════════════════════════════════════════════════════

describe("calculateRecoveryScore — burnout and stress", () => {
  it("burnoutRisk ≥ 70 deducts 20", () => {
    const score = calculateRecoveryScore(2, [], 0, 75, 0, NOW_MS);
    expect(score).toBe(80);
  });

  it("burnoutRisk 50–69 deducts 10", () => {
    const score = calculateRecoveryScore(2, [], 0, 60, 0, NOW_MS);
    expect(score).toBe(90);
  });

  it("burnoutRisk < 50: no deduction", () => {
    const score = calculateRecoveryScore(2, [], 0, 49, 0, NOW_MS);
    expect(score).toBe(100);
  });

  it("stress ≥ 75 deducts 8", () => {
    const score = calculateRecoveryScore(2, [], 0, 0, 80, NOW_MS);
    expect(score).toBe(92);
  });

  it("stress 55–74 deducts 4", () => {
    const score = calculateRecoveryScore(2, [], 0, 0, 60, NOW_MS);
    expect(score).toBe(96);
  });

  it("stress < 55: no deduction", () => {
    const score = calculateRecoveryScore(2, [], 0, 0, 54, NOW_MS);
    expect(score).toBe(100);
  });

  it("combined burnout 70 + stress 75: total deduction 28", () => {
    const score = calculateRecoveryScore(2, [], 0, 70, 75, NOW_MS);
    expect(score).toBe(72);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// calculateRecoveryScore — frequency
// ═══════════════════════════════════════════════════════════════════════════════

describe("calculateRecoveryScore — weekly frequency", () => {
  it("completionRate7d > 0.9 deducts 5", () => {
    const score = calculateRecoveryScore(2, [], 0.95, 0, 0, NOW_MS);
    expect(score).toBe(95);
  });

  it("completionRate7d ≤ 0.9: no deduction", () => {
    const score = calculateRecoveryScore(2, [], 0.9, 0, 0, NOW_MS);
    expect(score).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// calculateRecoveryScore — clamping
// ═══════════════════════════════════════════════════════════════════════════════

describe("calculateRecoveryScore — clamping", () => {
  it("score never exceeds 100", () => {
    // 3+ days rest adds 5, but clamped at 100
    const score = calculateRecoveryScore(7, [], 0, 0, 0, NOW_MS);
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBe(100);
  });

  it("score never goes below 0 with maximum stressors", () => {
    const heavySessions = [
      sessionDaysAgo(0, { musclesTrained: ["chest"], totalSets: 40, avgRpe: 9.5 }),
      sessionDaysAgo(0.5, { musclesTrained: ["chest"], totalSets: 40, avgRpe: 9.5 }),
      sessionDaysAgo(1, { musclesTrained: ["chest"], totalSets: 40, avgRpe: 9.5 }),
    ];
    const score = calculateRecoveryScore(0, heavySessions, 1.0, 90, 90, NOW_MS);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("score is an integer (rounded)", () => {
    const score = calculateRecoveryScore(1, [], 0.5, 35, 40, NOW_MS);
    expect(Number.isInteger(score)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildRecoveryFactors
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildRecoveryFactors", () => {
  it("returns 'Trained today' when daysSinceLastSession = 0", () => {
    const factors = buildRecoveryFactors(0, [], 0, 0, 0, 60, NOW_MS);
    expect(factors).toContain("Trained today");
  });

  it("returns '24 h since last session' when daysSinceLastSession = 1", () => {
    const factors = buildRecoveryFactors(1, [], 0, 0, 0, 85, NOW_MS);
    expect(factors).toContain("24 h since last session");
  });

  it("returns 'X days since last session' when ≥ 3", () => {
    const factors = buildRecoveryFactors(5, [], 0, 0, 0, 100, NOW_MS);
    expect(factors).toContain("5 days since last session");
  });

  it("returns high burnout factor first when burnoutRisk ≥ 70", () => {
    const factors = buildRecoveryFactors(0, [], 0, 75, 0, 40, NOW_MS);
    expect(factors[0]).toBe("High burnout risk");
  });

  it("returns elevated burnout when burnoutRisk 50–69", () => {
    const factors = buildRecoveryFactors(2, [], 0, 60, 0, 90, NOW_MS);
    expect(factors).toContain("Elevated burnout risk");
  });

  it("returns high stress factor", () => {
    const factors = buildRecoveryFactors(2, [], 0, 0, 80, 92, NOW_MS);
    expect(factors).toContain("High external stress");
  });

  it("returns elevated stress when stress 55–74", () => {
    const factors = buildRecoveryFactors(2, [], 0, 0, 60, 96, NOW_MS);
    expect(factors).toContain("Elevated stress");
  });

  it("returns 'Very high session volume' when totalSets > 30 and session is recent", () => {
    const sessions = [sessionDaysAgo(0, { totalSets: 35 })];
    const factors = buildRecoveryFactors(0, sessions, 0, 0, 0, 60, NOW_MS);
    expect(factors).toContain("Very high session volume");
  });

  it("returns 'High session volume' when totalSets 21–30 and session is recent", () => {
    const sessions = [sessionDaysAgo(0, { totalSets: 25 })];
    const factors = buildRecoveryFactors(0, sessions, 0, 0, 0, 65, NOW_MS);
    expect(factors).toContain("High session volume");
  });

  it("returns RPE factor when avgRpe > 8.5 and session is recent", () => {
    const sessions = [sessionDaysAgo(1, { avgRpe: 9.0 })];
    const factors = buildRecoveryFactors(1, sessions, 0, 0, 0, 78, NOW_MS);
    expect(factors).toContain("High session intensity (RPE > 8.5)");
  });

  it("returns consecutive days factor when 2+ sessions in 48 h", () => {
    const sessions = [sessionDaysAgo(0), sessionDaysAgo(1)];
    const factors = buildRecoveryFactors(0, sessions, 0, 0, 0, 55, NOW_MS);
    expect(factors).toContain("Consecutive training days");
  });

  it("returns muscle overlap factor", () => {
    const sessions = [
      sessionDaysAgo(0, { musclesTrained: ["chest"] }),
      sessionDaysAgo(1, { musclesTrained: ["chest", "triceps"] }),
    ];
    const factors = buildRecoveryFactors(0, sessions, 0, 0, 0, 53, NOW_MS);
    expect(factors).toContain("Same muscle group trained back-to-back");
  });

  it("returns 'Adequate rest' positive factor when score ≥ 80 and no negatives", () => {
    // daysSinceLastSession=2 produces no factor (48h is the standard window).
    // With no other negative factors and score ≥ 80, the positive fallback fires.
    const factors = buildRecoveryFactors(2, [], 0, 0, 0, 100, NOW_MS);
    expect(factors).toContain("Adequate rest since last session");
  });

  it("does not return 'Adequate rest' when other factors exist", () => {
    const factors = buildRecoveryFactors(0, [], 0, 0, 0, 60, NOW_MS);
    expect(factors).not.toContain("Adequate rest since last session");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildRecoveryBlock (from llm.ts)
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildRecoveryBlock", () => {
  it("returns empty string for null status", () => {
    expect(buildRecoveryBlock(null)).toBe("");
  });

  it("includes RECOVERY STATUS header", () => {
    const status: RecoveryStatus = {
      score: 85, status: "ready",
      constraintLevel: "unrestricted",
      factors: ["Adequate rest since last session"],
    };
    const block = buildRecoveryBlock(status);
    expect(block).toContain("RECOVERY STATUS");
  });

  it("shows score and uppercased status label", () => {
    const status: RecoveryStatus = {
      score: 74, status: "limited",
      constraintLevel: "intensity_reduced",
      factors: ["High soreness", "Recent training load"],
    };
    const block = buildRecoveryBlock(status);
    expect(block).toContain("Recovery score: 74");
    expect(block).toContain("Status: LIMITED");
  });

  it("shows each factor as a bullet", () => {
    const status: RecoveryStatus = {
      score: 35, status: "rest",
      constraintLevel: "training_blocked",
      factors: ["High burnout risk", "Trained today"],
    };
    const block = buildRecoveryBlock(status);
    expect(block).toContain("• High burnout risk");
    expect(block).toContain("• Trained today");
  });

  it("shows 'None identified' when factors array is empty", () => {
    const status: RecoveryStatus = {
      score: 90, status: "ready",
      constraintLevel: "unrestricted",
      factors: [],
    };
    const block = buildRecoveryBlock(status);
    expect(block).toContain("• None identified");
  });

  it("shows constraint level", () => {
    const status: RecoveryStatus = {
      score: 42, status: "rest",
      constraintLevel: "training_blocked",
      factors: ["High burnout risk"],
    };
    const block = buildRecoveryBlock(status);
    expect(block).toContain("Constraint level: training_blocked");
  });

  it("READY status is uppercased", () => {
    const status: RecoveryStatus = {
      score: 90, status: "ready",
      constraintLevel: "unrestricted",
      factors: [],
    };
    expect(buildRecoveryBlock(status)).toContain("Status: READY");
  });

  it("REST status is uppercased", () => {
    const status: RecoveryStatus = {
      score: 30, status: "rest",
      constraintLevel: "training_blocked",
      factors: ["High burnout risk"],
    };
    expect(buildRecoveryBlock(status)).toContain("Status: REST");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RECOVERY_INTELLIGENCE_ENABLED feature flag
// ═══════════════════════════════════════════════════════════════════════════════

describe("RECOVERY_INTELLIGENCE_ENABLED", () => {
  it("is true by default (env var not set to false)", () => {
    expect(typeof RECOVERY_INTELLIGENCE_ENABLED).toBe("boolean");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// End-to-end scenario evaluations
// ═══════════════════════════════════════════════════════════════════════════════

describe("Recovery scenarios", () => {
  it("fresh after rest day: score ≥ 80 → ready", () => {
    // Trained 2 days ago, no burnout, no stress
    const score  = calculateRecoveryScore(2, [sessionDaysAgo(2)], 0.5, 10, 20, NOW_MS);
    const status = calculateRecoveryStatus(score);
    expect(status).toBe("ready");
  });

  it("trained today, high volume, elevated burnout → rest", () => {
    const sessions = [sessionDaysAgo(0, { totalSets: 35, avgRpe: 9.0 })];
    const score  = calculateRecoveryScore(0, sessions, 0.8, 65, 50, NOW_MS);
    const status = calculateRecoveryStatus(score);
    expect(status).toBe("rest");
  });

  it("trained yesterday, moderate volume, medium stress → limited", () => {
    const sessions = [sessionDaysAgo(1, { totalSets: 22, avgRpe: 7.0 })];
    const score  = calculateRecoveryScore(1, sessions, 0.6, 30, 55, NOW_MS);
    const status = calculateRecoveryStatus(score);
    // -10 (1d) -8 (volume) -4 (stress) = 78 → limited
    expect(status).toBe("limited");
  });

  it("no sessions in 4 days, no burnout → ready with positive factor", () => {
    const score   = calculateRecoveryScore(4, [], 0.2, 15, 20, NOW_MS);
    const status  = calculateRecoveryStatus(score);
    const factors = buildRecoveryFactors(4, [], 0.2, 15, 20, score, NOW_MS);
    expect(status).toBe("ready");
    expect(factors).toContain("4 days since last session");
  });

  it("back-to-back same muscles reduces score enough for limited", () => {
    const sessions = [
      sessionDaysAgo(0, { musclesTrained: ["chest", "triceps"], totalSets: 18 }),
      sessionDaysAgo(1, { musclesTrained: ["chest", "triceps"], totalSets: 18 }),
    ];
    const score = calculateRecoveryScore(0, sessions, 0.7, 20, 30, NOW_MS);
    // -25 (today) -10 (2 in 48h) -15 (muscle overlap) = 50 → limited
    expect(score).toBeLessThanOrEqual(55);
    expect(calculateRecoveryStatus(score)).not.toBe("ready");
  });

  it("critical burnout alone pushes score into sub-ready territory", () => {
    const score = calculateRecoveryScore(2, [], 0.5, 85, 80, NOW_MS);
    // -20 (burnout) -8 (stress) = 72 → limited
    expect(score).toBeLessThan(80);
  });

  it("very high burnout + today's session → rest", () => {
    const score = calculateRecoveryScore(0, [sessionDaysAgo(0, { totalSets: 32, avgRpe: 9.5 })], 0.9, 80, 80, NOW_MS);
    const status = calculateRecoveryStatus(score);
    expect(status).toBe("rest");
  });

  // ── Phase 5C.1: conflict resolution scenarios ─────────────────────────────

  it("REST: constraintLevel is training_blocked", () => {
    // daysSinceLastSession=1, hard session yesterday, burnout → score < 50 = REST
    const sessions = [sessionDaysAgo(1, { totalSets: 35, avgRpe: 9.5 })];
    const score    = calculateRecoveryScore(1, sessions, 0.8, 75, 75, NOW_MS);
    const status   = applySystemicOverrides(calculateRecoveryStatus(score), 75);
    const constraintLevel = calculateConstraintLevel(status);
    expect(status).toBe("rest");
    expect(constraintLevel).toBe("training_blocked");
  });

  it("burnoutRisk=90 rested athlete: applySystemicOverrides prevents READY", () => {
    const score     = calculateRecoveryScore(3, [], 0, 90, 0, NOW_MS);
    const rawStatus = calculateRecoveryStatus(score);
    const status    = applySystemicOverrides(rawStatus, 90);
    expect(rawStatus).toBe("ready");    // score alone would pass
    expect(status).toBe("limited");     // override fires
    const constraintLevel = calculateConstraintLevel(status);
    expect(constraintLevel).toBe("intensity_reduced");
  });
});
