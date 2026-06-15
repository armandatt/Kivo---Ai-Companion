import { NextResponse }          from "next/server"
import { prisma }                from "@repo/db/client"
import { getSession }            from "../lib/auth/session"
import { buildFitnessSnapshot }  from "@repo/api/services/fitnessSnapshot.service"
import { getNutritionContext }   from "@repo/api/services/nutrition.service"
import { getMentorState }        from "@repo/api/engines/user-state-engine"
import type { MentorState }      from "@repo/api/engines/user-state-engine"

// RecoveryStatus shape (structural — matches recovery-engine.ts exactly)
type RecoveryStatus = {
  score:           number
  status:          "ready" | "limited" | "rest"
  constraintLevel: "training_blocked" | "intensity_reduced" | "unrestricted"
  factors:         string[]
}

// ═══════════════════════════════════════════════════════════════════════════════
// CoachPageData — the full brain dump.
//
// Every field is assembled from canonical services.
// No OpenAI. No duplicated logic.
// React components are pure visualization of this contract.
// ═══════════════════════════════════════════════════════════════════════════════

type Limiter    = "recovery" | "training" | "nutrition" | "adherence" | "unknown"
type Status     = "on_track" | "behind" | "critical" | "unknown"
type RecovLevel = "ready" | "limited" | "rest"
type Confidence = "low" | "moderate" | "high"
type StepStatus = "positive" | "warning" | "critical" | "neutral"
type Importance = "high" | "medium" | "low"

// ── Hard Constraints (replicated from mentor-orchestrator.ts — same formula) ──
type HardConstraints = {
  noChallenge:      boolean
  noAccountability: boolean
  noPlan:           boolean
  trainingBlocked:  boolean
  intensityReduced: boolean
  toneFloor:        "gentle" | "supportive" | null
}

// ── Active Investigation (replicated from mentor-orchestrator.ts) ──────────────
type ActiveInvestigation = {
  topic:             string
  hypotheses:        string[]
  missingData:       string[]
  evidenceCollected: Record<string, string>
  attemptCount:      number
  status:            "open" | "resolved" | "abandoned"
  startedAt:         string
  lastUpdatedAt:     string
}

export type CoachPageData = {
  telegramConnected: boolean
  isRexUser:         boolean

  // S1: What Rex believes is limiting progress
  currentFocus: {
    limiter:       Limiter
    overallStatus: Status
    why:           string
    evidence:      string[]
    confidence:    Confidence
  } | null

  // S2: Active diagnostic investigation
  activeInvestigation: {
    topic:             string
    hypotheses:        string[]
    missingData:       string[]
    evidenceCollected: Record<string, string>
    attemptCount:      number
    maxAttempts:       3
    status:            "open" | "resolved" | "abandoned"
    daysOpen:          number
  } | null

  // S3: Recommendations by risk tier
  recommendations: Array<{
    tier:          "low" | "medium" | "high"
    text:          string
    evidence:      string[]
    confidence:    Confidence
    blocked:       boolean
    blockedReason: string | null
  }>

  // S4: Recovery — exact same source Rex uses
  recovery: {
    score:            number | null
    status:           RecovLevel | null
    constraintLevel:  "training_blocked" | "intensity_reduced" | "unrestricted" | null
    factors:          string[]
    hardConstraints:  HardConstraints
  }

  // S5: Nutrition — exact same context Rex receives
  nutrition: {
    tier:                   1 | 2
    proteinTargetG:         number
    proteinAvgG:            number | null
    proteinDaysLogged:      number
    proteinTrend:           "up" | "down" | "stable" | null
    proteinConfidence:      Confidence | null
    calorieBalance:         "surplus" | "deficit" | "maintenance" | "unclear" | null
    calorieAlignedWithGoal: boolean | null
    calorieNarrative:       string | null
    calorieConfidence:      Confidence | null
    adherence:              "positive" | "negative" | null
    topFoods:               string[]
    actionNeeded:           boolean
    summary:                string
  } | null

  // S6: Goal analysis — progress + pace + why
  goalAnalysis: {
    goalType:         string
    exercise:         string | null
    progressPercent:  number
    status:           "ahead" | "on_track" | "behind" | "unknown"
    currentValue:     number | null
    targetValue:      number | null
    unit:             string
    startDate:        string
    targetDate:       string | null
    weeklyRateKg:     number | null
    weightTrend:      "gaining" | "losing" | "stable" | null
    weightStalled:    boolean
    whyProgressStatus: string
    etaLabel:         string | null
    overallStatus:    Status
  } | null

  // S7: Memories currently shaping coaching
  activeMemories: Array<{
    id:              string
    type:            string
    key:             string
    value:           string
    confidence:      number
    ageHours:        number
    importanceLabel: Importance
    whySurfaced:     string
  }>

  // S8: Synthesized coaching snapshot (no OpenAI)
  rexSnapshot: {
    lines:         string[]
    primaryAction: string
  }

  // S9: Full decision trace — the trust layer
  decisionTrace: {
    steps:         Array<{ label: string; value: string; status: StepStatus }>
    activeConstraints: string[]
    mentorScores:  {
      motivation:  number
      consistency: number
      burnoutRisk: number
      capacity:    number
      stress:      number
      discipline:  number
      momentum:    number
    }
    activeFlags: string[]
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PURE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

// Replicated from mentor-orchestrator.ts — exact same formula.
function computeHardConstraints(
  m: Pick<MentorState, "burnoutRisk" | "motivation" | "capacity" | "consecutiveMisses"> | null,
  recoveryConstraintLevel: "training_blocked" | "intensity_reduced" | "unrestricted" | null,
): HardConstraints {
  const burnoutRisk        = m?.burnoutRisk        ?? 0
  const burnoutFull        = burnoutRisk >= 70
  const burnoutPartial     = burnoutRisk >= 55 && burnoutRisk < 70
  const motivationCritical = (m?.motivation        ?? 100) < 25
  const capacityLow        = (m?.capacity          ?? 100) < 25
  const missStreakHigh     = (m?.consecutiveMisses ?? 0)   >= 4

  const toneFloor: HardConstraints["toneFloor"] =
    (burnoutFull || capacityLow) ? "gentle"    :
    burnoutPartial               ? "supportive" :
    null

  return {
    noChallenge:      burnoutFull || motivationCritical || burnoutPartial,
    noAccountability: burnoutFull || missStreakHigh,
    noPlan:           capacityLow,
    trainingBlocked:  recoveryConstraintLevel === "training_blocked",
    intensityReduced: recoveryConstraintLevel === "intensity_reduced",
    toneFloor,
  }
}

function buildFocusEvidence(
  limiter:       Limiter,
  recoveryStatus: RecoveryStatus | null,
  nutritionCtx:  { proteinTargetG: number; proteinSummary: { avgDailyG: number; daysLogged: number } | null; canonicalEvidence: Record<string, string> } | null,
  goalProgress:  { goalType: string; progressPercent: number; status: string } | null,
): string[] {
  const ev: string[] = []
  if (limiter === "recovery" && recoveryStatus) {
    ev.push(...recoveryStatus.factors.slice(0, 3))
  }
  if (limiter === "nutrition" && nutritionCtx) {
    const ce = nutritionCtx.canonicalEvidence
    if (ce.protein_intake)             ev.push(ce.protein_intake)
    if (ce.calorie_surplus_or_deficit) ev.push(ce.calorie_surplus_or_deficit)
    if (nutritionCtx.proteinSummary) {
      const ps = nutritionCtx.proteinSummary
      ev.push(`Protein avg ${ps.avgDailyG}g/day (${ps.daysLogged} day${ps.daysLogged !== 1 ? "s" : ""} logged)`)
    }
  }
  if (limiter === "training" && goalProgress) {
    ev.push(`${goalProgress.goalType.replace("_", " ")} goal: ${goalProgress.progressPercent}% progress`)
    if (goalProgress.status === "behind") ev.push("Progress behind target pace")
  }
  if (limiter === "adherence") {
    ev.push("Training consistency below threshold")
  }
  return ev.filter(Boolean).slice(0, 4)
}

function buildRecommendations(
  hc:             HardConstraints,
  limiter:        Limiter,
  recoveryStatus: RecoveryStatus | null,
  nutritionCtx:   { proteinTargetG: number; proteinSummary: { avgDailyG: number; daysLogged: number; confidence: Confidence } | null; trendAnalysis: { actionNeeded: boolean } } | null,
  goalProgress:   { goalType: string; status: string; progressPercent: number } | null,
): CoachPageData["recommendations"] {
  const recs: CoachPageData["recommendations"] = []

  // HIGH: Training blocked
  if (hc.trainingBlocked) {
    recs.push({
      tier: "high", confidence: "high", blocked: false, blockedReason: null,
      text: "Training is blocked today — recovery requires rest.",
      evidence: recoveryStatus?.factors.slice(0, 2) ?? [],
    })
  }

  // HIGH: Critical burnout
  if (hc.noChallenge && !hc.trainingBlocked) {
    recs.push({
      tier: "high", confidence: "high", blocked: false, blockedReason: null,
      text: "Reduce challenge intensity. Burnout risk is elevated.",
      evidence: ["Burnout risk exceeds threshold"],
    })
  }

  // MEDIUM: Reduce intensity
  if (hc.intensityReduced && !hc.trainingBlocked) {
    recs.push({
      tier: "medium", confidence: "high", blocked: false, blockedReason: null,
      text: "Train today with reduced intensity — recovery is limited.",
      evidence: recoveryStatus?.factors.slice(0, 2) ?? [],
    })
  }

  // MEDIUM: Nutrition gap
  if (limiter === "nutrition" && nutritionCtx?.trendAnalysis.actionNeeded) {
    const ps = nutritionCtx.proteinSummary
    const diff = ps ? Math.round(nutritionCtx.proteinTargetG - ps.avgDailyG) : null
    recs.push({
      tier: "medium",
      confidence: ps?.confidence ?? "low",
      blocked: hc.noPlan,
      blockedReason: hc.noPlan ? "Capacity too low for new habits right now" : null,
      text: diff !== null && diff > 0
        ? `Increase daily protein by ~${diff}g to reach your ${nutritionCtx.proteinTargetG}g target.`
        : `Log nutrition more consistently — only ${ps?.daysLogged ?? 0} days of data available.`,
      evidence: [
        ps ? `Current avg: ${ps.avgDailyG}g/day` : "No protein data",
        `Target: ${nutritionCtx.proteinTargetG}g/day`,
      ],
    })
  }

  // MEDIUM: Goal behind
  if (goalProgress?.status === "behind") {
    recs.push({
      tier: "medium", confidence: "moderate", blocked: false, blockedReason: null,
      text: `${goalProgress.goalType.replace("_", " ")} goal is behind pace. Review weekly adherence.`,
      evidence: [`${goalProgress.progressPercent}% progress to date`],
    })
  }

  // LOW: Accountability paused
  if (hc.noAccountability) {
    recs.push({
      tier: "low", confidence: "high", blocked: false, blockedReason: null,
      text: "Accountability pressure paused. Focus on one small win today.",
      evidence: ["Consecutive miss streak or elevated burnout"],
    })
  }

  const ORDER = { high: 0, medium: 1, low: 2 } as const
  return recs.sort((a, b) => ORDER[a.tier] - ORDER[b.tier])
}

const MEMORY_SURFACE_REASON: Record<string, string> = {
  promise:           "Rex uses promises to track accountability commitments.",
  commitment:        "Commitments shape how Rex escalates accountability.",
  goal:              "Stored goals define the coaching direction.",
  achievement:       "Rex surfaces achievements to counter self-doubt.",
  excuse_pattern:    "Rex detected an excuse pattern and adjusts coaching accordingly.",
  anchor:            "Core values that ground Rex's communication.",
  preference:        "Affects how Rex communicates tone and style.",
  injury:            "Factors into training recommendations directly.",
  nutrition_adherence: "Shapes how Rex approaches nutrition coaching.",
}

function memoryImportance(type: string, confidence: number): Importance {
  const highTypes = new Set(["promise", "commitment", "excuse_pattern", "injury"])
  if (highTypes.has(type) || confidence >= 0.85) return "high"
  if (confidence >= 0.65) return "medium"
  return "low"
}

function buildRexSnapshot(
  recoveryStatus: RecoveryStatus | null,
  nutritionCtx:  { proteinTargetG: number; proteinSummary: { avgDailyG: number; daysLogged: number } | null } | null,
  goalProgress:  { goalType: string; status: string; progressPercent: number } | null,
  weightTrend:   { currentWeight: number; weeklyRate: number; trend: string; stalled: boolean } | null,
  limiter:       Limiter,
  stalledLifts:  Array<{ exercise: string; sessionsStuck: number }>,
): CoachPageData["rexSnapshot"] {
  const lines: string[] = []
  const noData = !recoveryStatus && !nutritionCtx && !goalProgress && !weightTrend

  if (recoveryStatus) {
    const s = recoveryStatus.score
    lines.push(
      recoveryStatus.status === "rest"    ? `Recovery is poor (${s}/100). Rest required today.` :
      recoveryStatus.status === "limited" ? `Recovery is limited (${s}/100). Train lighter.` :
                                            `Recovery is good (${s}/100). Ready to train.`
    )
  }

  if (nutritionCtx?.proteinSummary) {
    const ps   = nutritionCtx.proteinSummary
    const diff = ps.avgDailyG - nutritionCtx.proteinTargetG
    lines.push(
      diff < -10
        ? `Protein is ${Math.abs(Math.round(diff))}g below the ${nutritionCtx.proteinTargetG}g target.`
        : `Protein is on target: ${ps.avgDailyG}g avg vs ${nutritionCtx.proteinTargetG}g goal.`
    )
  } else if (nutritionCtx) {
    lines.push("No protein data logged yet.")
  }

  if (weightTrend) {
    const r = weightTrend.weeklyRate
    const rateStr = r === 0 ? "±0" : r > 0 ? `+${r}` : `${r}`
    lines.push(
      weightTrend.stalled
        ? `Weight stalled at ${weightTrend.currentWeight}kg — no meaningful change in 14+ days.`
        : `Weight is ${weightTrend.trend} at ${rateStr}kg/week (${weightTrend.currentWeight}kg).`
    )
  }

  // Plateau outranks generic goal-progress text when limiter is training
  if (stalledLifts.length > 0 && limiter === "training") {
    const names = stalledLifts.slice(0, 2).map(l => l.exercise).join(" and ")
    lines.push(`Plateau detected on ${names} — weight not progressing.`)
  }

  if (goalProgress) {
    lines.push(
      goalProgress.status === "ahead"    ? `Goal progress is ahead of pace at ${goalProgress.progressPercent}%.` :
      goalProgress.status === "on_track" ? `Goal progress is on track at ${goalProgress.progressPercent}%.` :
      goalProgress.status === "behind"   ? `Goal is behind at ${goalProgress.progressPercent}%. Review consistency.` :
                                           `Goal progress: ${goalProgress.progressPercent}%.`
    )
  }

  // Empty state — chat-only or brand-new users
  if (lines.length === 0) {
    lines.push("No training data yet. Start logging sessions with Rex to unlock coaching insights.")
  }

  const primaryAction =
    noData                               ? "Start logging sessions with Rex." :
    recoveryStatus?.status === "rest"    ? "Rest today. Do not train." :
    recoveryStatus?.status === "limited" ? "Train at reduced intensity." :
    limiter === "nutrition"              ? "Prioritise protein intake today." :
    limiter === "adherence"              ? "Show up. Consistency is the current gap." :
    limiter === "recovery"               ? "Prioritise sleep and rest tonight." :
    stalledLifts.length > 0             ? "Try a deload or technique variation to break the plateau." :
    goalProgress?.status === "behind"    ? "Review your weekly training pace." :
                                           "Stay consistent. No critical gaps detected."

  return { lines, primaryAction }
}

function buildDecisionTrace(
  goalProgress:   { goalType: string; status: string; progressPercent: number } | null,
  recoveryStatus: RecoveryStatus | null,
  growthStatus:   Status,
  limiter:        Limiter,
  hc:             HardConstraints,
  mentorState:    MentorState,
): CoachPageData["decisionTrace"] {
  const steps: CoachPageData["decisionTrace"]["steps"] = [
    {
      label: "Goal",
      value: goalProgress
        ? `${goalProgress.goalType.replace("_", " ")} — ${goalProgress.progressPercent}%`
        : "No goal set",
      status:
        !goalProgress                         ? "neutral"  :
        goalProgress.status === "ahead"       ? "positive" :
        goalProgress.status === "on_track"    ? "positive" :
        goalProgress.status === "behind"      ? "warning"  :
        "neutral",
    },
    {
      label: "Recovery",
      value: recoveryStatus
        ? `${recoveryStatus.status} (${recoveryStatus.score}/100)`
        : "Not assessed",
      status:
        !recoveryStatus                       ? "neutral"  :
        recoveryStatus.status === "rest"      ? "critical" :
        recoveryStatus.status === "limited"   ? "warning"  :
        "positive",
    },
    {
      label: "Nutrition",
      value: growthStatus.replace("_", " "),
      status:
        growthStatus === "critical" ? "critical" :
        growthStatus === "behind"   ? "warning"  :
        growthStatus === "on_track" ? "positive" :
        "neutral",
    },
    {
      label: "Limiter",
      value: limiter.replace("_", " "),
      status: limiter === "unknown" ? "neutral" : "warning",
    },
    {
      label: "Recommendation",
      value: (hc.trainingBlocked || hc.noChallenge || hc.noPlan)
        ? "Constrained — some actions blocked"
        : `Address ${limiter.replace("_", " ")} gap`,
      status: (hc.trainingBlocked || hc.noChallenge || hc.noPlan) ? "warning" : "positive",
    },
  ]

  const activeConstraints: string[] = []
  if (hc.noChallenge)      activeConstraints.push("No challenge — high burnout or low motivation")
  if (hc.noAccountability) activeConstraints.push("No accountability — miss streak or burnout")
  if (hc.noPlan)           activeConstraints.push("No new plans — capacity critically low")
  if (hc.trainingBlocked)  activeConstraints.push("Training blocked — recovery constraint")
  if (hc.intensityReduced) activeConstraints.push("Intensity reduced — limited recovery")
  if (hc.toneFloor)        activeConstraints.push(`Tone floor: ${hc.toneFloor}`)

  return {
    steps,
    activeConstraints,
    mentorScores: {
      motivation:  mentorState.motivation,
      consistency: mentorState.consistency,
      burnoutRisk: mentorState.burnoutRisk,
      capacity:    mentorState.capacity,
      stress:      mentorState.stress,
      discipline:  mentorState.discipline,
      momentum:    mentorState.momentum,
    },
    activeFlags: mentorState.flags,
  }
}

function etaLabel(
  progressPercent: number,
  targetDate:      string | null,
  status:          string,
): string | null {
  if (!targetDate) return null
  const daysLeft = Math.round(
    (new Date(targetDate).getTime() - Date.now()) / 86_400_000
  )
  if (progressPercent >= 100) return "Goal reached"
  if (daysLeft < 0)           return "Target date passed"
  if (status === "ahead")     return `Ahead of pace — ${daysLeft}d remaining`
  if (status === "on_track")  return `${daysLeft}d to target date`
  if (status === "behind")    return `Behind pace — ${daysLeft}d left`
  return `${daysLeft}d to target date`
}

function emptyResponse(telegramConnected: boolean, isRexUser: boolean): CoachPageData {
  return {
    telegramConnected,
    isRexUser,
    currentFocus:        null,
    activeInvestigation: null,
    recommendations:     [],
    recovery: {
      score: null, status: null, constraintLevel: null, factors: [],
      hardConstraints: {
        noChallenge: false, noAccountability: false, noPlan: false,
        trainingBlocked: false, intensityReduced: false, toneFloor: null,
      },
    },
    nutrition:    null,
    goalAnalysis: null,
    activeMemories: [],
    rexSnapshot: {
      lines: ["Connect Telegram and complete onboarding to unlock coaching insights."],
      primaryAction: "Set up Rex on Telegram.",
    },
    decisionTrace: {
      steps: [], activeConstraints: [],
      mentorScores: {
        motivation: 0, consistency: 0, burnoutRisk: 0,
        capacity: 0,  stress: 0,      discipline: 0, momentum: 0,
      },
      activeFlags: [],
    },
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/coach
// ═══════════════════════════════════════════════════════════════════════════════

const V5_SYSTEM_TYPES = new Set([
  "intervention_log", "active_investigation", "follow_up_check", "mentor_state_history",
])

const COACHING_MEMORY_TYPES = new Set([
  "promise", "commitment", "goal", "achievement", "excuse_pattern",
  "anchor", "preference", "injury", "nutrition_adherence",
])

export async function GET() {
  const webSession = await getSession()
  if (!webSession) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  const userId = webSession.userId
  const now    = new Date()

  try {
    const [user, profile] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
      prisma.userProfile.findUnique({ where: { userId } }),
    ])

    if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const isRexUser         = profile?.primaryPersona === "rex"
    const telegramConnected = profile?.telegramConnected ?? false
    const telegramChatId    = profile?.telegramChatId ?? null

    if (!telegramChatId || !isRexUser) {
      return NextResponse.json(emptyResponse(telegramConnected, isRexUser ?? false))
    }

    const messenger = await prisma.messengerUser.findUnique({
      where:  { platform_platformChatId: { platform: "telegram", platformChatId: telegramChatId } },
      select: { id: true, intakeAnswers: true },
    })

    if (!messenger) return NextResponse.json(emptyResponse(telegramConnected, isRexUser ?? false))

    const messengerId    = messenger.id
    const platformChatId = telegramChatId
    const intake         = (messenger.intakeAnswers as Record<string, string>) ?? {}

    // ── Parallel data fetch ─────────────────────────────────────────────────
    const [snapshotBundle, mentorState, allMemories] = await Promise.all([
      buildFitnessSnapshot(messengerId, platformChatId, now),
      getMentorState(platformChatId),
      prisma.memoryFact.findMany({
        where:   { userId: messengerId },
        orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
        take:    30,
      }),
    ])

    const snapshot       = snapshotBundle?.snapshot       ?? null
    const recoveryStatus = snapshotBundle?.recoveryStatus ?? null
    const weightTrend    = snapshotBundle?.weightTrend    ?? null
    const patternReport  = snapshotBundle?.patternReport  ?? null

    // Nutrition context — same call Rex makes
    const bodyweightKg = snapshot?.weightTrend?.currentWeight ?? null
    const nutritionCtx = await getNutritionContext(
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

    // ── Compute hard constraints (same formula as mentor-orchestrator) ────────
    const hc = computeHardConstraints(
      mentorState,
      recoveryStatus?.constraintLevel ?? null,
    )

    // ── Extract active investigation ────────────────────────────────────────
    const investigationFact = allMemories.find(
      m => m.type === "active_investigation" && m.key === "current"
    )
    let activeInvestigation: CoachPageData["activeInvestigation"] = null
    if (investigationFact) {
      try {
        const raw = JSON.parse(investigationFact.value) as ActiveInvestigation
        const daysOpen = Math.round(
          (now.getTime() - new Date(raw.startedAt).getTime()) / 86_400_000
        )
        activeInvestigation = {
          topic:             raw.topic,
          hypotheses:        raw.hypotheses,
          missingData:       raw.missingData,
          evidenceCollected: raw.evidenceCollected,
          attemptCount:      raw.attemptCount,
          maxAttempts:       3,
          status:            raw.status,
          daysOpen,
        }
      } catch {}
    }

    // ── Section 1: Current Focus ────────────────────────────────────────────
    const ga      = nutritionCtx?.growthAssessment ?? null
    const limiter = (ga?.primaryLimiter  ?? "unknown") as Limiter
    const gaStatus = (ga?.overallStatus  ?? "unknown") as Status

    const focusConfidence: Confidence =
      limiter === "recovery"  ? "high" :
      limiter === "nutrition" ? (nutritionCtx?.proteinSummary?.confidence ?? "low") :
      limiter === "training"  ? "moderate" :
      limiter === "adherence" ? "moderate" :
      "low"

    const currentFocus: CoachPageData["currentFocus"] = ga ? {
      limiter,
      overallStatus: gaStatus,
      why:           ga.narrative,
      evidence:      buildFocusEvidence(limiter, recoveryStatus, nutritionCtx, snapshot?.goalProgress ?? null),
      confidence:    focusConfidence,
    } : null

    // ── Section 3: Recommendations ──────────────────────────────────────────
    const recommendations = buildRecommendations(
      hc, limiter, recoveryStatus, nutritionCtx, snapshot?.goalProgress ?? null
    )

    // ── Section 4: Recovery ──────────────────────────────────────────────────
    const recovery: CoachPageData["recovery"] = {
      score:           recoveryStatus?.score            ?? null,
      status:          (recoveryStatus?.status          ?? null) as RecovLevel | null,
      constraintLevel: (recoveryStatus?.constraintLevel ?? null) as CoachPageData["recovery"]["constraintLevel"],
      factors:         recoveryStatus?.factors          ?? [],
      hardConstraints: hc,
    }

    // ── Section 5: Nutrition ─────────────────────────────────────────────────
    let nutrition: CoachPageData["nutrition"] = null
    if (nutritionCtx) {
      const ps  = nutritionCtx.proteinSummary
      const cal = nutritionCtx.calorieBalance
      nutrition = {
        tier:                   nutritionCtx.tier,
        proteinTargetG:         nutritionCtx.proteinTargetG,
        proteinAvgG:            ps?.avgDailyG       ?? null,
        proteinDaysLogged:      ps?.daysLogged       ?? 0,
        proteinTrend:           (ps?.trend           ?? null) as "up" | "down" | "stable" | null,
        proteinConfidence:      (ps?.confidence      ?? null) as Confidence | null,
        calorieBalance:         (cal?.impliedBalance ?? null) as NonNullable<CoachPageData["nutrition"]>["calorieBalance"],
        calorieAlignedWithGoal: cal?.alignedWithGoal ?? null,
        calorieNarrative:       cal?.narrative       ?? null,
        calorieConfidence:      (cal?.confidence     ?? null) as Confidence | null,
        adherence:              nutritionCtx.adherenceSelfReport,
        topFoods:               nutritionCtx.mealMemory?.topFoods ?? [],
        actionNeeded:           nutritionCtx.trendAnalysis.actionNeeded,
        summary:                nutritionCtx.trendAnalysis.summary,
      }
    }

    // ── Section 6: Goal Analysis ──────────────────────────────────────────────
    const gp = snapshot?.goalProgress ?? null
    const wt = weightTrend
    let goalAnalysis: CoachPageData["goalAnalysis"] = null
    if (gp) {
      goalAnalysis = {
        goalType:          gp.goalType,
        exercise:          gp.exercise,
        progressPercent:   gp.progressPercent,
        status:            gp.status,
        currentValue:      gp.currentValue,
        targetValue:       gp.targetValue,
        unit:              gp.unit,
        startDate:         gp.startDate,
        targetDate:        gp.targetDate,
        weeklyRateKg:      wt?.weeklyRate   ?? null,
        weightTrend:       (wt?.trend       ?? null) as "gaining" | "losing" | "stable" | null,
        weightStalled:     wt?.stalled       ?? false,
        whyProgressStatus: ga?.narrative    ?? "No growth assessment available.",
        etaLabel:          etaLabel(gp.progressPercent, gp.targetDate, gp.status),
        overallStatus:     gaStatus,
      }
    }

    // ── Section 7: Memory Influencing Coaching ───────────────────────────────
    const nowMs = now.getTime()
    const activeMemories: CoachPageData["activeMemories"] = allMemories
      .filter(m => !V5_SYSTEM_TYPES.has(m.type) && COACHING_MEMORY_TYPES.has(m.type))
      .slice(0, 8)
      .map(m => ({
        id:              m.id,
        type:            m.type,
        key:             m.key,
        value:           m.value,
        confidence:      m.confidence,
        ageHours:        Math.round((nowMs - new Date(m.updatedAt).getTime()) / 3_600_000),
        importanceLabel: memoryImportance(m.type, m.confidence),
        whySurfaced:     MEMORY_SURFACE_REASON[m.type] ?? "Stored context that informs Rex's approach.",
      }))

    // ── Section 8: Rex Snapshot ───────────────────────────────────────────────
    const stalledLifts = patternReport?.stalledLifts ?? []
    const rexSnapshot = buildRexSnapshot(recoveryStatus, nutritionCtx, gp, wt, limiter, stalledLifts)

    // ── Section 9: Decision Trace ─────────────────────────────────────────────
    const decisionTrace = buildDecisionTrace(gp, recoveryStatus, gaStatus, limiter, hc, mentorState)

    const data: CoachPageData = {
      telegramConnected,
      isRexUser: isRexUser ?? false,
      currentFocus,
      activeInvestigation,
      recommendations,
      recovery,
      nutrition,
      goalAnalysis,
      activeMemories,
      rexSnapshot,
      decisionTrace,
    }

    return NextResponse.json(data)

  } catch (e) {
    console.error("[COACH_ERROR]", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
