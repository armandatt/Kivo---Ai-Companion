import { NextResponse }         from "next/server"
import { prisma }               from "@repo/db/client"
import { getSession }           from "../lib/auth/session"
import { buildFitnessSnapshot } from "@repo/api/services/fitnessSnapshot.service"
import { getNutritionContext }  from "@repo/api/services/nutrition.service"
import { getMentorState }       from "@repo/api/engines/user-state-engine"

// ═══════════════════════════════════════════════════════════════════════════════
// ProgressPageData — truth page contract.
//
// Assembled entirely from canonical services + Prisma queries.
// No OpenAI. No dashboard-specific formulas.
// React components are pure visualization.
// ═══════════════════════════════════════════════════════════════════════════════

type Direction = "up" | "down" | "stable" | "unknown"
type CardStatus = "positive" | "neutral" | "warning" | "unknown"

export type ScorecardCard = {
  value:     string
  direction: Direction
  delta:     string | null
  status:    CardStatus
}

export type LiftSummary = {
  exercise:    string
  currentKg:   number
  reps:        number
  date:        string
  prevKg:      number | null
  changeKg:    number | null
  prHistory:   { date: string; weightKg: number }[]  // oldest → newest, from set logs
}

export type MentorSnapshot = {
  timestamp:   string
  burnoutRisk: number
  motivation:  number
  capacity:    number
}

export type ProgressPageData = {
  telegramConnected: boolean
  isRexUser:         boolean

  // S1 — overall pulse
  scorecard: {
    weight:      ScorecardCard | null
    strength:    ScorecardCard | null
    consistency: ScorecardCard
    recovery:    ScorecardCard | null
    nutrition:   ScorecardCard | null
  }

  // S2 — bodyweight journey (graph + coaching note)
  weightJourney: {
    entries:       { date: string; weightKg: number }[]
    currentWeight: number
    weeklyRate:    number
    trend:         "gaining" | "losing" | "stable"
    stalled:       boolean
    insight:       string
  } | null

  // S3 — lift PRs + progression history
  strengthProgression: {
    lifts:          LiftSummary[]
    totalCurrentKg: number
    biggestPR:      string
  } | null

  // S4 — session calendar + rates
  consistency: {
    sessions:          { date: string; completed: boolean; muscles: string[] }[]
    currentStreak:     number
    longestStreak:     number
    completionRate7d:  number
    completionRate30d: number
    totalSessions:     number
    daysPerWeek:       number
  }

  // S5 — recovery score + burnout history
  recoveryTrend: {
    currentScore:     number
    status:           "ready" | "limited" | "rest"
    constraintLevel:  "training_blocked" | "intensity_reduced" | "unrestricted"
    factors:          string[]
    history:          MentorSnapshot[]
    burnoutRisk:      number
    motivation:       number
    momentum:         number
  } | null

  // S6 — protein trend + calorie context
  nutritionTrend: {
    currentAvgG:     number | null
    targetG:         number
    daysLogged:      number
    trend:           "up" | "down" | "stable" | null
    confidence:      "low" | "moderate" | "high" | null
    prevAvgG:        number | null
    daysAboveTarget: number
    topFoods:        string[]
    adherence:       "positive" | "negative" | null
    calorieBalance:  string | null
    calorieAligned:  boolean | null
  } | null

  // S7 — stalled exercises (only when present)
  plateauDetector: {
    stalledLifts: {
      exercise:        string
      sessionsStuck:   number
      currentWeightKg: number | null
      suggestedFix:    string
    }[]
  } | null

  // S8 — timeline of notable events
  milestones: {
    date:        string
    type:        "session" | "pr" | "streak" | "achievement"
    title:       string
    description: string
  }[]

  // S9 — 30-day delta across all dimensions
  monthlyDiff: {
    period:      string
    weight:      { delta: number | null; label: string; invertColor: boolean }
    strength:    { delta: number | null; label: string }
    consistency: { delta: number | null; label: string }
    protein:     { delta: number | null; label: string }
    burnout:     { delta: number | null; label: string }
  }

  // S10 — deterministic insights (no OpenAI)
  coachingInsights: {
    text:     string
    source:   string
    priority: "high" | "medium" | "low"
  }[]
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000)
}

function normalizeExerciseName(name: string): string {
  return name.replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase())
}

// Identifies the big 4 lifts by normalised exercise name
function classifyLift(name: string): string | null {
  const n = name.toLowerCase().replace(/[_\s]+/g, " ")
  if (/bench/.test(n))            return "Bench Press"
  if (/squat/.test(n))            return "Squat"
  if (/deadlift/.test(n))         return "Deadlift"
  if (/overhead|ohp/.test(n))     return "Overhead Press"
  return null
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

// Average protein for a set of raw log rows grouped by day
function avgProteinFromLogs(
  logs: { date: Date; proteinEstimate: number | null }[],
): number | null {
  const byDay: Record<string, number[]> = {}
  for (const l of logs) {
    if (l.proteinEstimate === null) continue
    const d = isoDate(l.date)
    byDay[d] ??= []
    byDay[d]!.push(l.proteinEstimate)
  }
  const days = Object.values(byDay)
  if (days.length === 0) return null
  const totalAvg = days.reduce((sum, day) => sum + day.reduce((a, b) => a + b, 0) / day.length, 0)
  return Math.round(totalAvg / days.length)
}

function buildInsights(
  data: {
    weightTrend:        { trend: string; stalled: boolean; currentWeight: number } | null
    proteinDelta:       number | null
    consistencyDelta:   number | null
    burnoutRisk:        number
    deloadDue:          boolean
    completionRate7d:   number
    completionRate30d:  number
    goalCategory:       string | null
    monthlyWeightDelta: number | null
    nutritionTracked:   boolean
    totalSessions:      number
    strengthDeltaKg:    number | null
    mentorFlags:        string[]
    activeInjuries:     string[]
  }
): ProgressPageData["coachingInsights"] {
  const all: ProgressPageData["coachingInsights"] = []
  const gc            = (data.goalCategory ?? "").toLowerCase()
  const isLosingGoal  = gc.includes("fat") || gc.includes("cut")
  const isGainingGoal = gc.includes("muscle") || gc.includes("bulk")

  // ── HIGH PRIORITY ─────────────────────────────────────────────────────────

  // Extreme rate: gaining too fast for muscle goal
  if (data.monthlyWeightDelta !== null && isGainingGoal && data.monthlyWeightDelta > 2) {
    all.push({
      text:     `Gaining ${data.monthlyWeightDelta.toFixed(1)}kg this month — above optimal lean bulk rate. Fat accumulation risk.`,
      source:   "BodyweightHistory + GoalProgress",
      priority: "high",
    })
  }

  // Extreme rate: losing too fast for fat loss goal
  if (data.monthlyWeightDelta !== null && isLosingGoal && data.monthlyWeightDelta < -3) {
    all.push({
      text:     `Losing ${Math.abs(data.monthlyWeightDelta).toFixed(1)}kg this month — rate is too fast. Muscle loss risk. Moderate the deficit.`,
      source:   "BodyweightHistory + GoalProgress",
      priority: "high",
    })
  }

  // Weight stall (goal-aware)
  if (data.weightTrend?.stalled) {
    const stallText = isLosingGoal
      ? `Weight flat at ${data.weightTrend.currentWeight}kg — revisit calorie deficit for fat loss goal.`
      : isGainingGoal
      ? `Weight flat at ${data.weightTrend.currentWeight}kg — insufficient calorie surplus for muscle goal.`
      : `Weight flat at ${data.weightTrend.currentWeight}kg for 14+ days — review calorie target.`
    all.push({ text: stallText, source: "WeightTrend.stalled", priority: "high" })
  }

  // Goal direction mismatch (not stalled, but wrong direction)
  if (data.monthlyWeightDelta !== null && !data.weightTrend?.stalled && data.goalCategory) {
    if (isGainingGoal && data.monthlyWeightDelta < -0.5) {
      all.push({
        text:     `Weight dropped ${Math.abs(data.monthlyWeightDelta).toFixed(1)}kg this month — insufficient calorie surplus for muscle goal.`,
        source:   "BodyweightHistory + GoalProgress",
        priority: "high",
      })
    }
    if (isLosingGoal && data.monthlyWeightDelta > 0.5) {
      all.push({
        text:     `Weight gained ${data.monthlyWeightDelta.toFixed(1)}kg this month — calorie surplus working against fat loss goal.`,
        source:   "BodyweightHistory + GoalProgress",
        priority: "high",
      })
    }
  }

  // Burnout
  if (data.burnoutRisk >= 65) {
    all.push({
      text:     `Burnout risk is elevated (${Math.round(data.burnoutRisk)}/100) — prioritise recovery over training intensity.`,
      source:   "MentorState.burnoutRisk",
      priority: "high",
    })
  }

  // ── MEDIUM PRIORITY ───────────────────────────────────────────────────────

  // Consistency — returning user, injury context, or standard drop/chronic checks
  const isReturning = data.mentorFlags.includes("comeback") || data.mentorFlags.includes("returning_after_gap")

  if (isReturning && data.completionRate30d < 0.55) {
    all.push({
      text:     "Welcome back. This week is already stronger than your last month — the return is the win.",
      source:   "MentorState.flags",
      priority: "medium",
    })
  } else if (data.consistencyDelta !== null && data.consistencyDelta < -20) {
    all.push({
      text:     `Consistency dropped ${Math.abs(Math.round(data.consistencyDelta))}% this month — attendance is the primary limiter.`,
      source:   "PatternReport.consistencyScore",
      priority: "medium",
    })
  } else if (data.completionRate30d < 0.55) {
    if (data.activeInjuries.length > 0) {
      all.push({
        text:     "Consistency reflects an adjusted plan while recovering — keep training within current capacity.",
        source:   "MemoryFact.injury + MentorState.completionRate30d",
        priority: "medium",
      })
    } else {
      all.push({
        text:     `Consistency at ${Math.round(data.completionRate30d * 100)}% — showing up is the primary bottleneck.`,
        source:   "MentorState.completionRate30d",
        priority: "medium",
      })
    }
  }

  // Protein drop
  if (data.proteinDelta !== null && data.proteinDelta <= -12) {
    all.push({
      text:     `Protein intake dropped ${Math.abs(data.proteinDelta)}g/day — may limit muscle retention and recovery.`,
      source:   "NutritionContext.proteinSummary",
      priority: "medium",
    })
  }

  // Short-term miss against strong baseline
  if (data.completionRate7d < 0.4 && data.completionRate30d >= 0.65) {
    all.push({
      text:     "Missed multiple sessions this week despite a strong 30-day baseline — short-term dip to watch.",
      source:   "SchedulerContextV2.completionRate7d",
      priority: "medium",
    })
  }

  // No nutrition data (coaching opportunity)
  if (!data.nutritionTracked && data.totalSessions >= 5) {
    all.push({
      text:     "No nutrition data logged — protein tracking is the highest-leverage habit to add.",
      source:   "NutritionContext",
      priority: "medium",
    })
  }

  // Deload due
  if (data.deloadDue) {
    all.push({
      text:     "Training cycle complete — a deload week may prevent accumulated fatigue.",
      source:   "PatternReport.deloadDue",
      priority: "medium",
    })
  }

  // ── LOW PRIORITY (positive) ───────────────────────────────────────────────

  // Protein improving
  if (data.proteinDelta !== null && data.proteinDelta >= 8) {
    all.push({
      text:     `Protein up ${data.proteinDelta}g/day over the past fortnight — good nutritional momentum.`,
      source:   "NutritionContext.proteinSummary",
      priority: "low",
    })
  }

  // Strong consistency
  if (data.completionRate30d >= 0.75 && !(data.consistencyDelta !== null && data.consistencyDelta < -20)) {
    all.push({
      text:     `Consistency at ${Math.round(data.completionRate30d * 100)}% over the last month — strong training habit.`,
      source:   "MentorState.completionRate30d",
      priority: "low",
    })
  }

  // Weight aligned with goal
  if (data.weightTrend && !data.weightTrend.stalled && data.goalCategory) {
    const aligned =
      (isLosingGoal  && data.weightTrend.trend === "losing") ||
      (isGainingGoal && data.weightTrend.trend === "gaining")
    if (aligned) {
      all.push({
        text:     "Weight is moving in the right direction for your goal — keep the approach consistent.",
        source:   "WeightTrend + GoalProgress",
        priority: "low",
      })
    }
  }

  // Strength gains this month
  if (data.strengthDeltaKg !== null && data.strengthDeltaKg > 0) {
    all.push({
      text:     `Strength up ${data.strengthDeltaKg}kg across your lifts this month.`,
      source:   "PersonalRecords + TelegramSetLog",
      priority: "low",
    })
  }

  // Recovery stable while training
  if (data.burnoutRisk <= 35 && data.completionRate30d >= 0.65) {
    all.push({
      text:     "Recovery stable while training consistently — optimal state for progression.",
      source:   "MentorState.burnoutRisk + MentorState.completionRate30d",
      priority: "low",
    })
  }

  // Sort: high → medium → low, take 3
  const order = { high: 0, medium: 1, low: 2 } as const
  const sorted = all
    .sort((a, b) => order[a.priority] - order[b.priority])
    .slice(0, 3)

  // Fallback: established users with no issues get a confirmation
  if (sorted.length === 0 && data.totalSessions >= 10) {
    return [{
      text:     "No critical gaps detected — keep the current habits consistent.",
      source:   "All canonical services",
      priority: "low",
    }]
  }

  return sorted
}

function buildMilestones(
  firstSession:     { date: Date } | null,
  totalSessions:    number,
  personalRecords:  Record<string, { weightKg: number; date: string }>,
  achievementFacts: { value: string; updatedAt: Date }[],
  mentorState:      { longestStreak: number; streakDays: number },
): ProgressPageData["milestones"] {
  const milestones: ProgressPageData["milestones"] = []

  // Achievement memories
  for (const f of achievementFacts.slice(0, 4)) {
    milestones.push({
      date:        isoDate(f.updatedAt),
      type:        "achievement",
      title:       "Achievement",
      description: f.value,
    })
  }

  // First workout
  if (firstSession) {
    milestones.push({
      date:        isoDate(firstSession.date),
      type:        "session",
      title:       "First workout",
      description: "Started the journey.",
    })
  }

  // Session count milestones
  const SESSION_MILESTONES = [10, 25, 50, 100, 200]
  for (const n of SESSION_MILESTONES) {
    if (totalSessions >= n) {
      milestones.push({
        date:        "lifetime",  // no exact date stored for session N
        type:        "session",
        title:       `${n} sessions`,
        description: `Completed ${n} workouts with Rex.`,
      })
      break  // only show the highest crossed threshold
    }
  }

  // Biggest PR milestones (top 3 by weight)
  const prEntries = Object.entries(personalRecords)
    .sort(([, a], [, b]) => b.weightKg - a.weightKg)
    .slice(0, 3)

  for (const [exercise, pr] of prEntries) {
    milestones.push({
      date:        pr.date.slice(0, 10),
      type:        "pr",
      title:       `${exercise} PR`,
      description: `${pr.weightKg}kg personal record.`,
    })
  }

  // Streak milestone
  if (mentorState.longestStreak >= 7) {
    milestones.push({
      date:        "lifetime",  // no exact date stored for streak achievement
      type:        "streak",
      title:       `${mentorState.longestStreak}-day streak`,
      description: `Longest training streak: ${mentorState.longestStreak} consecutive days.`,
    })
  }

  // Sort by date descending (most recent first)
  return milestones
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10)
}

function emptyProgress(telegramConnected: boolean, isRexUser: boolean): ProgressPageData {
  return {
    telegramConnected, isRexUser,
    scorecard: {
      weight:      null,
      strength:    null,
      consistency: { value: "—", direction: "unknown", delta: null, status: "unknown" },
      recovery:    null,
      nutrition:   null,
    },
    weightJourney:      null,
    strengthProgression: null,
    consistency: {
      sessions: [], currentStreak: 0, longestStreak: 0,
      completionRate7d: 0, completionRate30d: 0, totalSessions: 0, daysPerWeek: 3,
    },
    recoveryTrend:   null,
    nutritionTrend:  null,
    plateauDetector: null,
    milestones:      [],
    monthlyDiff: {
      period:      "Last 30 days",
      weight:      { delta: null, label: "No data", invertColor: false },
      strength:    { delta: null, label: "No data" },
      consistency: { delta: null, label: "No data" },
      protein:     { delta: null, label: "No data" },
      burnout:     { delta: null, label: "No data" },
    },
    coachingInsights: [],
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/progress
// ═══════════════════════════════════════════════════════════════════════════════

export async function GET() {
  const webSession = await getSession()
  if (!webSession) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  const userId = webSession.userId
  const now    = new Date()

  try {
    const [user, profile] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
      prisma.userProfile.findUnique({ where: { userId } }),
    ])

    if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const isRexUser         = profile?.primaryPersona === "rex"
    const telegramConnected = profile?.telegramConnected ?? false
    const telegramChatId    = profile?.telegramChatId ?? null

    if (!telegramChatId || !isRexUser) {
      return NextResponse.json(emptyProgress(telegramConnected, isRexUser ?? false))
    }

    const messenger = await prisma.messengerUser.findUnique({
      where:  { platform_platformChatId: { platform: "telegram", platformChatId: telegramChatId } },
      select: { id: true, intakeAnswers: true, personalRecords: true },
    })
    if (!messenger) return NextResponse.json(emptyProgress(telegramConnected, isRexUser ?? false))

    const messengerId    = messenger.id
    const platformChatId = telegramChatId
    const intake         = (messenger.intakeAnswers as Record<string, string>) ?? {}
    const daysPerWeek    = parseInt(intake.available_training_days ?? "3") || 3

    const cutoff90d  = daysBefore(now, 90)
    const cutoff60d  = daysBefore(now, 60)
    const cutoff30d  = daysBefore(now, 30)
    const cutoff14d  = daysBefore(now, 14)
    const cutoffPrev = daysBefore(now, 28)  // previous protein window start

    // ── Parallel batch ────────────────────────────────────────────────────────
    const [
      snapshotBundle,
      mentorState,
      rawBodyweightHistory,
      rawSessions90d,
      rawNutritionLogs,
      achievementFacts,
      mentorStateHistoryFact,
      firstSession,
      injuryFacts,
    ] = await Promise.all([
      buildFitnessSnapshot(messengerId, platformChatId, now),
      getMentorState(platformChatId),
      prisma.bodyweightHistory.findMany({
        where:   { userId: messengerId, recordedAt: { gte: cutoff90d } },
        orderBy: { recordedAt: "asc" },
        select:  { weightKg: true, recordedAt: true },
      }),
      prisma.telegramWorkoutSession.findMany({
        where:   { messengerUserId: messengerId, date: { gte: cutoff90d } },
        orderBy: { date: "asc" },
        select:  { id: true, date: true, completed: true, musclesTrained: true },
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
      prisma.memoryFact.findFirst({
        where:  { userId: messengerId, type: "mentor_state_history", key: "snapshots" },
        select: { value: true },
      }),
      prisma.telegramWorkoutSession.findFirst({
        where:   { messengerUserId: messengerId, completed: true },
        orderBy: { date: "asc" },
        select:  { date: true },
      }),
      prisma.memoryFact.findMany({
        where:   { userId: messengerId, type: "injury" },
        orderBy: { updatedAt: "desc" },
        take:    3,
        select:  { value: true },
      }),
    ])

    const snapshot       = snapshotBundle?.snapshot       ?? null
    const recoveryStatus = snapshotBundle?.recoveryStatus ?? null
    const weightTrend    = snapshotBundle?.weightTrend    ?? null
    const patternReport  = snapshotBundle?.patternReport  ?? null
    const schedulerCtx   = snapshotBundle?.schedulerCtx   ?? null

    const gc            = (snapshot?.goalCategory ?? "").toLowerCase()
    const isLosingGoal  = gc.includes("fat") || gc.includes("cut")
    const isGainingGoal = gc.includes("muscle") || gc.includes("bulk")

    // TelegramSetLog for completed sessions in last 90d (for PR progression)
    const sessionIds90d = rawSessions90d.filter(s => s.completed).map(s => s.id)
    const rawSets90d = sessionIds90d.length > 0
      ? await prisma.telegramSetLog.findMany({
          where:  { sessionId: { in: sessionIds90d }, completed: true },
          select: { exerciseName: true, weightKg: true, sessionId: true },
        })
      : []

    // Attach session dates to sets
    const sessionDateMap = new Map<string, Date>(rawSessions90d.map(s => [s.id, new Date(s.date)]))
    const setsWithDates = rawSets90d.map(s => ({
      exerciseName: s.exerciseName,
      weightKg:     s.weightKg,
      sessionDate:  sessionDateMap.get(s.sessionId) ?? new Date(),
    }))

    // ── Nutrition context (same call Rex makes) ───────────────────────────────
    const bodyweightKg = snapshot?.weightTrend?.currentWeight ?? null
    const nutritionCtx = await getNutritionContext(
      platformChatId, weightTrend, snapshot?.goalCategory ?? null,
      snapshot?.goalProgress ?? null, snapshot?.consistencyScore ?? 0,
      [], recoveryStatus, bodyweightKg, now,
    ).catch(() => null)

    // ── Parse personal records ────────────────────────────────────────────────
    const personalRecords: Record<string, { weightKg: number; reps: number; date: string; sessionId: string }> =
      (typeof messenger.personalRecords === "object" && messenger.personalRecords !== null)
        ? messenger.personalRecords as Record<string, { weightKg: number; reps: number; date: string; sessionId: string }>
        : {}

    // ── Parse mentor state history ────────────────────────────────────────────
    let mentorHistory: MentorSnapshot[] = []
    if (mentorStateHistoryFact?.value) {
      try {
        const parsed = JSON.parse(mentorStateHistoryFact.value) as MentorSnapshot[]
        if (Array.isArray(parsed)) mentorHistory = parsed.slice(-12)
      } catch {}
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // S1 — SCORECARD
    // ═══════════════════════════════════════════════════════════════════════════

    // Weight card
    let weightCard: ScorecardCard | null = null
    if (weightTrend) {
      const r    = weightTrend.weeklyRate
      const rStr = r === 0 ? "±0" : r > 0 ? `+${r}` : `${r}`
      const goalAligned =
        isLosingGoal  ? weightTrend.trend === "losing"  :
        isGainingGoal ? weightTrend.trend === "gaining" :
        true  // no goal context → assume neutral positive
      weightCard = {
        value:     `${weightTrend.currentWeight}kg`,
        direction: weightTrend.stalled ? "stable" : weightTrend.trend === "gaining" ? "up" : weightTrend.trend === "losing" ? "down" : "stable",
        delta:     `${rStr}kg/week`,
        status:    weightTrend.stalled ? (gc ? "warning" : "neutral") : goalAligned ? "positive" : "warning",
      }
    }

    // Strength card — sum of top-4 PRs vs "previous" based on set log history
    const prHistory = buildPRHistory(setsWithDates)

    let strengthCard: ScorecardCard | null = null
    const prEntries = Object.entries(personalRecords).sort(([, a], [, b]) => b.weightKg - a.weightKg)
    if (prEntries.length > 0) {
      const totalKg  = prEntries.reduce((sum, [, pr]) => sum + pr.weightKg, 0)
      const bigLabel = `${prEntries[0]![0]} ${prEntries[0]![1].weightKg}kg`

      // Delta: compute total PR kg now vs 30d ago from set log data
      let prevTotalKg: number | null = null
      const cutoff30dStr = isoDate(cutoff30d)
      let sumPrev = 0; let prevCount = 0
      for (const [exercise, pr] of prEntries) {
        const key = exercise.toLowerCase()
        const hist = prHistory[key] ?? []
        const prevEntry = hist.filter(h => h.date <= cutoff30dStr).at(-1)
        if (prevEntry) { sumPrev += prevEntry.weightKg; prevCount++ }
        else           { sumPrev += pr.weightKg; prevCount++ }  // no prior history = same as now
      }
      if (prevCount > 0) prevTotalKg = sumPrev

      const changeTotalKg = prevTotalKg !== null ? Math.round((totalKg - prevTotalKg) * 10) / 10 : null
      strengthCard = {
        value:     `${prEntries.length} PRs`,
        direction: changeTotalKg !== null && changeTotalKg > 0 ? "up" : changeTotalKg !== null && changeTotalKg < 0 ? "down" : "stable",
        delta:     changeTotalKg !== null && changeTotalKg !== 0 ? `${changeTotalKg > 0 ? "+" : ""}${changeTotalKg}kg total` : bigLabel,
        status:    changeTotalKg !== null && changeTotalKg >= 0 ? "positive" : "warning",
      }
    }

    // Consistency card
    const rate30d    = mentorState.completionRate30d
    const rate30dPct = Math.round(rate30d * 100)
    const rate7dPct  = Math.round(mentorState.completionRate7d * 100)
    const consDelta  = Math.round((mentorState.completionRate7d - mentorState.completionRate30d) * 100)
    const consistencyCard: ScorecardCard = {
      value:     `${rate30dPct}%`,
      direction: consDelta > 5 ? "up" : consDelta < -5 ? "down" : "stable",
      delta:     `${consDelta > 0 ? "+" : ""}${consDelta}% vs last 30d`,
      status:    rate30dPct >= 70 ? "positive" : rate30dPct >= 50 ? "neutral" : "warning",
    }

    // Recovery card
    let recoveryCard: ScorecardCard | null = null
    if (recoveryStatus) {
      const curr = Math.round(recoveryStatus.score)
      recoveryCard = {
        value:     `${curr}/100`,
        direction: "stable",
        delta:     null,
        status:    curr >= 70 ? "positive" : curr >= 45 ? "neutral" : "warning",
      }
    }

    // Nutrition card
    let nutritionCard: ScorecardCard | null = null
    if (nutritionCtx?.proteinSummary) {
      const ps      = nutritionCtx.proteinSummary
      const prevLogs = rawNutritionLogs.filter(l => new Date(l.date) < cutoff14d)
      const prevAvg  = avgProteinFromLogs(prevLogs)
      const delta    = prevAvg !== null ? Math.round(ps.avgDailyG - prevAvg) : null
      nutritionCard = {
        value:     `${ps.avgDailyG}g/day`,
        direction: ps.trend === "up" ? "up" : ps.trend === "down" ? "down" : "stable",
        delta:     delta !== null ? `${delta > 0 ? "+" : ""}${delta}g vs last 2w` : null,
        status:    ps.avgDailyG >= nutritionCtx.proteinTargetG ? "positive" : ps.avgDailyG >= nutritionCtx.proteinTargetG * 0.8 ? "neutral" : "warning",
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // S2 — WEIGHT JOURNEY
    // ═══════════════════════════════════════════════════════════════════════════

    let weightJourney: ProgressPageData["weightJourney"] = null
    if (weightTrend && rawBodyweightHistory.length >= 2) {
      const entries = rawBodyweightHistory.map(e => ({ date: isoDate(new Date(e.recordedAt)), weightKg: e.weightKg }))
      const insight = (() => {
        const rate = Math.abs(weightTrend.weeklyRate)
        if (weightTrend.stalled) {
          if (isLosingGoal)  return `Weight flat at ${weightTrend.currentWeight}kg — revisit calorie deficit for fat loss goal.`
          if (isGainingGoal) return `Weight flat at ${weightTrend.currentWeight}kg — increase calorie surplus to restart muscle gain.`
          return `Weight flat at ${weightTrend.currentWeight}kg for 14+ days — review calorie target.`
        }
        if (weightTrend.trend === "gaining") {
          if (isLosingGoal) return `Gaining ${rate}kg/week — moving against fat loss goal. Reduce calorie intake.`
          if (isGainingGoal) {
            if (rate > 1.0)    return `Gaining ${rate}kg/week — excessive rate. Trim surplus to limit fat accumulation.`
            if (rate >= 0.5)   return `Gaining ${rate}kg/week — slightly above lean bulk rate. Monitor body composition.`
            if (rate >= 0.2)   return `Gaining ${rate}kg/week — optimal lean bulk pace.`
            return               `Gaining ${rate}kg/week — slow progress. Consider increasing calorie surplus by 200kcal.`
          }
          return `Gaining ${rate}kg/week.`
        }
        if (weightTrend.trend === "losing") {
          if (isGainingGoal) return `Losing ${rate}kg/week — calorie surplus insufficient for muscle goal.`
          if (isLosingGoal) {
            if (rate > 1.0)    return `Losing ${rate}kg/week — too fast. Increase intake slightly to protect muscle.`
            if (rate >= 0.7)   return `Losing ${rate}kg/week — fast rate. Keep protein above target to protect muscle.`
            if (rate >= 0.3)   return `Losing ${rate}kg/week — on track for fat loss.`
            return               `Losing ${rate}kg/week — slower than expected. Review your calorie deficit.`
          }
          return `Losing ${rate}kg/week.`
        }
        return `Weight stable at ${weightTrend.currentWeight}kg.`
      })()
      weightJourney = {
        entries,
        currentWeight: weightTrend.currentWeight,
        weeklyRate:    weightTrend.weeklyRate,
        trend:         weightTrend.trend,
        stalled:       weightTrend.stalled,
        insight,
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // S3 — STRENGTH PROGRESSION
    // ═══════════════════════════════════════════════════════════════════════════

    let strengthProgression: ProgressPageData["strengthProgression"] = null
    if (prEntries.length > 0) {
      const lifts: LiftSummary[] = prEntries.slice(0, 8).map(([exercise, pr]) => {
        const key    = exercise.toLowerCase()
        const hist   = prHistory[key] ?? []
        const prevKg = hist.length >= 2 ? hist.at(-2)!.weightKg : null
        return {
          exercise: normalizeExerciseName(exercise),
          currentKg: pr.weightKg,
          reps:       pr.reps,
          date:       pr.date.slice(0, 10),
          prevKg,
          changeKg:   prevKg !== null ? Math.round((pr.weightKg - prevKg) * 10) / 10 : null,
          prHistory:  hist,
        }
      })

      const totalCurrentKg = lifts.reduce((s, l) => s + l.currentKg, 0)
      strengthProgression = {
        lifts,
        totalCurrentKg: Math.round(totalCurrentKg),
        biggestPR:      snapshot?.biggestPR ?? "none yet",
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // S4 — CONSISTENCY
    // ═══════════════════════════════════════════════════════════════════════════

    const sessions90dFormatted = rawSessions90d
      .filter(s => s.completed)
      .map(s => ({ date: isoDate(new Date(s.date)), completed: true, muscles: s.musclesTrained }))

    const consistency: ProgressPageData["consistency"] = {
      sessions:          sessions90dFormatted,
      currentStreak:     mentorState.streakDays,
      longestStreak:     mentorState.longestStreak,
      completionRate7d:  Math.round(mentorState.completionRate7d * 100),
      completionRate30d: Math.round(mentorState.completionRate30d * 100),
      totalSessions:     snapshot?.totalSessions ?? 0,
      daysPerWeek,
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // S5 — RECOVERY TREND
    // ═══════════════════════════════════════════════════════════════════════════

    let recoveryTrend: ProgressPageData["recoveryTrend"] = null
    if (recoveryStatus) {
      recoveryTrend = {
        currentScore:    recoveryStatus.score,
        status:          recoveryStatus.status,
        constraintLevel: recoveryStatus.constraintLevel,
        factors:         recoveryStatus.factors,
        history:         mentorHistory,
        burnoutRisk:     mentorState.burnoutRisk,
        motivation:      mentorState.motivation,
        momentum:        mentorState.momentum,
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // S6 — NUTRITION TREND
    // ═══════════════════════════════════════════════════════════════════════════

    let nutritionTrend: ProgressPageData["nutritionTrend"] = null
    if (nutritionCtx) {
      const ps = nutritionCtx.proteinSummary
      const prevLogs14d = rawNutritionLogs.filter(l => new Date(l.date) >= cutoffPrev && new Date(l.date) < cutoff14d)
      const prevAvg     = avgProteinFromLogs(prevLogs14d)

      // Days above target in last 28 days
      const recentLogs = rawNutritionLogs.filter(l => new Date(l.date) >= cutoff30d)
      const byDay: Record<string, number[]> = {}
      for (const l of recentLogs) {
        if (l.proteinEstimate === null) continue
        const d = isoDate(new Date(l.date))
        byDay[d] ??= []
        byDay[d]!.push(l.proteinEstimate)
      }
      const daysAboveTarget = Object.values(byDay).filter(
        day => day.reduce((a, b) => a + b, 0) / day.length >= nutritionCtx.proteinTargetG
      ).length

      nutritionTrend = {
        currentAvgG:     ps?.avgDailyG       ?? null,
        targetG:         nutritionCtx.proteinTargetG,
        daysLogged:      ps?.daysLogged       ?? 0,
        trend:           ps?.trend             ?? null,
        confidence:      ps?.confidence        ?? null,
        prevAvgG:        prevAvg,
        daysAboveTarget,
        topFoods:        nutritionCtx.mealMemory?.topFoods ?? [],
        adherence:       nutritionCtx.adherenceSelfReport,
        calorieBalance:  nutritionCtx.calorieBalance?.narrative ?? null,
        calorieAligned:  nutritionCtx.calorieBalance?.alignedWithGoal ?? null,
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // S7 — PLATEAU DETECTOR
    // ═══════════════════════════════════════════════════════════════════════════

    let plateauDetector: ProgressPageData["plateauDetector"] = null
    if (patternReport && patternReport.stalledLifts.length > 0) {
      plateauDetector = {
        stalledLifts: patternReport.stalledLifts.map(l => {
          const key = l.exercise.toLowerCase()
          const hist = prHistory[key] ?? []
          const latestKg = hist.at(-1)?.weightKg ?? null
          return {
            exercise:        normalizeExerciseName(l.exercise),
            sessionsStuck:   l.sessionsStuck,
            currentWeightKg: latestKg,
            suggestedFix:    l.suggestedFix,
          }
        }),
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // S8 — MILESTONES
    // ═══════════════════════════════════════════════════════════════════════════

    const milestones = buildMilestones(
      firstSession,
      snapshot?.totalSessions ?? 0,
      personalRecords,
      achievementFacts,
      mentorState,
    )

    // ═══════════════════════════════════════════════════════════════════════════
    // S9 — MONTHLY DIFF
    // ═══════════════════════════════════════════════════════════════════════════

    // Weight delta: current vs entry closest to 30 days ago
    let weightDelta: number | null = null
    if (rawBodyweightHistory.length >= 2) {
      const cutoff30dMs = cutoff30d.getTime()
      const weightAt30d = rawBodyweightHistory.reduce((best, e) => {
        const diff = Math.abs(new Date(e.recordedAt).getTime() - cutoff30dMs)
        return diff < Math.abs(new Date(best.recordedAt).getTime() - cutoff30dMs) ? e : best
      }, rawBodyweightHistory[0]!)
      const currentW = rawBodyweightHistory.at(-1)!.weightKg
      weightDelta = Math.round((currentW - weightAt30d.weightKg) * 10) / 10
    }

    // Consistency delta: completion rate in 30-60d window vs last 30d
    const sessions30d = rawSessions90d.filter(s => s.completed && new Date(s.date) >= cutoff30d).length
    const sessionsPrev30d = rawSessions90d.filter(
      s => s.completed && new Date(s.date) >= daysBefore(now, 60) && new Date(s.date) < cutoff30d
    ).length
    const planned30d     = daysPerWeek * 4
    const rate30dComputed = planned30d > 0 ? sessions30d     / planned30d : null
    const ratePrev30d     = planned30d > 0 ? sessionsPrev30d / planned30d : null
    const consDeltaMonthly = rate30dComputed !== null && ratePrev30d !== null
      ? Math.round((rate30dComputed - ratePrev30d) * 100)
      : null

    // Protein delta: last 14d avg vs previous 14d avg
    const currentLogs14d = rawNutritionLogs.filter(l => new Date(l.date) >= cutoff14d)
    const prevLogs14dVal  = rawNutritionLogs.filter(l => new Date(l.date) >= cutoffPrev && new Date(l.date) < cutoff14d)
    const currentAvgProt = avgProteinFromLogs(currentLogs14d)
    const prevAvgProt    = avgProteinFromLogs(prevLogs14dVal)
    const proteinDelta   = currentAvgProt !== null && prevAvgProt !== null
      ? Math.round(currentAvgProt - prevAvgProt)
      : null

    // Strength delta: total PR kg now vs 30d ago from set logs
    let strengthDelta: number | null = null
    if (prEntries.length > 0 && Object.keys(prHistory).length > 0) {
      const cutoff30dStr2 = isoDate(cutoff30d)
      let sumCurr = 0, sumPrev2 = 0, countPaired = 0
      for (const [exercise, pr] of prEntries) {
        const key  = exercise.toLowerCase()
        const hist = prHistory[key] ?? []
        const prev2 = hist.filter(h => h.date <= cutoff30dStr2).at(-1)
        if (prev2) {
          sumCurr  += pr.weightKg
          sumPrev2 += prev2.weightKg
          countPaired++
        }
      }
      if (countPaired > 0) strengthDelta = Math.round(sumCurr - sumPrev2)
    }

    // Burnout delta: current vs oldest snapshot (inverted — higher burnout = worse recovery)
    let burnoutDelta: number | null = null
    if (mentorHistory.length >= 2) {
      const oldest  = mentorHistory[0]!.burnoutRisk
      const current = mentorState.burnoutRisk
      burnoutDelta  = Math.round(current - oldest)  // positive = burnout increased (bad)
    }

    const monthlyDiff: ProgressPageData["monthlyDiff"] = {
      period:      "Last 30 days",
      weight:      { delta: weightDelta,     label: weightDelta   !== null ? `${weightDelta > 0 ? "+" : ""}${weightDelta}kg` : "No data", invertColor: isLosingGoal },
      strength:    { delta: strengthDelta,   label: strengthDelta !== null ? `${strengthDelta > 0 ? "+" : ""}${strengthDelta}kg` : "No data" },
      consistency: { delta: consDeltaMonthly, label: consDeltaMonthly !== null ? `${consDeltaMonthly > 0 ? "+" : ""}${consDeltaMonthly}%` : "No data" },
      protein:     { delta: proteinDelta,    label: proteinDelta  !== null ? `${proteinDelta > 0 ? "+" : ""}${proteinDelta}g/day` : "No data" },
      burnout:     { delta: burnoutDelta,    label: burnoutDelta  !== null ? (burnoutDelta > 0 ? `+${burnoutDelta} risk` : `${burnoutDelta} risk`) : "No data" },
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // S10 — COACHING INSIGHTS
    // ═══════════════════════════════════════════════════════════════════════════

    const coachingInsights = buildInsights({
      weightTrend:        weightTrend ? {
        trend: weightTrend.trend, stalled: weightTrend.stalled, currentWeight: weightTrend.currentWeight,
      } : null,
      proteinDelta,
      consistencyDelta:   consDeltaMonthly,
      burnoutRisk:        mentorState.burnoutRisk,
      deloadDue:          patternReport?.deloadDue ?? false,
      completionRate7d:   mentorState.completionRate7d,
      completionRate30d:  mentorState.completionRate30d,
      goalCategory:       snapshot?.goalCategory ?? null,
      monthlyWeightDelta: weightDelta,
      nutritionTracked:   nutritionCtx !== null,
      totalSessions:      snapshot?.totalSessions ?? 0,
      strengthDeltaKg:    strengthDelta,
      mentorFlags:        (mentorState.flags as string[] | undefined) ?? [],
      activeInjuries:     injuryFacts.map(f => f.value),
    })

    // ═══════════════════════════════════════════════════════════════════════════
    // ASSEMBLE
    // ═══════════════════════════════════════════════════════════════════════════

    const data: ProgressPageData = {
      telegramConnected,
      isRexUser: isRexUser ?? false,
      scorecard: {
        weight:      weightCard,
        strength:    strengthCard,
        consistency: consistencyCard,
        recovery:    recoveryCard,
        nutrition:   nutritionCard,
      },
      weightJourney,
      strengthProgression,
      consistency,
      recoveryTrend,
      nutritionTrend,
      plateauDetector,
      milestones,
      monthlyDiff,
      coachingInsights,
    }

    return NextResponse.json(data)

  } catch (e) {
    console.error("[PROGRESS_ERROR]", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
