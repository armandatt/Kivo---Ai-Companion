import { prisma } from "@repo/db/client"
import {
  getStreakMilestoneMessage,
  getStreakBrokenMessage,
  generateWeeklyReview,
} from "./engagement.service"
import {
  writeMomentPR,
  writeMomentBreakthrough,
  writeMomentStreakMilestone,
  writeMomentComeback,
  retrieveRelevantMoments,
  getConsecutiveSessionsAtWeight,
  generateLLMMilestoneMessage,
} from "./momentMemory.service"

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface QuickLogEntry {
  exercise:         string
  sets:             number
  reps:             number
  weightKg:         number | null
  setsRepsProvided?: boolean  // true = user explicitly gave sets/reps; false/undefined = defaulted
}

export interface PendingLog {
  muscles:       string
  splitDayIndex: number
  promptedAt:    string   // ISO
  chaseCount:    number   // 0=initial, 1=chase1, 2=chase2
}

interface ActiveLogging {
  sessionId:               string
  splitDayIndex:           number
  muscles:                 string
  startedAt:               string
  logMode:                 "quick"
  logState:                "awaiting_exercises" | "awaiting_weights" | "awaiting_sets_reps" | "confirming" | "weight_review" | "muscle_conflict"
  parsedEntries:           QuickLogEntry[]
  pendingWeightFor:        string[]
  lastActivityAt:          string
  pendingSuspectExercise:  string | null
  conflictEntries:         QuickLogEntry[]
  conflictDetectedMuscles: string
  noSplitAdvance:          boolean
}

export type FeelRating = "easy" | "moderate" | "hard" | "failed"

export interface SplitState {
  lastCompletedDayIndex: number | null
  lastSessionDate:       string | null
  cycleNumber:           number
  daysTrained:           number[]
  activeLogging:         ActiveLogging | null
  pendingLog:            PendingLog | null
  avgSessionDurationMin: number
  milestonesFired:       number[]
  firstExerciseWeights:  Record<string, number>
  firstLogDate:          string | null
  setupPending:          SetupPending | null
  skipState:             SkipState | null
  lastSkipDate:          string | null
  reactivationCount:     number
  lastFeelRating:        FeelRating | null
  feelPending:           { sessionId: string; muscles: string } | null
}

interface PersonalRecords {
  [exercise: string]: {
    weightKg:  number
    reps:      number
    date:      string
    sessionId: string
  }
}


type UserRow = {
  id:                   string
  gymStreak:            number
  splitState:           unknown
  personalRecords:      unknown
  intakeAnswers:        unknown
  preferredCheckInTime: string | null
}

interface ExerciseHistoryEntry {
  name:        string
  lastWeight?: number
  lastReps?:   number
}

interface SetupPending {
  field: "goal" | "split" | "weight_confirm" | "duplicate_session" | "split_days"
  value?: string
}

interface SkipState {
  pendingReason: boolean
  muscles:       string
}

const NOT_HANDLED = { handled: false as const, reply: "" }

// ═══════════════════════════════════════════════════════════════════════════════
// EXERCISE LIBRARY
// ═══════════════════════════════════════════════════════════════════════════════


// Per-muscle keys (for getExercisesForToday)
const MUSCLE_DEFAULTS: Record<string, string[]> = {
  chest:     ["Bench Press",     "Incline DB Press", "Cable Fly",      "Dips"],
  back:      ["Barbell Row",     "Pull-up",          "Lat Pulldown",   "Cable Row",     "Deadlift"],
  legs:      ["Squat",           "Romanian Deadlift","Leg Press",      "Hip Thrust",    "Lunges"],
  shoulders: ["Overhead Press",  "Lateral Raise",    "Face Pull",      "Arnold Press"],
  triceps:   ["Tricep Pushdown", "Skull Crusher",    "Close-Grip Bench"],
  biceps:    ["Barbell Curl",    "Hammer Curl",      "Incline DB Curl"],
  arms:      ["Barbell Curl",    "Tricep Pushdown",  "Hammer Curl",    "Close-Grip Bench"],
  core:      ["Plank",           "Cable Crunch",     "Hanging Leg Raise"],
  fullbody:  ["Squat",           "Bench Press",      "Deadlift",       "Overhead Press","Barbell Row"],
}

// Exercise alias lookup for parseMultiExercise
const EXERCISE_ALIASES: Array<{ canonical: string; pattern: RegExp }> = [
  { canonical: "Bench Press",         pattern: /\b(bench(\s*press)?|bp|flat\s*bench)\b/i },
  { canonical: "Incline Press",       pattern: /\b(incline(\s*(bench|db|press))?)\b/i },
  { canonical: "Overhead Press",      pattern: /\b(ohp|overhead\s*press|military\s*press|shoulder\s*press)\b/i },
  { canonical: "Squat",               pattern: /\b(squats?|back\s*squat)\b/i },
  { canonical: "Romanian Deadlift",   pattern: /\b(rdl|romanian|stiff.?leg\s*dl?)\b/i },
  { canonical: "Deadlift",            pattern: /\b(dead\s*lifts?|deadlifts?|\bdl\b)\b/i },
  { canonical: "Barbell Row",         pattern: /\b(rows?|bb\s*row|bent.?over\s*row|barbell\s*row)\b/i },
  { canonical: "Pull-up",             pattern: /\b(pull.?ups?|chin.?ups?)\b/i },
  { canonical: "Lat Pulldown",        pattern: /\b(lat\s*pull.?downs?|pull.?downs?)\b/i },
  { canonical: "Cable Row",           pattern: /\b(cable\s*row|seated\s*(cable\s*)?row)\b/i },
  { canonical: "Leg Press",           pattern: /\b(leg\s*press)\b/i },
  { canonical: "Romanian Deadlift",   pattern: /\b(rdl)\b/i },
  { canonical: "Hip Thrust",          pattern: /\b(hip\s*thrusts?|glute\s*bridge)\b/i },
  { canonical: "Lunges",              pattern: /\b(lunges?)\b/i },
  { canonical: "Leg Curl",            pattern: /\b(leg\s*curls?|ham(string)?\s*curls?)\b/i },
  { canonical: "Calf Raise",          pattern: /\b(calf\s*raises?|calves)\b/i },
  { canonical: "Tricep Pushdown",     pattern: /\b(pushdowns?|tricep\s*pushdowns?|cable\s*pushdowns?)\b/i },
  { canonical: "Skull Crusher",       pattern: /\b(skull.?crushers?|lying\s*tricep)\b/i },
  { canonical: "Dips",                pattern: /\b(dips?)\b/i },
  { canonical: "Barbell Curl",        pattern: /\b(curls?|bb\s*curls?|barbell\s*curls?)\b/i },
  { canonical: "Hammer Curl",         pattern: /\b(hammer\s*curls?|neutral.?grip\s*curl)\b/i },
  { canonical: "Face Pull",           pattern: /\b(face\s*pulls?)\b/i },
  { canonical: "Lateral Raise",       pattern: /\b(laterals?|lateral\s*raises?|side\s*raises?)\b/i },
  { canonical: "Cable Fly",           pattern: /\b(fl(y|ies)|flyes?|cable\s*fl(y|ies))\b/i },
]

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
// EXERCISE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function musclesFromSplitDay(muscles: string): string[] {
  const m = muscles.toLowerCase()
  const out: string[] = []
  if (m.includes("chest") || m.includes("push"))             out.push("chest")
  if (m.includes("back") || m.includes("pull"))              out.push("back")
  if (m.includes("leg") || m.includes("lower") || m.includes("quad") || m.includes("glute")) out.push("legs")
  if (m.includes("shoulder"))                                out.push("shoulders")
  if (m.includes("tricep"))                                  out.push("triceps")
  if (m.includes("bicep") || m.includes("arm"))              out.push("arms")
  if (m.includes("full") || m.includes("body"))              out.push("fullbody")
  if (m.includes("core") || m.includes("abs"))               out.push("core")
  if (!out.length) out.push("fullbody")
  return [...new Set(out)]
}

async function getExercisesForToday(
  userId: string,
  muscles: string
): Promise<{ source: "user_history" | "defaults"; exercises: ExerciseHistoryEntry[] }> {
  const muscleKeywords = musclesFromSplitDay(muscles)

  const sessions = await prisma.telegramWorkoutSession.findMany({
    where:   { messengerUserId: userId, completed: true },
    orderBy: { date: "desc" },
    take:    10,
    select:  {
      musclesTrained: true,
      sets: {
        orderBy: { setNumber: "asc" },
        select:  { exerciseName: true, weightKg: true, reps: true, setNumber: true },
      },
    },
  })

  const relevantSessions = sessions.filter(s =>
    s.musclesTrained.some(mt =>
      muscleKeywords.some(mk => mt.toLowerCase().includes(mk))
    )
  )

  if (relevantSessions.length >= 1) {
    const frequency: Record<string, { count: number; lastWeight: number; lastReps: number }> = {}
    for (const session of relevantSessions) {
      const seen = new Set<string>()
      for (const set of session.sets) {
        if (!seen.has(set.exerciseName)) {
          seen.add(set.exerciseName)
          if (frequency[set.exerciseName]) {
            frequency[set.exerciseName]!.count++
          } else {
            frequency[set.exerciseName] = { count: 1, lastWeight: set.weightKg, lastReps: set.reps }
          }
        }
      }
    }
    const sorted = Object.entries(frequency)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 5)
      .map(([name, d]) => ({ name, lastWeight: d.lastWeight, lastReps: d.lastReps }))

    if (sorted.length >= 2) {
      return { source: "user_history", exercises: sorted }
    }
  }

  const defaults = muscleKeywords
    .flatMap(mk => MUSCLE_DEFAULTS[mk] ?? [])
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 5)
    .map(name => ({ name }))

  return {
    source:    "defaults",
    exercises: defaults.length ? defaults : [{ name: "Bench Press" }, { name: "Squat" }, { name: "Barbell Row" }],
  }
}

function matchExerciseName(text: string): { canonical: string; pattern: RegExp } | null {
  for (const ex of EXERCISE_ALIASES) {
    if (ex.pattern.test(text)) return { canonical: ex.canonical, pattern: ex.pattern }
  }
  return null
}

function extractWeight(text: string): number | null {
  const kgMatch = text.match(/(\d+(?:\.\d+)?)\s*kg\b/i)
  if (kgMatch) return +kgMatch[1]!
  const nums = [...text.matchAll(/\b(\d+(?:\.\d+)?)\b/g)].map(m => +m[1]!)
  const candidates = nums.filter(n => n >= 20)
  return candidates.length === 1 ? candidates[0]! : null
}

function extractSetsRepsWeight(text: string): { sets: number; reps: number; weightKg: number | null; setsRepsProvided: boolean } {
  // sets×reps×weight like "3×5×80"
  const triple = text.match(/\b(\d+(?:\.\d+)?)\s*[×xX*]\s*(\d+(?:\.\d+)?)\s*[×xX*]\s*(\d+(?:\.\d+)?)\b/)
  if (triple) {
    const [a, b, c] = [+triple[1]!, +triple[2]!, +triple[3]!]
    if (a <= 8 && b <= 20 && c >= 10) return { sets: a, reps: b, weightKg: c, setsRepsProvided: true }
    if (c <= 8 && b <= 20 && a >= 10) return { sets: c, reps: b, weightKg: a, setsRepsProvided: true }
    return { sets: Math.round(a), reps: Math.round(b), weightKg: c, setsRepsProvided: true }
  }

  const weightKg = extractWeight(text)

  // double like "3×5" or "80×5"
  const double = text.match(/\b(\d+(?:\.\d+)?)\s*[×xX*]\s*(\d+(?:\.\d+)?)\b/)
  if (double) {
    const [n1, n2] = [+double[1]!, +double[2]!]
    if (weightKg !== null) {
      if (n1 <= 8 && n2 <= 20) return { sets: n1, reps: n2, weightKg, setsRepsProvided: true }
      return { sets: 1, reps: n2, weightKg, setsRepsProvided: true }
    }
    if (n1 >= 20) return { sets: 1, reps: n2, weightKg: n1, setsRepsProvided: true }
    if (n2 >= 20) return { sets: 1, reps: n1, weightKg: n2, setsRepsProvided: true }
    return { sets: n1, reps: n2, weightKg: null, setsRepsProvided: true }
  }

  const setsM = text.match(/(\d+)\s*sets?/i)
  const repsM = text.match(/(\d+)\s*reps?/i) ?? text.match(/for\s+(\d+)/i)
  return {
    sets:             setsM ? +setsM[1]! : 1,
    reps:             repsM ? +repsM[1]! : 5,
    weightKg,
    setsRepsProvided: setsM !== null || repsM !== null,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUICK LOG PARSERS
// ═══════════════════════════════════════════════════════════════════════════════

export function parseMultiExercise(text: string): QuickLogEntry[] {
  const chunks = text
    .split(/,\s*|\s+then\s+|\n|;\s*/)
    .map(c => c.trim())
    .filter(c => c.length > 1)

  const entries: QuickLogEntry[] = []
  for (const chunk of chunks) {
    const match = matchExerciseName(chunk)
    if (!match) continue
    const { sets, reps, weightKg, setsRepsProvided } = extractSetsRepsWeight(chunk)
    entries.push({ exercise: match.canonical, sets, reps, weightKg, setsRepsProvided })
  }
  return entries
}

// Parses "3×5", "3x5", "3 sets 5 reps", "3 5" → { sets, reps } | null
function parseSetsReps(text: string): { sets: number; reps: number } | null {
  const t = text.trim()
  const crossM = t.match(/^(\d+)\s*[×xX]\s*(\d+)$/)
  if (crossM) return { sets: +crossM[1]!, reps: +crossM[2]! }

  const setsM = t.match(/(\d+)\s*sets?/i)
  const repsM = t.match(/(\d+)\s*reps?/i)
  if (setsM && repsM) return { sets: +setsM[1]!, reps: +repsM[1]! }

  const twoM = t.match(/^(\d+)\s+(\d+)$/)
  if (twoM) {
    const [a, b] = [+twoM[1]!, +twoM[2]!]
    if (a <= 6 && b <= 20) return { sets: a, reps: b }
  }
  return null
}

// Fills in sets/reps for entries where setsRepsProvided is false.
// setsRepsText can be:
//   single pair  "3×5"          → applied to ALL needing fill
//   comma list   "3×5, 3×8, 3×12" → mapped in order to exercises needing fill
function fillMissingSetsReps(entries: QuickLogEntry[], setsRepsText: string): QuickLogEntry[] {
  const needFilling = entries.filter(e => !e.setsRepsProvided)
  if (!needFilling.length) return entries

  const chunks = setsRepsText.split(/,\s*/).map(s => s.trim()).filter(Boolean)
  const pairs  = chunks.map(c => parseSetsReps(c)).filter((p): p is { sets: number; reps: number } => p !== null)

  if (pairs.length === 1) {
    const { sets, reps } = pairs[0]!
    return entries.map(e => (!e.setsRepsProvided ? { ...e, sets, reps, setsRepsProvided: true } : e))
  }

  if (pairs.length >= needFilling.length) {
    let i = 0
    return entries.map(e => {
      if (!e.setsRepsProvided && i < pairs.length) {
        const { sets, reps } = pairs[i++]!
        return { ...e, sets, reps, setsRepsProvided: true }
      }
      return e
    })
  }

  // Single-number fallback — try the whole string as one pair
  const single = parseSetsReps(setsRepsText)
  if (single) {
    return entries.map(e => (!e.setsRepsProvided ? { ...e, sets: single.sets, reps: single.reps, setsRepsProvided: true } : e))
  }

  return entries
}

function fillMissingWeights(entries: QuickLogEntry[], pendingFor: string[], text: string): QuickLogEntry[] {
  if (!pendingFor.length) return entries

  if (pendingFor.length === 1) {
    const w = extractWeight(text)
    if (w !== null) {
      return entries.map(e => (e.exercise === pendingFor[0] ? { ...e, weightKg: w } : e))
    }
    return entries
  }

  // Try parsing as exercise:weight pairs first
  const parsed = parseMultiExercise(text)
  if (parsed.length) {
    return entries.map(e => {
      const found = parsed.find(p => p.exercise.toLowerCase() === e.exercise.toLowerCase() && p.weightKg !== null)
      return found ? { ...e, weightKg: found.weightKg } : e
    })
  }

  // Weights listed in order
  const weights = [...text.matchAll(/\b(\d+(?:\.\d+)?)\b/g)].map(m => +m[1]!).filter(n => n >= 1)
  let wi = 0
  return entries.map(e => {
    if (pendingFor.includes(e.exercise) && wi < weights.length) {
      return { ...e, weightKg: weights[wi++]! }
    }
    return e
  })
}

function buildQuickLogConfirmation(entries: QuickLogEntry[]): string {
  const lines = entries.map(e =>
    `${e.exercise} — ${e.sets}×${e.reps}×${e.weightKg ?? "?"}kg ✓`
  )
  return `Logged:\n${lines.join("\n")}`
}

function formatQuickLogOpening(muscles: string, data: { source: "user_history" | "defaults"; exercises: ExerciseHistoryEntry[] }): string {
  const { source, exercises } = data
  if (source === "user_history") {
    const lines = exercises.slice(0, 4).map((e, i) =>
      e.lastWeight ? `${i + 1}. ${e.name} — last: ${e.lastWeight}kg × ${e.lastReps}` : `${i + 1}. ${e.name}`
    )
    return `Last time:\n${lines.join("\n")}\n\nTell me what you hit today.`
  }
  const lines = exercises.slice(0, 4).map((e, i) => `${i + 1}. ${e.name}`)
  return `${muscles} — what did you do?\n${lines.join("\n")}\n\nTell me the exercises, weight, and sets.`
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTED STATE HELPERS (used by gymCron)
// ═══════════════════════════════════════════════════════════════════════════════

export async function setPendingLog(platformChatId: string, pendingLog: PendingLog): Promise<void> {
  const user = await getUser(platformChatId)
  if (!user) return
  const state = parseSplitState(user.splitState)
  if (state.activeLogging) return // don't overwrite active session
  await writeSplitState(user.id, { ...state, pendingLog })
}

export async function getNextSplitDayInfo(
  platformChatId: string
): Promise<{ muscles: string; splitDayIndex: number } | null> {
  const user = await getUser(platformChatId)
  if (!user) return null
  const intake   = parseIntake(user.intakeAnswers)
  const split    = intake.current_split ?? "unstructured"
  const days     = parseInt(intake.available_training_days ?? "3") || 3
  const dayList  = getTrainingDays(split, days)
  const state    = parseSplitState(user.splitState)
  const nextIdx  = getNextDayIndex(state, dayList.length)
  return { muscles: dayList[nextIdx] ?? "Full Body", splitDayIndex: nextIdx }
}

export async function getAvgSessionDurationMin(platformChatId: string): Promise<number> {
  const user = await getUser(platformChatId)
  if (!user) return 60
  const state = parseSplitState(user.splitState)
  return state.avgSessionDurationMin || 60
}

// ═══════════════════════════════════════════════════════════════════════════════
// /log COMMAND — entry point
// ═══════════════════════════════════════════════════════════════════════════════

export async function handleLogCommand(
  platformChatId: string,
  now = new Date()
): Promise<string> {
  const user = await getUser(platformChatId)
  if (!user) return "Set up your training profile first."

  const state = parseSplitState(user.splitState)

  // Already logging — resume
  if (state.activeLogging) {
    const al = state.activeLogging
    if (al.parsedEntries.length) {
      return buildQuickLogConfirmation(al.parsedEntries) + "\n\nAnything else or \"done\"?"
    }
    return `${al.muscles} — what did you hit?`
  }

  const intake   = parseIntake(user.intakeAnswers)
  const split    = intake.current_split ?? "unstructured"
  const days     = parseInt(intake.available_training_days ?? "3") || 3
  const dayList  = getTrainingDays(split, days)

  // Use pending log info if present (cron already set the muscles/dayIndex)
  const pendingMuscles = state.pendingLog?.muscles
  const nextIdx = state.pendingLog?.splitDayIndex ?? getNextDayIndex(state, dayList.length)
  const muscles = pendingMuscles ?? (dayList[nextIdx] ?? "Full Body")

  // Edge Case 3: duplicate session today for the same muscle group
  const duplicate = await checkTodaySession(user.id, muscles, now)
  if (duplicate) {
    const time = new Date(duplicate.date).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    await writeSplitState(user.id, { ...state, setupPending: { field: "duplicate_session", value: duplicate.id } })
    return `You already logged ${muscles} today at ${time}.\nAdding more sets or did you mean a different session?`
  }

  const session = await prisma.telegramWorkoutSession.create({
    data: {
      messengerUserId: user.id,
      date:            now,
      splitDayIndex:   nextIdx,
      musclesTrained:  [muscles],
      completed:       false,
    },
  })

  const newAl: ActiveLogging = {
    sessionId:               session.id,
    splitDayIndex:           nextIdx,
    muscles,
    startedAt:               now.toISOString(),
    logMode:                 "quick",
    logState:                "awaiting_exercises",
    parsedEntries:           [],
    pendingWeightFor:        [],
    lastActivityAt:          now.toISOString(),
    pendingSuspectExercise:  null,
    conflictEntries:         [],
    conflictDetectedMuscles: "",
    noSplitAdvance:          false,
  }

  await writeSplitState(user.id, {
    ...state,
    pendingLog:    null,
    firstLogDate:  state.firstLogDate ?? now.toISOString().slice(0, 10),
    activeLogging: newAl,
  })

  const exData = await getExercisesForToday(user.id, muscles)
  return [
    `Day ${nextIdx + 1} — ${muscles}.`,
    "",
    formatQuickLogOpening(muscles, exData),
  ].join("\n")
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTIVE SESSION ROUTING
// ═══════════════════════════════════════════════════════════════════════════════

export async function handleActiveLoggingMessage(
  platformChatId: string,
  text:           string,
  now = new Date()
): Promise<{ handled: boolean; reply: string }> {
  const user = await getUser(platformChatId)
  if (!user) return NOT_HANDLED

  const state = parseSplitState(user.splitState)

  // Intercept pending setup flow (e.g. /setup split or /setup goal waiting for value)
  if (state.setupPending && !state.activeLogging) {
    return handleSetupPendingMessage(user, state, state.setupPending, text)
  }

  // Intercept pending skip-reason collection
  if (state.skipState?.pendingReason && !state.activeLogging) {
    return handleSkipReason(user, state, text, now)
  }

  // Intercept if there's a pending log (cron auto-prompt response)
  if (state.pendingLog && !state.activeLogging) {
    return handlePendingLogMessage(user, state, state.pendingLog, text, now)
  }

  // Intercept feel-rating response after a completed session
  if (state.feelPending && !state.activeLogging) {
    return handleFeelResponse(user, state, state.feelPending, text)
  }

  if (!state.activeLogging) return NOT_HANDLED

  const al = state.activeLogging

  // Session timeout (3 hrs) — auto-save whatever is logged
  const ageMs = now.getTime() - new Date(al.lastActivityAt || al.startedAt).getTime()
  if (ageMs > 3 * 3_600_000) {
    if (!al.parsedEntries.length) {
      await prisma.telegramWorkoutSession.delete({ where: { id: al.sessionId } }).catch(() => {})
      await writeSplitState(user.id, { ...state, activeLogging: null })
      return NOT_HANDLED
    }
    await saveQuickEntriesToDb(al.sessionId, al.parsedEntries)
    const result = await finishSession(user, state, al, now)
    return { ...result, reply: `Session timed out — auto-saved.\n\n${result.reply}` }
  }

  const updatedAl = { ...al, lastActivityAt: now.toISOString() }
  return handleQuickLogMessage(user, { ...state, activeLogging: updatedAl }, updatedAl, text, now)
}

// ═══════════════════════════════════════════════════════════════════════════════
// PENDING LOG — handle response to auto-prompt
// ═══════════════════════════════════════════════════════════════════════════════

async function handlePendingLogMessage(
  user: UserRow, state: SplitState, pendingLog: PendingLog, text: string, now: Date
): Promise<{ handled: boolean; reply: string }> {
  const lower = text.trim().toLowerCase()

  // User didn't train
  if (/\b(no|nope|didn.?t|missed|skip|rest|couldn.?t|not today)\b/i.test(lower)) {
    await writeSplitState(user.id, { ...state, pendingLog: null })
    return {
      handled: true,
      reply:   `Got it. No session today. Next ${pendingLog.muscles} day on track.`,
    }
  }

  const isYes       = /^(yes|yeah|yep|yup|did it|trained|went|done|finished|yep done)$/i.test(lower)
  const hasExercises = parseMultiExercise(text).length > 0

  // Message doesn't look relevant — clear pending and pass through
  if (!isYes && !hasExercises) {
    await writeSplitState(user.id, { ...state, pendingLog: null })
    return NOT_HANDLED
  }

  // Create session
  const session = await prisma.telegramWorkoutSession.create({
    data: {
      messengerUserId: user.id,
      date:            now,
      splitDayIndex:   pendingLog.splitDayIndex,
      musclesTrained:  [pendingLog.muscles],
      completed:       false,
    },
  })

  const newAl: ActiveLogging = {
    sessionId:               session.id,
    splitDayIndex:           pendingLog.splitDayIndex,
    muscles:                 pendingLog.muscles,
    startedAt:               pendingLog.promptedAt,
    logMode:                 "quick",
    logState:                "awaiting_exercises",
    parsedEntries:           [],
    pendingWeightFor:        [],
    lastActivityAt:          now.toISOString(),
    pendingSuspectExercise:  null,
    conflictEntries:         [],
    conflictDetectedMuscles: "",
    noSplitAdvance:          false,
  }

  const newState: SplitState = { ...state, pendingLog: null, activeLogging: newAl }
  await writeSplitState(user.id, newState)

  if (isYes && !hasExercises) {
    const exData = await getExercisesForToday(user.id, pendingLog.muscles)
    return {
      handled: true,
      reply:   `Post-session log. What did you hit?\n\n${formatQuickLogOpening(pendingLog.muscles, exData)}`,
    }
  }

  // User sent exercise data directly
  const entries      = parseMultiExercise(text)
  const missing      = entries.filter(e => e.weightKg === null).map(e => e.exercise)
  const needSetsReps = entries.filter(e => e.weightKg !== null && !e.setsRepsProvided)
  const withData     = { ...newAl, parsedEntries: entries }

  if (missing.length) {
    await writeSplitState(user.id, { ...newState, activeLogging: { ...withData, logState: "awaiting_weights", pendingWeightFor: missing } })
    return { handled: true, reply: `Got it. Weight for ${missing.join(" and ")}?` }
  }

  if (needSetsReps.length > 0) {
    const lines  = entries.map(e => `${e.exercise} — ${e.weightKg}kg`)
    const target = needSetsReps.length === 1 ? needSetsReps[0]!.exercise : "each"
    await writeSplitState(user.id, { ...newState, activeLogging: { ...withData, logState: "awaiting_sets_reps" } })
    return {
      handled: true,
      reply:   `Got it.\n${lines.join("\n")}\n\nSets × reps for ${target}? (e.g. 3×5, 3×8, 3×12)`,
    }
  }

  await writeSplitState(user.id, { ...newState, activeLogging: { ...withData, logState: "confirming" } })
  return {
    handled: true,
    reply:   buildQuickLogConfirmation(entries) + "\n\nAnything else or \"done\"?",
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUICK LOG STATE MACHINE
// ═══════════════════════════════════════════════════════════════════════════════

async function handleQuickLogMessage(
  user: UserRow, state: SplitState, al: ActiveLogging, text: string, now: Date
): Promise<{ handled: boolean; reply: string }> {
  const lower = text.trim().toLowerCase()

  // Cancel
  if (/^(cancel|abort|never ?mind|stop logging|no session)$/i.test(lower)) {
    await prisma.telegramWorkoutSession.delete({ where: { id: al.sessionId } }).catch(() => {})
    await writeSplitState(user.id, { ...state, activeLogging: null })
    return { handled: true, reply: `Cancelled. Session not saved.` }
  }

  // "done" at any point saves whatever is parsed
  if (/^(done|finish|finished|that.?s? all|that.?s? it|all done)$/i.test(lower)) {
    if (!al.parsedEntries.length) {
      const setCount = await prisma.telegramSetLog.count({ where: { sessionId: al.sessionId } })
      if (setCount === 0) {
        await prisma.telegramWorkoutSession.delete({ where: { id: al.sessionId } }).catch(() => {})
        await writeSplitState(user.id, { ...state, activeLogging: null })
        return { handled: true, reply: `Nothing logged. Session cancelled.` }
      }
    }
    if (al.parsedEntries.length) {
      await saveQuickEntriesToDb(al.sessionId, al.parsedEntries)
    }
    return finishSession(user, state, al, now)
  }

  switch (al.logState) {
    case "awaiting_exercises": {
      // "same as last time"
      if (/\bsame\b.*\blast\b|\blast time\b/i.test(lower)) {
        return handleSameAsLastTime(user, state, al)
      }

      const entries = parseMultiExercise(text)
      if (!entries.length) {
        return {
          handled: true,
          reply:   `Format: "bench 80 3x5, rows 60 4x8"\nOr type exercise names and I'll ask for weights.`,
        }
      }

      // Edge Case 2: muscle mismatch — exercises don't match today's planned split day
      const { mismatch, detected } = detectMuscleMismatch(entries, al.muscles)
      if (mismatch) {
        const updated = { ...al, parsedEntries: entries, logState: "muscle_conflict" as const, conflictDetectedMuscles: detected, lastActivityAt: now.toISOString() }
        await writeSplitState(user.id, { ...state, activeLogging: updated })
        return {
          handled: true,
          reply:   `Logging ${detected} — but today was ${al.muscles} in your split.\nTraining ${detected} instead or adding a session?\n\n"Instead" — log ${detected}, mark ${al.muscles} as skipped.\n"Adding" — log ${detected} as bonus, ${al.muscles} still due.`,
        }
      }

      // Edge Case 7: unrealistic weight on early sessions
      const intake = parseIntake(user.intakeAnswers)
      const bw = parseFloat(intake.current_bodyweight_kg ?? "0")
      const sessionCount = bw > 0 ? await prisma.telegramWorkoutSession.count({ where: { messengerUserId: user.id, completed: true } }) : 999
      if (bw > 0 && sessionCount < 3) {
        const suspect = entries.find(e => isUnrealisticWeight(e, bw))
        if (suspect) {
          const updated = { ...al, parsedEntries: entries, logState: "weight_review" as const, pendingSuspectExercise: suspect.exercise, lastActivityAt: now.toISOString() }
          await writeSplitState(user.id, { ...state, activeLogging: updated })
          return {
            handled: true,
            reply:   `${suspect.weightKg}kg ${suspect.exercise} — is that right?\nJust checking before I save it as your baseline.`,
          }
        }
      }

      const missing      = entries.filter(e => e.weightKg === null).map(e => e.exercise)
      const needSetsReps = entries.filter(e => !e.setsRepsProvided)
      const updated      = { ...al, parsedEntries: entries, lastActivityAt: now.toISOString() }

      if (missing.length) {
        await writeSplitState(user.id, { ...state, activeLogging: { ...updated, logState: "awaiting_weights", pendingWeightFor: missing } })
        return { handled: true, reply: `Got the exercises. Weight for ${missing.join(" and ")}?` }
      }

      // Weights present but sets/reps not given — confirm what was parsed, ask once for reps
      if (needSetsReps.length > 0) {
        const lines  = entries.map(e => `${e.exercise} — ${e.weightKg}kg`)
        const target = needSetsReps.length === 1 ? needSetsReps[0]!.exercise : "each"
        await writeSplitState(user.id, { ...state, activeLogging: { ...updated, logState: "awaiting_sets_reps" } })
        return {
          handled: true,
          reply:   `Got it.\n${lines.join("\n")}\n\nSets × reps for ${target}? (e.g. 3×5, 3×8, 3×12)`,
        }
      }

      await writeSplitState(user.id, { ...state, activeLogging: { ...updated, logState: "confirming" } })
      return {
        handled: true,
        reply:   buildQuickLogConfirmation(entries) + "\n\nAnything else or \"done\"?",
      }
    }

    case "awaiting_weights": {
      const updated      = fillMissingWeights(al.parsedEntries, al.pendingWeightFor, text)
      const stillMissing = updated.filter(e => e.weightKg === null).map(e => e.exercise)
      const newAl        = { ...al, parsedEntries: updated, lastActivityAt: now.toISOString() }

      if (stillMissing.length) {
        await writeSplitState(user.id, { ...state, activeLogging: { ...newAl, pendingWeightFor: stillMissing } })
        return { handled: true, reply: `Got it. Weight for ${stillMissing.join(" and ")}?` }
      }

      // All weights filled — check if sets/reps still needed
      const needSetsReps = updated.filter(e => !e.setsRepsProvided)
      if (needSetsReps.length > 0) {
        const lines  = updated.map(e => `${e.exercise} — ${e.weightKg}kg`)
        const target = needSetsReps.length === 1 ? needSetsReps[0]!.exercise : "each"
        await writeSplitState(user.id, { ...state, activeLogging: { ...newAl, logState: "awaiting_sets_reps", pendingWeightFor: [] } })
        return {
          handled: true,
          reply:   `Got:\n${lines.join("\n")}\n\nSets × reps for ${target}? (e.g. 3×5, 3×8, 3×12)`,
        }
      }

      await writeSplitState(user.id, { ...state, activeLogging: { ...newAl, logState: "confirming", pendingWeightFor: [] } })
      return {
        handled: true,
        reply:   buildQuickLogConfirmation(updated) + "\n\nAnything else or \"done\"?",
      }
    }

    case "awaiting_sets_reps": {
      const filled    = fillMissingSetsReps(al.parsedEntries, text)
      const stillNeed = filled.filter(e => !e.setsRepsProvided)
      const newAl     = { ...al, parsedEntries: filled, lastActivityAt: now.toISOString() }

      if (stillNeed.length) {
        await writeSplitState(user.id, { ...state, activeLogging: newAl })
        const names = stillNeed.map(e => e.exercise).join(", ")
        return { handled: true, reply: `Sets × reps for ${names}?` }
      }

      await writeSplitState(user.id, { ...state, activeLogging: { ...newAl, logState: "confirming" } })
      return {
        handled: true,
        reply:   buildQuickLogConfirmation(filled) + "\n\nAnything else or \"done\"?",
      }
    }

    case "confirming": {
      if (/^(yes|yep|yeah|correct|looks? good|good|right|confirm|ok|yup)$/i.test(lower)) {
        await saveQuickEntriesToDb(al.sessionId, al.parsedEntries)
        return finishSession(user, state, al, now)
      }

      // More exercises added
      const newEntries   = parseMultiExercise(text)
      if (newEntries.length) {
        const combined     = [...al.parsedEntries, ...newEntries]
        const missing      = newEntries.filter(e => e.weightKg === null).map(e => e.exercise)
        const needSetsReps = newEntries.filter(e => e.weightKg !== null && !e.setsRepsProvided)
        const newAl        = { ...al, parsedEntries: combined, lastActivityAt: now.toISOString() }

        if (missing.length) {
          await writeSplitState(user.id, { ...state, activeLogging: { ...newAl, logState: "awaiting_weights", pendingWeightFor: missing } })
          return { handled: true, reply: `Added. Weight for ${missing.join(" and ")}?` }
        }

        if (needSetsReps.length > 0) {
          const target = needSetsReps.length === 1 ? needSetsReps[0]!.exercise : "each"
          await writeSplitState(user.id, { ...state, activeLogging: { ...newAl, logState: "awaiting_sets_reps" } })
          const lines = combined.map(e => `${e.exercise} — ${e.weightKg}kg`)
          return {
            handled: true,
            reply:   `Got:\n${lines.join("\n")}\n\nSets × reps for ${target}? (e.g. 3×5, 3×8, 3×12)`,
          }
        }

        await writeSplitState(user.id, { ...state, activeLogging: newAl })
        return {
          handled: true,
          reply:   buildQuickLogConfirmation(combined) + "\n\nAnything else or \"done\"?",
        }
      }

      return {
        handled: true,
        reply:   `Type "done" to save, add more exercises, or "cancel" to abort.`,
      }
    }

    case "weight_review": {
      const exercise = al.pendingSuspectExercise!
      if (/^(yes|yep|yeah|correct|right|that.?s right|confirmed?)$/i.test(lower)) {
        await writeSplitState(user.id, { ...state, activeLogging: { ...al, logState: "confirming", pendingSuspectExercise: null } })
        return { handled: true, reply: buildQuickLogConfirmation(al.parsedEntries) + "\n\nAnything else or \"done\"?" }
      }
      const corrected = extractWeight(text)
      if (corrected !== null) {
        const fixed = al.parsedEntries.map(e => e.exercise === exercise ? { ...e, weightKg: corrected } : e)
        await writeSplitState(user.id, { ...state, activeLogging: { ...al, parsedEntries: fixed, logState: "confirming", pendingSuspectExercise: null } })
        return { handled: true, reply: buildQuickLogConfirmation(fixed) + "\n\nAnything else or \"done\"?" }
      }
      if (/\b(no|typo|wrong|mistake)\b/i.test(lower)) {
        return { handled: true, reply: `What's the correct weight for ${exercise}?` }
      }
      const cur = al.parsedEntries.find(e => e.exercise === exercise)
      return { handled: true, reply: `Is ${cur?.weightKg ?? "?"}kg for ${exercise} correct? (yes / no, or give the right weight)` }
    }

    case "muscle_conflict": {
      if (/\b(instead|swap|replace|just (?:doing|training) this|do this)\b/i.test(lower)) {
        const updated = { ...al, muscles: al.conflictDetectedMuscles, logState: "confirming" as const, noSplitAdvance: true }
        await writeSplitState(user.id, { ...state, activeLogging: updated, lastSkipDate: now.toISOString().slice(0, 10) })
        return { handled: true, reply: buildQuickLogConfirmation(al.parsedEntries) + "\n\nAnything else or \"done\"?" }
      }
      if (/\b(add(?:ing)?|bonus|extra|also|in addition)\b/i.test(lower)) {
        const updated = { ...al, logState: "confirming" as const, noSplitAdvance: true }
        await writeSplitState(user.id, { ...state, activeLogging: updated })
        return { handled: true, reply: buildQuickLogConfirmation(al.parsedEntries) + `\n\nAnything else or "done"? ${al.muscles} is still on your schedule.` }
      }
      return {
        handled: true,
        reply:   `"Instead" — log ${al.conflictDetectedMuscles}, mark ${al.muscles} as skipped.\n"Adding" — log ${al.conflictDetectedMuscles} as bonus, ${al.muscles} still due.`,
      }
    }

    default:
      return NOT_HANDLED
  }
}

async function handleSameAsLastTime(
  user: UserRow, state: SplitState, al: ActiveLogging
): Promise<{ handled: boolean; reply: string }> {
  const lastSession = await prisma.telegramWorkoutSession.findFirst({
    where:   { messengerUserId: user.id, completed: true },
    orderBy: { date: "desc" },
    select:  { id: true, date: true, musclesTrained: true },
  })

  if (!lastSession) {
    return {
      handled: true,
      reply:   `No last session found. Tell me what you hit today.`,
    }
  }

  const allSets = await prisma.telegramSetLog.findMany({
    where:   { sessionId: lastSession.id, completed: true },
    orderBy: [{ exerciseName: "asc" }, { setNumber: "asc" }],
    select:  { exerciseName: true, reps: true, weightKg: true },
  })

  if (!allSets.length) {
    return {
      handled: true,
      reply:   `Last session had no sets logged. Tell me what you hit today.`,
    }
  }

  // Group by exercise → QuickLogEntry
  const byExercise: Record<string, typeof allSets> = {}
  for (const s of allSets) {
    byExercise[s.exerciseName] ??= []
    byExercise[s.exerciseName]!.push(s)
  }

  const entries: QuickLogEntry[] = Object.entries(byExercise).map(([exercise, sets]) => ({
    exercise,
    sets:    sets.length,
    reps:    sets[0]!.reps,
    weightKg: sets[0]!.weightKg,
  }))

  const d   = new Date(lastSession.date)
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })

  await writeSplitState(user.id, { ...state, activeLogging: { ...al, parsedEntries: entries, logState: "confirming" } })

  return {
    handled: true,
    reply: `Same as last session (${day})?\n${buildQuickLogConfirmation(entries)}\n\nConfirm or change anything.`,
  }
}

async function saveQuickEntriesToDb(sessionId: string, entries: QuickLogEntry[]): Promise<void> {
  for (const entry of entries) {
    for (let i = 0; i < entry.sets; i++) {
      await prisma.telegramSetLog.create({
        data: {
          sessionId,
          exerciseName: entry.exercise,
          setNumber:    i + 1,
          reps:         entry.reps,
          weightKg:     entry.weightKg ?? 0,
          completed:    true,
        },
      })
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FEEL RESPONSE (post-session)
// ═══════════════════════════════════════════════════════════════════════════════

function classifyFeelResponse(text: string): FeelRating | null {
  const lower = text.toLowerCase()
  if (/\b(failed|couldn'?t|missed reps?|dropped|couldn'?t (finish|complete)|didn'?t finish)\b/.test(lower)) return "failed"
  if (/\b(easy|too easy|way more|barely felt|breeze|flew through|could (do|have done) more|more (reps?|in the tank|left))\b/.test(lower)) return "easy"
  if (/\b(had more|more in (the )?tank|wasn'?t hard|felt light|nothing)\b/.test(lower)) return "easy"
  if (/\b(hard but (finished|done|completed|got it)|tough but (made|got)|barely (made|finished)|grinded)\b/.test(lower)) return "hard"
  if (/\b(very hard|really hard|struggled|nearly failed|barely)\b/.test(lower)) return "hard"
  if (/\b(hard|tough|difficult)\b/.test(lower)) return "hard"
  if (/\b(moderate|medium|ok(ay)?|alright|decent|fine|solid|normal|usual|average|manageable)\b/.test(lower)) return "moderate"
  return null
}

async function handleFeelResponse(
  user: UserRow, state: SplitState, feelPending: { sessionId: string; muscles: string }, text: string,
): Promise<{ handled: boolean; reply: string }> {
  const rating = classifyFeelResponse(text)
  await writeSplitState(user.id, { ...state, feelPending: null, lastFeelRating: rating })

  if (!rating) return { handled: true, reply: "Noted." }

  const ack: Record<FeelRating, string> = {
    easy:     "Good — weight's moving well. We'll look at pushing next session.",
    moderate: "Solid. That's exactly where you want to be.",
    hard:     "Grinded through it. Keep the same weight next session — hit it cleaner before adding more.",
    failed:   "Missed reps. Same weight next time, dial in the form before adding load.",
  }
  return { handled: true, reply: ack[rating] }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SESSION STEPS (set-by-set mode)
// ═══════════════════════════════════════════════════════════════════════════════

async function finishSession(
  user: UserRow, state: SplitState, al: ActiveLogging, now: Date
): Promise<{ handled: boolean; reply: string }> {
  const allExercises = al.parsedEntries.map(e => e.exercise)

  const totalSets = await prisma.telegramSetLog.count({
    where: { sessionId: al.sessionId, completed: true },
  })

  const durationMin = Math.round(
    (now.getTime() - new Date(al.startedAt).getTime()) / 60_000
  )

  const allSets = await prisma.telegramSetLog.findMany({
    where:   { sessionId: al.sessionId, completed: true },
    orderBy: [{ exerciseName: "asc" }, { setNumber: "asc" }],
    select:  { exerciseName: true, reps: true, weightKg: true },
  })
  const sessionSummary = buildSessionSummary(allSets)

  await prisma.telegramWorkoutSession.update({
    where: { id: al.sessionId },
    data: {
      completed:       true,
      musclesTrained:  [al.muscles, ...allExercises].filter(Boolean),
      durationMinutes: durationMin,
      totalSets,
      sessionSummary,
    },
  })

  // Update avg session duration (rolling average over last 5)
  const recentSessions = await prisma.telegramWorkoutSession.findMany({
    where:   { messengerUserId: user.id, completed: true, durationMinutes: { gt: 0 } },
    orderBy: { date: "desc" },
    take:    5,
    select:  { durationMinutes: true },
  })
  if (recentSessions.length >= 2) {
    const avg = Math.round(
      recentSessions.reduce((s, r) => s + (r.durationMinutes ?? 0), 0) / recentSessions.length
    )
    const updatedState = parseSplitState(user.splitState)
    await writeSplitState(user.id, { ...updatedState, avgSessionDurationMin: avg })
  }

  const intake    = parseIntake(user.intakeAnswers)
  const split     = intake.current_split ?? "unstructured"
  const days      = parseInt(intake.available_training_days ?? "3") || 3
  const dayList   = getTrainingDays(split, days)
  const todayISO  = now.toISOString().slice(0, 10)
  const trained   = [...state.daysTrained, al.splitDayIndex]
  const cycleDone = trained.length >= dayList.length

  const streakBroken = !isConsecutiveDay(state.lastSessionDate, todayISO) && (user.gymStreak ?? 0) > 1
  const prevStreak   = user.gymStreak ?? 0
  const newStreak    = isConsecutiveDay(state.lastSessionDate, todayISO) ? prevStreak + 1 : 1

  const milestone        = getStreakMilestoneMessage(newStreak, state.milestonesFired)
  const updatedMilestones = milestone ? [...state.milestonesFired, milestone.threshold] : state.milestonesFired

  const level = intake.training_experience ?? "intermediate"

  const newState: SplitState = {
    lastCompletedDayIndex: al.noSplitAdvance ? state.lastCompletedDayIndex : al.splitDayIndex,
    lastSessionDate:       todayISO,
    cycleNumber:           cycleDone && !al.noSplitAdvance ? state.cycleNumber + 1 : state.cycleNumber,
    daysTrained:           cycleDone && !al.noSplitAdvance ? [] : al.noSplitAdvance ? state.daysTrained : trained,
    activeLogging:         null,
    pendingLog:            null,
    avgSessionDurationMin: state.avgSessionDurationMin,
    milestonesFired:       updatedMilestones,
    firstExerciseWeights:  state.firstExerciseWeights,
    firstLogDate:          state.firstLogDate ?? todayISO,
    setupPending:          null,
    skipState:             null,
    lastSkipDate:          al.noSplitAdvance ? (now.toISOString().slice(0, 10)) : state.lastSkipDate,
    reactivationCount:     state.reactivationCount,
    lastFeelRating:        state.lastFeelRating ?? null,
    feelPending:           { sessionId: al.sessionId, muscles: al.muscles },
  }
  await writeSplitState(user.id, newState)

  await prisma.messengerUser.update({
    where: { id: user.id },
    data:  { gymStreak: newStreak },
  })

  const hadPRsBefore = Object.keys(parsePersonalRecords(user.personalRecords)).length > 0
  const prMessages   = await checkPRsForSession(user, al.sessionId)

  // Write streak milestone and comeback moments (fire-and-forget — never blocks reply)
  if (milestone) {
    writeMomentStreakMilestone(user.id, milestone.threshold, newStreak).catch(() => {})
  }
  const daysSinceLastSession = state.lastSessionDate
    ? Math.floor((now.getTime() - new Date(state.lastSessionDate).getTime()) / 86_400_000)
    : 999
  if (daysSinceLastSession >= 5) {
    writeMomentComeback(user.id, daysSinceLastSession, prevStreak, al.muscles).catch(() => {})
  }

  const nextIdx     = (al.splitDayIndex + 1) % dayList.length
  const nextMuscles = dayList[nextIdx] ?? "Full Body"

  // Retrieve one historical moment to surface when a PR was hit
  const primaryLift = primaryLiftFromMuscles(al.muscles)
  const sessionMoments = prMessages.length > 0
    ? await retrieveRelevantMoments(user.id, { surface: "session_completion", exercise: primaryLift })
    : []

  // For milestones >= 30 days, generate a personalised message from actual history
  let milestoneMessage = milestone?.message ?? null
  if (milestone && milestone.threshold >= 30) {
    const llmMsg = await generateLLMMilestoneMessage(user.id, milestone.threshold, newStreak)
    if (llmMsg) milestoneMessage = llmMsg
  }

  const streakBlock = streakBroken
    ? `\n\n${getStreakBrokenMessage(prevStreak)}`
    : milestoneMessage ? `\n\n${milestoneMessage}` : ""

  const identityBlock = (!hadPRsBefore && prMessages.length > 0)
    ? "\n\nThat weight didn't move before. Now it does.\nThat's the whole point of this. 🔥"
    : prMessages.length ? "\n\n" + prMessages.join("\n") : ""

  // Journey context — one line showing arc when a PR was hit and history exists
  const momentBlock = sessionMoments.length
    ? `\n\n${sessionMoments[0]}`
    : ""

  const deloadMsg = cycleDone && newState.cycleNumber > 0 && newState.cycleNumber % 4 === 0
    ? "\n\n4 weeks straight. Next cycle: 60% weights, 2 sets max. Non-negotiable — your CNS needs it."
    : ""

  const firstDeloadNote = cycleDone && newState.cycleNumber === 4
    ? "\n\nI know you want to train hard. That's the problem.\nAdaptation happens in recovery, not in the session.\nTrust the process this week."
    : ""

  let weeklyReviewBlock = ""
  if (cycleDone && newState.cycleNumber % 4 !== 0) {
    const review = await generateWeeklyReview(user.id, newState.cycleNumber - 1, dayList.length, false)
    weeklyReviewBlock = review ? `\n\n${review}` : ""
  } else if (cycleDone && newState.cycleNumber % 4 === 0) {
    const review = await generateWeeklyReview(user.id, newState.cycleNumber - 1, dayList.length, true)
    weeklyReviewBlock = review ? `\n\n${review}` : ""
  }

  const exercisesLogged = allExercises.length || al.parsedEntries.length
  const feelQ = level === "beginner"
    ? `\n\nHow did that feel — could you have done more reps, or was it genuinely hard by the last set?`
    : `\n\nHow did that feel? Easy, hard, or somewhere in between?`

  return {
    handled: true,
    reply: [
      `Done. ${al.muscles} logged. ${totalSets} sets. ${durationMin} min.`,
      exercisesLogged ? `Next session: Day ${nextIdx + 1} — ${nextMuscles}.` : `Next: Day ${nextIdx + 1} — ${nextMuscles}.`,
      identityBlock,
      momentBlock,
      deloadMsg,
      firstDeloadNote,
      streakBlock,
      weeklyReviewBlock,
      feelQ,
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

  // Write moment facts for PRs and breakthroughs (fire-and-forget)
  const totalSessions = await prisma.telegramWorkoutSession.count({
    where: { messengerUserId: user.id, completed: true },
  })
  for (const [exercise, update] of Object.entries(updates)) {
    const prev = records[exercise]
    if (!prev || update.weightKg <= prev.weightKg) continue

    const firstWeight = (parseSplitState(user.splitState).firstExerciseWeights ?? {})[exercise] ?? null

    writeMomentPR(user.id, exercise, update.weightKg, prev.weightKg, firstWeight, totalSessions)
      .catch(() => {})

    // Breakthrough = PR after being stuck at prev.weightKg for 3+ sessions
    getConsecutiveSessionsAtWeight(user.id, exercise, prev.weightKg)
      .then(stallCount => {
        if (stallCount >= 3) {
          writeMomentBreakthrough(user.id, exercise, prev.weightKg, update.weightKg, stallCount)
            .catch(() => {})
        }
      })
      .catch(() => {})
  }

  return messages
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROGRESSIVE OVERLOAD
// ═══════════════════════════════════════════════════════════════════════════════


export async function computeProgressiveOverloadForSession(
  userId:     string,
  sessionId:  string,
  feelRating?: FeelRating | null,
): Promise<Array<{ exercise: string; nextWeightKg: number; note: string; flag: string | null }>> {
  // Phase 1: no overload suggestions for the first 3 sessions
  const totalSessions = await prisma.telegramWorkoutSession.count({
    where: { messengerUserId: userId, completed: true },
  })
  if (totalSessions < 4) {
    const phaseNote: Record<number, string> = {
      1: "First session logged. I'll watch how your weights move over the next 2 sessions before suggesting changes.",
      2: "Two sessions in. Keep the same weights — let your body adapt before we push.",
      3: "3 sessions done. One more before I start giving overload targets.",
    }
    return [{ exercise: "all", nextWeightKg: 0, note: phaseNote[totalSessions] ?? "Building baseline.", flag: "phase1" }]
  }

  // Sessions-needed threshold by experience level
  const userRow = await prisma.messengerUser.findUnique({ where: { id: userId }, select: { intakeAnswers: true } })
  const intake  = (userRow?.intakeAnswers as Record<string, string>) ?? {}
  const level   = intake.training_experience ?? "intermediate"
  const sessionsNeeded = level === "beginner" ? 2 : level === "advanced" ? 4 : 3

  const exercises = await prisma.telegramSetLog.groupBy({
    by:    ["exerciseName"],
    where: { sessionId, completed: true },
  })

  const results = []

  for (const { exerciseName } of exercises) {
    const allSets = await prisma.telegramSetLog.findMany({
      where:   { exerciseName, session: { messengerUserId: userId }, completed: true },
      orderBy: [{ sessionId: "desc" }, { setNumber: "asc" }],
      take:    40,
      select:  { weightKg: true, reps: true, rpe: true, sessionId: true },
    })

    const sessions = groupBySession(allSets)
    const current  = sessions[0]
    if (!current?.length) continue

    const maxW      = Math.max(...current.map((s: any) => s.weightKg))
    const rpeVals   = current.filter((s: any) => s.rpe != null).map((s: any) => s.rpe as number)
    const avgRpe    = rpeVals.length ? rpeVals.reduce((a, b) => a + b, 0) / rpeVals.length : 7
    const failedAny = current.some((s: any) => s.reps < 1)

    // Map feel rating to effective RPE — overrides logged RPE when available
    const effectiveRpe = feelRating === "failed" ? 10
      : feelRating === "hard"     ? 9
      : feelRating === "moderate" ? 7.5
      : feelRating === "easy"     ? 6
      : avgRpe

    // Sessions at current weight
    const sessionsAtWeight = sessions.filter(
      (sess: any[]) => Math.max(...sess.map((s: any) => s.weightKg)) === maxW
    ).length

    if (feelRating === "failed" || failedAny) {
      results.push({ exercise: exerciseName, nextWeightKg: maxW, flag: "maintain",
        note: `Missed reps at ${maxW}kg. Keep it — complete the reps first.` })
    } else if (effectiveRpe >= 9) {
      results.push({ exercise: exerciseName, nextWeightKg: maxW, flag: "maintain",
        note: `Keep ${maxW}kg. Hit the reps cleaner first.` })
    } else if (sessionsAtWeight >= sessionsNeeded && effectiveRpe < 9) {
      const newWeight = maxW + 2.5
      results.push({ exercise: exerciseName, nextWeightKg: newWeight, flag: "increase",
        note: buildOverloadNote(level, exerciseName, maxW, newWeight, sessionsAtWeight) })
    } else {
      const remaining = sessionsNeeded - sessionsAtWeight
      results.push({ exercise: exerciseName, nextWeightKg: maxW, flag: "maintain",
        note: `${maxW}kg — ${remaining} more session${remaining > 1 ? "s" : ""} at this weight before we move up.` })
    }
  }

  return results
}

function buildOverloadNote(level: string, exercise: string, oldWeight: number, newWeight: number, sessions: number): string {
  if (level === "beginner") {
    return `${exercise} has been ${oldWeight}kg for ${sessions} sessions and you're handling it. Try ${newWeight}kg — if the last set gets hard, that's fine. Come back to ${oldWeight}kg if you can't complete the reps.`
  }
  if (level === "advanced") {
    return `${newWeight}kg next. ${sessions} sessions at ${oldWeight}kg — earned.`
  }
  return `${oldWeight}kg for ${sessions} sessions. Time to test ${newWeight}kg. If it moves clean for all sets, it's your new working weight.`
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETUP UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

function parseTimeString(str: string): string | null {
  const s = str.trim()
  const hhmmMatch = s.match(/^(\d{1,2}):(\d{2})$/)
  if (hhmmMatch) {
    const h = parseInt(hhmmMatch[1]!), m = parseInt(hhmmMatch[2]!)
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59)
      return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`
  }
  const ampmMatch = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i)
  if (ampmMatch) {
    let h = parseInt(ampmMatch[1]!), m = ampmMatch[2] ? parseInt(ampmMatch[2]) : 0
    const p = ampmMatch[3]!.toLowerCase()
    if (p === "pm" && h !== 12) h += 12
    if (p === "am" && h === 12) h = 0
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59)
      return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`
  }
  const hourMatch = s.match(/^(\d{1,2})$/)
  if (hourMatch) {
    const h = parseInt(hourMatch[1]!)
    if (h >= 0 && h <= 23) return `${h.toString().padStart(2, "0")}:00`
  }
  return null
}

function formatTime12h(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number)
  const period = h >= 12 ? "pm" : "am"
  const dh = h === 0 ? 12 : h > 12 ? h - 12 : h
  const dm = m === 0 ? "" : `:${m.toString().padStart(2, "0")}`
  return `${dh}${dm}${period}`
}

function addMinutesToTimeStr(hhmm: string, minutes: number): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number)
  const total = ((h * 60 + m + minutes) % 1440 + 1440) % 1440
  return `${Math.floor(total / 60).toString().padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`
}

async function writeIntakeAnswers(userId: string, answers: Record<string, string>): Promise<void> {
  await prisma.messengerUser.update({ where: { id: userId }, data: { intakeAnswers: answers as any } })
}

function exerciseToMuscleKeys(exercise: string): string[] {
  const name = exercise.toLowerCase()
  const keys: string[] = []
  for (const [muscle, exercises] of Object.entries(MUSCLE_DEFAULTS)) {
    if (exercises.some(e => {
      const en = e.toLowerCase()
      return en.includes(name.split(" ")[0]!) || name.includes(en.split(" ")[0]!)
    })) keys.push(muscle)
  }
  return [...new Set(keys)]
}

function detectMuscleMismatch(
  entries: QuickLogEntry[], sessionMuscles: string
): { mismatch: boolean; detected: string } {
  if (entries.length === 0) return { mismatch: false, detected: "" }
  const plannedKeys = musclesFromSplitDay(sessionMuscles)
  const detectedKeys = new Set<string>()
  let mismatchCount = 0
  for (const entry of entries) {
    const exKeys = exerciseToMuscleKeys(entry.exercise)
    if (exKeys.length > 0 && !exKeys.some(k => plannedKeys.includes(k))) {
      mismatchCount++
      exKeys.forEach(k => detectedKeys.add(k))
    }
  }
  const mismatch = mismatchCount > 0 && mismatchCount >= Math.ceil(entries.length / 2)
  return { mismatch, detected: [...detectedKeys].join(" + ") || "other muscles" }
}

function isUnrealisticWeight(entry: QuickLogEntry, bodyweightKg: number): boolean {
  if (!entry.weightKg || bodyweightKg <= 0) return false
  if (/\b(bench|press|row|pull|curl|dip|push|overhead|ohp|fly|raise)\b/i.test(entry.exercise))
    return entry.weightKg > bodyweightKg * 2
  if (/\b(squat|deadlift|leg press)\b/i.test(entry.exercise))
    return entry.weightKg > bodyweightKg * 3
  return false
}

async function checkTodaySession(
  userId: string, muscles: string, now: Date
): Promise<{ id: string; date: Date } | null> {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  return prisma.telegramWorkoutSession.findFirst({
    where: { messengerUserId: userId, completed: true, date: { gte: start }, musclesTrained: { has: muscles } },
    orderBy: { date: "desc" },
    select: { id: true, date: true },
  })
}

function detectGymTimeChange(text: string): string | null {
  const patterns = [
    /(?:changing|moving|updating|switching).*?(?:to|at)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
    /(?:gym|training|workout)\s+(?:time|at|to)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
    /(?:train(?:ing)?|gym|workout)\s+(?:from|starting|now\s+(?:at|from))\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
  ]
  for (const pat of patterns) {
    const m = text.match(pat)
    if (m?.[1]) { const t = parseTimeString(m[1]); if (t) return t }
  }
  return null
}

// ─── /setup state machine ─────────────────────────────────────────────────────

export async function handleSetupCommand(
  platformChatId: string,
  text: string,
): Promise<{ handled: boolean; reply: string }> {
  const args  = text.trim().replace(/^\/setup\s*/i, "").trim()
  const user  = await getUser(platformChatId)
  if (!user) return { handled: true, reply: "No profile found." }
  if (!args) {
    return {
      handled: true,
      reply:   "What do you want to update?\n/setup gym_time 19:30\n/setup weight 80\n/setup goal [fat_loss|muscle|recomp]\n/setup split",
    }
  }

  const [field, ...rest] = args.split(/\s+/)
  const value  = rest.join(" ").trim()
  const intake = parseIntake(user.intakeAnswers)
  const state  = parseSplitState(user.splitState)

  // ── gym_time ───────────────────────────────────────────────────────────────
  if (field === "gym_time") {
    const parsed = parseTimeString(value)
    if (!parsed) return { handled: true, reply: "Format: /setup gym_time 19:30" }
    await prisma.messengerUser.update({ where: { id: user.id }, data: { preferredCheckInTime: parsed } })
    await writeIntakeAnswers(user.id, { ...intake, preferred_gym_time: parsed })
    const preTime = addMinutesToTimeStr(parsed, -30)
    return {
      handled: true,
      reply:   `Updated. Gym time now ${formatTime12h(parsed)}.\nPre-session message shifts to ${formatTime12h(preTime)}.`,
    }
  }

  // ── weight ─────────────────────────────────────────────────────────────────
  if (field === "weight") {
    const kg = parseFloat(value)
    if (isNaN(kg) || kg < 20 || kg > 300) return { handled: true, reply: "Format: /setup weight 80" }
    const existing = parseFloat(intake.current_bodyweight_kg ?? "0")
    if (existing > 0 && Math.abs(kg - existing) > 15) {
      const diff = Math.abs(kg - existing).toFixed(0)
      const dir  = kg > existing ? "more" : "less"
      await writeSplitState(user.id, { ...state, setupPending: { field: "weight_confirm", value: kg.toString() } })
      return {
        handled: true,
        reply:   `${kg}kg — that's ${diff}kg ${dir} than your profile shows (${existing}kg).\nDid you update your bodyweight or was that a typo?`,
      }
    }
    await writeIntakeAnswers(user.id, { ...intake, current_bodyweight_kg: kg.toString() })
    return { handled: true, reply: `Updated. Bodyweight now ${kg}kg.` }
  }

  // ── goal ───────────────────────────────────────────────────────────────────
  if (field === "goal") {
    const GOALS: Record<string, string> = { fat_loss: "fat loss", muscle: "muscle gain", recomp: "recomp", performance: "performance" }
    if (value && GOALS[value]) {
      await writeIntakeAnswers(user.id, { ...intake, gym_goal: value })
      return { handled: true, reply: `Updated. Goal: ${GOALS[value]}.` }
    }
    await writeSplitState(user.id, { ...state, setupPending: { field: "goal" } })
    return {
      handled: true,
      reply:   `Current goal: ${intake.gym_goal ?? "not set"}.\nNew goal? fat_loss / muscle / recomp / performance`,
    }
  }

  // ── split ──────────────────────────────────────────────────────────────────
  if (field === "split") {
    const SPLITS: Record<string, string> = { ppl: "PPL", upper_lower: "upper_lower", full_body: "full_body", bro_split: "bro_split" }
    const key = value.toLowerCase().replace(/[-\s]/g, "_")
    if (value && SPLITS[key]) {
      await writeIntakeAnswers(user.id, { ...intake, current_split: SPLITS[key]! })
      await writeSplitState(user.id, { ...state, lastCompletedDayIndex: null, daysTrained: [], cycleNumber: 0, setupPending: null })
      return { handled: true, reply: `Split updated to ${SPLITS[key]}. Cycle reset to Day 1.` }
    }
    await writeSplitState(user.id, { ...state, setupPending: { field: "split" } })
    return {
      handled: true,
      reply:   `Current split: ${intake.current_split ?? "not set"}.\nNew split?\n1. PPL\n2. Upper/Lower\n3. Full Body\n4. Bro Split`,
    }
  }

  return { handled: true, reply: `Unknown field. Try: gym_time, weight, goal, split` }
}

async function handleSetupPendingMessage(
  user: UserRow, state: SplitState, pending: SetupPending, text: string
): Promise<{ handled: boolean; reply: string }> {
  const intake = parseIntake(user.intakeAnswers)
  const lower  = text.trim().toLowerCase()

  if (pending.field === "goal") {
    const map: Record<string, string> = {
      fat_loss: "fat_loss", "fat loss": "fat_loss", cut: "fat_loss",
      muscle: "muscle", gain: "muscle", bulk: "muscle", build: "muscle",
      recomp: "recomp", performance: "performance",
      "1": "fat_loss", "2": "muscle", "3": "recomp", "4": "performance",
    }
    const matched = Object.entries(map).find(([k]) => lower.includes(k))?.[1]
    if (matched) {
      await writeIntakeAnswers(user.id, { ...intake, gym_goal: matched })
      await writeSplitState(user.id, { ...state, setupPending: null })
      return { handled: true, reply: `Updated. Goal: ${matched}.` }
    }
    return { handled: true, reply: "Pick one: fat_loss, muscle, recomp, or performance." }
  }

  if (pending.field === "split") {
    const map: Record<string, string> = {
      ppl: "PPL", "1": "PPL",
      upper: "upper_lower", upper_lower: "upper_lower", "2": "upper_lower",
      full: "full_body", full_body: "full_body", "3": "full_body",
      bro: "bro_split", bro_split: "bro_split", "4": "bro_split",
    }
    const matched = Object.entries(map).find(([k]) => lower.includes(k))?.[1]
    if (matched) {
      await writeIntakeAnswers(user.id, { ...intake, current_split: matched })
      await writeSplitState(user.id, { ...state, setupPending: null, lastCompletedDayIndex: null, daysTrained: [], cycleNumber: 0 })
      return { handled: true, reply: `Split updated to ${matched}. Cycle reset to Day 1.` }
    }
    return { handled: true, reply: "Pick: PPL (1), Upper/Lower (2), Full Body (3), or Bro Split (4)." }
  }

  if (pending.field === "weight_confirm") {
    const kg = parseFloat(pending.value ?? "0")
    if (/^(yes|yep|yeah|correct|right|that.?s right|confirmed?)$/i.test(lower)) {
      await writeIntakeAnswers(user.id, { ...intake, current_bodyweight_kg: kg.toString() })
      await writeSplitState(user.id, { ...state, setupPending: null })
      return { handled: true, reply: `Got it. Bodyweight updated to ${kg}kg.` }
    }
    const corrected = parseFloat(text.trim())
    if (!isNaN(corrected) && corrected > 20 && corrected < 300) {
      await writeIntakeAnswers(user.id, { ...intake, current_bodyweight_kg: corrected.toString() })
      await writeSplitState(user.id, { ...state, setupPending: null })
      return { handled: true, reply: `Updated to ${corrected}kg.` }
    }
    if (/\b(no|typo|wrong|mistake)\b/i.test(lower)) {
      await writeSplitState(user.id, { ...state, setupPending: null })
      return { handled: true, reply: `No change. Profile still shows ${intake.current_bodyweight_kg ?? "unknown"}kg.` }
    }
    return { handled: true, reply: `Is ${kg}kg correct? (yes / no, or give the right weight)` }
  }

  if (pending.field === "duplicate_session") {
    const existingId = pending.value!
    if (/\b(add|more|adding|append|continue)\b/i.test(lower)) {
      const session = await prisma.telegramWorkoutSession.findUnique({
        where: { id: existingId },
        select: { id: true, musclesTrained: true, splitDayIndex: true },
      })
      if (!session) {
        await writeSplitState(user.id, { ...state, setupPending: null })
        return { handled: true, reply: "Session not found. Use /log to start fresh." }
      }
      const muscles = session.musclesTrained[0] ?? "Full Body"
      const newAl: ActiveLogging = {
        sessionId:               existingId,
        splitDayIndex:           session.splitDayIndex ?? 0,
        muscles,
        startedAt:               new Date().toISOString(),
        logMode:                 "quick",
        logState:                "awaiting_exercises",
        parsedEntries:           [],
        pendingWeightFor:        [],
        lastActivityAt:          new Date().toISOString(),
        pendingSuspectExercise:  null,
        conflictEntries:         [],
        conflictDetectedMuscles: "",
        noSplitAdvance:          true,
      }
      await writeSplitState(user.id, { ...state, setupPending: null, activeLogging: newAl })
      const exData = await getExercisesForToday(user.id, muscles)
      return { handled: true, reply: `Adding to your earlier session.\n\n${formatQuickLogOpening(muscles, exData)}` }
    }
    if (/\b(different|new|another|second|separate)\b/i.test(lower)) {
      await writeSplitState(user.id, { ...state, setupPending: null })
      return { handled: true, reply: await handleLogCommandForce(user, state, new Date()) }
    }
    return { handled: true, reply: "Adding sets to your earlier session, or starting a separate one?" }
  }

  return NOT_HANDLED
}

async function handleSkipReason(
  user: UserRow, state: SplitState, text: string, now: Date
): Promise<{ handled: boolean; reply: string }> {
  const lower = text.trim().toLowerCase()
  const today = now.toISOString().slice(0, 10)

  // Calculate next training day label
  const intake  = parseIntake(user.intakeAnswers)
  const dayList = getTrainingDays(intake.current_split ?? "unstructured", parseInt(intake.available_training_days ?? "3") || 3)
  const nextIdx = getNextDayIndex(state, dayList.length)
  const nextMus = dayList[nextIdx] ?? "Full Body"

  const clearSkip = async () => writeSplitState(user.id, { ...state, skipState: null, lastSkipDate: today })

  if (/\b(injury|injured|hurt|pain|torn|strain)\b/i.test(lower)) {
    await clearSkip()
    return { handled: true, reply: `What's the issue? I'll adjust the split around it.` }
  }
  if (/\b(sick|ill|fever|cold|flu|unwell|not well)\b/i.test(lower)) {
    await clearSkip()
    return { handled: true, reply: `Rest. Don't train sick — it makes it worse.\nBack when you feel human.` }
  }
  if (/\b(life|work|busy|travel|family|meeting|couldn.?t|other|stuff)\b/i.test(lower)) {
    await clearSkip()
    return { handled: true, reply: `Fine. Back on ${nextMus} day. Don't let it slide again.` }
  }
  if (/\b(skip|rest|just skip|no reason|pass)\b/i.test(lower) || lower.length < 6) {
    // Check grace rule
    const lastSkip = state.lastSkipDate
    const withinWeek = lastSkip &&
      (new Date(today).getTime() - new Date(lastSkip).getTime()) < 7 * 86_400_000
    await clearSkip()
    if (withinWeek) {
      const streak = user.gymStreak ?? 0
      if (streak > 0) {
        await prisma.messengerUser.update({ where: { id: user.id }, data: { gymStreak: 0 } })
      }
      return {
        handled: true,
        reply:   `Fine. ${nextMus} is next. Don't skip that one.\n\nStreak reset — two skips in one week.`,
      }
    }
    return { handled: true, reply: `Fine. ${nextMus} is next. Don't skip that one.` }
  }
  // Unrecognised reason — treat as generic
  await clearSkip()
  return { handled: true, reply: `Got it. ${nextMus} is next. Don't let it slide.` }
}

export async function incrementReactivationCount(platformChatId: string): Promise<void> {
  const user = await getUser(platformChatId)
  if (!user) return
  const state = parseSplitState(user.splitState)
  await writeSplitState(user.id, { ...state, reactivationCount: (state.reactivationCount ?? 0) + 1 })
}

// ─── Force create session (bypassing duplicate check) ─────────────────────────
async function handleLogCommandForce(user: UserRow, state: SplitState, now: Date): Promise<string> {
  const intake    = parseIntake(user.intakeAnswers)
  const split     = intake.current_split ?? "unstructured"
  const days      = parseInt(intake.available_training_days ?? "3") || 3
  const dayList   = getTrainingDays(split, days)
  const nextIdx   = state.pendingLog?.splitDayIndex ?? getNextDayIndex(state, dayList.length)
  const muscles   = state.pendingLog?.muscles ?? (dayList[nextIdx] ?? "Full Body")
  const session = await prisma.telegramWorkoutSession.create({
    data: { messengerUserId: user.id, date: now, splitDayIndex: nextIdx, musclesTrained: [muscles], completed: false },
  })

  const newAl: ActiveLogging = {
    sessionId:               session.id,
    splitDayIndex:           nextIdx,
    muscles,
    startedAt:               now.toISOString(),
    logMode:                 "quick",
    logState:                "awaiting_exercises",
    parsedEntries:           [],
    pendingWeightFor:        [],
    lastActivityAt:          now.toISOString(),
    pendingSuspectExercise:  null,
    conflictEntries:         [],
    conflictDetectedMuscles: "",
    noSplitAdvance:          false,
  }

  await writeSplitState(user.id, { ...state, pendingLog: null, setupPending: null, activeLogging: newAl })

  const exData = await getExercisesForToday(user.id, muscles)
  return [`Logging Day ${nextIdx + 1} — ${muscles}.`, "", formatQuickLogOpening(muscles, exData)].join("\n")
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

export async function handleWorkoutCommand(
  platformChatId: string,
  text:           string
): Promise<{ handled: boolean; reply: string; intent?: string }> {
  const lower = text.trim().toLowerCase()

  if (lower === "/setup" || lower.startsWith("/setup ")) {
    return { ...(await handleSetupCommand(platformChatId, text)), intent: "setup_update" }
  }

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

  // ── NL: "can't train today" / skip ────────────────────────────────────────
  if (/\b(can.?t (?:train|go to(?: the)? gym|work ?out)|not (?:going|training|working out) today|skipping (?:today|gym|training)|rest day today|missing (?:gym|training|session) today|too (?:tired|sick|busy) to (?:go|train)|won.?t (?:make it|train) today)\b/i.test(text)) {
    const user = await getUser(platformChatId)
    if (user) {
      const state  = parseSplitState(user.splitState)
      const intake = parseIntake(user.intakeAnswers)
      const dl     = getTrainingDays(intake.current_split ?? "unstructured", parseInt(intake.available_training_days ?? "3") || 3)
      const nxt    = getNextDayIndex(state, dl.length)
      await writeSplitState(user.id, { ...state, skipState: { pendingReason: true, muscles: dl[nxt] ?? "Full Body" } })
      return { handled: true, reply: "Noted. Reason?\nskip / injury / sick / life", intent: "skip_day" }
    }
  }

  // ── NL: gym time change ────────────────────────────────────────────────────
  const detectedTime = detectGymTimeChange(text)
  if (detectedTime) {
    const user = await getUser(platformChatId)
    if (user) {
      const intake = parseIntake(user.intakeAnswers)
      await prisma.messengerUser.update({ where: { id: user.id }, data: { preferredCheckInTime: detectedTime } })
      await writeIntakeAnswers(user.id, { ...intake, preferred_gym_time: detectedTime })
      const preTime = addMinutesToTimeStr(detectedTime, -30)
      return {
        handled: true,
        reply:   `Done. Gym time moved to ${formatTime12h(detectedTime)}.\nPre-session message shifts to ${formatTime12h(preTime)} from tomorrow.`,
        intent:  "setup_update",
      }
    }
  }

  return NOT_HANDLED
}

async function prCommand(platformChatId: string): Promise<string> {
  const user = await getUser(platformChatId)
  if (!user) return "No profile found."

  const records = parsePersonalRecords(user.personalRecords)
  if (!Object.keys(records).length) {
    return "No PRs yet.\nLog a session and I'll track from there."
  }

  const lines = Object.entries(records)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ex, r]) => `${ex}: ${r.weightKg}kg × ${r.reps} (${r.date})`)

  return `Your records:\n${lines.join("\n")}`
}

async function progressCommand(platformChatId: string, exercise: string | null): Promise<string> {
  const user = await getUser(platformChatId)
  if (!user) return "No profile found."

  if (!exercise) {
    const keys = Object.keys(parsePersonalRecords(user.personalRecords))
    if (!keys.length) {
      return "No logged exercises yet.\nUse /progress bench, /progress squat, etc. after logging."
    }
    return `Use /progress [exercise]. Tracked: ${keys.join(", ")}`
  }

  const sets = await prisma.telegramSetLog.findMany({
    where:   { exerciseName: { contains: exercise, mode: "insensitive" }, session: { messengerUserId: user.id, completed: true } },
    orderBy: { id: "desc" },
    take:    48,
    select:  { weightKg: true, sessionId: true },
  })
  if (!sets.length) {
    return `No ${exercise} logged yet.\nLog it in your next session and I'll track it.`
  }

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
  if (!sessions.length) {
    return "No sessions logged yet.\nI'll prompt you after your first session."
  }

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
  if (!last) return "No sessions logged yet.\nUse /log to start."

  const state    = parseSplitState(user.splitState)
  const overloads = await computeProgressiveOverloadForSession(user.id, last.id, state.lastFeelRating)
  if (!overloads.length) return "Not enough data to compute targets yet."

  // Phase 1: just return the note directly
  if (overloads[0]?.flag === "phase1") return overloads[0].note

  const lines = overloads.map(o => {
    const arrow = o.flag === "increase" ? `↑ ${o.nextWeightKg}kg` : `→ ${o.nextWeightKg}kg`
    return `${o.exercise}: ${arrow} — ${o.note}`
  })

  return `Next session targets (${last.musclesTrained[0] ?? "session"}):\n${lines.join("\n")}`
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
    return `${marker} Day ${i + 1}: ${muscles}`.trim()
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


// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES + DB HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function migrateActiveLogging(raw: Partial<ActiveLogging> & Record<string, unknown>): ActiveLogging {
  const knownStates: ActiveLogging["logState"][] = [
    "awaiting_exercises", "awaiting_weights", "awaiting_sets_reps", "confirming", "weight_review", "muscle_conflict",
  ]
  const rawState = raw.logState as string | undefined
  const logState: ActiveLogging["logState"] = knownStates.includes(rawState as ActiveLogging["logState"])
    ? (rawState as ActiveLogging["logState"])
    : "awaiting_exercises"

  return {
    sessionId:              raw.sessionId              ?? "",
    splitDayIndex:          raw.splitDayIndex          ?? 0,
    muscles:                raw.muscles                ?? "Full Body",
    startedAt:              raw.startedAt              ?? new Date().toISOString(),
    logMode:                "quick",
    logState,
    parsedEntries:          Array.isArray(raw.parsedEntries) ? raw.parsedEntries : [],
    pendingWeightFor:       Array.isArray(raw.pendingWeightFor) ? raw.pendingWeightFor : [],
    lastActivityAt:         raw.lastActivityAt         ?? raw.startedAt ?? new Date().toISOString(),
    pendingSuspectExercise: raw.pendingSuspectExercise  ?? null,
    conflictEntries:        Array.isArray(raw.conflictEntries) ? raw.conflictEntries : [],
    conflictDetectedMuscles: raw.conflictDetectedMuscles ?? "",
    noSplitAdvance:         raw.noSplitAdvance         ?? false,
  }
}

function primaryLiftFromMuscles(muscles: string): string {
  const m = muscles.toLowerCase()
  if (m.includes("chest") || m.includes("push"))  return "bench"
  if (m.includes("leg")   || m.includes("lower")) return "squat"
  if (m.includes("back")  || m.includes("pull"))  return "deadlift"
  return "squat"
}

function buildSessionSummary(sets: Array<{ exerciseName: string; reps: number; weightKg: number }>): string {
  if (!sets.length) return ""
  const grouped: Record<string, Array<{ reps: number; weightKg: number }>> = {}
  for (const s of sets) {
    grouped[s.exerciseName] ??= []
    grouped[s.exerciseName]!.push(s)
  }
  return Object.entries(grouped)
    .map(([ex, exSets]) => {
      const maxW    = Math.max(...exSets.map(s => s.weightKg))
      const maxReps = exSets.find(s => s.weightKg === maxW)?.reps ?? exSets[0]!.reps
      return `${ex} ${maxW}kg×${maxReps}`
    })
    .join(", ")
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
    select: { id: true, gymStreak: true, splitState: true, personalRecords: true, intakeAnswers: true, preferredCheckInTime: true },
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
  const FEEL_RATINGS = new Set(["easy", "moderate", "hard", "failed"])

  const def: SplitState = {
    lastCompletedDayIndex: null, lastSessionDate: null, cycleNumber: 0,
    daysTrained: [], activeLogging: null, pendingLog: null,
    avgSessionDurationMin: 60,
    milestonesFired: [], firstExerciseWeights: {}, firstLogDate: null,
    setupPending: null, skipState: null, lastSkipDate: null, reactivationCount: 0,
    lastFeelRating: null, feelPending: null,
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return def
  const s = raw as Record<string, unknown>
  return {
    lastCompletedDayIndex: typeof s.lastCompletedDayIndex === "number" ? s.lastCompletedDayIndex : null,
    lastSessionDate:       typeof s.lastSessionDate === "string" ? s.lastSessionDate : null,
    cycleNumber:           typeof s.cycleNumber === "number" ? s.cycleNumber : 0,
    daysTrained:           Array.isArray(s.daysTrained) ? (s.daysTrained as number[]) : [],
    activeLogging:         s.activeLogging && typeof s.activeLogging === "object" ? migrateActiveLogging(s.activeLogging as Partial<ActiveLogging>) : null,
    pendingLog:            s.pendingLog && typeof s.pendingLog === "object" ? (s.pendingLog as PendingLog) : null,
    avgSessionDurationMin: typeof s.avgSessionDurationMin === "number" ? s.avgSessionDurationMin : 60,
    milestonesFired:       Array.isArray(s.milestonesFired) ? (s.milestonesFired as number[]) : [],
    firstExerciseWeights:  (s.firstExerciseWeights && typeof s.firstExerciseWeights === "object" && !Array.isArray(s.firstExerciseWeights))
      ? (s.firstExerciseWeights as Record<string, number>) : {},
    firstLogDate:          typeof s.firstLogDate === "string" ? s.firstLogDate : null,
    setupPending:          (s.setupPending && typeof s.setupPending === "object") ? (s.setupPending as SetupPending) : null,
    skipState:             (s.skipState && typeof s.skipState === "object") ? (s.skipState as SkipState) : null,
    lastSkipDate:          typeof s.lastSkipDate === "string" ? s.lastSkipDate : null,
    reactivationCount:     typeof s.reactivationCount === "number" ? s.reactivationCount : 0,
    lastFeelRating:        FEEL_RATINGS.has(s.lastFeelRating as string) ? (s.lastFeelRating as FeelRating) : null,
    feelPending:           (s.feelPending && typeof s.feelPending === "object") ? (s.feelPending as { sessionId: string; muscles: string }) : null,
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
