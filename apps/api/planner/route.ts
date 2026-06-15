import { NextResponse }                from "next/server"
import { prisma }                     from "@repo/db/client"
import { getSession }                 from "../lib/auth/session"
import { buildFitnessSnapshot }       from "@repo/api/services/fitnessSnapshot.service"
import { getNutritionContext }        from "@repo/api/services/nutrition.service"
import {
  TrainingState,
  parseSplitStateMinimal,
  getLocalDateISO,
  daysBetween,
  isTrainingDayByFrequency,
} from "@repo/api/engines/scheduler-intelligence-v2"

// ═══════════════════════════════════════════════════════════════════════════════
// PlannerPageData — single contract between /api/planner and all planner components.
//
// Every field is assembled from canonical services.
// No React component may compute scheduling, recovery, or nutrition logic.
// ═══════════════════════════════════════════════════════════════════════════════

export type TrainingDayStatus =
  | "due"
  | "completed"
  | "skipped"
  | "pending_confirmation"
  | "upcoming"
  | "unknown"

export type ReviewType = "weight" | "nutrition" | "goal" | "plateau"

export type TimelineEntry = {
  dateISO:  string              // "YYYY-MM-DD"
  dayName:  string              // "Mon" | "Tue" | ...
  isToday:  boolean
  isPast:   boolean
  isFuture: boolean
  workout: {
    muscles: string
    status: "completed" | "planned" | "skipped"
  } | null
  reviews: Array<{ type: ReviewType; label: string }>
}

export type SplitDay = {
  dayNumber: number    // 1-based
  muscles:   string
  isNext:    boolean   // the next pending cycle day
  isDone:    boolean   // already completed in current cycle pass
}

export type WeighInEntry = {
  dateISO:  string
  weightKg: number
}

export type PlannerPageData = {
  telegramConnected: boolean
  isRexUser:         boolean

  today: {
    muscles:             string | null
    trainingStatus:      TrainingDayStatus
    gymTimeStr:          string | null
    minutesUntilGym:     number | null
    avgDurationMin:      number
    recoveryScore:       number | null
    recoveryStatusLabel: "ready" | "limited" | "rest" | null
    recoveryFactors:     string[]
    rexDirective:        string
    consecutiveMisses:   number
  }

  next7Days: TimelineEntry[]

  workoutPlan: {
    splitName:       string
    days:            SplitDay[]
    daysPerWeek:     number
    totalSessions:   number
    lastSessionDate: string | null
  } | null

  weightChecks: {
    lastEntries:    WeighInEntry[]
    nextDueDateISO: string | null
    frequencyDays:  number | null
    currentKg:      number | null
    weeklyRateKg:   number | null
    trend:          "gaining" | "losing" | "stable" | null
  }

  nutritionReviews: {
    primaryLimiter:    "recovery" | "training" | "nutrition" | "adherence" | "unknown"
    overallStatus:     "on_track" | "behind" | "critical" | "unknown"
    proteinTargetG:    number
    proteinAvgG:       number | null
    proteinDaysLogged: number
    calorieBalance:    "surplus" | "deficit" | "maintenance" | "unclear" | null
    actionNeeded:      boolean
    reason:            string
  } | null

  goalReview: {
    goalType:        string
    exercise:        string | null
    progressPercent: number
    status:          "ahead" | "on_track" | "behind" | "unknown"
    currentValue:    number | null
    targetValue:     number | null
    unit:            string
    startDate:       string
    targetDate:      string | null
    overallStatus:   "on_track" | "behind" | "critical" | "unknown"
    narrative:       string
  } | null

  plateauReviews: Array<{
    exercise:      string
    sessionsStuck: number
    suggestedFix:  string
  }>

  customReminders: never[]
}

// ═══════════════════════════════════════════════════════════════════════════════
// PURE HELPERS — arithmetic only, no domain logic
// ═══════════════════════════════════════════════════════════════════════════════

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function getMondayUTC(now: Date): Date {
  const day = now.getUTCDay()
  const daysToMon = day === 0 ? 6 : day - 1
  const mon = new Date(now)
  mon.setUTCDate(now.getUTCDate() - daysToMon)
  mon.setUTCHours(0, 0, 0, 0)
  return mon
}

function minutesUntilGym(gymTimeStr: string, now: Date): number {
  const [th = "0", tm = "0"] = gymTimeStr.split(":")
  const nowMins = now.getUTCHours() * 60 + now.getUTCMinutes()
  return parseInt(th) * 60 + parseInt(tm) - nowMins
}

// Matches buildDayList in scheduler-intelligence-v2 — used for DISPLAY only.
function buildSplitDayList(
  split:         string,
  daysPerWeek:   number,
  splitDaysJson?: string,
): string[] {
  if (splitDaysJson) {
    try {
      const days = JSON.parse(splitDaysJson) as string[]
      if (Array.isArray(days) && days.length >= 2) return days
    } catch {}
  }
  if (split === "PPL") {
    const base = ["Chest + Triceps + Shoulders", "Back + Biceps", "Legs"]
    return daysPerWeek >= 6 ? [...base, ...base] : base
  }
  if (split === "upper_lower") return [
    "Upper Body (Chest / Back / Shoulders / Arms)",
    "Lower Body (Quads / Hamstrings / Glutes)",
    "Upper Body (Chest / Back / Shoulders / Arms)",
    "Lower Body (Quads / Hamstrings / Glutes)",
  ]
  if (split === "full_body")  return ["Full Body", "Full Body", "Full Body"]
  if (split === "bro_split")  return ["Chest", "Back", "Legs", "Shoulders", "Arms"]
  const n = Math.min(Math.max(daysPerWeek, 2), 6)
  return Array<string>(n).fill("Full Body")
}

function splitNameLabel(split: string): string {
  const labels: Record<string, string> = {
    PPL:           "Push / Pull / Legs",
    upper_lower:   "Upper / Lower",
    full_body:     "Full Body",
    bro_split:     "Bro Split",
    unstructured:  "Unstructured",
  }
  return labels[split] ?? split
}

function trainingStateToStatus(state: TrainingState): TrainingDayStatus {
  switch (state) {
    case TrainingState.DUE:                  return "due"
    case TrainingState.PENDING_CONFIRMATION: return "pending_confirmation"
    case TrainingState.COMPLETED:            return "completed"
    case TrainingState.SKIPPED:              return "skipped"
    case TrainingState.UPCOMING:             return "upcoming"
    default:                                 return "unknown"
  }
}

function buildRexDirective(
  state:             TrainingState,
  recoveryLabel:     "ready" | "limited" | "rest" | null,
  consecutiveMisses: number,
  pendingMuscles:    string | null,
): string {
  switch (state) {
    case TrainingState.COMPLETED:
      return "Good work. Recovery active. Rest or light activity today."
    case TrainingState.SKIPPED:
      return "Session skipped. Stay consistent — show up next session."
    case TrainingState.PENDING_CONFIRMATION:
      return "Training window passed. Did you train? Log your session."
    case TrainingState.DUE:
      if (recoveryLabel === "rest") return "Recovery requires rest today. Skip this session."
      if (recoveryLabel === "limited") {
        return pendingMuscles
          ? `${pendingMuscles} — reduce intensity. Recovery is limited.`
          : "Train with reduced intensity. Recovery is limited."
      }
      return pendingMuscles
        ? `${pendingMuscles} — full session. Recovery is ready.`
        : "Full session. Recovery is ready."
    case TrainingState.UPCOMING:
      if (consecutiveMisses >= 3) return "Rest day. Several misses in a row — recover today."
      return pendingMuscles
        ? `Rest day. Next: ${pendingMuscles}.`
        : "Rest day. Next session is coming."
    default:
      return "Log sessions with Rex to unlock scheduling insights."
  }
}

function computeWeighInFrequency(
  entries: Array<{ recordedAt: Date }>,
): number | null {
  if (entries.length < 2) return null
  const sorted = [...entries].sort((a, b) =>
    b.recordedAt.getTime() - a.recordedAt.getTime()
  )
  const gaps: number[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!.recordedAt
    const b = sorted[i + 1]!.recordedAt
    gaps.push(Math.round((a.getTime() - b.getTime()) / 86_400_000))
  }
  return Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)
}

// Builds the Mon–Sun weekly timeline.
// Past days: from actual session history.
// Today: from schedulerCtx.trainingState.
// Future days: frequency simulation using isTrainingDayByFrequency.
function buildWeekTimeline(
  now:           Date,
  schedulerCtx: {
    trainingState:        TrainingState
    pendingMuscles:       string | null
    pendingSplitDayIndex: number | null
    lastSessionDate:      string | null
    daysPerWeek:          number
    consecutiveMisses:    number
  } | null,
  sessions: Array<{ dateISO: string; muscles: string }>,
  dayList:           string[],
  stalledLifts:      string[],
  lastWeighIn:       Date | null,
  weighInFrequency:  number,
  nutritionAction:   boolean,
): TimelineEntry[] {
  const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  const monday    = getMondayUTC(now)
  const todayStr  = toDateStr(now)

  const sessionByDate = new Map(sessions.map(s => [s.dateISO, s.muscles]))

  const daysPerWeek  = schedulerCtx?.daysPerWeek ?? 3
  const minRestDays  = Math.max(0, Math.floor(7 / daysPerWeek) - 1)
  let lastRef        = schedulerCtx?.lastSessionDate ?? null
  let cycleOffset    = schedulerCtx?.pendingSplitDayIndex ?? 0

  return DAY_NAMES.map((dayName, i) => {
    const d = new Date(monday)
    d.setUTCDate(d.getUTCDate() + i)
    const dateStr = toDateStr(d)
    const isToday  = dateStr === todayStr
    const isPast   = dateStr < todayStr
    const isFuture = !isToday && !isPast

    // ── Workout ───────────────────────────────────────────────────────────────
    let workout: TimelineEntry["workout"] = null

    if (isPast) {
      const muscles = sessionByDate.get(dateStr)
      if (muscles) workout = { muscles, status: "completed" }
    } else if (isToday && schedulerCtx) {
      const state = schedulerCtx.trainingState
      if (state === TrainingState.COMPLETED) {
        const muscles = sessionByDate.get(dateStr) ?? schedulerCtx.pendingMuscles ?? "Today"
        workout = { muscles, status: "completed" }
      } else if (state === TrainingState.SKIPPED) {
        workout = { muscles: schedulerCtx.pendingMuscles ?? "Session", status: "skipped" }
      } else if (state === TrainingState.DUE || state === TrainingState.PENDING_CONFIRMATION) {
        workout = { muscles: schedulerCtx.pendingMuscles ?? "Training", status: "planned" }
      }
    } else if (isFuture && schedulerCtx && lastRef) {
      const daysSinceRef = daysBetween(lastRef, dateStr)
      if (isTrainingDayByFrequency(daysPerWeek, daysSinceRef)) {
        const cycleLen  = dayList.length || 1
        const muscles   = dayList[cycleOffset % cycleLen] ?? "Training"
        workout         = { muscles, status: "planned" }
        lastRef         = dateStr
        cycleOffset     = (cycleOffset + 1) % cycleLen
      }
    }

    // ── Reviews ───────────────────────────────────────────────────────────────
    const reviews: TimelineEntry["reviews"] = []

    if (stalledLifts.length > 0 && dayName === "Sat") {
      reviews.push({ type: "plateau", label: "Plateau review" })
    }
    if (lastWeighIn && weighInFrequency > 0) {
      const nextDueISO = toDateStr(new Date(lastWeighIn.getTime() + weighInFrequency * 86_400_000))
      if (nextDueISO === dateStr) {
        reviews.push({ type: "weight", label: "Weigh-in due" })
      }
    }
    if (nutritionAction && isFuture && i === 3) {
      reviews.push({ type: "nutrition", label: "Nutrition check" })
    }

    return { dateISO: dateStr, dayName, isToday, isPast, isFuture, workout, reviews }
  })
}

function emptyWeek(): TimelineEntry[] {
  const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  const now    = new Date()
  const monday = getMondayUTC(now)
  const today  = toDateStr(now)
  return DAY_NAMES.map((dayName, i) => {
    const d = new Date(monday)
    d.setUTCDate(d.getUTCDate() + i)
    const dateStr = toDateStr(d)
    return {
      dateISO: dateStr, dayName,
      isToday: dateStr === today,
      isPast:  dateStr < today,
      isFuture: dateStr > today,
      workout: null, reviews: [],
    }
  })
}

function emptyResponse(
  telegramConnected: boolean,
  isRexUser:         boolean,
): PlannerPageData {
  return {
    telegramConnected,
    isRexUser,
    today: {
      muscles: null, trainingStatus: "unknown",
      gymTimeStr: null, minutesUntilGym: null, avgDurationMin: 60,
      recoveryScore: null, recoveryStatusLabel: null, recoveryFactors: [],
      rexDirective: "Connect Telegram and complete onboarding to unlock scheduling.",
      consecutiveMisses: 0,
    },
    next7Days: emptyWeek(),
    workoutPlan: null,
    weightChecks: { lastEntries: [], nextDueDateISO: null, frequencyDays: null, currentKg: null, weeklyRateKg: null, trend: null },
    nutritionReviews: null,
    goalReview: null,
    plateauReviews: [],
    customReminders: [],
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/planner
// ═══════════════════════════════════════════════════════════════════════════════

export async function GET() {
  const webSession = await getSession()
  if (!webSession) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  const userId = webSession.userId
  const now    = new Date()

  try {
    const [user, profile] = await Promise.all([
      prisma.user.findUnique({
        where:  { id: userId },
        select: { name: true, email: true },
      }),
      prisma.userProfile.findUnique({ where: { userId } }),
    ])

    if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const isRexUser         = profile?.primaryPersona === "rex"
    const telegramConnected = profile?.telegramConnected ?? false
    const telegramChatId    = profile?.telegramChatId ?? null

    if (!telegramChatId || !isRexUser) {
      return NextResponse.json(emptyResponse(telegramConnected, isRexUser))
    }

    const messenger = await prisma.messengerUser.findUnique({
      where:  { platform_platformChatId: { platform: "telegram", platformChatId: telegramChatId } },
      select: {
        id:                   true,
        intakeAnswers:        true,
        splitState:           true,
        preferredCheckInTime: true,
        timezone:             true,
        personalRecords:      true,
      },
    })

    if (!messenger) return NextResponse.json(emptyResponse(telegramConnected, isRexUser))

    const messengerId    = messenger.id
    const platformChatId = telegramChatId
    const intake         = (messenger.intakeAnswers as Record<string, string>) ?? {}
    const daysPerWeek    = parseInt(intake.available_training_days ?? "3") || 3
    const split          = intake.current_split ?? "unstructured"
    const splitDaysJson  = intake.split_days_json
    const monday         = getMondayUTC(now)

    // ── Parallel data fetch ─────────────────────────────────────────────────
    const [snapshotBundle, thisWeekSessions, bodyweightHistory] = await Promise.all([
      buildFitnessSnapshot(messengerId, platformChatId, now),
      prisma.telegramWorkoutSession.findMany({
        where:   { messengerUserId: messengerId, completed: true, date: { gte: monday } },
        orderBy: { date: "asc" },
        select:  { date: true, musclesTrained: true },
      }),
      prisma.bodyweightHistory.findMany({
        where:   { userId: messengerId },
        orderBy: { recordedAt: "desc" },
        take:    8,
        select:  { weightKg: true, recordedAt: true },
      }),
    ])

    const snapshot      = snapshotBundle?.snapshot      ?? null
    const schedulerCtx  = snapshotBundle?.schedulerCtx  ?? null
    const patternReport = snapshotBundle?.patternReport  ?? null
    const recoveryStatus = snapshotBundle?.recoveryStatus ?? null
    const weightTrend   = snapshotBundle?.weightTrend   ?? null

    // Nutrition context (same call Rex uses)
    const bodyweightKg   = snapshot?.weightTrend?.currentWeight ?? null
    const nutritionCtx   = await getNutritionContext(
      platformChatId,
      weightTrend,
      snapshot?.goalCategory ?? null,
      snapshot?.goalProgress ?? null,
      snapshot?.consistencyScore ?? 0,
      [],
      recoveryStatus,
      bodyweightKg,
      now,
    ).catch(() => null)

    // ── Section 1: Today ─────────────────────────────────────────────────────
    const trainingState  = schedulerCtx?.trainingState ?? TrainingState.UNKNOWN
    const pendingMuscles = schedulerCtx?.pendingMuscles ?? null
    const gymTimeStr     = messenger.preferredCheckInTime ?? null
    const minsUntilGym   = gymTimeStr ? minutesUntilGym(gymTimeStr, now) : null
    const recoveryLabel  = recoveryStatus?.status ?? null

    const rexDirective = buildRexDirective(
      trainingState,
      recoveryLabel,
      schedulerCtx?.consecutiveMisses ?? 0,
      pendingMuscles,
    )

    // ── Section 2: 7-day timeline ─────────────────────────────────────────────
    const dayList      = buildSplitDayList(split, daysPerWeek, splitDaysJson)
    const stalledLifts = patternReport?.stalledLifts ?? []
    const lastWeighIn  = bodyweightHistory[0]?.recordedAt ?? null
    const weighFreq    = computeWeighInFrequency(bodyweightHistory) ?? 7

    const next7Days = buildWeekTimeline(
      now,
      schedulerCtx ? {
        trainingState:        schedulerCtx.trainingState,
        pendingMuscles:       schedulerCtx.pendingMuscles,
        pendingSplitDayIndex: schedulerCtx.pendingSplitDayIndex,
        lastSessionDate:      schedulerCtx.lastSessionDate,
        daysPerWeek:          schedulerCtx.daysPerWeek,
        consecutiveMisses:    schedulerCtx.consecutiveMisses,
      } : null,
      thisWeekSessions.map(s => ({
        dateISO: toDateStr(new Date(s.date)),
        muscles: s.musclesTrained[0] ?? "Session",
      })),
      dayList,
      stalledLifts.map(s => s.exercise),
      lastWeighIn,
      weighFreq,
      nutritionCtx?.trendAnalysis.actionNeeded ?? false,
    )

    // ── Section 3: Workout plan ────────────────────────────────────────────────
    const pendingSplitDayIndex = schedulerCtx?.pendingSplitDayIndex ?? null
    const splitDays: SplitDay[] = dayList.map((muscles, idx) => ({
      dayNumber: idx + 1,
      muscles,
      isNext: idx === pendingSplitDayIndex,
      isDone: pendingSplitDayIndex !== null && idx < pendingSplitDayIndex,
    }))

    const workoutPlan: PlannerPageData["workoutPlan"] = dayList.length > 0 ? {
      splitName:       splitNameLabel(split),
      days:            splitDays,
      daysPerWeek,
      totalSessions:   snapshot?.totalSessions ?? 0,
      lastSessionDate: schedulerCtx?.lastSessionDate ?? null,
    } : null

    // ── Section 4: Weight checks ───────────────────────────────────────────────
    const lastEntries: WeighInEntry[] = bodyweightHistory.slice(0, 4).map(e => ({
      dateISO:  e.recordedAt.toISOString().slice(0, 10),
      weightKg: e.weightKg,
    }))
    const nextDueDateISO = lastWeighIn
      ? toDateStr(new Date(lastWeighIn.getTime() + weighFreq * 86_400_000))
      : null

    const weightChecks: PlannerPageData["weightChecks"] = {
      lastEntries,
      nextDueDateISO,
      frequencyDays: bodyweightHistory.length >= 2 ? weighFreq : null,
      currentKg:     weightTrend?.currentWeight ?? null,
      weeklyRateKg:  weightTrend?.weeklyRate    ?? null,
      trend:         weightTrend?.trend         ?? null,
    }

    // ── Section 5: Nutrition reviews ───────────────────────────────────────────
    let nutritionReviews: PlannerPageData["nutritionReviews"] = null
    if (nutritionCtx) {
      const ga      = nutritionCtx.growthAssessment
      const protein = nutritionCtx.proteinSummary
      const cal     = nutritionCtx.calorieBalance

      let reason = ""
      if (protein) {
        const diff = protein.avgDailyG - nutritionCtx.proteinTargetG
        reason = diff < 0
          ? `Average protein ${Math.abs(diff)}g below target for ${protein.daysLogged} logged day${protein.daysLogged !== 1 ? "s" : ""}.`
          : `Protein on target (avg ${protein.avgDailyG}g over ${protein.daysLogged} days).`
      } else {
        reason = "No protein logs in the last 7 days."
      }
      if (cal && cal.alignedWithGoal === false) {
        reason += ` ${cal.narrative}.`
      }

      nutritionReviews = {
        primaryLimiter:    (ga?.primaryLimiter ?? "unknown") as "recovery" | "training" | "nutrition" | "adherence" | "unknown",
        overallStatus:     (ga?.overallStatus  ?? "unknown") as "on_track" | "behind" | "critical" | "unknown",
        proteinTargetG:    nutritionCtx.proteinTargetG,
        proteinAvgG:       protein?.avgDailyG       ?? null,
        proteinDaysLogged: protein?.daysLogged       ?? 0,
        calorieBalance:    cal?.impliedBalance        ?? null,
        actionNeeded:      nutritionCtx.trendAnalysis.actionNeeded,
        reason,
      }
    }

    // ── Section 6: Goal review ─────────────────────────────────────────────────
    const gp = snapshot?.goalProgress ?? null
    const ga = nutritionCtx?.growthAssessment ?? null
    const goalReview: PlannerPageData["goalReview"] = gp ? {
      goalType:        gp.goalType,
      exercise:        gp.exercise,
      progressPercent: gp.progressPercent,
      status:          gp.status,
      currentValue:    gp.currentValue,
      targetValue:     gp.targetValue,
      unit:            gp.unit,
      startDate:       gp.startDate,
      targetDate:      gp.targetDate,
      overallStatus:   (ga?.overallStatus  ?? "unknown") as "on_track" | "behind" | "critical" | "unknown",
      narrative:       ga?.narrative ?? "No target set — tracking baseline only.",
    } : null

    // ── Section 7: Plateau reviews ─────────────────────────────────────────────
    const plateauReviews: PlannerPageData["plateauReviews"] = stalledLifts.map(s => ({
      exercise:      s.exercise,
      sessionsStuck: s.sessionsStuck,
      suggestedFix:  s.suggestedFix,
    }))

    const data: PlannerPageData = {
      telegramConnected,
      isRexUser,
      today: {
        muscles:             pendingMuscles,
        trainingStatus:      trainingStateToStatus(trainingState),
        gymTimeStr,
        minutesUntilGym:     minsUntilGym,
        avgDurationMin:      schedulerCtx?.avgDurationMin ?? 60,
        recoveryScore:       recoveryStatus?.score ?? null,
        recoveryStatusLabel: recoveryLabel,
        recoveryFactors:     (recoveryStatus?.factors ?? []).slice(0, 3),
        rexDirective,
        consecutiveMisses:   schedulerCtx?.consecutiveMisses ?? 0,
      },
      next7Days,
      workoutPlan,
      weightChecks,
      nutritionReviews,
      goalReview,
      plateauReviews,
      customReminders: [],
    }

    return NextResponse.json(data)

  } catch (e) {
    console.error("[PLANNER_ERROR]", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
