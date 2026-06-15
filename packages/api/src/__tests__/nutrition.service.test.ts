import {
  computeTrendAnalysis,
  computeGrowthAssessment,
} from "../services/nutrition.service";
import type {
  ProteinSummary,
  CalorieBalanceAssessment,
  NutritionTrendAnalysis,
} from "../services/nutrition.service";
import type { GoalProgress } from "../services/goalProgress.service";
import type { RecoveryStatus } from "../engines/recovery-engine";

// ─── computeTrendAnalysis ──────────────────────────────────────────────────────

describe("computeTrendAnalysis", () => {
  it("actionNeeded=true when protein is null (no data = gap)", () => {
    const result = computeTrendAnalysis(null, null, 140);
    expect(result.proteinAdequate).toBeNull();
    expect(result.actionNeeded).toBe(true);
  });

  it("actionNeeded=false when protein is adequate", () => {
    const protein: ProteinSummary = {
      avgDailyG: 150, daysLogged: 5, trend: "stable", confidence: "high",
    };
    const result = computeTrendAnalysis(protein, null, 140);
    expect(result.proteinAdequate).toBe(true);
    expect(result.actionNeeded).toBe(false);
  });

  it("actionNeeded=true when protein is below target", () => {
    const protein: ProteinSummary = {
      avgDailyG: 100, daysLogged: 5, trend: "stable", confidence: "high",
    };
    const result = computeTrendAnalysis(protein, null, 140);
    expect(result.proteinAdequate).toBe(false);
    expect(result.actionNeeded).toBe(true);
  });

  it("actionNeeded=true when calorie not aligned (even if protein adequate)", () => {
    const protein: ProteinSummary = {
      avgDailyG: 150, daysLogged: 5, trend: "stable", confidence: "high",
    };
    const calorie: CalorieBalanceAssessment = {
      impliedBalance: "deficit", alignedWithGoal: false,
      narrative: "Eating less than expected for bulk", confidence: "moderate",
      weeklyRateKg: -0.3,
    };
    const result = computeTrendAnalysis(protein, calorie, 140);
    expect(result.proteinAdequate).toBe(true);
    expect(result.calorieAligned).toBe(false);
    expect(result.actionNeeded).toBe(true);
  });

  it("actionNeeded=false when calorie aligned and protein adequate", () => {
    const protein: ProteinSummary = {
      avgDailyG: 150, daysLogged: 5, trend: "stable", confidence: "high",
    };
    const calorie: CalorieBalanceAssessment = {
      impliedBalance: "surplus", alignedWithGoal: true,
      narrative: "On track for bulk", confidence: "high",
      weeklyRateKg: 0.4,
    };
    const result = computeTrendAnalysis(protein, calorie, 140);
    expect(result.actionNeeded).toBe(false);
  });
});

// ─── computeGrowthAssessment ───────────────────────────────────────────────────

const makeTrend = (overrides: Partial<NutritionTrendAnalysis> = {}): NutritionTrendAnalysis => ({
  tier: 1,
  summary: "No data",
  proteinAdequate: null,
  calorieAligned: null,
  actionNeeded: true,
  ...overrides,
});

const makeGoalProgress = (status: string): GoalProgress => ({
  goalType:        "muscle",
  status:          status as GoalProgress["status"],
  exercise:        null,
  baselineValue:   70,
  currentValue:    73,
  targetValue:     80,
  unit:            "kg",
  startDate:       "2026-01-01",
  targetDate:      null,
  progressPercent: 30,
});

const makeRecovery = (constraintLevel: string): RecoveryStatus => ({
  score: 45,
  status: "limited",
  constraintLevel: constraintLevel as RecoveryStatus["constraintLevel"],
  factors: ["Poor sleep"],
});

describe("computeGrowthAssessment — unknown status branch", () => {
  it("returns overallStatus=on_track when goalProgress.status=unknown", () => {
    const result = computeGrowthAssessment(
      makeGoalProgress("unknown"), null, makeTrend({ proteinAdequate: true, actionNeeded: false }), 70, null
    );
    expect(result?.overallStatus).toBe("on_track");
  });

  it("limiter=recovery when recovery is constrained and status=unknown", () => {
    const result = computeGrowthAssessment(
      makeGoalProgress("unknown"), null, makeTrend(), 70, makeRecovery("intensity_reduced")
    );
    expect(result?.primaryLimiter).toBe("recovery");
    expect(result?.overallStatus).toBe("on_track");
  });

  it("limiter=nutrition when protein=null and no recovery constraint and status=unknown", () => {
    const result = computeGrowthAssessment(
      makeGoalProgress("unknown"), null, makeTrend({ proteinAdequate: null }), 70, null
    );
    expect(result?.primaryLimiter).toBe("nutrition");
  });

  it("limiter=nutrition when protein=false and no recovery constraint and status=unknown", () => {
    const result = computeGrowthAssessment(
      makeGoalProgress("unknown"), null, makeTrend({ proteinAdequate: false, actionNeeded: true }), 70, null
    );
    expect(result?.primaryLimiter).toBe("nutrition");
  });

  it("limiter=training when consistency<40 and protein adequate and no recovery constraint and status=unknown", () => {
    const result = computeGrowthAssessment(
      makeGoalProgress("unknown"), null, makeTrend({ proteinAdequate: true, actionNeeded: false }), 30, null
    );
    expect(result?.primaryLimiter).toBe("training");
  });

  it("limiter=unknown when all signals clear and status=unknown", () => {
    const result = computeGrowthAssessment(
      makeGoalProgress("unknown"), null, makeTrend({ proteinAdequate: true, actionNeeded: false }), 70, null
    );
    expect(result?.primaryLimiter).toBe("unknown");
    expect(result?.overallStatus).toBe("on_track");
  });

  it("returns null when goalProgress is null", () => {
    const result = computeGrowthAssessment(null, null, makeTrend(), 70, null);
    expect(result).toBeNull();
  });
});
