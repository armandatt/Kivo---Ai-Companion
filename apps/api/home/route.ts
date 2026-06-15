import { NextResponse }                                from "next/server"
import { prisma }                                     from "@repo/db/client"
import { getSession }                                 from "../lib/auth/session"
import { buildFitnessSnapshot }                       from "@repo/api/services/fitnessSnapshot.service"
import { computeProgressiveOverloadForSession }       from "@repo/api/services/workoutTracking.service"
import { getNutritionContext }                        from "@repo/api/services/nutrition.service"
import { TrainingState }                              from "@repo/api/engines/scheduler-intelligence-v2"

// ═══════════════════════════════════════════════════════════════════════════════
// HomePageData — single contract between backend and all home page components.
//
// Every field is a computed value from a canonical service.
// No React component may compute any of these values itself.
// ═══════════════════════════════════════════════════════════════════════════════

export type WeekStripDay = {
  dayName:    string          // "Mon" … "Sun"
  label:      string          // muscles trained, pending muscles, or "—"
  isToday:    boolean
  isTrained:  boolean
  isPlanned:  boolean         // today && isTrainingDay && not yet trained
}

export type OverloadTarget = {
  exercise:     string
  nextWeightKg: number
  note:         string
  flag:         string | null
}

export type MainLiftEntry = {
  exercise:  string           // display name: Squat / Bench / Deadlift / OHP
  currentKg: number
  deltaKg:   number           // currentKg − oldest in trend window
  isPR:      boolean
  isStalled: boolean          // from FitnessSnapshot.stalledLifts (canonically computed)
  trend:     number[]         // last ≤5 sessions' max weights, ascending
}

export type HomePageData = {
  user:               { name: string | null; email: string; image: string | null }
  telegramConnected:  boolean
  isRexUser:          boolean

  // Hero Card — What should I do today?
  hero: {
    todayMuscles:     string | null    // SchedulerContextV2.pendingMuscles (cycle-based)
    isTrainingDay:    boolean          // trainingState === DUE | PENDING_CONFIRMATION
    gymTimeStr:       string | null    // preferredCheckInTime
    minutesUntilGym:  number | null    // arithmetic from gymTimeStr vs now
    weekStrip:        WeekStripDay[]
    alertMessage:     string | null    // growthAssessment.narrative when critical
  }

  // Today's Mission — computeProgressiveOverloadForSession
  mission: {
    nextMuscles: string | null
    targets:     OverloadTarget[]
    phase1Note:  string | null         // shown when < 4 sessions logged
  }

  // Biggest Bottleneck — computeGrowthAssessment via getNutritionContext
  bottleneck: {
    primaryLimiter:      "recovery" | "training" | "nutrition" | "adherence" | "unknown"
    overallStatus:       "on_track" | "behind" | "critical" | "unknown"
    narrative:           string
    recoveryScore:       number | null
    recoveryStatusLabel: "ready" | "limited" | "rest" | null
    recoveryFactors:     string[]
  } | null

  // Momentum — FitnessSnapshot + main lift history
  momentum: {
    streakDays:   number               // FitnessSnapshot.streakDays
    mainLifts:    MainLiftEntry[]
    goalProgress: {
      goalType:        string
      exercise:        string | null
      progressPercent: number
      status:          "ahead" | "on_track" | "behind" | "unknown"
      currentValue:    number | null
      targetValue:     number | null
      unit:            string
    } | null
  }

  // Quick Stats — PatternReport + SchedulerContextV2 + FitnessSnapshot
  stats: {
    sessionsThisWeek:  number
    plannedThisWeek:   number          // daysPerWeek from intake
    consistencyScore:  number          // FitnessSnapshot.consistencyScore (0–100, PatternReport)
    volumeThisWeekKg:  number
    rpeTrend:          "overtrained" | "undertrained" | "optimal" | "unknown"
    weightTrend: {
      currentKg:    number
      weeklyRateKg: number
      trend:        "gaining" | "losing" | "stable"
      stalled:      boolean
    } | null
  }

  // Ask Rex
  chat: {
    lastMessage: { text: string; timestamp: string } | null
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PURE HELPERS  (arithmetic only — no domain logic)
// ═══════════════════════════════════════════════════════════════════════════════

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function getMondayUTC(now: Date): Date {
  const day = now.getUTCDay()           // 0 = Sun
  const daysToMon = day === 0 ? 6 : day - 1
  const mon = new Date(now)
  mon.setUTCDate(mon.getUTCDate() - daysToMon)
  mon.setUTCHours(0, 0, 0, 0)
  return mon
}

function minutesUntilGym(gymTimeStr: string, now: Date): number {
  const [th, tm] = gymTimeStr.split(":").map(Number)
  if (th === undefined || tm === undefined) return 0
  const nowMins = now.getUTCHours() * 60 + now.getUTCMinutes()
  return (th * 60 + tm) - nowMins
}

function buildWeekStrip(
  now:               Date,
  sessions:          Array<{ date: Date; musclesTrained: string[] }>,
  isTrainingToday:   boolean,
  pendingMuscles:    string | null,
): WeekStripDay[] {
  const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  const monday    = getMondayUTC(now)
  const todayStr  = toDateStr(now)

  const byDate = new Map(
    sessions.map(s => [toDateStr(s.date), s.musclesTrained[0] ?? "Session"])
  )

  return DAY_NAMES.map((dayName, i) => {
    const d = new Date(monday)
    d.setUTCDate(d.getUTCDate() + i)
    const dateStr  = toDateStr(d)
    const isToday  = dateStr === todayStr
    const muscles  = byDate.get(dateStr)
    const isTrained = !!muscles
    const isPlanned = isToday && isTrainingToday && !isTrained

    return {
      dayName,
      label:     muscles ?? (isPlanned && pendingMuscles ? pendingMuscles : "—"),
      isToday,
      isTrained,
      isPlanned,
    }
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN LIFTS — data fetch only, no computation
// ═══════════════════════════════════════════════════════════════════════════════

const MAIN_LIFT_DEFS = [
  { label: "Squat",    keywords: ["squat"]                      },
  { label: "Bench",    keywords: ["bench"]                      },
  { label: "Deadlift", keywords: ["deadlift"]                   },
  { label: "OHP",      keywords: ["overhead", "ohp", "military"]},
] as const

async function buildMainLifts(
  messengerId: string,
  stalledLifts: string[],
  prs: Record<string, { weightKg: number }>,
): Promise<MainLiftEntry[]> {
  const sessions = await prisma.telegramWorkoutSession.findMany({
    where:   { messengerUserId: messengerId, completed: true },
    orderBy: { date: "desc" },
    take:    10,
    select:  { id: true, sets: { select: { exerciseName: true, weightKg: true } } },
  })

  const results: MainLiftEntry[] = []

  for (const { label, keywords } of MAIN_LIFT_DEFS) {
    const allSets = sessions.flatMap(s =>
      s.sets
        .filter(st => keywords.some(k => st.exerciseName.toLowerCase().includes(k)))
        .map(st => ({ weightKg: st.weightKg, sessionId: s.id }))
    )
    if (!allSets.length) continue

    const bySession = new Map<string, number[]>()
    for (const s of allSets) {
      if (!bySession.has(s.sessionId)) bySession.set(s.sessionId, [])
      bySession.get(s.sessionId)!.push(s.weightKg)
    }

    // Max weight per session, newest first
    const weightPerSession = [...bySession.values()].map(ws => Math.max(...ws))
    const currentKg = weightPerSession[0] ?? 0
    if (currentKg === 0) continue

    const oldest   = weightPerSession[weightPerSession.length - 1] ?? currentKg
    const deltaKg  = +(currentKg - oldest).toFixed(1)
    const trend    = [...weightPerSession].reverse().slice(-5)

    const prKey = Object.keys(prs).find(k =>
      keywords.some(kw => k.toLowerCase().includes(kw))
    )
    const isPR = prKey ? prs[prKey]!.weightKg === currentKg : false

    const isStalled = stalledLifts.some(sl =>
      keywords.some(k => sl.toLowerCase().includes(k))
    )

    results.push({ exercise: label, currentKg, deltaKg, isPR, isStalled, trend })
  }

  return results
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMPTY-STATE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function emptyWeekStrip(): WeekStripDay[] {
  return ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((dayName, i) => ({
    dayName,
    label:     "—",
    isToday:   new Date().getUTCDay() === (i + 1) % 7,
    isTrained: false,
    isPlanned: false,
  }))
}

function emptyResponse(
  user:    { name: string | null; email: string; image: string | null },
  options: { telegramConnected: boolean; isRexUser: boolean },
): HomePageData {
  return {
    user,
    telegramConnected: options.telegramConnected,
    isRexUser:         options.isRexUser,
    hero:    { todayMuscles: null, isTrainingDay: false, gymTimeStr: null, minutesUntilGym: null, weekStrip: emptyWeekStrip(), alertMessage: null },
    mission: { nextMuscles: null, targets: [], phase1Note: null },
    bottleneck: null,
    momentum: { streakDays: 0, mainLifts: [], goalProgress: null },
    stats:   { sessionsThisWeek: 0, plannedThisWeek: 0, consistencyScore: 0, volumeThisWeekKg: 0, rpeTrend: "unknown", weightTrend: null },
    chat:    { lastMessage: null },
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/home
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
        select: { name: true, email: true, image: true },
      }),
      prisma.userProfile.findUnique({ where: { userId } }),
    ])

    if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const userData: HomePageData["user"] = { name: user.name, email: user.email, image: user.image }
    const isRexUser         = profile?.primaryPersona === "rex"
    const telegramConnected = profile?.telegramConnected ?? false
    const telegramChatId    = profile?.telegramChatId ?? null

    if (!telegramChatId || !isRexUser) {
      return NextResponse.json(emptyResponse(userData, { telegramConnected, isRexUser }))
    }

    // ── Resolve MessengerUser ────────────────────────────────────────────────
    const messenger = await prisma.messengerUser.findUnique({
      where:  { platform_platformChatId: { platform: "telegram", platformChatId: telegramChatId } },
      select: {
        id:                   true,
        gymStreak:            true,
        intakeAnswers:        true,
        preferredCheckInTime: true,
        timezone:             true,
        personalRecords:      true,
      },
    })
    if (!messenger) {
      return NextResponse.json(emptyResponse(userData, { telegramConnected, isRexUser }))
    }

    const messengerId   = messenger.id
    const platformChatId = telegramChatId
    const intake        = (messenger.intakeAnswers as Record<string, string>) ?? {}
    const daysPerWeek   = parseInt(intake.available_training_days ?? "3") || 3
    const prs           = (messenger.personalRecords as Record<string, { weightKg: number }>) ?? {}

    // ── Canonical service calls (parallel) ──────────────────────────────────
    //
    // buildFitnessSnapshot is the single source of truth for:
    //   streakDays, consistencyScore, plateauDetected, stalledLifts,
    //   goalProgress, recoveryStatus, weightTrend, schedulerCtxV2, patternReport
    //
    const monday = getMondayUTC(now)

    const [snapshotBundle, thisWeekData, lastSessionRow, lastMessageRow] = await Promise.all([
      buildFitnessSnapshot(messengerId, platformChatId, now),
      prisma.telegramWorkoutSession.findMany({
        where:   { messengerUserId: messengerId, completed: true, date: { gte: monday } },
        orderBy: { date: "asc" },
        select:  {
          date:           true,
          musclesTrained: true,
          sets:           { select: { weightKg: true, reps: true } },
        },
      }),
      prisma.telegramWorkoutSession.findFirst({
        where:   { messengerUserId: messengerId, completed: true },
        orderBy: { date: "desc" },
        select:  { id: true },
      }),
      prisma.companionMessage.findFirst({
        where:   { userId: messengerId, role: "assistant" },
        orderBy: { createdAt: "desc" },
        select:  { text: true, createdAt: true },
      }),
    ])

    const snapshot      = snapshotBundle?.snapshot      ?? null
    const schedulerCtx  = snapshotBundle?.schedulerCtx  ?? null
    const patternReport = snapshotBundle?.patternReport  ?? null

    // ── Progressive overload targets (computeProgressiveOverloadForSession) ─
    let targets:    OverloadTarget[] = []
    let phase1Note: string | null    = null

    if (lastSessionRow) {
      const overloads = await computeProgressiveOverloadForSession(messengerId, lastSessionRow.id).catch(() => [])
      const phase1 = overloads.find(o => o.flag === "phase1")
      if (phase1) {
        phase1Note = phase1.note
      } else {
        targets = overloads
          .filter(o => o.nextWeightKg > 0)
          .map(o => ({ exercise: o.exercise, nextWeightKg: o.nextWeightKg, note: o.note, flag: o.flag }))
      }
    }

    // ── Nutrition context → growthAssessment (computeGrowthAssessment) ──────
    //
    // getNutritionContext is the canonical call that Rex uses.
    // growthAssessment.primaryLimiter is the authoritative bottleneck ranking.
    //
    const bodyweightKg = snapshot?.weightTrend?.currentWeight
      ?? (parseFloat(intake.bodyweight ?? "0") || null)

    const nutritionCtx = await getNutritionContext(
      platformChatId,
      snapshot?.weightTrend    ?? null,
      snapshot?.goalCategory   ?? null,
      snapshot?.goalProgress   ?? null,
      snapshot?.consistencyScore ?? 0,
      [],                         // adherenceFacts: not available from web context
      snapshot?.recoveryStatus ?? null,
      bodyweightKg,
      now,
    ).catch(() => null)

    // ── Bottleneck ───────────────────────────────────────────────────────────
    const ga          = nutritionCtx?.growthAssessment ?? null
    const recStatus   = snapshot?.recoveryStatus ?? null
    const bottleneck: HomePageData["bottleneck"] = ga ? {
      primaryLimiter:      ga.primaryLimiter,
      overallStatus:       ga.overallStatus,
      narrative:           ga.narrative,
      recoveryScore:       recStatus?.score       ?? null,
      recoveryStatusLabel: recStatus?.status      ?? null,
      recoveryFactors:     recStatus?.factors      ?? [],
    } : null

    // ── Main lifts (data fetch, not logic) ──────────────────────────────────
    const mainLifts = await buildMainLifts(
      messengerId,
      snapshot?.stalledLifts ?? [],
      prs,
    )

    // ── Hero card ────────────────────────────────────────────────────────────
    //
    // pendingMuscles comes exclusively from SchedulerContextV2.
    // This is cycle-based (resolveNextCycleDay) — same source Rex uses.
    //
    const pendingMuscles = schedulerCtx?.pendingMuscles ?? null
    const isTrainingDay  =
      schedulerCtx?.trainingState === TrainingState.DUE ||
      schedulerCtx?.trainingState === TrainingState.PENDING_CONFIRMATION

    const gymTimeStr       = messenger.preferredCheckInTime ?? null
    const minsUntilGym     = gymTimeStr ? minutesUntilGym(gymTimeStr, now) : null
    const weekStrip        = buildWeekStrip(now, thisWeekData, isTrainingDay, pendingMuscles)

    // ── Quick stats ──────────────────────────────────────────────────────────
    const sessionsThisWeek = thisWeekData.length
    const volumeThisWeekKg = Math.round(
      thisWeekData
        .flatMap(s => s.sets)
        .reduce((sum, s) => sum + s.weightKg * s.reps, 0)
    )

    // ── Response ─────────────────────────────────────────────────────────────
    const data: HomePageData = {
      user:              userData,
      telegramConnected,
      isRexUser,

      hero: {
        todayMuscles:    isTrainingDay ? pendingMuscles : null,
        isTrainingDay,
        gymTimeStr,
        minutesUntilGym: minsUntilGym,
        weekStrip,
        alertMessage:    ga?.overallStatus === "critical" ? ga.narrative : null,
      },

      mission: {
        nextMuscles: pendingMuscles,
        targets,
        phase1Note,
      },

      bottleneck,

      momentum: {
        streakDays: snapshot?.streakDays ?? 0,
        mainLifts,
        goalProgress: snapshot?.goalProgress ? {
          goalType:        snapshot.goalProgress.goalType,
          exercise:        snapshot.goalProgress.exercise,
          progressPercent: snapshot.goalProgress.progressPercent,
          status:          snapshot.goalProgress.status,
          currentValue:    snapshot.goalProgress.currentValue,
          targetValue:     snapshot.goalProgress.targetValue,
          unit:            snapshot.goalProgress.unit,
        } : null,
      },

      stats: {
        sessionsThisWeek,
        plannedThisWeek:  daysPerWeek,
        consistencyScore: snapshot?.consistencyScore ?? 0,
        volumeThisWeekKg,
        rpeTrend:         patternReport?.rpe_trend ?? "unknown",
        weightTrend:      snapshot?.weightTrend ? {
          currentKg:    snapshot.weightTrend.currentWeight,
          weeklyRateKg: snapshot.weightTrend.weeklyRate,
          trend:        snapshot.weightTrend.trend,
          stalled:      snapshot.weightTrend.stalled,
        } : null,
      },

      chat: {
        lastMessage: lastMessageRow ? {
          text:      lastMessageRow.text,
          timestamp: lastMessageRow.createdAt.toISOString(),
        } : null,
      },
    }

    return NextResponse.json(data)
  } catch (e) {
    console.error("[HOME ERROR]", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
