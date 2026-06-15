import { NextResponse }            from "next/server"
import { prisma }                  from "@repo/db/client"
import { getSession }              from "../lib/auth/session"
import { buildFitnessSnapshot }    from "@repo/api/services/fitnessSnapshot.service"
import {
  getNutritionContext,
  computeGrowthAssessment,
}                                  from "@repo/api/services/nutrition.service"
import { getMentorState }          from "@repo/api/engines/user-state-engine"

// ═══════════════════════════════════════════════════════════════════════════════
// GoalsPageData — forecasting center contract.
//
// Answers: What am I trying to achieve? Am I on track? If not, why not?
// What must change? What happens if I continue exactly as I am?
//
// All computation is in this route. React components are pure visualization.
// GrowthAssessment is the single limiter source — must match Coach exactly.
// ═══════════════════════════════════════════════════════════════════════════════

export type HealthStatus  = "healthy" | "watch" | "limiting"
export type LimiterType   = "nutrition" | "recovery" | "training" | "adherence" | "unknown"
export type GoalStatus    = "ahead" | "on_track" | "behind" | "unknown"
export type Confidence    = "low" | "medium" | "high"
export type ScenarioLever = "current" | "consistency" | "nutrition" | "combined"

export type GoalsPageData = {
  telegramConnected: boolean
  isRexUser:         boolean
  hasGoal:           boolean
  hasSessions:       boolean   // LB3: false for chat-only users — triggers coaching callout
  goalCategory:      string | null

  // S1 — Primary Goal
  primaryGoal: {
    type:          string
    targetValue:   number | null
    currentValue:  number | null
    baselineValue: number | null
    unit:          string
    progressPct:   number | null
    status:        GoalStatus
    targetDate:    string | null
    daysRemaining: number | null
  } | null

  // S2 — Forecast
  forecast: {
    currentPace:      number | null
    requiredPace:     number | null
    paceUnit:         string
    projectedWeeks:   number | null
    projectedDate:    string | null
    onTrack:          boolean
    confidence:       Confidence
    confidenceReason: string
  } | null

  // S3 — Goal Health
  goalHealth: {
    recovery:    { status: HealthStatus; note: string }
    nutrition:   { status: HealthStatus; note: string }
    consistency: { status: HealthStatus; note: string }
    training:    { status: HealthStatus; note: string }
  }

  // S4 — Biggest Limiter (same source as Coach — GrowthAssessment)
  biggestLimiter: {
    limiter:    LimiterType
    why:        string
    evidence:   string
    confidence: Confidence
  } | null

  // S5 — What Must Change
  whatMustChange: {
    requiredRate:    number | null
    currentRate:     number | null
    gap:             number | null
    unit:            string
    highestLeverage: string
    context:         string
  } | null

  // S6 — Evidence-based risks (no generic warnings)
  risks: {
    title:    string
    detail:   string
    severity: "high" | "medium" | "low"
    source:   string
  }[]

  // S7 — Goal Timeline
  timeline: {
    startDate:   string
    currentDate: string
    targetDate:  string | null
    progressPct: number
    milestones: { date: string; label: string; reached: boolean }[]
  } | null

  // S8 — Alternative Scenarios (deterministic multipliers, no AI)
  scenarios: {
    label:          string
    description:    string
    projectedWeeks: number | null
    projectedDate:  string | null
    deltaWeeks:     number | null
    lever:          ScenarioLever
  }[]

  // S9 — Goal History
  goalHistory: { date: string; event: string; detail: string }[]

  // S10 — Rex's Goal Verdict (deterministic, matches Coach narrative)
  verdict: {
    headline: string
    detail:   string
    limiter:  string | null
    outlook:  "positive" | "neutral" | "negative"
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function isoDate(d: Date): string { return d.toISOString().slice(0, 10) }
function daysBefore(now: Date, n: number): Date { return new Date(now.getTime() - n * 86_400_000) }
function weeksFrom(now: Date, weeks: number): string {
  return isoDate(new Date(now.getTime() + weeks * 7 * 86_400_000))
}
function normalizeExerciseName(name: string): string {
  return name.replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase())
}
function displayGoalType(gc: string | null | undefined): string {
  const s = (gc ?? "").toLowerCase()
  if (s.includes("muscle") || s.includes("bulk")) return "Lean Bulk"
  if (s.includes("fat")    || s.includes("cut"))  return "Fat Loss"
  if (s.includes("strength"))                      return "Strength"
  if (s.includes("endurance"))                     return "Endurance"
  if (s.includes("maintenance"))                   return "Weight Maintenance"
  return "General Fitness"
}

// Groups set-log weights by exercise + session date → max weight per session
function buildPRHistory(
  sets: { exerciseName: string; weightKg: number; sessionDate: Date }[],
): Record<string, { date: string; weightKg: number }[]> {
  const byExercise: Record<string, Record<string, number>> = {}
  for (const s of sets) {
    const key     = s.exerciseName.toLowerCase()
    const dateStr = isoDate(s.sessionDate)
    byExercise[key] ??= {}
    byExercise[key]![dateStr] = Math.max(byExercise[key]![dateStr] ?? 0, s.weightKg)
  }
  const result: Record<string, { date: string; weightKg: number }[]> = {}
  for (const [exercise, dateWeights] of Object.entries(byExercise)) {
    result[exercise] = Object.entries(dateWeights)
      .map(([date, weightKg]) => ({ date, weightKg }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }
  return result
}

// Strength progression rate (kg/week) for a given exercise from history
function strengthPaceWeekly(
  history: { date: string; weightKg: number }[],
): number | null {
  if (history.length < 2) return null
  const oldest = history[0]!
  const newest = history[history.length - 1]!
  const weeks  = (new Date(newest.date).getTime() - new Date(oldest.date).getTime()) / (7 * 86_400_000)
  if (weeks < 1) return null
  return Math.round(((newest.weightKg - oldest.weightKg) / weeks) * 100) / 100
}

// ─────────────────────────────────────────────────────────────────────────────

function computeGoalHealth(
  recoveryStatus: any,
  nutritionCtx:   any,
  mentorState:    any,
  patternReport:  any,
): GoalsPageData["goalHealth"] {
  // Recovery
  let recovery: GoalsPageData["goalHealth"]["recovery"]
  if (!recoveryStatus) {
    recovery = { status: "watch", note: "No recovery data" }
  } else if (recoveryStatus.constraintLevel === "training_blocked") {
    recovery = { status: "limiting", note: `Training blocked — ${recoveryStatus.factors?.[0] ?? "fatigue too high"}` }
  } else if (recoveryStatus.constraintLevel === "intensity_reduced") {
    recovery = { status: "watch", note: `Intensity reduced — score ${Math.round(recoveryStatus.score)}/100` }
  } else if (recoveryStatus.score >= 70) {
    recovery = { status: "healthy", note: `Score ${Math.round(recoveryStatus.score)}/100 — ready` }
  } else {
    recovery = { status: "watch", note: `Score ${Math.round(recoveryStatus.score)}/100 — monitor` }
  }

  // Nutrition
  let nutrition: GoalsPageData["goalHealth"]["nutrition"]
  if (!nutritionCtx) {
    nutrition = { status: "watch", note: "No nutrition logs" }
  } else {
    const ta = nutritionCtx.trendAnalysis
    const ps = nutritionCtx.proteinSummary
    if (ta?.proteinAdequate === false && ta?.calorieAligned === false) {
      nutrition = { status: "limiting", note: `Protein ${ps?.avgDailyG ?? "?"}g/day — calories + protein misaligned` }
    } else if (ta?.proteinAdequate === false || ta?.proteinAdequate === null) {
      nutrition = { status: "watch", note: `Protein ${ps?.avgDailyG ?? "?"}g/day — not confirmed adequate` }
    } else if (ta?.calorieAligned === false) {
      nutrition = { status: "watch", note: nutritionCtx.calorieBalance?.narrative ?? "Calories not aligned" }
    } else {
      nutrition = { status: "healthy", note: `Protein ${ps?.avgDailyG ?? "?"}g/day — on target` }
    }
  }

  // Consistency
  const rate = mentorState.completionRate30d
  const rPct = Math.round(rate * 100)
  let consistency: GoalsPageData["goalHealth"]["consistency"]
  if (rate < 0.40) {
    consistency = { status: "limiting", note: `${rPct}% — showing up is the bottleneck` }
  } else if (rate < 0.65) {
    consistency = { status: "watch", note: `${rPct}% — below optimal frequency` }
  } else {
    consistency = { status: "healthy", note: `${rPct}% — consistent` }
  }

  // Training
  let training: GoalsPageData["goalHealth"]["training"]
  if (!patternReport) {
    training = { status: "watch", note: "No training data yet" }
  } else if ((patternReport.stalledLifts?.length ?? 0) > 0) {
    training = { status: "watch", note: `${patternReport.stalledLifts.length} lift(s) stalled — no progression in 3+ sessions` }
  } else if (patternReport.deloadDue) {
    training = { status: "watch", note: "Deload week recommended to reset fatigue" }
  } else {
    training = { status: "healthy", note: "Training progressing normally" }
  }

  return { recovery, nutrition, consistency, training }
}

// ─────────────────────────────────────────────────────────────────────────────

function buildLimiterEvidence(
  limiter:        LimiterType,
  nutritionCtx:   any,
  recoveryStatus: any,
  patternReport:  any,
  mentorState:    any,
): string {
  switch (limiter) {
    case "nutrition": {
      const ps = nutritionCtx?.proteinSummary
      const ta = nutritionCtx?.trendAnalysis
      if (ta?.proteinAdequate === false && ta?.calorieAligned === false) {
        return `Protein ${ps?.avgDailyG ?? "unknown"}g/day (below target) and calorie intake not aligned with goal.`
      }
      if (ta?.proteinAdequate === false || ta?.proteinAdequate === null) {
        return `Protein not confirmed adequate — ${ps?.daysLogged ?? 0} day(s) of data available.`
      }
      return nutritionCtx?.calorieBalance?.narrative ?? "Calorie intake not aligned with goal."
    }
    case "recovery": {
      const score  = Math.round(recoveryStatus?.score ?? 0)
      const factor = recoveryStatus?.factors?.[0] ?? "fatigue limiting performance"
      return `Recovery score ${score}/100 — ${factor}.`
    }
    case "training": {
      const stalls = patternReport?.stalledLifts?.length ?? 0
      const rate   = Math.round(mentorState.completionRate30d * 100)
      if (stalls > 0) return `${stalls} lift(s) stalled at the same weight for 3+ sessions.`
      return `Consistency at ${rate}% — training volume insufficient for goal pace.`
    }
    case "adherence": {
      const rate = Math.round(mentorState.completionRate30d * 100)
      return `${rate}% session completion rate — adherence is below what's required to sustain progress.`
    }
    default:
      return "No specific limiter identified. Focus on maintaining current habits."
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function buildRisks(
  weightTrend:        any,
  patternReport:      any,
  recoveryStatus:     any,
  mentorState:        any,
  gc:                 string,
  monthlyWeightDelta: number | null,
): GoalsPageData["risks"] {
  const risks: GoalsPageData["risks"] = []
  const isLosingGoal  = gc.includes("fat") || gc.includes("cut")
  const isGainingGoal = gc.includes("muscle") || gc.includes("bulk")

  // LB3 (from Progress audit): extreme rate independent of GrowthAssessment
  if (monthlyWeightDelta !== null && isGainingGoal && monthlyWeightDelta > 2) {
    risks.push({
      title:    "Gaining too fast",
      detail:   `${monthlyWeightDelta.toFixed(1)}kg gained this month — above optimal lean bulk rate. Fat accumulation risk.`,
      severity: "high",
      source:   "WeightTrend + GoalProgress.goalCategory",
    })
  }
  if (monthlyWeightDelta !== null && isLosingGoal && monthlyWeightDelta < -3) {
    risks.push({
      title:    "Losing too fast",
      detail:   `${Math.abs(monthlyWeightDelta).toFixed(1)}kg lost this month — rate is too fast. Muscle loss risk.`,
      severity: "high",
      source:   "WeightTrend + GoalProgress.goalCategory",
    })
  }

  // Weight stall when there's a directional goal
  if (weightTrend?.stalled && (isLosingGoal || isGainingGoal)) {
    risks.push({
      title:    "Weight trend stalled",
      detail:   `Weight flat at ${weightTrend.currentWeight}kg for 14+ days — intervention required.`,
      severity: "high",
      source:   "WeightTrend.stalled",
    })
  }

  // Recovery blocks
  if (recoveryStatus?.constraintLevel === "training_blocked") {
    risks.push({
      title:    "Training blocked",
      detail:   `Recovery score ${Math.round(recoveryStatus.score)}/100 — reduce training volume now.`,
      severity: "high",
      source:   "RecoveryStatus.constraintLevel",
    })
  } else if (recoveryStatus?.constraintLevel === "intensity_reduced") {
    risks.push({
      title:    "Recovery limiting intensity",
      detail:   `Recovery score ${Math.round(recoveryStatus.score)}/100 — avoid max-effort sessions.`,
      severity: "medium",
      source:   "RecoveryStatus.constraintLevel",
    })
  }

  // Stalled lifts (max 2)
  for (const lift of (patternReport?.stalledLifts ?? []).slice(0, 2)) {
    risks.push({
      title:    `${normalizeExerciseName(lift.exercise)} plateau`,
      detail:   `${lift.sessionsStuck}+ sessions at the same weight. ${lift.suggestedFix}`,
      severity: "medium",
      source:   "PatternReport.stalledLifts",
    })
  }

  // Burnout
  if (mentorState.burnoutRisk >= 65) {
    risks.push({
      title:    "Elevated burnout risk",
      detail:   `Burnout risk at ${Math.round(mentorState.burnoutRisk)}/100 — motivation and capacity may decline soon.`,
      severity: "medium",
      source:   "MentorState.burnoutRisk",
    })
  }

  // Low consistency risk (only if not already captured above)
  if (mentorState.completionRate30d < 0.45) {
    risks.push({
      title:    "Low training frequency",
      detail:   `Completing ${Math.round(mentorState.completionRate30d * 100)}% of planned sessions — insufficient stimulus for goal pace.`,
      severity: "medium",
      source:   "MentorState.completionRate30d",
    })
  }

  const order = { high: 0, medium: 1, low: 2 }
  return risks
    .sort((a, b) => order[a.severity] - order[b.severity])
    .slice(0, 5)
}

// ─────────────────────────────────────────────────────────────────────────────

function buildScenarios(
  currentPace:       number | null,
  targetValue:       number | null,
  currentValue:      number | null,
  unit:              string,
  completionRate30d: number,
  nutritionCtx:      any,
  now:               Date,
): GoalsPageData["scenarios"] {
  if (targetValue === null || currentValue === null) return []
  const remaining = targetValue - currentValue
  if (remaining === 0) return []

  const scenarios: GoalsPageData["scenarios"] = []
  const safeRate  = (currentPace !== null && currentPace !== 0) ? currentPace : null

  const hasNutritionGap = !nutritionCtx
    || nutritionCtx.trendAnalysis?.proteinAdequate !== true
    || nutritionCtx.trendAnalysis?.calorieAligned === false

  // Scenario 1 — Current pace
  const baseWeeks = safeRate ? Math.round(remaining / safeRate) : null
  scenarios.push({
    label:          "Current pace",
    description:    safeRate ? `At ${safeRate > 0 ? "+" : ""}${safeRate}${unit}/week` : "Stalled — pace needs to increase",
    projectedWeeks: baseWeeks && baseWeeks > 0 ? baseWeeks : null,
    projectedDate:  baseWeeks && baseWeeks > 0 ? weeksFrom(now, baseWeeks) : null,
    deltaWeeks:     0,
    lever:          "current",
  })

  // Scenario 2 — Better consistency
  if (completionRate30d < 0.80) {
    const boost   = Math.min((0.80 / Math.max(completionRate30d, 0.10) - 1) * 0.6 + 1, 1.4)
    const newRate = (safeRate ?? 0) * boost
    const weeks   = newRate !== 0 ? Math.round(remaining / newRate) : null
    scenarios.push({
      label:          "With 80% consistency",
      description:    "More sessions → more weekly stimulus",
      projectedWeeks: weeks && weeks > 0 ? weeks : null,
      projectedDate:  weeks && weeks > 0 ? weeksFrom(now, weeks) : null,
      deltaWeeks:     baseWeeks && weeks && weeks > 0 ? baseWeeks - weeks : null,
      lever:          "consistency",
    })
  }

  // Scenario 3 — Aligned nutrition
  if (hasNutritionGap) {
    const newRate = (safeRate ?? 0) * 1.20
    const weeks   = newRate !== 0 ? Math.round(remaining / newRate) : null
    scenarios.push({
      label:          "With aligned nutrition",
      description:    "Protein + calorie targets met",
      projectedWeeks: weeks && weeks > 0 ? weeks : null,
      projectedDate:  weeks && weeks > 0 ? weeksFrom(now, weeks) : null,
      deltaWeeks:     baseWeeks && weeks && weeks > 0 ? baseWeeks - weeks : null,
      lever:          "nutrition",
    })
  }

  // Scenario 4 — Both improve
  if (completionRate30d < 0.80 && hasNutritionGap) {
    const consistBoost = Math.min((0.80 / Math.max(completionRate30d, 0.10) - 1) * 0.6 + 1, 1.4)
    const newRate      = (safeRate ?? 0) * consistBoost * 1.15
    const weeks        = newRate !== 0 ? Math.round(remaining / newRate) : null
    scenarios.push({
      label:          "Both improve",
      description:    "80% consistency + aligned nutrition",
      projectedWeeks: weeks && weeks > 0 ? weeks : null,
      projectedDate:  weeks && weeks > 0 ? weeksFrom(now, weeks) : null,
      deltaWeeks:     baseWeeks && weeks && weeks > 0 ? baseWeeks - weeks : null,
      lever:          "combined",
    })
  }

  return scenarios
}

// ─────────────────────────────────────────────────────────────────────────────

function buildVerdict(
  goalProgress:       any,
  growthAssessment:   any,
  forecast:           GoalsPageData["forecast"],
  hasGoal:            boolean,
  monthlyWeightDelta: number | null,
  gc:                 string,
  mentorFlags:        string[],
): GoalsPageData["verdict"] {
  if (!hasGoal || !goalProgress) {
    return {
      headline: "No active goal",
      detail:   "Set a goal with Rex to unlock goal forecasting.",
      limiter:  null,
      outlook:  "neutral",
    }
  }

  const isLosingGoal   = gc.includes("fat") || gc.includes("cut")
  const isGainingGoal  = gc.includes("muscle") || gc.includes("bulk")
  const isReturning    = mentorFlags.includes("comeback") || mentorFlags.includes("returning_after_gap")

  const status = goalProgress.status as GoalStatus
  let headline: string
  let outlook: "positive" | "neutral" | "negative"

  switch (status) {
    case "ahead":
      // LB1: Excessive rate overrides positive "ahead" verdict
      if (isGainingGoal && monthlyWeightDelta !== null && monthlyWeightDelta > 2) {
        headline = "Gaining too fast."
        outlook  = "neutral"
      } else if (isLosingGoal && monthlyWeightDelta !== null && monthlyWeightDelta < -3) {
        headline = "Losing too fast."
        outlook  = "neutral"
      } else {
        headline = "Ahead of pace."
        outlook  = "positive"
      }
      break
    case "on_track":
      headline = "On track toward your goal."
      outlook  = "positive"
      break
    case "behind":
      // LB2: Returning user gets softer framing
      if (isReturning) {
        headline = "Rebuilding momentum."
        outlook  = "neutral"
      } else {
        headline = "Currently behind pace."
        outlook  = "negative"
      }
      break
    default:
      headline = "Goal progress undetermined."
      outlook  = "neutral"
  }

  const limiter = growthAssessment?.primaryLimiter as LimiterType | undefined
  const limiterLabels: Partial<Record<LimiterType, string>> = {
    nutrition: "Protein and calorie alignment",
    recovery:  "Recovery",
    training:  "Training consistency and volume",
    adherence: "Adherence to plan",
  }
  const limiterText = limiter && limiter !== "unknown"
    ? ` ${limiterLabels[limiter] ?? "An identified factor"} is the primary limiter.`
    : ""

  let projectionText = ""
  if (isReturning && status === "behind") {
    projectionText = " Returning to training is the first win — pace will improve as consistency builds."
  } else if (forecast?.projectedWeeks && forecast.projectedWeeks > 0) {
    const w = forecast.projectedWeeks
    projectionText = ` At current pace, target in approximately ${w} week${w !== 1 ? "s" : ""}.`
  } else if (status === "behind") {
    projectionText = " Pace needs to increase to stay on track."
  } else if (headline === "Gaining too fast." || headline === "Losing too fast.") {
    projectionText = " Reduce the rate to protect body composition."
  }

  return {
    headline,
    detail:  `${headline}${limiterText}${projectionText}`.trim(),
    limiter: limiter && limiter !== "unknown" ? limiter : null,
    outlook,
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function computeHighestLeverage(
  limiter:       LimiterType,
  nutritionCtx:  any,
  patternReport: any,
  gc:            string,
): string {
  const isLosingGoal  = gc.includes("fat") || gc.includes("cut")
  const isGainingGoal = gc.includes("muscle") || gc.includes("bulk")

  switch (limiter) {
    case "nutrition":
      if (isLosingGoal)  return "Reduce calorie intake by ~250kcal/day and keep protein above target to protect muscle."
      if (isGainingGoal) return "Increase calorie surplus by ~200kcal/day and hit daily protein target consistently."
      return "Align calorie intake with goal direction and ensure protein adequacy."
    case "recovery":
      return "Prioritise sleep (8h), reduce training volume by 20%, and avoid max-effort sessions this week."
    case "training": {
      const stalls = patternReport?.stalledLifts ?? []
      if (stalls.length > 0) return `Break the ${normalizeExerciseName(stalls[0].exercise)} plateau: ${stalls[0].suggestedFix}`
      return "Increase session attendance — aim for at least 4 sessions this week."
    }
    case "adherence":
      return "Focus on schedule consistency — reduce missed sessions before adding volume."
    default:
      return "Maintain current approach and continue logging progress."
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function emptyGoals(telegramConnected: boolean, isRexUser: boolean): GoalsPageData {
  return {
    telegramConnected,
    isRexUser,
    hasGoal:      false,
    hasSessions:  false,
    goalCategory: null,
    primaryGoal:  null,
    forecast:     null,
    goalHealth: {
      recovery:    { status: "watch", note: "No data" },
      nutrition:   { status: "watch", note: "No data" },
      consistency: { status: "watch", note: "No data" },
      training:    { status: "watch", note: "No data" },
    },
    biggestLimiter: null,
    whatMustChange: null,
    risks:          [],
    timeline:       null,
    scenarios:      [],
    goalHistory:    [],
    verdict: {
      headline: "No active goal",
      detail:   "Set a goal with Rex to unlock goal forecasting.",
      limiter:  null,
      outlook:  "neutral",
    },
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/goals
// ═══════════════════════════════════════════════════════════════════════════════

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  const now    = new Date()
  const userId = session.userId

  try {
    const profile = await prisma.userProfile.findUnique({
      where:  { userId },
      select: { telegramChatId: true, primaryPersona: true, goalCategory: true },
    })

    const telegramConnected = !!(profile?.telegramChatId)
    const isRexUser         = profile?.primaryPersona === "rex"

    if (!profile?.telegramChatId || !isRexUser) {
      return NextResponse.json(emptyGoals(telegramConnected, isRexUser))
    }

    const messenger = await prisma.messengerUser.findUnique({
      where:  { platform_platformChatId: { platform: "telegram", platformChatId: profile.telegramChatId } },
      select: { id: true, intakeAnswers: true, personalRecords: true },
    })
    if (!messenger) return NextResponse.json(emptyGoals(telegramConnected, isRexUser))

    const messengerId    = messenger.id
    const platformChatId = profile.telegramChatId
    const cutoff90d      = daysBefore(now, 90)
    const cutoff60d      = daysBefore(now, 60)

    // ── Parallel batch ─────────────────────────────────────────────────────────
    const [
      snapshotBundle,
      mentorState,
      rawSessions90d,
      rawNutritionLogs,
      achievementFacts,
      goalFacts,
      firstSession,
    ] = await Promise.all([
      buildFitnessSnapshot(messengerId, platformChatId, now),
      getMentorState(platformChatId),
      prisma.telegramWorkoutSession.findMany({
        where:   { messengerUserId: messengerId, date: { gte: cutoff90d } },
        orderBy: { date: "asc" },
        select:  { id: true, date: true, completed: true },
      }),
      prisma.nutritionLog.findMany({
        where:   { userId: messengerId, date: { gte: cutoff60d } },
        orderBy: { date: "asc" },
        select:  { date: true, proteinEstimate: true },
      }),
      prisma.memoryFact.findMany({
        where:   { userId: messengerId, type: "achievement" },
        orderBy: { updatedAt: "desc" },
        take:    5,
        select:  { value: true, updatedAt: true },
      }),
      prisma.memoryFact.findMany({
        where:   { userId: messengerId, type: { in: ["goal", "goal_history"] } },
        orderBy: { updatedAt: "desc" },
        take:    10,
        select:  { value: true, key: true, updatedAt: true, type: true },
      }),
      prisma.telegramWorkoutSession.findFirst({
        where:   { messengerUserId: messengerId, completed: true },
        orderBy: { date: "asc" },
        select:  { date: true },
      }),
    ])

    const snapshot       = snapshotBundle?.snapshot       ?? null
    const recoveryStatus = snapshotBundle?.recoveryStatus ?? null
    const weightTrend    = snapshotBundle?.weightTrend    ?? null
    const patternReport  = snapshotBundle?.patternReport  ?? null
    const goalProgress   = snapshot?.goalProgress         ?? null

    const gc            = (snapshot?.goalCategory ?? profile.goalCategory ?? "").toLowerCase()
    const isLosingGoal  = gc.includes("fat") || gc.includes("cut")
    const isGainingGoal = gc.includes("muscle") || gc.includes("bulk")
    const isStrengthGoal = gc.includes("strength")

    // TelegramSetLog for strength pace computation
    const sessionIds90d = rawSessions90d.filter(s => s.completed).map(s => s.id)
    const rawSets90d = sessionIds90d.length > 0
      ? await prisma.telegramSetLog.findMany({
          where:  { sessionId: { in: sessionIds90d }, completed: true },
          select: { exerciseName: true, weightKg: true, sessionId: true },
        })
      : []
    const sessionDateMap = new Map<string, Date>(rawSessions90d.map(s => [s.id, new Date(s.date)]))
    const setsWithDates  = rawSets90d.map(s => ({
      exerciseName: s.exerciseName,
      weightKg:     s.weightKg,
      sessionDate:  sessionDateMap.get(s.sessionId) ?? new Date(),
    }))
    const prHistory = buildPRHistory(setsWithDates)

    // Nutrition context (identical call to Coach/Progress)
    const bodyweightKg = snapshot?.weightTrend?.currentWeight ?? null
    const nutritionCtx = await getNutritionContext(
      platformChatId, weightTrend, snapshot?.goalCategory ?? null,
      goalProgress, snapshot?.consistencyScore ?? 0,
      [], recoveryStatus, bodyweightKg, now,
    ).catch(() => null)

    // GrowthAssessment — single source, must match Coach
    const fallbackTrend = { tier: 1 as const, summary: "", proteinAdequate: null as boolean | null, calorieAligned: null as boolean | null, actionNeeded: true }
    const growthAssessment = nutritionCtx?.growthAssessment
      ?? computeGrowthAssessment(
        goalProgress,
        weightTrend,
        fallbackTrend,
        snapshot?.consistencyScore ?? 0,
        recoveryStatus,
      )

    const hasGoal     = !!(goalProgress && (goalProgress.targetValue !== null || goalProgress.goalType))
    const hasSessions = rawSessions90d.some(s => s.completed)

    // ═══════════════════════════════════════════════════════════════════════════
    // S1 — PRIMARY GOAL
    // ═══════════════════════════════════════════════════════════════════════════
    const primaryGoal: GoalsPageData["primaryGoal"] = goalProgress ? {
      type:          displayGoalType(snapshot?.goalCategory ?? profile.goalCategory),
      targetValue:   goalProgress.targetValue ?? null,
      currentValue:  goalProgress.currentValue ?? null,
      baselineValue: goalProgress.baselineValue ?? null,
      unit:          "kg",
      progressPct:   goalProgress.progressPercent ?? null,
      status:        (goalProgress.status ?? "unknown") as GoalStatus,
      targetDate:    goalProgress.targetDate ? isoDate(new Date(goalProgress.targetDate)) : null,
      daysRemaining: goalProgress.targetDate
        ? Math.max(0, Math.round((new Date(goalProgress.targetDate).getTime() - now.getTime()) / 86_400_000))
        : null,
    } : null

    // ═══════════════════════════════════════════════════════════════════════════
    // S2 — FORECAST
    // ═══════════════════════════════════════════════════════════════════════════
    let currentPace: number | null = null
    const paceUnit = "kg/week"

    if ((isLosingGoal || isGainingGoal) && weightTrend) {
      currentPace = weightTrend.stalled ? 0 : weightTrend.weeklyRate
    } else if (isStrengthGoal) {
      // Find the lift with the most progression history
      let bestPace: number | null = null
      for (const [, history] of Object.entries(prHistory)) {
        const rate = strengthPaceWeekly(history)
        if (rate !== null && (bestPace === null || Math.abs(rate) > Math.abs(bestPace))) {
          bestPace = rate
        }
      }
      currentPace = bestPace
    }

    const tv = goalProgress?.targetValue  ?? null
    const cv = goalProgress?.currentValue ?? null
    const td = goalProgress?.targetDate   ? new Date(goalProgress.targetDate) : null

    let requiredPace: number | null = null
    if (td && tv !== null && cv !== null) {
      const weeksLeft = (td.getTime() - now.getTime()) / (7 * 86_400_000)
      if (weeksLeft > 0) requiredPace = Math.round(((tv - cv) / weeksLeft) * 100) / 100
    }

    let projectedWeeks: number | null = null
    if (currentPace !== null && currentPace !== 0 && tv !== null && cv !== null) {
      const raw = (tv - cv) / currentPace
      if (raw > 0) projectedWeeks = Math.round(raw)
    }
    const projectedDate = projectedWeeks ? weeksFrom(now, projectedWeeks) : null

    const daysLogged     = nutritionCtx?.proteinSummary?.daysLogged ?? 0
    const confidence: Confidence =
      daysLogged >= 14 && currentPace !== null && mentorState.completionRate30d >= 0.65 ? "high" :
      currentPace !== null && mentorState.completionRate30d >= 0.40                     ? "medium" :
      "low"
    const confidenceReason =
      confidence === "high"   ? `${daysLogged}+ days of nutrition data, consistent training above 65%` :
      confidence === "medium" ? "Limited data — projection is an estimate" :
      "Insufficient data for a reliable projection"

    const onTrack = (goalProgress?.status === "on_track" || goalProgress?.status === "ahead") ?? false
    const forecast: GoalsPageData["forecast"] = goalProgress ? {
      currentPace:      currentPace !== null ? Math.round(currentPace * 100) / 100 : null,
      requiredPace,
      paceUnit,
      projectedWeeks,
      projectedDate,
      onTrack,
      confidence,
      confidenceReason,
    } : null

    // ═══════════════════════════════════════════════════════════════════════════
    // S3 — GOAL HEALTH
    // ═══════════════════════════════════════════════════════════════════════════
    const goalHealth = computeGoalHealth(recoveryStatus, nutritionCtx, mentorState, patternReport)

    // ═══════════════════════════════════════════════════════════════════════════
    // S4 — BIGGEST LIMITER (GrowthAssessment — identical to Coach)
    // ═══════════════════════════════════════════════════════════════════════════
    const biggestLimiter: GoalsPageData["biggestLimiter"] = growthAssessment ? {
      limiter:    (growthAssessment.primaryLimiter ?? "unknown") as LimiterType,
      why:        growthAssessment.narrative ?? "",
      evidence:   buildLimiterEvidence(
        (growthAssessment.primaryLimiter ?? "unknown") as LimiterType,
        nutritionCtx, recoveryStatus, patternReport, mentorState,
      ),
      confidence,  // derived from data availability, not from GrowthAssessment
    } : null

    // ═══════════════════════════════════════════════════════════════════════════
    // S5 — WHAT MUST CHANGE
    // ═══════════════════════════════════════════════════════════════════════════
    const limiterType = (growthAssessment?.primaryLimiter ?? "unknown") as LimiterType
    const gap = (requiredPace !== null && currentPace !== null)
      ? Math.round((requiredPace - currentPace) * 100) / 100
      : null

    const contextStr = (tv !== null && td)
      ? `To reach ${tv}kg by ${new Date(td).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}`
      : tv !== null
      ? `Target: ${tv}kg`
      : ""

    const whatMustChange: GoalsPageData["whatMustChange"] = goalProgress && (tv !== null || limiterType !== "unknown") ? {
      requiredRate:    requiredPace,
      currentRate:     currentPace !== null ? Math.round(currentPace * 100) / 100 : null,
      gap,
      unit:            paceUnit,
      highestLeverage: computeHighestLeverage(limiterType, nutritionCtx, patternReport, gc),
      context:         contextStr,
    } : null

    // ═══════════════════════════════════════════════════════════════════════════
    // S6 — RISKS
    // ═══════════════════════════════════════════════════════════════════════════
    const monthlyWeightDelta = weightTrend
      ? Math.round(weightTrend.weeklyRate * 4 * 10) / 10
      : null

    const risks = buildRisks(weightTrend, patternReport, recoveryStatus, mentorState, gc, monthlyWeightDelta)

    // ═══════════════════════════════════════════════════════════════════════════
    // S7 — GOAL TIMELINE
    // ═══════════════════════════════════════════════════════════════════════════
    const milestones: { date: string; label: string; reached: boolean }[] = []
    if (firstSession) {
      milestones.push({ date: isoDate(new Date(firstSession.date)), label: "Journey started", reached: true })
    }
    for (const f of achievementFacts.slice(0, 3)) {
      milestones.push({
        date:    isoDate(new Date(f.updatedAt)),
        label:   typeof f.value === "string" ? f.value : "",
        reached: true,
      })
    }
    if (goalProgress?.progressPercent) {
      milestones.push({
        date:    isoDate(now),
        label:   `${Math.round(goalProgress.progressPercent)}% of target reached`,
        reached: true,
      })
    }
    milestones.sort((a, b) => a.date.localeCompare(b.date))

    const timeline: GoalsPageData["timeline"] = goalProgress ? {
      startDate:   firstSession ? isoDate(new Date(firstSession.date)) : isoDate(now),
      currentDate: isoDate(now),
      targetDate:  goalProgress.targetDate ? isoDate(new Date(goalProgress.targetDate)) : null,
      progressPct: goalProgress.progressPercent ?? 0,
      milestones,
    } : null

    // ═══════════════════════════════════════════════════════════════════════════
    // S8 — ALTERNATIVE SCENARIOS
    // ═══════════════════════════════════════════════════════════════════════════
    const scenarios = buildScenarios(
      currentPace, tv, cv, "kg",
      mentorState.completionRate30d,
      nutritionCtx, now,
    )

    // ═══════════════════════════════════════════════════════════════════════════
    // S9 — GOAL HISTORY
    // ═══════════════════════════════════════════════════════════════════════════
    const goalHistory: GoalsPageData["goalHistory"] = []

    if (firstSession) {
      goalHistory.push({ date: isoDate(new Date(firstSession.date)), event: "Journey started", detail: "First workout logged." })
    }
    for (const f of achievementFacts) {
      goalHistory.push({
        date:   isoDate(new Date(f.updatedAt)),
        event:  "Achievement",
        detail: typeof f.value === "string" ? f.value : "",
      })
    }
    for (const f of goalFacts) {
      goalHistory.push({
        date:   isoDate(new Date(f.updatedAt)),
        event:  f.type === "goal_history" ? "Goal update" : "Goal set",
        detail: typeof f.value === "string" ? f.value : "",
      })
    }
    goalHistory.sort((a, b) => b.date.localeCompare(a.date))

    // ═══════════════════════════════════════════════════════════════════════════
    // S10 — REX'S GOAL VERDICT
    // ═══════════════════════════════════════════════════════════════════════════
    const mentorFlags = (mentorState.flags as string[] | undefined) ?? []
    const verdict     = buildVerdict(
      goalProgress, growthAssessment, forecast, hasGoal,
      monthlyWeightDelta, gc, mentorFlags,
    )

    return NextResponse.json({
      telegramConnected,
      isRexUser,
      hasGoal,
      hasSessions,
      goalCategory: snapshot?.goalCategory ?? profile.goalCategory ?? null,
      primaryGoal,
      forecast,
      goalHealth,
      biggestLimiter,
      whatMustChange,
      risks,
      timeline,
      scenarios,
      goalHistory,
      verdict,
    } satisfies GoalsPageData)
  } catch (e) {
    console.error("[GOALS ERROR]", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
