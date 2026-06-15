// ═══════════════════════════════════════════════════════════════════════════════
// NUTRITION INTELLIGENCE SERVICE — Phase 6.1 (correctness patch)
//
// Tier 1 (always available): CalorieBalanceAssessment derived from WeightTrend.
// Tier 2 (when meals are logged): ProteinSummary + MealMemory.
//
// Feature flag: NUTRITION_INTELLIGENCE_ENABLED
//   Set to "false" to bypass completely. Default: enabled.
// ═══════════════════════════════════════════════════════════════════════════════

import { prisma } from "@repo/db/client";
import type { WeightTrend } from "./bodyweight.service";
import type { GoalProgress } from "./goalProgress.service";
import type { RecoveryStatus } from "../engines/recovery-engine";

// ─── Feature flag ─────────────────────────────────────────────────────────────

export const NUTRITION_INTELLIGENCE_ENABLED =
  process.env.NUTRITION_INTELLIGENCE_ENABLED !== "false";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProteinSummary {
  avgDailyG:  number;
  daysLogged: number;
  trend:      "up" | "down" | "stable";
  confidence: "low" | "moderate" | "high";
}

export interface CalorieBalanceAssessment {
  impliedBalance:  "surplus" | "deficit" | "maintenance" | "unclear";
  alignedWithGoal: boolean | null;  // null only for strength at maintenance (acceptable)
  weeklyRateKg:    number;
  narrative:       string;
  confidence:      "low" | "moderate" | "high";
}

export interface MealMemory {
  topFoods:          string[];  // up to 5 recurring food words (freq >= 2)
  avgProteinPerLog:  number;
  lastLoggedDaysAgo: number;
}

export interface NutritionTrendAnalysis {
  tier:            1 | 2;
  summary:         string;
  proteinAdequate: boolean | null;
  calorieAligned:  boolean | null;
  actionNeeded:    boolean;
}

export interface GrowthAssessment {
  overallStatus:  "on_track" | "behind" | "critical" | "unknown";
  primaryLimiter: "training" | "nutrition" | "recovery" | "adherence" | "unknown";
  narrative:      string;
}

export interface NutritionContext {
  tier:                1 | 2;
  proteinTargetG:      number;          // Fix 1: personalized (bodyweightKg * 1.8, min 100)
  proteinSummary:      ProteinSummary | null;
  calorieBalance:      CalorieBalanceAssessment | null;
  trendAnalysis:       NutritionTrendAnalysis;
  mealMemory:          MealMemory | null;
  adherenceSelfReport: "positive" | "negative" | null;
  growthAssessment:    GrowthAssessment | null;
  canonicalEvidence: {
    protein_intake?:             string;
    calorie_surplus_or_deficit?: string;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FOOD_STOP_WORDS = new Set([
  "had", "ate", "eaten", "eating", "just", "some", "the", "and", "with",
  "for", "was", "been", "have", "today", "yesterday", "lunch", "dinner",
  "breakfast", "snack", "meal", "food", "around", "about", "like", "good",
  "post", "pre", "workout", "big", "small", "little", "bit", "lot", "lots",
  "grams", "gram", "protein", "calories", "carbs", "fat",
]);

const SURPLUS_GOALS = new Set(["muscle", "bulk"]);
const DEFICIT_GOALS = new Set(["fat_loss", "cut"]);

// Protein target multiplier (g per kg bodyweight)
const PROTEIN_PER_KG = 1.8;
const PROTEIN_TARGET_FALLBACK = 140; // used only when bodyweight is unknown

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface NutritionLogEntry {
  date:            Date;
  proteinEstimate: number | null;
  description:     string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// computeProteinSummary — Tier 2
// Pure. Returns null when no logs with protein estimates in last 7 days.
// ═══════════════════════════════════════════════════════════════════════════════

export function computeProteinSummary(
  logs: NutritionLogEntry[],
  now  = new Date(),
): ProteinSummary | null {
  const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const recent = logs.filter(l => l.date >= cutoff && l.proteinEstimate !== null);
  if (recent.length === 0) return null;

  const byDay = new Map<string, number[]>();
  for (const l of recent) {
    const key = l.date.toISOString().slice(0, 10);
    const arr = byDay.get(key) ?? [];
    arr.push(l.proteinEstimate!);
    byDay.set(key, arr);
  }

  const daysLogged  = byDay.size;
  const dailyTotals = [...byDay.values()].map(arr => arr.reduce((a, b) => a + b, 0));
  const avgDailyG   = Math.round(dailyTotals.reduce((a, b) => a + b, 0) / daysLogged);

  const sortedDays = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  const half = Math.floor(sortedDays.length / 2);
  let trend: ProteinSummary["trend"] = "stable";
  if (half >= 1) {
    const earlyAvg = sortedDays.slice(0, half)
      .map(([, v]) => v.reduce((a, b) => a + b, 0))
      .reduce((a, b) => a + b, 0) / half;
    const lateAvg = sortedDays.slice(half)
      .map(([, v]) => v.reduce((a, b) => a + b, 0))
      .reduce((a, b) => a + b, 0) / (sortedDays.length - half);
    const diff = lateAvg - earlyAvg;
    trend = diff > 10 ? "up" : diff < -10 ? "down" : "stable";
  }

  const confidence: ProteinSummary["confidence"] =
    daysLogged >= 5 ? "high" : daysLogged >= 3 ? "moderate" : "low";

  return { avgDailyG, daysLogged, trend, confidence };
}

// ═══════════════════════════════════════════════════════════════════════════════
// computeCalorieBalance — Tier 1
// Fix 2: maintenance = false (not null) for surplus/deficit goals.
// Pure. Returns null when < 2 weight entries.
// ═══════════════════════════════════════════════════════════════════════════════

export function computeCalorieBalance(
  weeklyRateKg:    number,
  goalCategory:    string | null,
  weightEntryCount: number,
): CalorieBalanceAssessment | null {
  if (weightEntryCount < 2) return null;

  const SURPLUS_THRESHOLD = 0.15;
  const DEFICIT_THRESHOLD = -0.15;

  let impliedBalance: CalorieBalanceAssessment["impliedBalance"];
  if (weeklyRateKg > SURPLUS_THRESHOLD)       impliedBalance = "surplus";
  else if (weeklyRateKg < DEFICIT_THRESHOLD)  impliedBalance = "deficit";
  else                                         impliedBalance = "maintenance";

  const gc = goalCategory?.toLowerCase().trim() ?? null;
  let alignedWithGoal: boolean | null = null;

  if (gc && SURPLUS_GOALS.has(gc)) {
    // Muscle/bulk goal needs surplus. Maintenance and deficit are both misaligned.
    alignedWithGoal = impliedBalance === "surplus" ? true : false;
  } else if (gc && DEFICIT_GOALS.has(gc)) {
    // Fat loss needs deficit. Maintenance and surplus are both misaligned.
    alignedWithGoal = impliedBalance === "deficit" ? true : false;
  } else if (gc === "strength") {
    // Strength goal: surplus and maintenance both fine; only deficit is a concern.
    alignedWithGoal = impliedBalance === "deficit" ? null : true;
  }

  const sign    = weeklyRateKg >= 0 ? "+" : "";
  const rateStr = `${sign}${weeklyRateKg.toFixed(2)}kg/week`;
  const narrative =
    impliedBalance === "surplus"   ? `Gaining weight (${rateStr}) — calorie surplus implied`
    : impliedBalance === "deficit" ? `Losing weight (${rateStr}) — calorie deficit implied`
    : `Weight stable (${rateStr}) — roughly maintenance calories`;

  const confidence: CalorieBalanceAssessment["confidence"] =
    weightEntryCount >= 6 ? "high" : weightEntryCount >= 3 ? "moderate" : "low";

  return { impliedBalance, alignedWithGoal, weeklyRateKg, narrative, confidence };
}

// ═══════════════════════════════════════════════════════════════════════════════
// computeMealMemory — Part 6 (passive pattern accumulation)
// Pure. Returns null when no logs in last 14 days.
// ═══════════════════════════════════════════════════════════════════════════════

export function computeMealMemory(
  logs: NutritionLogEntry[],
  now  = new Date(),
): MealMemory | null {
  if (logs.length === 0) return null;

  const cutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const recent = logs.filter(l => l.date >= cutoff);
  if (recent.length === 0) return null;

  const freq = new Map<string, number>();
  for (const log of recent) {
    const words = log.description
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 3 && !FOOD_STOP_WORDS.has(w));
    for (const w of words) {
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }

  const topFoods = [...freq.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .filter(([, count]) => count >= 2)
    .map(([w]) => w);

  const proteinLogs     = recent.filter(l => l.proteinEstimate !== null);
  const avgProteinPerLog = proteinLogs.length > 0
    ? Math.round(proteinLogs.reduce((a, l) => a + l.proteinEstimate!, 0) / proteinLogs.length)
    : 0;

  const last = logs.reduce((a, l) => (l.date > a.date ? l : a), logs[0]!);
  const lastLoggedDaysAgo = Math.floor((now.getTime() - last.date.getTime()) / 86_400_000);

  return { topFoods, avgProteinPerLog, lastLoggedDaysAgo };
}

// ═══════════════════════════════════════════════════════════════════════════════
// computeTrendAnalysis — combines Tier 1 + Tier 2
// Fix 1: uses proteinTargetG (personalized) instead of hardcoded 140g.
// ═══════════════════════════════════════════════════════════════════════════════

export function computeTrendAnalysis(
  protein:        ProteinSummary | null,
  calorie:        CalorieBalanceAssessment | null,
  proteinTargetG: number,
): NutritionTrendAnalysis {
  const tier: 1 | 2 = protein ? 2 : 1;

  const proteinAdequate = protein ? protein.avgDailyG >= proteinTargetG : null;
  const calorieAligned  = calorie ? calorie.alignedWithGoal : null;
  // null protein = gap (can't confirm adequate), so actionNeeded unless explicitly true
  const actionNeeded    = proteinAdequate !== true || calorieAligned === false;

  let summary: string;
  if (protein && calorie) {
    summary = `Protein avg ${protein.avgDailyG}g/day (${protein.daysLogged}d logged, target ${proteinTargetG}g). ${calorie.narrative}.`;
  } else if (protein) {
    summary = `Protein avg ${protein.avgDailyG}g/day (${protein.daysLogged}d logged, target ${proteinTargetG}g). No weight-based calorie data.`;
  } else if (calorie) {
    summary = `No protein logs (target ${proteinTargetG}g/day). ${calorie.narrative}.`;
  } else {
    summary = "No nutrition data available.";
  }

  if (protein?.trend === "up")   summary += " Protein intake trending up.";
  if (protein?.trend === "down") summary += " Protein intake trending down.";

  return { tier, summary, proteinAdequate, calorieAligned, actionNeeded };
}

// ═══════════════════════════════════════════════════════════════════════════════
// computeGrowthAssessment — Part 10
// Fix 3: recovery is now the highest-priority limiter when constraintLevel ≠ unrestricted.
// ═══════════════════════════════════════════════════════════════════════════════

export function computeGrowthAssessment(
  goalProgress:     GoalProgress | null,
  weightTrend:      WeightTrend | null,
  trendAnalysis:    NutritionTrendAnalysis,
  consistencyScore: number,
  recoveryStatus:   RecoveryStatus | null,  // Fix 3: recovery now participates
): GrowthAssessment | null {
  if (!goalProgress) return null;

  const gt = goalProgress.goalType;
  let overallStatus:  GrowthAssessment["overallStatus"]  = "unknown";
  let primaryLimiter: GrowthAssessment["primaryLimiter"] = "unknown";

  if (goalProgress.status === "ahead") {
    overallStatus  = "on_track";
    primaryLimiter = "unknown";
  } else if (goalProgress.status === "on_track") {
    overallStatus = "on_track";
    // Identify any sub-optimal limiter even when broadly on track
    if (recoveryStatus && recoveryStatus.constraintLevel !== "unrestricted") {
      primaryLimiter = "recovery";
    } else if (trendAnalysis.proteinAdequate === false || trendAnalysis.proteinAdequate === null) {
      primaryLimiter = "nutrition";
    } else if (consistencyScore < 40) {
      primaryLimiter = "training";
    }
  } else if (goalProgress.status === "behind") {
    overallStatus = "behind";
    // Priority: recovery > training > nutrition > adherence
    if (recoveryStatus && recoveryStatus.constraintLevel !== "unrestricted") {
      primaryLimiter = "recovery";
    } else if (consistencyScore < 30) {
      primaryLimiter = "training";
    } else if (trendAnalysis.calorieAligned === false) {
      primaryLimiter = "nutrition";
    } else if (trendAnalysis.proteinAdequate === false) {
      primaryLimiter = "nutrition";
    } else {
      primaryLimiter = "adherence";
    }
  } else if (goalProgress.status === "unknown") {
    // No target set — derive best-effort limiter from available signals
    overallStatus = "on_track"; // conservative default until target is specified
    if (recoveryStatus && recoveryStatus.constraintLevel !== "unrestricted") {
      primaryLimiter = "recovery";
    } else if (trendAnalysis.proteinAdequate === false || trendAnalysis.proteinAdequate === null) {
      primaryLimiter = "nutrition";
    } else if (consistencyScore < 40) {
      primaryLimiter = "training";
    }
    // else stays "unknown" — no clear limiter, everything looks fine
  }

  // Critical override: weight moving in the wrong direction for goal type
  if (gt === "muscle"   && weightTrend?.trend === "losing"  && goalProgress.status === "behind") {
    overallStatus  = "critical";
    primaryLimiter = "nutrition";
  }
  if (gt === "fat_loss" && weightTrend?.trend === "gaining" && goalProgress.status === "behind") {
    overallStatus  = "critical";
    primaryLimiter = "nutrition";
  }

  const narrative: Record<GrowthAssessment["overallStatus"], string> = {
    on_track: "Progress on track.",
    behind:   `Progress behind — primary limiter: ${primaryLimiter}.`,
    critical: `Progress critical — weight moving wrong direction for ${gt} goal.`,
    unknown:  `No target set — coaching on best available signal${primaryLimiter !== "unknown" ? `: ${primaryLimiter}` : ""}.`,
  };

  return { overallStatus, primaryLimiter, narrative: narrative[overallStatus] };
}

// ═══════════════════════════════════════════════════════════════════════════════
// getNutritionContext — main async loader
//
// Fix 1: bodyweightKg parameter → personalized protein target.
// Fix 3: recoveryStatus parameter → passed to computeGrowthAssessment.
// Fix 5: adherenceFacts filtered to < 7 days (staleness gate).
// ═══════════════════════════════════════════════════════════════════════════════

export async function getNutritionContext(
  platformChatId:   string,
  weightTrend:      WeightTrend | null,
  goalCategory:     string | null,
  goalProgress:     GoalProgress | null,
  consistencyScore: number,
  adherenceFacts:   Array<{ value: string; updatedAt: Date }>,
  recoveryStatus:   RecoveryStatus | null,  // Fix 3
  bodyweightKg:     number | null,          // Fix 1
  now               = new Date(),
): Promise<NutritionContext | null> {
  if (!NUTRITION_INTELLIGENCE_ENABLED) return null;

  try {
    const userRow = await prisma.messengerUser.findUnique({
      where:  { platform_platformChatId: { platform: "telegram", platformChatId } },
      select: { id: true },
    });
    if (!userRow) return null;

    const cutoff28d = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);

    const [rawLogs, weightEntries] = await Promise.all([
      prisma.nutritionLog.findMany({
        where:   { userId: userRow.id, date: { gte: cutoff28d } },
        orderBy: { date: "desc" },
        take:    100,
        select:  { date: true, proteinEstimate: true, description: true },
      }),
      prisma.bodyweightHistory.findMany({
        where:   { userId: userRow.id, recordedAt: { gte: cutoff28d } },
        select:  { weightKg: true },
      }),
    ]);

    const logs: NutritionLogEntry[] = rawLogs.map(l => ({
      date:            l.date,
      proteinEstimate: l.proteinEstimate,
      description:     l.description,
    }));

    // Fix 1: Personalized protein target. Prefer live bodyweight, fallback to profile value.
    const bwKg = bodyweightKg ?? weightTrend?.currentWeight ?? null;
    const proteinTargetG = bwKg ? Math.max(100, Math.round(bwKg * PROTEIN_PER_KG)) : PROTEIN_TARGET_FALLBACK;

    const proteinSummary   = computeProteinSummary(logs, now);
    const calorieBalance   = computeCalorieBalance(
      weightTrend?.weeklyRate ?? 0,
      goalCategory,
      weightEntries.length,
    );
    const mealMemory       = computeMealMemory(logs, now);
    const trendAnalysis    = computeTrendAnalysis(proteinSummary, calorieBalance, proteinTargetG);
    const growthAssessment = computeGrowthAssessment(
      goalProgress, weightTrend, trendAnalysis, consistencyScore, recoveryStatus,
    );

    // Fix 5: Adherence staleness — only surface if the signal is < 7 days old.
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const freshAdherence = adherenceFacts
      .filter(f => f.updatedAt >= sevenDaysAgo)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const adherenceSelfReport: NutritionContext["adherenceSelfReport"] =
      freshAdherence[0]?.value === "positive" ? "positive"
      : freshAdherence[0]?.value === "negative" ? "negative"
      : null;

    const canonicalEvidence: NutritionContext["canonicalEvidence"] = {};
    if (proteinSummary) {
      canonicalEvidence.protein_intake =
        `avg ${proteinSummary.avgDailyG}g/day over last ${proteinSummary.daysLogged} logged days (target ${proteinTargetG}g)`;
    }
    if (calorieBalance) {
      canonicalEvidence.calorie_surplus_or_deficit = calorieBalance.narrative;
    }

    const tier: 1 | 2 = proteinSummary ? 2 : 1;

    return {
      tier,
      proteinTargetG,
      proteinSummary,
      calorieBalance,
      trendAnalysis,
      mealMemory,
      adherenceSelfReport,
      growthAssessment,
      canonicalEvidence,
    };
  } catch (err) {
    console.error("[NUTRITION_SERVICE] getNutritionContext failed:", err);
    return null;
  }
}
