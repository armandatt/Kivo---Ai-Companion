// ═══════════════════════════════════════════════════════════════════════════════
// BODYWEIGHT SERVICE — Phase 5D.0
//
// Append-only bodyweight history for MessengerUser.
// OpenAI consumes WeightTrend. This service never classifies intent.
//
// Feature flag: BODYWEIGHT_INTELLIGENCE_ENABLED
//   Set env var to "false" to bypass completely.
//   Default: enabled.
// ═══════════════════════════════════════════════════════════════════════════════

import { prisma } from "@repo/db/client";

// ─── Feature flag ─────────────────────────────────────────────────────────────

export const BODYWEIGHT_INTELLIGENCE_ENABLED =
  process.env.BODYWEIGHT_INTELLIGENCE_ENABLED !== "false";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BodyweightSource = "onboarding" | "manual_update" | "passive_capture";

export type WeightTrendDirection = "gaining" | "losing" | "stable";

export interface WeightTrend {
  currentWeight: number;       // kg — most recent entry
  weeklyRate:    number;       // kg/week; positive = gaining, negative = losing
  trend:         WeightTrendDirection;
  stalled:       boolean;      // true if no meaningful change for 14+ days
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TREND_WINDOW_DAYS     = 28;   // linear regression window
const STALL_WINDOW_DAYS     = 14;   // window to detect stall
const STALL_THRESHOLD_KG    = 0.5;  // movement below this is a stall
const GAINING_THRESHOLD_KG  = 0.1;  // weekly rate above this → gaining
const LOSING_THRESHOLD_KG   = -0.1; // weekly rate below this → losing

// ═══════════════════════════════════════════════════════════════════════════════
// recordBodyweight
// Appends an entry. Never overwrites. Returns false and logs when flag is off.
// ═══════════════════════════════════════════════════════════════════════════════

export async function recordBodyweight(
  userId:   string,
  weightKg: number,
  source:   BodyweightSource,
): Promise<void> {
  if (!BODYWEIGHT_INTELLIGENCE_ENABLED) return;

  try {
    await prisma.bodyweightHistory.create({
      data: { userId, weightKg, source },
    });
  } catch (err) {
    console.error("[BODYWEIGHT_HISTORY_ERROR]", { userId, weightKg, source, error: err });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// getLatestWeight
// Returns the most recent bodyweight entry for a user, or null if none.
// ═══════════════════════════════════════════════════════════════════════════════

export async function getLatestWeight(userId: string): Promise<number | null> {
  if (!BODYWEIGHT_INTELLIGENCE_ENABLED) return null;

  const entry = await prisma.bodyweightHistory.findFirst({
    where:   { userId },
    orderBy: { recordedAt: "desc" },
    select:  { weightKg: true },
  });

  return entry?.weightKg ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// calculateWeeklyRate
// Pure. Ordinary least-squares linear regression on (dayOffset, weightKg) pairs.
// Returns kg/week. Returns 0 when fewer than 2 data points.
// ═══════════════════════════════════════════════════════════════════════════════

export function calculateWeeklyRate(
  entries: { recordedAt: Date; weightKg: number }[],
  now     = new Date(),
): number {
  if (entries.length < 2) return 0;

  const nowMs = now.getTime();

  // Convert to (x = days-ago from now, y = weightKg) pairs
  const points = entries.map(e => ({
    x: (nowMs - e.recordedAt.getTime()) / (1000 * 60 * 60 * 24),
    y: e.weightKg,
  }));

  const n  = points.length;
  const sx = points.reduce((acc, p) => acc + p.x, 0);
  const sy = points.reduce((acc, p) => acc + p.y, 0);
  const sx2 = points.reduce((acc, p) => acc + p.x * p.x, 0);
  const sxy = points.reduce((acc, p) => acc + p.x * p.y, 0);

  const denom = n * sx2 - sx * sx;
  if (denom === 0) return 0;

  // slope in kg/day (negative because x = days-ago; older entries have larger x)
  // We want kg/week forward in time, so negate and multiply by 7
  const slopePerDay = (n * sxy - sx * sy) / denom;
  return (Math.round((-slopePerDay * 7) * 100) / 100) || 0; // kg/week, 2dp; || 0 coerces -0 → 0
}

// ═══════════════════════════════════════════════════════════════════════════════
// detectWeightStall
// Pure. True if max−min spread over the stall window is < STALL_THRESHOLD_KG.
// ═══════════════════════════════════════════════════════════════════════════════

export function detectWeightStall(
  entries: { recordedAt: Date; weightKg: number }[],
  now     = new Date(),
): boolean {
  const cutoff = new Date(now.getTime() - STALL_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const window = entries.filter(e => e.recordedAt >= cutoff);

  if (window.length < 2) return false; // not enough data to call a stall

  const weights = window.map(e => e.weightKg);
  const spread  = Math.max(...weights) - Math.min(...weights);
  return spread < STALL_THRESHOLD_KG;
}

// ═══════════════════════════════════════════════════════════════════════════════
// getWeightTrend
// Async. Fetches 28-day history, delegates to pure functions, returns WeightTrend.
// Returns null when: flag off, no history, or DB error.
// ═══════════════════════════════════════════════════════════════════════════════

export async function getWeightTrend(
  userId: string,
  now    = new Date(),
): Promise<WeightTrend | null> {
  if (!BODYWEIGHT_INTELLIGENCE_ENABLED) return null;

  try {
    const cutoff = new Date(now.getTime() - TREND_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const entries = await prisma.bodyweightHistory.findMany({
      where:   { userId, recordedAt: { gte: cutoff } },
      orderBy: { recordedAt: "desc" },
      select:  { weightKg: true, recordedAt: true },
    });

    if (entries.length === 0) return null;

    const currentWeight = entries[0]!.weightKg;
    const weeklyRate    = calculateWeeklyRate(entries, now);
    const stalled       = detectWeightStall(entries, now);

    // FIX 5: stalled overrides trend direction — "losing but stalled" is contradictory
    const trend: WeightTrendDirection = stalled
      ? "stable"
      : weeklyRate > GAINING_THRESHOLD_KG ? "gaining"
      : weeklyRate < LOSING_THRESHOLD_KG  ? "losing"
      : "stable";

    return { currentWeight, weeklyRate, trend, stalled };
  } catch (err) {
    console.error("[BODYWEIGHT_SERVICE] getWeightTrend failed:", err);
    return null;
  }
}
