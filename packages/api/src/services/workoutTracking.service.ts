import { prisma } from "@repo/db/client"
import {
  getStreakMilestoneMessage,
  getStreakBrokenMessage,
  generateWeeklyReview,
} from "./engagement.service"

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface SplitState {
  lastCompletedDayIndex: number | null
  lastSessionDate:       string | null   // "YYYY-MM-DD"
  cycleNumber:           number
  daysTrained:           number[]        // day indices trained this cycle
  activeLogging:         ActiveLogging | null
  milestonesFired:       number[]                    // streak thresholds already sent
  firstExerciseWeights:  Record<string, number>      // first logged weight per exercise
  firstLogDate:          string | null               // "YYYY-MM-DD" of first ever session
}

interface ActiveLogging {
  sessionId:        string
  splitDayIndex:    number
  muscles:          string
  startedAt:        string              // ISO timestamp
  currentExercise:  string | null
  exercisesDone:    string[]
  pendingRpe:       boolean
  lastSetId:        string | null
  currentSetNumber: number
}

interface PersonalRecords {
  [exercise: string]: {
    weightKg:  number
    reps:      number
    date:      string
    sessionId: string
  }
}

interface SetEntry {
  sets:     number
  reps:     number
  weightKg: number
}

type UserRow = {
  id:              string
  gymStreak:       number
  splitState:      unknown
  personalRecords: unknown
  intakeAnswers:   unknown
}

const NOT_HANDLED = { handled: false as const, reply: "" }

// ═══════════════════════════════════════════════════════════════════════════════
// EXERCISE LIBRARY
// ═══════════════════════════════════════════════════════════════════════════════

const MUSCLE_EXERCISES: Record<string, string[]> = {
  "Chest + Triceps + Shoulders":                  ["Bench Press",  "Overhead Press",    "Incline DB Press",  "Tricep Dips"],
  "Back + Biceps":                                ["Barbell Row",  "Pull-up",           "Lat Pulldown",      "Barbell Curl"],
  "Legs":                                         ["Squat",        "Romanian Deadlift", "Leg Press",         "Hip Thrust"],
  "Upper Body (Chest / Back / Shoulders / Arms)": ["Bench Press",  "Barbell Row",       "Overhead Press",    "Pull-up"],
  "Lower Body (Quads / Hamstrings / Glutes)":     ["Squat",        "Romanian Deadlift", "Leg Press",         "Lunges"],
  "Full Body":                                    ["Squat",        "Bench Press",       "Barbell Row",       "Romanian Deadlift"],
  "Chest":                                        ["Bench Press",  "Incline DB Press",  "Cable Flyes",       "Dips"],
  "Back":                                         ["Barbell Row",  "Pull-up",           "Lat Pulldown",      "Seated Cable Row"],
  "Shoulders":                                    ["Overhead Press","Lateral Raises",   "Face Pulls",        "Arnold Press"],
  "Arms":                                         ["Barbell Curl", "Tricep Pushdown",   "Hammer Curl",       "Close-Grip Bench"],
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPLIT CYCLE
// ═══════════════════════════════════════════════════════════════════════════════

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
  if (split === "full_body") return ["Full Body", "Full Body", "Full Body"]
  if (split === "bro_split") return ["Chest", "Back", "Legs", "Shoulders", "Arms"]
  const n = Math.min(Math.max(daysPerWeek, 2), 6)
  return Array<string>(n).fill("Full Body")
}

function getNextDayIndex(state: SplitState, cycleLength: number): number {
  if (state.lastCompletedDayIndex === null) return 0
  return (state.lastCompletedDayIndex + 1) % cycleLength
}

// ═══════════════════════════════════════════════════════════════════════════════
// /log COMMAND — open new session
// ═══════════════════════════════════════════════════════════════════════════════

export async function handleLogCommand(
  platformChatId: string,
  now = new Date()
): Promise<string> {
  const user = await getUser(platformChatId)
  if (!user) return "Set up your training profile first."

  const intake  = parseIntake(user.intakeAnswers)
  const split   = intake.current_split ?? "unstructured"
  const days    = parseInt(intake.available_training_days ?? "3") || 3
  const dayList = getTrainingDays(split, days)
  const state   = parseSplitState(user.splitState)

  if (state.activeLogging) {
    const al = state.activeLogging
    return al.currentExercise
      ? `Already logging — ${al.muscles}, set ${al.currentSetNumber} of ${al.currentExercise}.\nContinue or type "done" to finish.`
      : `Logging ${al.muscles}. First exercise? (or type your own):\n${formatExerciseList(al.muscles)}`
  }

  const nextIndex = getNextDayIndex(state, dayList.length)
  const muscles   = dayList[nextIndex] ?? "Full Body"

  const session = await prisma.telegramWorkoutSession.create({
    data: {
      messengerUserId: user.id,
      date:            now,
      splitDayIndex:   nextIndex,
      musclesTrained:  [muscles],
      completed:       false,
    },
  })

  await writeSplitState(user.id, {
    ...state,
    firstLogDate: state.firstLogDate ?? now.toISOString().slice(0, 10),
    activeLogging: {
      sessionId:        session.id,
      splitDayIndex:    nextIndex,
      muscles,
      startedAt:        now.toISOString(),
      currentExercise:  null,
      exercisesDone:    [],
      pendingRpe:       false,
      lastSetId:        null,
      currentSetNumber: 0,
    },
  })

  return `Logging Day ${nextIndex + 1} — ${muscles}.\n\nFirst exercise? (or type your own):\n${formatExerciseList(muscles)}`
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTIVE SESSION ROUTING — called for every message when logging is open
// ═══════════════════════════════════════════════════════════════════════════════

export async function handleActiveLoggingMessage(
  platformChatId: string,
  text:           string,
  now = new Date()
): Promise<{ handled: boolean; reply: string }> {
  const user = await getUser(platformChatId)
  if (!user) return NOT_HANDLED

  const state = parseSplitState(user.splitState)
  if (!state.activeLogging) return NOT_HANDLED

  const al    = state.activeLogging
  const lower = text.trim().toLowerCase()

  // done / finish → complete session
  if (/^(done|finish|finished|end|stop|complete)$/i.test(lower)) {
    return finishSession(user, state, al, now)
  }

  // RPE response pending
  if (al.pendingRpe) {
    const rpe  = parseRpe(text)
    const skip = /^(skip|no|s|-|pass|\.|\/)$/i.test(lower)
    if (rpe !== null || skip) {
      if (al.lastSetId && rpe !== null) {
        await prisma.telegramSetLog.update({
          where: { id: al.lastSetId },
          data:  { rpe },
        })
      }
      await writeSplitState(user.id, { ...state, activeLogging: { ...al, pendingRpe: false } })
      return { handled: true, reply: `Logged. Next set, "next" for next exercise, or "done".` }
    }
    // Non-RPE input while pending — fall through to try parsing as a set
  }

  // No exercise selected yet
  if (!al.currentExercise) {
    return selectExercise(user, state, al, text)
  }

  // next / switch exercise
  if (/^(next|next exercise|change|switch|new exercise)$/i.test(lower)) {
    return moveToNextExercise(user, state, al)
  }

  // parse set data
  const setEntry = parseSet(text)
  if (setEntry) {
    return logSets(user, state, al, setEntry)
  }

  return {
    handled: true,
    reply:   `Format: 3×5×80 (sets×reps×kg) or "80kg × 5".\n"next" for next exercise. "done" to finish.`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SESSION STEPS
// ═══════════════════════════════════════════════════════════════════════════════

async function selectExercise(
  user: UserRow, state: SplitState, al: ActiveLogging, text: string
): Promise<{ handled: boolean; reply: string }> {
  const defaults = MUSCLE_EXERCISES[al.muscles] ?? []
  const idx = parseInt(text.trim()) - 1
  const exercise = (idx >= 0 && idx < defaults.length)
    ? defaults[idx]!
    : capitalize(text.trim())

  await writeSplitState(user.id, {
    ...state,
    activeLogging: { ...al, currentExercise: exercise, currentSetNumber: 0, pendingRpe: false },
  })

  const overload = await getOverloadSuggestion(user.id, exercise)
  const hint = overload ? `\nLast time: ${overload.lastNote} → target ${overload.nextKg}kg.` : ""

  return {
    handled: true,
    reply:   `${exercise}.${hint}\n\nSets × reps × weight. Go:\nFormat: 3×5×80 or just "80kg × 5"`,
  }
}

async function logSets(
  user: UserRow, state: SplitState, al: ActiveLogging, entry: SetEntry
): Promise<{ handled: boolean; reply: string }> {
  let lastSetId: string | null = null

  for (let i = 0; i < entry.sets; i++) {
    const setNumber = al.currentSetNumber + i + 1
    const set = await prisma.telegramSetLog.create({
      data: {
        sessionId:    al.sessionId,
        exerciseName: al.currentExercise!,
        setNumber,
        reps:         entry.reps,
        weightKg:     entry.weightKg,
        completed:    true,
      },
    })
    if (i === entry.sets - 1) lastSetId = set.id
  }

  const newSetNum = al.currentSetNumber + entry.sets
  const askRpe   = entry.sets === 1

  // Track first logged weight for this exercise (for LLM memory context)
  const firstWeights = state.firstExerciseWeights
  const isNew        = al.currentExercise! && !(al.currentExercise! in firstWeights)
  const updatedFirstWeights = isNew
    ? { ...firstWeights, [al.currentExercise!]: entry.weightKg }
    : firstWeights

  await writeSplitState(user.id, {
    ...state,
    firstExerciseWeights: updatedFirstWeights,
    activeLogging: {
      ...al,
      currentSetNumber: newSetNum,
      pendingRpe:       askRpe,
      lastSetId:        askRpe ? lastSetId : al.lastSetId,
    },
  })

  const summary = entry.sets > 1
    ? `${entry.sets} sets: ${entry.weightKg}kg × ${entry.reps}.`
    : `Set ${newSetNum}: ${entry.weightKg}kg × ${entry.reps}.`

  const rpeLine = askRpe ? ` RPE? (or skip)` : ``
  return {
    handled: true,
    reply:   `${summary}${rpeLine}\n\nNext set, "next" for new exercise, or "done".`,
  }
}

async function moveToNextExercise(
  user: UserRow, state: SplitState, al: ActiveLogging
): Promise<{ handled: boolean; reply: string }> {
  const done = al.currentExercise
    ? [...al.exercisesDone, al.currentExercise]
    : al.exercisesDone

  await writeSplitState(user.id, {
    ...state,
    activeLogging: {
      ...al,
      currentExercise:  null,
      exercisesDone:    done,
      currentSetNumber: 0,
      pendingRpe:       false,
      lastSetId:        null,
    },
  })

  const total = await prisma.telegramSetLog.count({
    where: { sessionId: al.sessionId },
  })

  return {
    handled: true,
    reply:   `${al.currentSetNumber} sets done. ${total} total this session.\n\nNext exercise? (or "done")\n${formatExerciseList(al.muscles)}`,
  }
}

async function finishSession(
  user: UserRow, state: SplitState, al: ActiveLogging, now: Date
): Promise<{ handled: boolean; reply: string }> {
  const allExercises = al.currentExercise
    ? [...al.exercisesDone, al.currentExercise]
    : al.exercisesDone

  const totalSets = await prisma.telegramSetLog.count({
    where: { sessionId: al.sessionId, completed: true },
  })

  const durationMin = Math.round(
    (now.getTime() - new Date(al.startedAt).getTime()) / 60_000
  )

  await prisma.telegramWorkoutSession.update({
    where: { id: al.sessionId },
    data: {
      completed:       true,
      musclesTrained:  [al.muscles, ...allExercises].filter(Boolean),
      durationMinutes: durationMin,
    },
  })

  // Advance split state
  const intake    = parseIntake(user.intakeAnswers)
  const split     = intake.current_split ?? "unstructured"
  const days      = parseInt(intake.available_training_days ?? "3") || 3
  const dayList   = getTrainingDays(split, days)
  const todayISO  = now.toISOString().slice(0, 10)
  const trained   = [...state.daysTrained, al.splitDayIndex]
  const cycleDone = trained.length >= dayList.length

  // Streak — check before writing state
  const streakBroken  = !isConsecutiveDay(state.lastSessionDate, todayISO) && (user.gymStreak ?? 0) > 1
  const prevStreak    = user.gymStreak ?? 0
  const newStreak     = isConsecutiveDay(state.lastSessionDate, todayISO) ? prevStreak + 1 : 1

  // Streak milestone
  const milestone        = getStreakMilestoneMessage(newStreak, state.milestonesFired)
  const updatedMilestones = milestone
    ? [...state.milestonesFired, milestone.threshold]
    : state.milestonesFired

  const newState: SplitState = {
    lastCompletedDayIndex: al.splitDayIndex,
    lastSessionDate:       todayISO,
    cycleNumber:           cycleDone ? state.cycleNumber + 1 : state.cycleNumber,
    daysTrained:           cycleDone ? [] : trained,
    activeLogging:         null,
    milestonesFired:       updatedMilestones,
    firstExerciseWeights:  state.firstExerciseWeights,
    firstLogDate:          state.firstLogDate ?? todayISO,
  }
  await writeSplitState(user.id, newState)

  await prisma.messengerUser.update({
    where: { id: user.id },
    data:  { gymStreak: newStreak },
  })

  // PRs — check before/after to detect first PR ever
  const hadPRsBefore = Object.keys(parsePersonalRecords(user.personalRecords)).length > 0
  const prMessages   = await checkPRsForSession(user, al.sessionId)

  // Next session info
  const nextIdx     = (al.splitDayIndex + 1) % dayList.length
  const nextMuscles = dayList[nextIdx] ?? "Full Body"

  // ── Engagement blocks ─────────────────────────────────────────────────────

  // Streak broken
  const streakBlock = streakBroken
    ? `\n\n${getStreakBrokenMessage(prevStreak)}`
    : milestone
      ? `\n\n${milestone.message}`
      : ""

  // First PR ever
  const identityBlock = (!hadPRsBefore && prMessages.length > 0)
    ? "\n\nThat weight didn't move before. Now it does.\nThat's the whole point of this. 🔥"
    : prMessages.length
      ? "\n\n" + prMessages.join("\n")
      : ""

  // First deload (cycle 4 just completed)
  const deloadMsg = cycleDone && newState.cycleNumber > 0 && newState.cycleNumber % 4 === 0
    ? "\n\n4 weeks straight. Next cycle: 60% weights, 2 sets max. Non-negotiable — your CNS needs it."
    : ""

  // First-deload identity moment (cycle 4 exactly — the very first deload)
  const firstDeloadNote = cycleDone && newState.cycleNumber === 4
    ? "\n\nI know you want to train hard. That's the problem.\nAdaptation happens in recovery, not in the session.\nTrust the process this week."
    : ""

  // Weekly review (after completed cycle, not on deload weeks — they already get the deload message)
  let weeklyReviewBlock = ""
  if (cycleDone && newState.cycleNumber % 4 !== 0) {
    const review = await generateWeeklyReview(
      user.id,
      newState.cycleNumber - 1,
      dayList.length,
      false,
    )
    weeklyReviewBlock = review ? `\n\n${review}` : ""
  } else if (cycleDone && newState.cycleNumber % 4 === 0) {
    const review = await generateWeeklyReview(
      user.id,
      newState.cycleNumber - 1,
      dayList.length,
      true,
    )
    weeklyReviewBlock = review ? `\n\n${review}` : ""
  }

  return {
    handled: true,
    reply: [
      `Done. ${al.muscles} session logged. ${totalSets} sets. ${durationMin} min.`,
      `Next session: Day ${nextIdx + 1} — ${nextMuscles}.`,
      identityBlock,
      deloadMsg,
      firstDeloadNote,
      streakBlock,
      weeklyReviewBlock,
    ].join(""),
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PR CHECKING
// ═══════════════════════════════════════════════════════════════════════════════

async function checkPRsForSession(user: UserRow, sessionId: string): Promise<string[]> {
  const sets = await prisma.telegramSetLog.findMany({
    where:  { sessionId, completed: true },
    select: { exerciseName: true, weightKg: true, reps: true },
  })
  if (!sets.length) return []

  const byExercise: Record<string, Array<{ weightKg: number; reps: number }>> = {}
  for (const s of sets) {
    byExercise[s.exerciseName] ??= []
    byExercise[s.exerciseName]!.push(s)
  }

  const records = parsePersonalRecords(user.personalRecords)
  const updates: PersonalRecords = {}
  const messages: string[] = []

  for (const [exercise, exSets] of Object.entries(byExercise)) {
    const maxW    = Math.max(...exSets.map(s => s.weightKg))
    const maxReps = Math.max(...exSets.filter(s => s.weightKg === maxW).map(s => s.reps))
    const prev    = records[exercise]

    if (!prev || maxW > prev.weightKg || (maxW === prev.weightKg && maxReps > prev.reps)) {
      updates[exercise] = { weightKg: maxW, reps: maxReps, date: new Date().toISOString().slice(0, 10), sessionId }
      if (prev && maxW > prev.weightKg) {
        messages.push(`WAIT. ${exercise} ${maxW}kg — that's a PR. Previous best was ${prev.weightKg}kg. LETSSS GO 🐉`)
      }
    }
  }

  if (Object.keys(updates).length) {
    await writePersonalRecords(user.id, { ...records, ...updates })
  }
  return messages
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROGRESSIVE OVERLOAD
// ═══════════════════════════════════════════════════════════════════════════════

async function getOverloadSuggestion(
  userId: string,
  exercise: string
): Promise<{ lastNote: string; nextKg: number } | null> {
  const sets = await prisma.telegramSetLog.findMany({
    where:   { exerciseName: exercise, session: { messengerUserId: userId }, completed: true },
    orderBy: [{ sessionId: "desc" }, { setNumber: "asc" }],
    take:    30,
    select:  { weightKg: true, reps: true, rpe: true, sessionId: true },
  })
  if (!sets.length) return null

  const sessions = groupBySession(sets)
  const last     = sessions[0]
  if (!last?.length) return null

  const maxW     = Math.max(...last.map((s: any) => s.weightKg))
  const rpeVals  = last.filter((s: any) => s.rpe != null).map((s: any) => s.rpe as number)
  const avgRpe   = rpeVals.length ? rpeVals.reduce((a, b) => a + b, 0) / rpeVals.length : 7

  const stalled  = sessions.length >= 3 &&
    sessions.slice(0, 3).every((sess: any[]) => Math.max(...sess.map((s: any) => s.weightKg)) === maxW)

  if (stalled)     return { lastNote: `${maxW}kg (stalled 3 sessions)`,   nextKg: maxW }
  if (avgRpe <= 8) return { lastNote: `${maxW}kg @ RPE ${avgRpe.toFixed(0)}`, nextKg: maxW + 2.5 }
  return             { lastNote: `${maxW}kg @ RPE ${avgRpe.toFixed(0)}`, nextKg: maxW }
}

export async function computeProgressiveOverloadForSession(
  userId:    string,
  sessionId: string
): Promise<Array<{ exercise: string; nextWeightKg: number; note: string; flag: string | null }>> {
  const exercises = await prisma.telegramSetLog.groupBy({
    by:    ["exerciseName"],
    where: { sessionId, completed: true },
  })

  const results = []

  for (const { exerciseName } of exercises) {
    const allSets = await prisma.telegramSetLog.findMany({
      where:   { exerciseName, session: { messengerUserId: userId }, completed: true },
      orderBy: [{ sessionId: "desc" }, { setNumber: "asc" }],
      take:    30,
      select:  { weightKg: true, reps: true, rpe: true, sessionId: true },
    })

    const sessions = groupBySession(allSets)
    const current  = sessions[0]
    if (!current?.length) continue

    const maxW      = Math.max(...current.map((s: any) => s.weightKg))
    const rpeVals   = current.filter((s: any) => s.rpe != null).map((s: any) => s.rpe as number)
    const avgRpe    = rpeVals.length ? rpeVals.reduce((a, b) => a + b, 0) / rpeVals.length : 7
    const failedAny = current.some((s: any) => s.reps < 1)

    const stalled = sessions.length >= 3 &&
      sessions.slice(0, 3).every((sess: any[]) => Math.max(...sess.map((s: any) => s.weightKg)) === maxW)

    if (stalled) {
      results.push({ exercise: exerciseName, nextWeightKg: maxW, flag: "rep_increase",
        note: `${exerciseName} stalled at ${maxW}kg for 3 sessions. Same weight, add a rep.` })
    } else if (failedAny || avgRpe >= 10) {
      results.push({ exercise: exerciseName, nextWeightKg: maxW, flag: "technique_check",
        note: `Grinded that. Keep ${maxW}kg. Focus on bar path, not adding weight.` })
    } else if (avgRpe >= 9) {
      results.push({ exercise: exerciseName, nextWeightKg: maxW, flag: "maintain",
        note: `Keep ${maxW}kg. Hit the reps cleaner first.` })
    } else {
      results.push({ exercise: exerciseName, nextWeightKg: maxW + 2.5, flag: "increase",
        note: `Last time ${maxW}kg felt manageable. Today: ${maxW + 2.5}kg.` })
    }
  }

  return results
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

export async function handleWorkoutCommand(
  platformChatId: string,
  text:           string
): Promise<{ handled: boolean; reply: string; intent?: string }> {
  const lower = text.trim().toLowerCase()

  if (lower === "/log" || lower.startsWith("/log ")) {
    return { handled: true, reply: await handleLogCommand(platformChatId), intent: "log_start" }
  }
  if (lower === "/pr") {
    return { handled: true, reply: await prCommand(platformChatId), intent: "workout_pr" }
  }
  if (lower.startsWith("/progress")) {
    const ex = text.slice("/progress".length).trim() || null
    return { handled: true, reply: await progressCommand(platformChatId, ex), intent: "workout_progress" }
  }
  if (lower.startsWith("/history")) {
    const n = parseInt(text.slice("/history".length).trim()) || 5
    return { handled: true, reply: await historyCommand(platformChatId, n), intent: "workout_history" }
  }
  if (lower === "/overload") {
    return { handled: true, reply: await overloadCommand(platformChatId), intent: "workout_overload" }
  }
  if (lower === "/streak") {
    return { handled: true, reply: await streakCommand(platformChatId), intent: "workout_streak" }
  }
  if (lower === "/split") {
    return { handled: true, reply: await splitCommand(platformChatId), intent: "workout_split" }
  }

  return NOT_HANDLED
}

async function prCommand(platformChatId: string): Promise<string> {
  const user = await getUser(platformChatId)
  if (!user) return "No profile found."

  const records = parsePersonalRecords(user.personalRecords)
  if (!Object.keys(records).length) return "No records yet. Log some sessions first."

  const lines = Object.entries(records)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ex, r]) => `${ex}: ${r.weightKg}kg × ${r.reps} (${r.date})`)

  return `Your records:\n${lines.join("\n")} 💪`
}

async function progressCommand(platformChatId: string, exercise: string | null): Promise<string> {
  const user = await getUser(platformChatId)
  if (!user) return "No profile found."

  if (!exercise) {
    const keys = Object.keys(parsePersonalRecords(user.personalRecords))
    if (!keys.length) return "No logged exercises yet. Use /progress bench, /progress squat, etc."
    return `Use /progress [exercise]. Tracked: ${keys.join(", ")}`
  }

  const sets = await prisma.telegramSetLog.findMany({
    where:   { exerciseName: { contains: exercise, mode: "insensitive" }, session: { messengerUserId: user.id, completed: true } },
    orderBy: { id: "desc" },
    take:    48,
    select:  { weightKg: true, sessionId: true },
  })
  if (!sets.length) return `No data for "${exercise}" yet.`

  const sessions = groupBySession(sets).slice(0, 8).reverse()
  const weights  = sessions.map((sess: any[]) => Math.max(...sess.map((s: any) => s.weightKg)))
  if (!weights.length) return `No data for "${exercise}" yet.`

  const max  = Math.max(...weights)
  const min  = Math.min(...weights)
  const span = max - min || 1
  const W    = 10

  const lines = weights.map((w, i) => {
    const bars = Math.round(((w - min) / span) * (W - 1)) + 1
    return `${String(i + 1).padStart(2)}. ${"█".repeat(bars)}${"░".repeat(W - bars)} ${w}kg`
  })

  const trend = weights.at(-1)! > weights[0]!
    ? `↑ +${(weights.at(-1)! - weights[0]!).toFixed(1)}kg over ${sessions.length} sessions`
    : `→ holding at ${max}kg`

  return `${exercise} — last ${sessions.length} sessions:\n${lines.join("\n")}\n${trend}`
}

async function historyCommand(platformChatId: string, n: number): Promise<string> {
  const user = await getUser(platformChatId)
  if (!user) return "No profile found."

  const sessions = await prisma.telegramWorkoutSession.findMany({
    where:   { messengerUserId: user.id, completed: true },
    orderBy: { date: "desc" },
    take:    Math.min(n, 20),
    select:  { date: true, musclesTrained: true, durationMinutes: true, sets: { select: { id: true } } },
  })
  if (!sessions.length) return "No sessions logged yet. Use /log to start."

  const lines = sessions.map((s: any) => {
    const d   = new Date(s.date)
    const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
    const dur = s.durationMinutes ? ` — ${s.durationMinutes} min` : ""
    return `${day} — ${s.musclesTrained[0] ?? "Session"} — ${s.sets.length} sets${dur}`
  })

  return `Last ${sessions.length} sessions:\n${lines.join("\n")}`
}

async function overloadCommand(platformChatId: string): Promise<string> {
  const user = await getUser(platformChatId)
  if (!user) return "No profile found."

  const last = await prisma.telegramWorkoutSession.findFirst({
    where:   { messengerUserId: user.id, completed: true },
    orderBy: { date: "desc" },
    select:  { id: true, musclesTrained: true },
  })
  if (!last) return "No sessions logged yet. Use /log to start."

  const overloads = await computeProgressiveOverloadForSession(user.id, last.id)
  if (!overloads.length) return "Not enough data to compute targets yet."

  const lines = overloads.map(o => {
    const arrow = o.flag === "increase" ? `↑ ${o.nextWeightKg}kg` : `→ ${o.nextWeightKg}kg`
    return `${o.exercise}: ${arrow} — ${o.note}`
  })

  return `Tomorrow's targets (${last.musclesTrained[0] ?? "session"}):\n${lines.join("\n")}`
}

async function streakCommand(platformChatId: string): Promise<string> {
  const user = await getUser(platformChatId)
  if (!user) return "No profile found."
  const s = user.gymStreak ?? 0
  if (s === 0) return "No active streak. Start today."
  if (s === 1) return "1 day. Keep it going tomorrow."
  return `Current streak: ${s} days 🔥`
}

async function splitCommand(platformChatId: string): Promise<string> {
  const user = await getUser(platformChatId)
  if (!user) return "No profile found."

  const intake   = parseIntake(user.intakeAnswers)
  const split    = intake.current_split ?? "unstructured"
  const days     = parseInt(intake.available_training_days ?? "3") || 3
  const dayList  = getTrainingDays(split, days)
  const state    = parseSplitState(user.splitState)
  const nextIdx  = getNextDayIndex(state, dayList.length)

  const lines = dayList.map((muscles, i) => {
    const marker = i === nextIdx ? "→" : " "
    const label  = i === nextIdx ? "(next)" : i < nextIdx ? "" : ""
    return `${marker} Day ${i + 1}: ${muscles} ${label}`.trim()
  })

  return [
    `${split.toUpperCase()} (${days} days) — Cycle ${state.cycleNumber + 1}`,
    lines.join("\n"),
    `\n${state.daysTrained.length}/${dayList.length} days trained this cycle`,
  ].join("\n")
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARSERS
// ═══════════════════════════════════════════════════════════════════════════════

function parseSet(text: string): SetEntry | null {
  const t = text.trim()

  // 3×5×80, 3x5x80, 3*5*80
  const a = t.match(/^(\d+)\s*[×xX*]\s*(\d+)\s*[×xX*]\s*(\d+(?:\.\d+)?)(?:\s*kg)?$/i)
  if (a) return { sets: +a[1]!, reps: +a[2]!, weightKg: +a[3]! }

  // 80×5 or 5×80  (weight first if number ≥ 20, reps first otherwise)
  const b = t.match(/^(\d+(?:\.\d+)?)\s*(?:kg)?\s*[×xX*]\s*(\d+)(?:\s*reps?)?$/i)
  if (b) {
    const n1 = +b[1]!, n2 = +b[2]!
    return n1 >= 20
      ? { sets: 1, reps: n2, weightKg: n1 }   // weight × reps
      : { sets: 1, reps: n1, weightKg: n2 }   // reps × weight
  }

  // free form: extract weight (kg) and reps
  const weight = t.match(/(\d+(?:\.\d+)?)\s*kg/i)?.[1]
  const reps   = t.match(/(\d+)\s*rep/i)?.[1] ?? t.match(/(\d+)\s*times?/i)?.[1]
  const sets   = t.match(/(\d+)\s*sets?/i)?.[1]
  if (weight && reps) return { sets: sets ? +sets : 1, reps: +reps, weightKg: +weight }

  return null
}

function parseRpe(text: string): number | null {
  const n = parseFloat(text.trim().replace(/^rpe\s*/i, ""))
  return !isNaN(n) && n >= 1 && n <= 10 ? Math.round(n) : null
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES + DB HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function formatExerciseList(muscles: string): string {
  const ex = MUSCLE_EXERCISES[muscles] ?? ["Bench Press", "Squat", "Barbell Row", "Deadlift"]
  return ex.slice(0, 4).map((e, i) => `${i + 1}. ${e}`).join("\n")
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function isConsecutiveDay(last: string | null, today: string): boolean {
  if (!last) return false
  return Math.floor((new Date(today).getTime() - new Date(last).getTime()) / 86_400_000) === 1
}

function groupBySession<T extends { sessionId: string }>(sets: T[]): T[][] {
  const map = new Map<string, T[]>()
  for (const s of sets) {
    if (!map.has(s.sessionId)) map.set(s.sessionId, [])
    map.get(s.sessionId)!.push(s)
  }
  return [...map.values()]
}

async function getUser(platformChatId: string): Promise<UserRow | null> {
  return prisma.messengerUser.findUnique({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: { id: true, gymStreak: true, splitState: true, personalRecords: true, intakeAnswers: true },
  })
}

async function writeSplitState(userId: string, state: SplitState): Promise<void> {
  await prisma.messengerUser.update({
    where: { id: userId },
    data:  { splitState: state as any },
  })
}

async function writePersonalRecords(userId: string, records: PersonalRecords): Promise<void> {
  await prisma.messengerUser.update({
    where: { id: userId },
    data:  { personalRecords: records as any },
  })
}

function parseSplitState(raw: unknown): SplitState {
  const def: SplitState = {
    lastCompletedDayIndex: null, lastSessionDate: null, cycleNumber: 0,
    daysTrained: [], activeLogging: null,
    milestonesFired: [], firstExerciseWeights: {}, firstLogDate: null,
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return def
  const s = raw as Record<string, unknown>
  return {
    lastCompletedDayIndex: typeof s.lastCompletedDayIndex === "number" ? s.lastCompletedDayIndex : null,
    lastSessionDate:       typeof s.lastSessionDate === "string" ? s.lastSessionDate : null,
    cycleNumber:           typeof s.cycleNumber === "number" ? s.cycleNumber : 0,
    daysTrained:           Array.isArray(s.daysTrained) ? (s.daysTrained as number[]) : [],
    activeLogging:         s.activeLogging && typeof s.activeLogging === "object" ? (s.activeLogging as ActiveLogging) : null,
    milestonesFired:       Array.isArray(s.milestonesFired) ? (s.milestonesFired as number[]) : [],
    firstExerciseWeights:  (s.firstExerciseWeights && typeof s.firstExerciseWeights === "object" && !Array.isArray(s.firstExerciseWeights))
      ? (s.firstExerciseWeights as Record<string, number>) : {},
    firstLogDate:          typeof s.firstLogDate === "string" ? s.firstLogDate : null,
  }
}

function parsePersonalRecords(raw: unknown): PersonalRecords {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return raw as PersonalRecords
}

function parseIntake(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return raw as Record<string, string>
}
