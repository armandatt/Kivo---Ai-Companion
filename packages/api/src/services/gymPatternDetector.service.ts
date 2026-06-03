import { prisma } from "@repo/db/client"

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface StalledLift {
  exercise:     string
  sessionsStuck: number
  suggestedFix: string
}

export interface WeeklyVolumeEntry {
  muscle: string
  sets:   number
  target: number
}

export interface PatternReport {
  consistencyScore:    number
  skippedMuscles:      string[]
  stalledLifts:        StalledLift[]
  rpe_trend:           "overtrained" | "undertrained" | "optimal" | "unknown"
  inferredMethodology: "strength" | "hypertrophy" | "mixed"
  weeklyVolume:        WeeklyVolumeEntry[]
  deloadDue:           boolean
  flags:               string[]
  interventionMessage: string | null
}

interface RawSession {
  id:            string
  date:          Date
  musclesTrained: string[]
  completed:     boolean
}

interface RawSet {
  exerciseName: string
  weightKg:     number
  reps:         number
  rpe:          number | null
  sessionId:    string
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function parseIntake(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return raw as Record<string, string>
}

function parseSplitStateMinimal(raw: unknown): { cycleNumber: number } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { cycleNumber: 0 }
  const s = raw as Record<string, unknown>
  return { cycleNumber: typeof s.cycleNumber === "number" ? s.cycleNumber : 0 }
}

function getTrainingDays(split: string, daysPerWeek: number): string[] {
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

function shortMuscle(muscle: string): string {
  if (muscle.includes("(")) return muscle.split("(")[0]!.trim().toLowerCase()
  if (muscle.includes("+")) return muscle.split("+")[0]!.trim().toLowerCase()
  return muscle.toLowerCase()
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Groups sets by exercise → sessions in chronological order
function groupByExerciseAndSession(
  sets:         RawSet[],
  sessionOrder: string[],
): Record<string, RawSet[][]> {
  const byExercise: Record<string, Record<string, RawSet[]>> = {}
  for (const set of sets) {
    byExercise[set.exerciseName] ??= {}
    byExercise[set.exerciseName]![set.sessionId] ??= []
    byExercise[set.exerciseName]![set.sessionId]!.push(set)
  }
  const result: Record<string, RawSet[][]> = {}
  for (const [exercise, sessionMap] of Object.entries(byExercise)) {
    result[exercise] = sessionOrder
      .filter(id => id in sessionMap)
      .map(id => sessionMap[id]!)
  }
  return result
}

// ═══════════════════════════════════════════════════════════════════════════════
// FLAG → INTERVENTION MESSAGE
// ═══════════════════════════════════════════════════════════════════════════════

function buildInterventionMessage(
  flags:               string[],
  stalledLifts:        StalledLift[],
  consistencyScore:    number,
  inferredMethodology: "strength" | "hypertrophy" | "mixed",
): string | null {
  // Priority: OVERREACHING > REGRESSION > STALL > LOW_CONSISTENCY >
  //           MUSCLE_AVOIDANCE > UNDERTRAINING > LOW_VOLUME > SCHEDULE_SLIP > DELOAD_DUE

  if (flags.includes("OVERREACHING")) {
    return "Your RPE has been 9-10 every session this week. That's not intensity, that's your CNS screaming. Cut weights 15% today. Not optional."
  }

  const regression = flags.find(f => f.startsWith("REGRESSION:"))
  if (regression) {
    const ex = capitalize(regression.replace("REGRESSION: ", ""))
    return `${ex} dropped twice in a row. Not a technique issue — answer me this: sleep and food this week, 1-10?`
  }

  const stall = flags.find(f => f.startsWith("STALL:"))
  if (stall) {
    const ex = capitalize(stall.replace("STALL: ", ""))
    const lift = stalledLifts.find(s => s.exercise.toLowerCase() === ex.toLowerCase())
    const weightMatch = lift?.suggestedFix.match(/(\d+(?:\.\d+)?)kg/)
    const weight = weightMatch ? `${weightMatch[1]}kg` : "the same weight"
    return `${ex} has been ${weight} for 3 sessions. We're not adding weight — we're adding a rep. Same weight, hit one more rep. Reset the pattern.`
  }

  if (flags.includes("LOW_CONSISTENCY")) {
    return `Real talk — you've completed ${consistencyScore}% of planned sessions in the last 4 weeks. That's not a schedule problem. What's actually going on?`
  }

  const avoidance = flags.find(f => f.startsWith("MUSCLE_AVOIDANCE:"))
  if (avoidance) {
    const muscle = avoidance.replace("MUSCLE_AVOIDANCE: ", "")
    return `You haven't trained ${muscle} in over 10 days. I'm not asking if you want to. It's on the plan. When this week?`
  }

  if (flags.includes("UNDERTRAINING")) {
    return "You've been coasting. RPE 5-6 isn't training, it's showing up. Add 5kg across the board this session."
  }

  const lowVol = flags.find(f => f.startsWith("LOW_VOLUME:"))
  if (lowVol) {
    const muscle = lowVol.replace("LOW_VOLUME: ", "")
    return `Your ${muscle} is getting under 10 sets this week. Minimum for growth is 12-16. Add one more set to your next session.`
  }

  if (flags.includes("SCHEDULE_SLIP")) {
    return "Your session gaps are stretching past what the plan allows. Give me a specific day you're training this week."
  }

  if (flags.includes("HIGH_VOLUME")) {
    const hv = flags.find(f => f.startsWith("HIGH_VOLUME:"))!
    const muscle = hv.replace("HIGH_VOLUME: ", "")
    return `Over 22 sets for ${muscle} this week. More volume isn't better — it's just more. Drop 2 sets and add sleep instead.`
  }

  if (flags.includes("DELOAD_DUE")) {
    const label = inferredMethodology === "strength" ? "4 cycles of real training" : "4 weeks straight"
    return `${label}. Next cycle is a deload — 60% weights, 2 sets per exercise. I know you hate it. Do it anyway.`
  }

  return null
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

export async function computePatternReport(
  messengerUserId: string,
  now = new Date(),
): Promise<PatternReport | null> {
  const user = await prisma.messengerUser.findUnique({
    where:  { id: messengerUserId },
    select: { intakeAnswers: true, splitState: true },
  })
  if (!user) return null

  const intake      = parseIntake(user.intakeAnswers)
  const daysPerWeek = parseInt(intake.available_training_days ?? "3") || 3
  const split       = intake.current_split ?? "unstructured"
  const gymGoal     = (intake.gym_goal ?? "").toLowerCase()
  const splitState  = parseSplitStateMinimal(user.splitState)

  // Sessions in last 28 days
  const since28: Date = new Date(now.getTime() - 28 * 86_400_000)
  const sessions: RawSession[] = await prisma.telegramWorkoutSession.findMany({
    where:   { messengerUserId, date: { gte: since28 } },
    orderBy: { date: "asc" },
    select:  { id: true, date: true, musclesTrained: true, completed: true },
  })

  if (!sessions.length) return null

  const completedSessions = sessions.filter(s => s.completed)
  if (completedSessions.length < 2) return null

  const sessionOrder = completedSessions.map(s => s.id)

  // All sets from completed sessions
  const sets: RawSet[] = await prisma.telegramSetLog.findMany({
    where:  { sessionId: { in: sessionOrder }, completed: true },
    select: { exerciseName: true, weightKg: true, reps: true, rpe: true, sessionId: true },
  })

  // ─── CONSISTENCY ─────────────────────────────────────────────────────────────
  const plannedSessions  = daysPerWeek * 4
  const consistencyScore = Math.min(100, Math.round((completedSessions.length / plannedSessions) * 100))

  // ─── SKIPPED MUSCLES ─────────────────────────────────────────────────────────
  const dayList       = getTrainingDays(split, daysPerWeek)
  const uniqueMuscles = [...new Set(dayList)]
  const tenDaysAgo    = new Date(now.getTime() - 10 * 86_400_000)
  const skippedMuscles: string[] = []

  for (const muscle of uniqueMuscles) {
    const firstWord = muscle.split(/[\s(+]/)[0]!.toLowerCase()
    const lastTrained = [...completedSessions]
      .reverse()
      .find(s => s.musclesTrained.some(m => m.toLowerCase().includes(firstWord)))
    if (!lastTrained || new Date(lastTrained.date) < tenDaysAgo) {
      skippedMuscles.push(muscle)
    }
  }

  // ─── STALLED LIFTS + REGRESSIONS ─────────────────────────────────────────────
  const exerciseGroups = groupByExerciseAndSession(sets, sessionOrder)
  const stalledLifts:  StalledLift[] = []
  const regressions:   string[]      = []

  for (const [exercise, exerciseSessions] of Object.entries(exerciseGroups)) {
    if (exerciseSessions.length < 3) continue
    const sessWeights = exerciseSessions.map(sess => Math.max(...sess.map(s => s.weightKg)))
    const last3       = sessWeights.slice(-3) as [number, number, number]

    if (last3.every(w => w === last3[0])) {
      stalledLifts.push({
        exercise,
        sessionsStuck: 3,
        suggestedFix:  `Same weight, add a rep. This session: ${last3[0]}kg × more reps.`,
      })
    } else if (last3[2] < last3[1] && last3[1] < last3[0]) {
      regressions.push(exercise)
    }
  }

  // ─── RPE TREND ───────────────────────────────────────────────────────────────
  const recentIds     = completedSessions.slice(-5).map(s => s.id)
  const recentRpeSets = sets.filter(s => recentIds.includes(s.sessionId) && s.rpe != null)

  const sessionRpeAvgs = recentIds.map(sid => {
    const vals = recentRpeSets.filter(s => s.sessionId === sid).map(s => s.rpe as number)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  }).filter((r): r is number => r !== null)

  let rpe_trend: PatternReport["rpe_trend"] = "unknown"
  if (sessionRpeAvgs.length >= 3) {
    if (sessionRpeAvgs.every(r => r >= 9))      rpe_trend = "overtrained"
    else if (sessionRpeAvgs.every(r => r <= 6)) rpe_trend = "undertrained"
    else                                         rpe_trend = "optimal"
  }

  // ─── METHODOLOGY ─────────────────────────────────────────────────────────────
  const repValues = sets.map(s => s.reps)
  const avgReps   = repValues.length ? repValues.reduce((a, b) => a + b, 0) / repValues.length : 8

  let inferredMethodology: PatternReport["inferredMethodology"] = "mixed"
  if (gymGoal.includes("strength") || avgReps < 6)                                                    inferredMethodology = "strength"
  else if (gymGoal.includes("muscle") || gymGoal.includes("hypertrophy") || gymGoal.includes("mass") || avgReps > 8) inferredMethodology = "hypertrophy"

  // ─── WEEKLY VOLUME ────────────────────────────────────────────────────────────
  const sevenDaysAgo    = new Date(now.getTime() - 7 * 86_400_000)
  const lastWeekSess    = completedSessions.filter(s => new Date(s.date) >= sevenDaysAgo)
  const lastWeekIds     = new Set(lastWeekSess.map(s => s.id))
  const weekSets        = sets.filter(s => lastWeekIds.has(s.sessionId))

  const muscleSetCounts: Record<string, number> = {}
  for (const sess of lastWeekSess) {
    const muscle = sess.musclesTrained[0] ?? "Unknown"
    const count  = weekSets.filter(s => s.sessionId === sess.id).length
    muscleSetCounts[muscle] = (muscleSetCounts[muscle] ?? 0) + count
  }

  const volumeTarget = inferredMethodology === "strength" ? 12 : 14
  const weeklyVolume: WeeklyVolumeEntry[] = Object.entries(muscleSetCounts).map(([muscle, count]) => ({
    muscle,
    sets:   count,
    target: volumeTarget,
  }))

  // ─── DELOAD ───────────────────────────────────────────────────────────────────
  const deloadDue = splitState.cycleNumber > 0 && splitState.cycleNumber % 4 === 0

  // ─── SCHEDULE SLIP ────────────────────────────────────────────────────────────
  let scheduleSlip = false
  const dates = completedSessions.map(s => new Date(s.date).getTime()).sort((a, b) => a - b)
  if (dates.length >= 3) {
    const gaps: number[] = []
    for (let i = 1; i < dates.length; i++) gaps.push((dates[i]! - dates[i - 1]!) / 86_400_000)
    const avgGap      = gaps.reduce((a, b) => a + b, 0) / gaps.length
    const expectedGap = 7 / daysPerWeek
    scheduleSlip = avgGap > expectedGap * 1.7
  }

  // ─── BUILD FLAGS ─────────────────────────────────────────────────────────────
  const flags: string[] = []

  if (consistencyScore < 60 && completedSessions.length >= 4) flags.push("LOW_CONSISTENCY")
  if (scheduleSlip)                                            flags.push("SCHEDULE_SLIP")
  for (const muscle of skippedMuscles)                        flags.push(`MUSCLE_AVOIDANCE: ${shortMuscle(muscle)}`)
  for (const lift of stalledLifts)                            flags.push(`STALL: ${lift.exercise.toLowerCase()}`)
  for (const ex of regressions)                               flags.push(`REGRESSION: ${ex.toLowerCase()}`)
  if (rpe_trend === "overtrained")                            flags.push("OVERREACHING")
  if (rpe_trend === "undertrained")                           flags.push("UNDERTRAINING")
  for (const v of weeklyVolume) {
    if (v.sets < Math.floor(v.target * 0.7)) flags.push(`LOW_VOLUME: ${shortMuscle(v.muscle)}`)
    if (v.sets > 22)                          flags.push(`HIGH_VOLUME: ${shortMuscle(v.muscle)}`)
  }
  if (deloadDue) flags.push("DELOAD_DUE")

  const interventionMessage = buildInterventionMessage(
    flags, stalledLifts, consistencyScore, inferredMethodology,
  )

  return {
    consistencyScore,
    skippedMuscles,
    stalledLifts,
    rpe_trend,
    inferredMethodology,
    weeklyVolume,
    deloadDue,
    flags,
    interventionMessage,
  }
}
