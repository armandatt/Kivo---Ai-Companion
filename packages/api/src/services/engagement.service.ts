import { prisma } from "@repo/db/client"

// ═══════════════════════════════════════════════════════════════════════════════
// STREAK MILESTONES
// ═══════════════════════════════════════════════════════════════════════════════

const MILESTONES = [3, 7, 14, 21, 30, 60, 100] as const

const MILESTONE_MESSAGES: Record<number, string> = {
  3:   "3 in a row. Habit forming.",
  7:   "Week streak. The version of you that 'starts Monday' is dead. 🔥",
  14:  "14 days. This isn't motivation anymore. This is identity.",
  21:  "21 days. Science says habit. I say you're just built different now. 💪",
  30:  "30 days. You're not the same person who typed /start. 🐉",
  60:  "60 days. Most people quit in week 2. You're in the top 5%. 🐉",
  100: "100 days. I don't give this often: you've earned it.\nWhatever you set for the next 100 days — I'll be here. 🐉",
}

export function getStreakMilestoneMessage(
  streak:          number,
  milestonesFired: number[],
): { message: string; threshold: number } | null {
  for (const threshold of MILESTONES) {
    if (streak >= threshold && !milestonesFired.includes(threshold)) {
      return { message: MILESTONE_MESSAGES[threshold]!, threshold }
    }
  }
  return null
}

export function getStreakBrokenMessage(prevStreak: number): string {
  return `Streak gone. ${prevStreak} days. Now it's 0.\nStart again today or wait until Monday. Your call.`
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEEKLY REVIEW
// Auto-generated after every completed split cycle.
// ═══════════════════════════════════════════════════════════════════════════════

export async function generateWeeklyReview(
  messengerUserId: string,
  cycleNumber:     number,   // 0-indexed cycle that just completed
  cycleLength:     number,   // sessions in the cycle
  deloadNext:      boolean,
): Promise<string | null> {
  // Grab the last cycleLength completed sessions (just-finished cycle)
  const sessions = await prisma.telegramWorkoutSession.findMany({
    where:   { messengerUserId, completed: true },
    orderBy: { date: "desc" },
    take:    cycleLength,
    select:  { id: true, musclesTrained: true },
  })
  if (!sessions.length) return null

  const sessionIds: string[] = sessions.map((s: any) => s.id)

  const allSets = await prisma.telegramSetLog.findMany({
    where:   { sessionId: { in: sessionIds }, completed: true },
    orderBy: { weightKg: "desc" },
    select:  { exerciseName: true, weightKg: true, reps: true, sessionId: true },
  })
  if (!allSets.length) return null

  const weekNum = cycleNumber + 1

  // Best moment: heaviest set with usable reps
  const goodSets = allSets.filter((s: any) => s.reps >= 3)
  const best     = (goodSets[0] ?? allSets[0]) as { exerciseName: string; weightKg: number; reps: number }

  // Was it a PR? Compare against user's current personalRecords (set during this cycle)
  const user = await prisma.messengerUser.findUnique({
    where:  { id: messengerUserId },
    select: { personalRecords: true },
  })
  const prs = (user?.personalRecords ?? {}) as Record<string, { weightKg: number; sessionId: string }>
  const pr  = prs[best.exerciseName]
  const isPRThisCycle = pr && sessionIds.includes(pr.sessionId) && pr.weightKg === best.weightKg

  const bestNote = isPRThisCycle ? `${best.weightKg}kg — PR 🔥` : `${best.weightKg}kg`

  // One thing to fix: detect the most obvious problem from set history
  const exerciseWeights = groupSetsByExercise(allSets, sessionIds)
  const fixLine = detectTopFix(exerciseWeights, sessions.length)

  // Next cycle directive
  const nextLine = deloadNext
    ? "Next cycle: deload — 60% of all weights, 2 sets per exercise."
    : "Next cycle: add weight where RPE allowed it. No maintenance sets."

  return [
    `Week ${weekNum} done.`,
    `${sessions.length} session${sessions.length === 1 ? "" : "s"}. Best moment: ${best.exerciseName} ${bestNote}.`,
    fixLine,
    nextLine,
  ].join("\n")
}

function groupSetsByExercise(
  sets:       any[],
  sessionIds: string[],
): Record<string, Record<string, number>> {
  // Returns { exercise: { sessionId: maxWeight } }
  const result: Record<string, Record<string, number>> = {}
  for (const set of sets) {
    result[set.exerciseName] ??= {}
    const cur = result[set.exerciseName]![set.sessionId] ?? 0
    result[set.exerciseName]![set.sessionId] = Math.max(cur, set.weightKg)
  }
  return result
}

function detectTopFix(
  exerciseWeights: Record<string, Record<string, number>>,
  sessionCount:    number,
): string {
  // Stall: same weight across all sessions that included the exercise
  for (const [exercise, sessWeights] of Object.entries(exerciseWeights)) {
    const weights = Object.values(sessWeights)
    if (weights.length >= 2 && weights.every(w => w === weights[0])) {
      return `Fix: ${exercise} is stalling at ${weights[0]}kg. Next cycle: drop to ${Math.round(weights[0]! * 0.9)}kg, 4×6 to reset.`
    }
  }

  // Regression: weight dropped in last 2 sessions
  for (const [exercise, sessWeights] of Object.entries(exerciseWeights)) {
    const weights = Object.values(sessWeights)
    if (weights.length >= 2 && weights.at(-1)! < weights.at(-2)!) {
      return `Fix: ${exercise} dropped weight. Diagnose before next session — sleep, food, bar path.`
    }
  }

  if (sessionCount < 3) {
    return "Fix: missed sessions this cycle. Every day counts."
  }

  return "Fix: keep adding reps before adding weight. Don't rush the progression."
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENGAGEMENT CONTEXT (injected into every Rex LLM call)
// ═══════════════════════════════════════════════════════════════════════════════

export interface EngagementContext {
  streak:             number
  sessionsThisMonth:  number
  biggestPR:          string         // "Deadlift 120kg" or "none yet"
  onboardingObstacle: string | null
  firstBenchWeight:   number | null  // first ever logged bench weight
  currentBenchWeight: number | null  // current PR bench weight
  firstLogDate:       string | null  // "YYYY-MM-DD"
}

export async function buildEngagementContext(
  messengerUserId: string,
  now = new Date(),
): Promise<EngagementContext | null> {
  const user = await prisma.messengerUser.findUnique({
    where:  { id: messengerUserId },
    select: { gymStreak: true, personalRecords: true, intakeAnswers: true, splitState: true },
  })
  if (!user) return null

  const intake    = parseIntake(user.intakeAnswers)
  const prs       = (user.personalRecords ?? {}) as Record<string, { weightKg: number }>
  const splitData = parseSplitDataMinimal(user.splitState)

  const monthStart       = new Date(now.getFullYear(), now.getMonth(), 1)
  const sessionsThisMonth: number = await prisma.telegramWorkoutSession.count({
    where: { messengerUserId, completed: true, date: { gte: monthStart } },
  })

  // Biggest PR by weight
  const prEntries = Object.entries(prs).sort(([, a], [, b]) => b.weightKg - a.weightKg)
  const biggestPR = prEntries.length > 0
    ? `${prEntries[0]![0]} ${prEntries[0]![1].weightKg}kg`
    : "none yet"

  // Stated obstacle: check various intake fields
  const onboardingObstacle =
    intake.obstacle ??
    intake.biggest_challenge ??
    (intake.injury_notes && intake.injury_notes !== "none" ? intake.injury_notes : null) ??
    null

  // Bench: first logged vs current
  const benchKey = Object.keys(prs).find(k =>
    k.toLowerCase().includes("bench") || k.toLowerCase().includes("press")
  )
  const currentBenchWeight = benchKey ? prs[benchKey]!.weightKg : null
  const firstBenchWeight   = splitData.firstExerciseWeights["Bench Press"] ?? null

  return {
    streak:             user.gymStreak ?? 0,
    sessionsThisMonth,
    biggestPR,
    onboardingObstacle,
    firstBenchWeight,
    currentBenchWeight,
    firstLogDate: splitData.firstLogDate,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function parseIntake(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return raw as Record<string, string>
}

function parseSplitDataMinimal(raw: unknown): {
  firstLogDate:         string | null
  firstExerciseWeights: Record<string, number>
} {
  const def = { firstLogDate: null, firstExerciseWeights: {} }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return def
  const s = raw as Record<string, unknown>
  return {
    firstLogDate: typeof s.firstLogDate === "string" ? s.firstLogDate : null,
    firstExerciseWeights:
      s.firstExerciseWeights &&
      typeof s.firstExerciseWeights === "object" &&
      !Array.isArray(s.firstExerciseWeights)
        ? (s.firstExerciseWeights as Record<string, number>)
        : {},
  }
}
