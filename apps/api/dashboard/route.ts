import { NextResponse } from "next/server"
import { prisma } from "@repo/db/client"
import { getSession } from "../lib/auth/session"

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type GymData = {
  streak:            number
  sessionsThisWeek:  number
  plannedThisWeek:   number
  consistencyScore:  number
  volumeThisWeekKg:  number
  splitType:         string
  daysPerWeek:       number
  splitDays: Array<{
    dayName:     string   // Mon / Tue / ...
    muscles:     string   // "Chest / Triceps" | "Rest"
    isRest:      boolean
    isToday:     boolean
    isCompleted: boolean
  }>
  todayMuscles:    string | null
  gymTimeStr:      string | null
  minutesUntilGym: number | null
  nextSessionMuscles: string
  nextSessionTargets: Array<{
    exercise:     string
    nextWeightKg: number
    reps:         number
    flag:         "increase" | "maintain" | "technique_check" | "rep_increase" | null
    note:         string
  }>
  mainLifts: Array<{
    exercise:  string
    currentKg: number
    deltaKg:   number
    isPR:      boolean
    trend:     number[]
  }>
  flags:               string[]
  interventionMessage: string | null
  weeklyVolume: Array<{
    muscle: string
    sets:   number
    target: number
  }>
  heatmap: Array<{
    date:    string
    trained: boolean
    rpe:     number | null
  }>
  avgRpe:           number | null
  rpeDescription:   string
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function computeStreak(logs: Array<{ date: Date; completed: boolean }>) {
  if (!logs.length) return { current: 0, best: 0, broken: false }
  const completedDates = [...new Set(
    logs.filter((l) => l.completed).map((l) => toDateStr(l.date))
  )].sort((a, b) => b.localeCompare(a))
  if (!completedDates.length) return { current: 0, best: 0, broken: false }
  const today = toDateStr(new Date())
  const yesterday = toDateStr(new Date(Date.now() - 86400000))
  const mostRecent = completedDates[0]
  if (mostRecent !== today && mostRecent !== yesterday) {
    return { current: 0, best: completedDates.length, broken: true }
  }
  let current = 0
  for (let i = 0; i < completedDates.length; i++) {
    const expected = new Date(mostRecent!)
    expected.setDate(expected.getDate() - i)
    if (completedDates[i] === toDateStr(expected)) current++
    else break
  }
  return { current, best: Math.max(current, completedDates.length), broken: false }
}

function moodFromLog(entry: { moodTag: string | null; morningScore: number | null }): string {
  if (entry.moodTag) return entry.moodTag
  const s = entry.morningScore
  if (s === null) return "no_data"
  if (s >= 8) return "motivated"
  if (s >= 6) return "neutral"
  if (s >= 4) return "calm"
  return "stressed"
}

function getTrainingDays(split: string, daysPerWeek: number): string[] {
  if (split === "PPL") {
    const base = ["Chest + Triceps + Shoulders", "Back + Biceps", "Legs"]
    return daysPerWeek >= 6 ? [...base, ...base] : base
  }
  if (split === "upper_lower") return [
    "Upper Body", "Lower Body", "Upper Body", "Lower Body",
  ]
  if (split === "full_body") return ["Full Body", "Full Body", "Full Body"]
  if (split === "bro_split") return ["Chest", "Back", "Legs", "Shoulders", "Arms"]
  const n = Math.min(Math.max(daysPerWeek, 2), 6)
  return Array<string>(n).fill("Full Body")
}

const MUSCLE_EXERCISES: Record<string, string[]> = {
  "Chest + Triceps + Shoulders": ["Bench Press", "Overhead Press", "Incline DB Press", "Tricep Dips"],
  "Back + Biceps":               ["Barbell Row",  "Pull-up",       "Lat Pulldown",     "Barbell Curl"],
  "Legs":                        ["Squat",        "Romanian Deadlift", "Leg Press",    "Hip Thrust"],
  "Upper Body":                  ["Bench Press",  "Barbell Row",   "Overhead Press",   "Pull-up"],
  "Lower Body":                  ["Squat",        "Romanian Deadlift", "Leg Press",    "Lunges"],
  "Full Body":                   ["Squat",        "Bench Press",   "Barbell Row",      "Romanian Deadlift"],
  "Chest":                       ["Bench Press",  "Incline DB Press","Cable Flyes",    "Dips"],
  "Back":                        ["Barbell Row",  "Pull-up",       "Lat Pulldown",     "Seated Cable Row"],
  "Shoulders":                   ["Overhead Press","Lateral Raises","Face Pulls",      "Arnold Press"],
  "Arms":                        ["Barbell Curl", "Tricep Pushdown","Hammer Curl",     "Close-Grip Bench"],
}

function shortMuscle(m: string): string {
  // "Chest + Triceps + Shoulders" → "Chest / Triceps"
  // "Back + Biceps" → "Back / Bi"
  // etc.
  const parts = m.split("+").map(p => p.trim()).slice(0, 2)
  return parts.join(" / ").replace("Biceps", "Bi").replace("Triceps", "Tri")
}

// Training day distribution across Mon-Sun (0=Mon … 6=Sun)
function trainingDaySlots(daysPerWeek: number): number[] {
  const patterns: Record<number, number[]> = {
    2: [0, 3],       // Mon, Thu
    3: [0, 2, 4],    // Mon, Wed, Fri
    4: [0, 1, 3, 4], // Mon, Tue, Thu, Fri
    5: [0, 1, 2, 3, 4],
    6: [0, 1, 2, 3, 4, 5],
    7: [0, 1, 2, 3, 4, 5, 6],
  }
  return patterns[Math.min(Math.max(daysPerWeek, 2), 7)] ?? [0, 2, 4]
}

function minutesBetween(currentHHMM: string, targetHHMM: string): number {
  const [ch, cm] = currentHHMM.split(":").map(Number)
  const [th, tm] = targetHHMM.split(":").map(Number)
  return (th! * 60 + tm!) - (ch! * 60 + cm!)
}

// ═══════════════════════════════════════════════════════════════════════════════
// GYM DATA COMPUTATION
// ═══════════════════════════════════════════════════════════════════════════════

type Session = {
  id: string
  date: Date
  completed: boolean
  musclesTrained: string[]
  sets: Array<{ exerciseName: string; weightKg: number; reps: number; rpe: number | null }>
}

async function computeGymData(
  messengerId: string,
  intake:   Record<string, string>,
  splitStateRaw: unknown,
  personalRecordsRaw: unknown,
  gymStreak: number,
  preferredCheckInTime: string | null,
  timezone: string | null,
  now: Date,
): Promise<GymData> {
  const daysPerWeek  = parseInt(intake.available_training_days ?? "3") || 3
  const split        = intake.current_split ?? "unstructured"
  const dayList      = getTrainingDays(split, daysPerWeek)
  const gymGoal      = (intake.gym_goal ?? "").toLowerCase()
  const methodology  = gymGoal.includes("strength") ? "strength" : "hypertrophy"
  const volumeTarget = methodology === "strength" ? 12 : 14

  const ss = (splitStateRaw && typeof splitStateRaw === "object" && !Array.isArray(splitStateRaw))
    ? (splitStateRaw as Record<string, unknown>)
    : {}
  const lastDayIdx = typeof ss.lastCompletedDayIndex === "number" ? ss.lastCompletedDayIndex : null
  const nextDayIdx = lastDayIdx === null ? 0 : (lastDayIdx + 1) % dayList.length
  const nextMuscles = dayList[nextDayIdx] ?? "Full Body"

  const prs = (personalRecordsRaw && typeof personalRecordsRaw === "object" && !Array.isArray(personalRecordsRaw))
    ? (personalRecordsRaw as Record<string, { weightKg: number; sessionId: string; date: string }>)
    : {}

  // Fetch sessions + sets for 84 days
  const since84 = new Date(now.getTime() - 84 * 86_400_000)
  const sessions: Session[] = await prisma.telegramWorkoutSession.findMany({
    where:   { messengerUserId: messengerId, date: { gte: since84 } },
    orderBy: { date: "asc" },
    select:  {
      id: true, date: true, completed: true, musclesTrained: true,
      sets: { select: { exerciseName: true, weightKg: true, reps: true, rpe: true } },
    },
  }) as Session[]

  const completedSessions = sessions.filter(s => s.completed)

  // Monday of this week (UTC)
  const todayNum   = now.getUTCDay() // 0=Sun
  const daysToMon  = todayNum === 0 ? 6 : todayNum - 1
  const monday     = new Date(now)
  monday.setUTCDate(monday.getUTCDate() - daysToMon)
  monday.setUTCHours(0, 0, 0, 0)
  const todayISO   = toDateStr(now)

  const thisWeekSessions = completedSessions.filter(s => new Date(s.date) >= monday)
  const sessionsThisWeek = thisWeekSessions.length
  const trainingSlots    = trainingDaySlots(daysPerWeek)
  const plannedThisWeek  = trainingSlots.length

  // Consistency (last 28 days)
  const since28    = new Date(now.getTime() - 28 * 86_400_000)
  const last28     = completedSessions.filter(s => new Date(s.date) >= since28)
  const planned28  = daysPerWeek * 4
  const consistencyScore = Math.min(100, Math.round((last28.length / planned28) * 100))

  // Volume this week
  const weekSetAll = thisWeekSessions.flatMap(s => s.sets)
  const volumeThisWeekKg = Math.round(weekSetAll.reduce((acc, s) => acc + s.weightKg * s.reps, 0))

  // ─── Split days Mon-Sun ───────────────────────────────────────────────────────
  const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  const weekSessionsByDate = new Map(
    thisWeekSessions.map(s => [toDateStr(s.date), s.musclesTrained[0] ?? "Session"])
  )

  // Determine which split day index maps to each training slot
  // Starting from lastDayIdx+1 (or 0), cycle through dayList for each training slot
  const splitDays = DAY_NAMES.map((dayName, i) => {
    const d = new Date(monday)
    d.setUTCDate(d.getUTCDate() + i)
    const dateStr   = toDateStr(d)
    const isToday   = dateStr === todayISO
    const session   = weekSessionsByDate.get(dateStr)
    const isTrain   = trainingSlots.includes(i)
    const slotIdx   = trainingSlots.indexOf(i)
    const splitIdx  = isTrain ? (nextDayIdx + slotIdx) % dayList.length : -1
    const muscles   = session ?? (isTrain ? (dayList[splitIdx] ?? "Session") : null)
    return {
      dayName,
      muscles:     muscles ? shortMuscle(muscles) : "Rest",
      isRest:      !muscles,
      isToday,
      isCompleted: !!session,
    }
  })

  // ─── Today / gym time ─────────────────────────────────────────────────────────
  const todayEntry = splitDays[daysToMon]
  const todayMuscles = todayEntry && !todayEntry.isRest ? todayEntry.muscles : null
  let gymTimeStr:      string | null = null
  let minutesUntilGym: number | null = null

  if (preferredCheckInTime && todayMuscles) {
    gymTimeStr = preferredCheckInTime.padStart(5, "0") // ensure HH:MM
    const nowHHMM = `${String(now.getUTCHours()).padStart(2,"0")}:${String(now.getUTCMinutes()).padStart(2,"0")}`
    minutesUntilGym = minutesBetween(nowHHMM, gymTimeStr)
  }

  // ─── Next session targets ─────────────────────────────────────────────────────
  const exercises = MUSCLE_EXERCISES[nextMuscles] ?? ["Squat", "Bench Press", "Barbell Row", "Romanian Deadlift"]

  const nextSessionTargets = await Promise.all(exercises.map(async (exercise) => {
    // Get last 3 sessions' sets for this exercise
    const exSets = completedSessions.flatMap(s =>
      s.sets.filter(st => st.exerciseName.toLowerCase() === exercise.toLowerCase())
           .map(st => ({ ...st, sessionId: s.id }))
    )
    if (!exSets.length) {
      return { exercise, nextWeightKg: 0, reps: 8, flag: null as any, note: "First time — choose a starting weight." }
    }

    // Group by session (keep last 3)
    const bySession = new Map<string, typeof exSets>()
    for (const s of exSets) {
      if (!bySession.has(s.sessionId)) bySession.set(s.sessionId, [])
      bySession.get(s.sessionId)!.push(s)
    }
    const sessArr = [...bySession.values()].slice(-3)
    const last    = sessArr.at(-1)!
    const maxW    = Math.max(...last.map(s => s.weightKg))
    const lastReps = last.find(s => s.weightKg === maxW)?.reps ?? 8
    const rpeVals = last.filter(s => s.rpe != null).map(s => s.rpe as number)
    const avgRpe  = rpeVals.length ? rpeVals.reduce((a, b) => a + b, 0) / rpeVals.length : 7

    const stalled = sessArr.length >= 3 &&
      sessArr.every(sess => Math.max(...sess.map(s => s.weightKg)) === maxW)

    if (stalled) {
      return { exercise, nextWeightKg: maxW, reps: lastReps + 1, flag: "rep_increase" as const, note: `Stalled at ${maxW}kg. Add a rep.` }
    }
    if (avgRpe >= 10) {
      return { exercise, nextWeightKg: maxW, reps: lastReps, flag: "technique_check" as const, note: `Hold ${maxW}kg. Fix form first.` }
    }
    if (avgRpe >= 9) {
      return { exercise, nextWeightKg: maxW, reps: lastReps, flag: "maintain" as const, note: `Hold ${maxW}kg — hit the reps cleaner.` }
    }
    return { exercise, nextWeightKg: maxW + 2.5, reps: lastReps, flag: "increase" as const, note: `${maxW}kg felt ok. Push to ${maxW + 2.5}kg.` }
  }))

  // ─── Main lifts (Squat / Bench / Deadlift / OHP) ─────────────────────────────
  const MAIN_LIFTS = [
    { label: "Squat",    keywords: ["squat"] },
    { label: "Bench",    keywords: ["bench"] },
    { label: "Deadlift", keywords: ["deadlift"] },
    { label: "OHP",      keywords: ["overhead", "ohp", "military"] },
  ]

  const mainLifts = MAIN_LIFTS.map(({ label, keywords }) => {
    const liftSets = completedSessions.flatMap(s =>
      s.sets
        .filter(st => keywords.some(k => st.exerciseName.toLowerCase().includes(k)))
        .map(st => ({ ...st, sessionId: s.id }))
    )
    if (!liftSets.length) return null

    const bySession = new Map<string, typeof liftSets>()
    for (const s of liftSets) {
      if (!bySession.has(s.sessionId)) bySession.set(s.sessionId, [])
      bySession.get(s.sessionId)!.push(s)
    }
    const sessArr  = [...bySession.values()].slice(-5)
    const weights  = sessArr.map(sess => +Math.max(...sess.map(s => s.weightKg)).toFixed(1))
    const currentKg = weights.at(-1) ?? 0
    const firstKg   = weights[0] ?? currentKg
    const deltaKg   = +(currentKg - firstKg).toFixed(1)

    // Check if current weight matches PR
    const prKey = Object.keys(prs).find(k => keywords.some(kw => k.toLowerCase().includes(kw)))
    const isPR  = prKey ? prs[prKey]!.weightKg === currentKg : false

    return { exercise: label, currentKg, deltaKg, isPR, trend: weights }
  }).filter((l): l is NonNullable<typeof l> => l !== null && l.currentKg > 0)

  // ─── Flags (simple inline computation) ────────────────────────────────────────
  const flags: string[] = []
  let interventionMessage: string | null = null

  // Stall detection on main lifts
  for (const lift of mainLifts) {
    if (lift.trend.length >= 3 && lift.trend.slice(-3).every(w => w === lift.trend.at(-1))) {
      flags.push(`STALL: ${lift.exercise.toLowerCase()}`)
      if (!interventionMessage) {
        interventionMessage = `${lift.exercise} has been ${lift.currentKg}kg for 3 sessions. Same weight, add a rep. Reset the pattern.`
      }
    }
    if (lift.trend.length >= 3) {
      const last3 = lift.trend.slice(-3) as [number, number, number]
      if (last3[2] < last3[1] && last3[1] < last3[0]) {
        flags.push(`REGRESSION: ${lift.exercise.toLowerCase()}`)
        if (!interventionMessage) {
          interventionMessage = `${lift.exercise} dropped twice in a row. Sleep and food this week, 1-10?`
        }
      }
    }
  }

  // Consistency
  if (consistencyScore < 60 && last28.length >= 4) {
    flags.push("LOW_CONSISTENCY")
    if (!interventionMessage) {
      interventionMessage = `${consistencyScore}% of planned sessions in 4 weeks. That's not a schedule problem. What's actually going on?`
    }
  }

  // Streak milestone
  if (gymStreak >= 7) {
    flags.push(`STREAK: ${gymStreak} days 🔥`)
  }

  // RPE trend
  const recentRpeSets = completedSessions.slice(-5).flatMap(s => s.sets.filter(st => st.rpe != null).map(st => st.rpe as number))
  const avgRpe = recentRpeSets.length
    ? +(recentRpeSets.reduce((a, b) => a + b, 0) / recentRpeSets.length).toFixed(1)
    : null

  if (avgRpe !== null && avgRpe > 8.5) {
    flags.push("OVERREACHING")
    if (!interventionMessage) {
      interventionMessage = "Your RPE has been 9-10 every session. Cut weights 15% today. Not optional."
    }
  }

  const rpeDescription =
    avgRpe === null              ? "no RPE data yet"
    : avgRpe > 8.5              ? "overreaching — take it down"
    : avgRpe < 6                ? "undertraining — push harder"
    : avgRpe >= 7 && avgRpe <= 8.5 ? "optimal zone"
    : "acceptable"

  // Positive flags
  if (gymStreak > 0 && flags.filter(f => f.startsWith("STALL") || f.startsWith("REGRESSION")).length === 0) {
    const progressing = mainLifts.filter(l => l.deltaKg > 0)
    if (progressing.length > 0) {
      const best = progressing.sort((a, b) => b.deltaKg - a.deltaKg)[0]!
      flags.push(`PROGRESSING: ${best.exercise} +${best.deltaKg}kg`)
    }
  }
  if (gymStreak >= 7 && !interventionMessage) {
    flags.push(`${gymStreak}-day streak. Don't break it today.`)
  }

  // ─── Weekly volume by muscle ──────────────────────────────────────────────────
  const muscleSetMap: Record<string, number> = {}
  for (const s of thisWeekSessions) {
    const muscle = s.musclesTrained[0] ?? "Unknown"
    muscleSetMap[muscle] = (muscleSetMap[muscle] ?? 0) + s.sets.length
  }
  const weeklyVolume = Object.entries(muscleSetMap).map(([muscle, sets]) => ({
    muscle: shortMuscle(muscle),
    sets,
    target: volumeTarget,
  })).sort((a, b) => b.sets - a.sets)

  // ─── 12-week heatmap ──────────────────────────────────────────────────────────
  const dateSessionMap = new Map(completedSessions.map(s => {
    const rpes = s.sets.filter(st => st.rpe != null).map(st => st.rpe as number)
    const rpe  = rpes.length ? +(rpes.reduce((a, b) => a + b, 0) / rpes.length).toFixed(1) : null
    return [toDateStr(s.date), { trained: true, rpe }]
  }))

  const heatmap = Array.from({ length: 84 }, (_, i) => {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() - (83 - i))
    const dateStr = toDateStr(d)
    const entry   = dateSessionMap.get(dateStr)
    return { date: dateStr, trained: !!entry, rpe: entry?.rpe ?? null }
  })

  return {
    streak: gymStreak,
    sessionsThisWeek,
    plannedThisWeek,
    consistencyScore,
    volumeThisWeekKg,
    splitType: split,
    daysPerWeek,
    splitDays,
    todayMuscles,
    gymTimeStr,
    minutesUntilGym,
    nextSessionMuscles: shortMuscle(nextMuscles),
    nextSessionTargets: nextSessionTargets.filter(t => t.nextWeightKg > 0),
    mainLifts,
    flags,
    interventionMessage,
    weeklyVolume,
    heatmap,
    avgRpe,
    rpeDescription,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/dashboard
// ═══════════════════════════════════════════════════════════════════════════════

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  const userId       = session.userId
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000)
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000)

  try {
    const [user, profile, energyLogs, workoutLogs] = await Promise.all([
      prisma.user.findUnique({
        where:  { id: userId },
        select: { id: true, name: true, email: true, image: true },
      }),
      prisma.userProfile.findUnique({ where: { userId } }),
      prisma.energyLog.findMany({
        where:   { userId, date: { gte: sevenDaysAgo } },
        orderBy: { date: "desc" },
        take:    7,
        select:  { date: true, moodTag: true, morningScore: true },
      }),
      prisma.workoutLog.findMany({
        where:   { userId, date: { gte: sixtyDaysAgo } },
        orderBy: { date: "desc" },
        select:  { date: true, completed: true },
      }),
    ])

    if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const streak = computeStreak(workoutLogs)
    const moodMap = new Map(energyLogs.map((l) => [toDateStr(l.date), moodFromLog(l)]))
    const mood = Array.from({ length: 7 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - i))
      const dateStr = toDateStr(d)
      return { date: dateStr, mood: moodMap.get(dateStr) ?? "no_data" }
    })

    let deadlines:   Array<{ id: string; title: string; dueAt: string }> = []
    let lastMessage: { text: string; timestamp: string } | null = null
    let activePlan:  { id: string; content: string } | null = null
    let gymData:     GymData | null = null

    if (profile?.telegramChatId) {
      const messenger = await prisma.messengerUser.findUnique({
        where: { platform_platformChatId: { platform: "telegram", platformChatId: profile.telegramChatId } },
        select: {
          id:                   true,
          persona:              true,
          gymStreak:            true,
          splitState:           true,
          intakeAnswers:        true,
          personalRecords:      true,
          timezone:             true,
          preferredCheckInTime: true,
          deadlines: {
            where:   { status: "active", dueAt: { gte: new Date() } },
            orderBy: { dueAt: "asc" },
            take:    5,
            select:  { id: true, title: true, dueAt: true },
          },
          messages: {
            where:   { role: "assistant" },
            orderBy: { createdAt: "desc" },
            take:    1,
            select:  { text: true, createdAt: true },
          },
          plans: {
            where:   { status: "active" },
            orderBy: { createdAt: "desc" },
            take:    1,
            select:  { id: true, content: true },
          },
        },
      })

      if (messenger) {
        deadlines = messenger.deadlines.map((d) => ({ id: d.id, title: d.title, dueAt: d.dueAt.toISOString() }))
        if (messenger.messages[0]) {
          lastMessage = { text: messenger.messages[0].text, timestamp: messenger.messages[0].createdAt.toISOString() }
        }
        activePlan = messenger.plans[0] ?? null

        // Gym data — only for Rex users who completed intake
        if (messenger.persona === "rex" && messenger.intakeAnswers) {
          const intake = (messenger.intakeAnswers as Record<string, string>)
          gymData = await computeGymData(
            messenger.id,
            intake,
            messenger.splitState,
            messenger.personalRecords,
            messenger.gymStreak ?? 0,
            messenger.preferredCheckInTime,
            messenger.timezone,
            new Date(),
          ).catch((err) => {
            console.error("[DASHBOARD] gymData failed:", err)
            return null
          })
        }
      }
    }

    return NextResponse.json({
      user:    { name: user.name, email: user.email, image: user.image },
      profile: profile ? {
        creatureName:         profile.creatureName,
        creatureType:         profile.creatureType,
        creatureColor:        profile.creatureColor,
        primaryPersona:       profile.primaryPersona,
        personaName:          profile.personaName,
        primaryGoal30d:       profile.primaryGoal30d,
        goalCategory:         profile.goalCategory,
        aspirationWords:      profile.aspirationWords,
        onboardingComplete:   profile.onboardingComplete,
        preferredCheckInTime: profile.preferredCheckInTime,
      } : null,
      streak,
      mood,
      planContent:      activePlan?.content ?? null,
      planId:           activePlan?.id ?? null,
      deadlines,
      lastMessage,
      telegramConnected: profile?.telegramConnected ?? false,
      gymData,
    })
  } catch (e) {
    console.error("[DASHBOARD ERROR]", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
