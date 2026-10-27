import { NextResponse }         from "next/server"
import { prisma }               from "@repo/db/client"
import { getSession }           from "../lib/auth/session"
import { getMentorState }       from "@repo/api/engines/user-state-engine"

// ═══════════════════════════════════════════════════════════════════════════════
// JourneyPageData — the user's fitness story.
//
// Narrative page answering: "Damn. I've actually changed."
//
// Sources: MemoryFacts, WorkoutSessions, BodyweightHistory, PersonalRecords,
//          MentorState, Achievements.
// No OpenAI. No dashboard-specific calculations. No buildFitnessSnapshot.
// ═══════════════════════════════════════════════════════════════════════════════

export type TimelineEventType =
  | "joined" | "first_workout" | "pr" | "weight_milestone"
  | "goal_milestone" | "streak_milestone" | "comeback"
  | "plateau_breakthrough" | "achievement"

export type ChapterType =
  | "start" | "consistency" | "strength" | "bulk" | "cut"
  | "comeback" | "recovery" | "maintenance"

export type JourneyPageData = {
  telegramConnected: boolean
  isRexUser:         boolean
  hasAnyData:        boolean

  // S1 — Journey Summary
  summary: {
    daysWithKivo:          number
    sessionsCompleted:     number
    weightChangeTotalKg:   number | null
    strengthChangeSummary: string | null
    longestStreak:         number
    currentStreak:         number
    joinedDate:            string
    latestSessionDate:     string | null
  }

  // S2 — Chronological Timeline
  timeline: {
    date:   string
    type:   TimelineEventType
    title:  string
    detail: string
  }[]

  // S3 — Auto-generated Chapters
  chapters: {
    title:     string
    startDate: string
    endDate:   string
    summary:   string
    type:      ChapterType
  }[]

  // S4 — Biggest Wins
  biggestWins: {
    title:  string
    value:  string
    detail: string
    type:   "pr" | "streak" | "weight" | "consistency" | "volume"
  }[]

  // S5 — Comeback Moments
  comebacks: {
    date:          string
    gapDays:       number
    sessionsAfter: number
    note:          string
  }[]

  // S6 — Breakthroughs
  breakthroughs: {
    date:   string
    type:   "plateau_resolved" | "weight_stall_resolved" | "consistency_jump"
    title:  string
    detail: string
  }[]

  // S7 — Milestone Wall
  milestones: {
    id:      string
    label:   string
    detail:  string
    date:    string | null
    reached: boolean
    type:    "session" | "pr" | "streak" | "weight" | "goal"
  }[]

  // S8 — Year In Review
  yearInReview: {
    thisMonth:   { sessions: number; weightDelta: number | null; topLiftLabel: string | null }
    last3Months: { sessions: number; weightDelta: number | null; topLiftLabel: string | null }
    allTime:     { sessions: number; weightDeltaKg: number | null; longestStreak: number; totalPRs: number }
  }

  // S9 — Ranked Memories
  memories: {
    date:   string
    type:   "achievement" | "goal" | "breakthrough"
    text:   string
    weight: number
  }[]

  // S10 — Kivo Story (deterministic narrative)
  story: { lines: string[] }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function isoDate(d: Date): string { return d.toISOString().slice(0, 10) }
function daysBefore(now: Date, n: number): Date { return new Date(now.getTime() - n * 86_400_000) }

function normalizeExerciseName(name: string): string {
  return name.replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase())
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

// ─────────────────────────────────────────────────────────────────────────────

function detectComebacks(
  sortedCompletedDates: Date[],
): JourneyPageData["comebacks"] {
  const comebacks: JourneyPageData["comebacks"] = []

  for (let i = 1; i < sortedCompletedDates.length; i++) {
    const gap = (sortedCompletedDates[i]!.getTime() - sortedCompletedDates[i - 1]!.getTime()) / 86_400_000
    if (gap >= 14) {
      const returnDate = sortedCompletedDates[i]!
      const endWindow  = new Date(returnDate.getTime() + 30 * 86_400_000)
      const sessionsAfter = sortedCompletedDates.slice(i).filter(d => d < endWindow).length

      comebacks.push({
        date:          isoDate(returnDate),
        gapDays:       Math.round(gap),
        sessionsAfter,
        note: `Returned after ${Math.round(gap)} days away and completed ${sessionsAfter} session${sessionsAfter !== 1 ? "s" : ""} in the following month.`,
      })
    }
  }

  return comebacks.slice(0, 3)
}

// ─────────────────────────────────────────────────────────────────────────────

function detectBreakthroughs(
  prHistory:   Record<string, { date: string; weightKg: number }[]>,
  bodyweights: { recordedAt: Date; weightKg: number }[],
): JourneyPageData["breakthroughs"] {
  const breakthroughs: JourneyPageData["breakthroughs"] = []

  // Plateau resolved: same PR weight 2+ consecutive dates, then a new high
  for (const [exercise, history] of Object.entries(prHistory)) {
    if (history.length < 3) continue
    for (let i = 2; i < history.length; i++) {
      const h0 = history[i - 2]!
      const h1 = history[i - 1]!
      const h2 = history[i]!
      if (h0.weightKg === h1.weightKg && h2.weightKg > h1.weightKg) {
        const lift       = normalizeExerciseName(exercise)
        const increase   = Math.round((h2.weightKg - h1.weightKg) * 10) / 10
        const stallWeeks = Math.max(1, Math.round(
          (new Date(h2.date).getTime() - new Date(h0.date).getTime()) / (7 * 86_400_000),
        ))
        breakthroughs.push({
          date:   h2.date,
          type:   "plateau_resolved",
          title:  `${lift} plateau broken`,
          detail: `Added ${increase}kg after ${stallWeeks} week${stallWeeks !== 1 ? "s" : ""} at the same weight.`,
        })
        break
      }
    }
    if (breakthroughs.length >= 2) break
  }

  // Weight stall resolved: flat 14+ days then moves ≥1kg
  for (let i = 2; i < bodyweights.length; i++) {
    const b0 = bodyweights[i - 2]!
    const b1 = bodyweights[i - 1]!
    const b2 = bodyweights[i]!
    const delta01   = Math.abs(b1.weightKg - b0.weightKg)
    const delta12   = Math.abs(b2.weightKg - b1.weightKg)
    const days01    = (b1.recordedAt.getTime() - b0.recordedAt.getTime()) / 86_400_000
    if (delta01 < 0.5 && days01 >= 14 && delta12 >= 1.0) {
      breakthroughs.push({
        date:   isoDate(b2.recordedAt),
        type:   "weight_stall_resolved",
        title:  "Weight plateau broken",
        detail: `Weight moved ${delta12.toFixed(1)}kg after ${Math.round(days01)} days flat.`,
      })
      break
    }
  }

  return breakthroughs.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5)
}

// ─────────────────────────────────────────────────────────────────────────────

const CHAPTER_TITLES: Record<ChapterType, string> = {
  start:       "Getting Started",
  consistency: "Building Consistency",
  strength:    "Strength Phase",
  bulk:        "Lean Bulk Phase",
  cut:         "Fat Loss Phase",
  comeback:    "Comeback",
  recovery:    "Recovery Period",
  maintenance: "Maintenance",
}

function detectChapters(
  sortedCompletedDates: Date[],
  bodyweights:          { recordedAt: Date; weightKg: number }[],
  joinedDate:           Date,
  now:                  Date,
): JourneyPageData["chapters"] {
  const daysSince = (now.getTime() - joinedDate.getTime()) / 86_400_000
  if (daysSince < 14) return []

  const WINDOW = 30 * 86_400_000
  type Win = { start: Date; end: Date; sessions: number; weightDelta: number | null; afterGap: boolean; type: ChapterType }
  const windows: Win[] = []
  let lastSessionDate: Date | null = null

  for (let t = joinedDate.getTime(); t < now.getTime(); t += WINDOW) {
    const wStart = new Date(t)
    const wEnd   = new Date(Math.min(t + WINDOW, now.getTime()))
    const idx    = windows.length

    const wSessions = sortedCompletedDates.filter(d => d >= wStart && d < wEnd).length
    const wWeights  = bodyweights.filter(b => b.recordedAt >= wStart && b.recordedAt < wEnd)

    let weightDelta: number | null = null
    if (wWeights.length >= 2) {
      weightDelta = Math.round((wWeights[wWeights.length - 1]!.weightKg - wWeights[0]!.weightKg) * 10) / 10
    }

    const firstInWindow = sortedCompletedDates.find(d => d >= wStart && d < wEnd)
    const afterGap = !!(lastSessionDate && firstInWindow &&
      (firstInWindow.getTime() - lastSessionDate.getTime()) / 86_400_000 > 14)

    const lastInWindow = [...sortedCompletedDates].reverse().find(d => d >= wStart && d < wEnd)
    if (lastInWindow) lastSessionDate = lastInWindow

    let type: ChapterType
    if (idx === 0) {
      type = "start"
    } else if (afterGap && wSessions >= 3) {
      type = "comeback"
    } else if (wSessions >= 10 && weightDelta !== null && weightDelta > 0.5) {
      type = "bulk"
    } else if (wSessions >= 10 && weightDelta !== null && weightDelta < -0.5) {
      type = "cut"
    } else if (wSessions >= 10) {
      type = idx <= 1 ? "consistency" : "strength"
    } else if (wSessions < 4 && wSessions > 0) {
      type = "recovery"
    } else if (wSessions === 0) {
      type = "maintenance"
    } else {
      type = "consistency"
    }

    windows.push({ start: wStart, end: wEnd, sessions: wSessions, weightDelta, afterGap, type })
  }

  // Merge adjacent same-type (except comeback stays separate)
  type Merged = { type: ChapterType; start: Date; end: Date; totalSessions: number; weightDelta: number | null }
  const merged: Merged[] = []
  for (const w of windows) {
    const last = merged[merged.length - 1]
    if (last && last.type === w.type && w.type !== "comeback" && w.type !== "start") {
      last.end = w.end
      last.totalSessions += w.sessions
      if (w.weightDelta !== null) {
        last.weightDelta = Math.round(((last.weightDelta ?? 0) + w.weightDelta) * 10) / 10
      }
    } else {
      merged.push({ type: w.type, start: w.start, end: w.end, totalSessions: w.sessions, weightDelta: w.weightDelta })
    }
  }

  return merged.slice(0, 6).map(m => {
    const wdStr = m.weightDelta !== null && Math.abs(m.weightDelta) > 0.5
      ? ` Weight ${m.weightDelta > 0 ? "gained" : "lost"}: ${Math.abs(m.weightDelta).toFixed(1)}kg.`
      : ""
    return {
      title:     CHAPTER_TITLES[m.type],
      startDate: isoDate(m.start),
      endDate:   isoDate(m.end),
      summary:   `${m.totalSessions} session${m.totalSessions !== 1 ? "s" : ""} completed.${wdStr}`,
      type:      m.type,
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────

function buildTimeline(
  sortedCompletedDates: Date[],
  bodyweights:          { recordedAt: Date; weightKg: number }[],
  personalRecords:      Record<string, { weightKg: number; reps: number; date: string }>,
  achievementFacts:     { value: string; updatedAt: Date }[],
  goalFacts:            { value: string; updatedAt: Date }[],
  comebacks:            JourneyPageData["comebacks"],
  breakthroughs:        JourneyPageData["breakthroughs"],
  joinedDate:           Date,
  firstBodyweight:      number | null,
  longestStreak:        number,
): JourneyPageData["timeline"] {
  const events: JourneyPageData["timeline"] = []

  // Joined
  events.push({ date: isoDate(joinedDate), type: "joined",       title: "Joined Kivo",          detail: "Connected Rex and started the journey." })

  // First workout
  if (sortedCompletedDates.length > 0) {
    events.push({ date: isoDate(sortedCompletedDates[0]!), type: "first_workout", title: "First workout logged", detail: "The journey begins." })
  }

  // Current PRs
  for (const [exercise, pr] of Object.entries(personalRecords)) {
    const label = normalizeExerciseName(exercise)
    events.push({
      date:   pr.date,
      type:   "pr",
      title:  `PR: ${label} — ${pr.weightKg}kg`,
      detail: `${pr.reps} rep${pr.reps !== 1 ? "s" : ""} at ${pr.weightKg}kg.`,
    })
  }

  // Weight milestones (±5kg, ±10kg, ±15kg from baseline)
  if (firstBodyweight !== null && bodyweights.length > 1) {
    for (const delta of [-15, -10, -5, 5, 10, 15]) {
      const target  = firstBodyweight + delta
      const crossed = bodyweights.find(b =>
        delta > 0 ? b.weightKg >= target : b.weightKg <= target,
      )
      if (crossed) {
        events.push({
          date:   isoDate(crossed.recordedAt),
          type:   "weight_milestone",
          title:  `${Math.abs(delta)}kg ${delta > 0 ? "gained" : "lost"}`,
          detail: `Reached ${target.toFixed(1)}kg from starting weight of ${firstBodyweight.toFixed(1)}kg.`,
        })
      }
    }
  }

  // Streak milestone
  if (longestStreak >= 14) {
    events.push({
      date:   isoDate(new Date()),
      type:   "streak_milestone",
      title:  `${longestStreak}-day streak`,
      detail: `Longest training streak: ${longestStreak} consecutive days.`,
    })
  }

  // Achievements
  for (const f of achievementFacts.slice(0, 6)) {
    if (typeof f.value !== "string" || !f.value) continue
    events.push({ date: isoDate(f.updatedAt), type: "achievement", title: "Achievement", detail: f.value })
  }

  // Goal milestones
  for (const f of goalFacts.slice(0, 3)) {
    if (typeof f.value !== "string" || !f.value) continue
    events.push({ date: isoDate(f.updatedAt), type: "goal_milestone", title: "Goal milestone", detail: f.value })
  }

  // Comebacks
  for (const c of comebacks) {
    events.push({
      date:   c.date,
      type:   "comeback",
      title:  `Comeback after ${c.gapDays} days`,
      detail: `Returned and completed ${c.sessionsAfter} sessions.`,
    })
  }

  // Breakthroughs
  for (const b of breakthroughs) {
    events.push({ date: b.date, type: "plateau_breakthrough", title: b.title, detail: b.detail })
  }

  return events
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 30)
}

// ─────────────────────────────────────────────────────────────────────────────

function buildMilestoneWall(
  totalSessions:       number,
  longestStreak:       number,
  weightChangeTotalKg: number | null,
  personalRecords:     Record<string, { weightKg: number; date: string }>,
): JourneyPageData["milestones"] {
  const ms: JourneyPageData["milestones"] = []

  // Session milestones
  for (const target of [1, 5, 10, 25, 50, 100, 200]) {
    ms.push({
      id:      `sessions_${target}`,
      label:   target === 1 ? "First Workout" : `${target} Sessions`,
      detail:  target === 1 ? "The first step." : `Completed ${target} workouts.`,
      date:    null,
      reached: totalSessions >= target,
      type:    "session",
    })
  }

  // Streak milestones
  for (const target of [7, 14, 30, 60, 90]) {
    ms.push({
      id:      `streak_${target}`,
      label:   `${target}-Day Streak`,
      detail:  `${target} consecutive training days.`,
      date:    null,
      reached: longestStreak >= target,
      type:    "streak",
    })
  }

  // PR milestones (only for exercises the user has actually logged)
  // Normalize: match by lowercased key with underscores/spaces collapsed
  const normalizeKey = (k: string) => k.toLowerCase().replace(/[\s-]+/g, "_")
  const normalizedPRs: Record<string, { weightKg: number; date: string }> = {}
  for (const [k, v] of Object.entries(personalRecords)) {
    normalizedPRs[normalizeKey(k)] = v
  }

  const prTargets: { exercise: string; label: string; target: number }[] = [
    { exercise: "bench_press",    label: "100kg Bench",    target: 100 },
    { exercise: "bench_press",    label: "120kg Bench",    target: 120 },
    { exercise: "squat",          label: "100kg Squat",    target: 100 },
    { exercise: "squat",          label: "140kg Squat",    target: 140 },
    { exercise: "deadlift",       label: "100kg Deadlift", target: 100 },
    { exercise: "deadlift",       label: "180kg Deadlift", target: 180 },
    { exercise: "overhead_press", label: "60kg OHP",       target: 60  },
  ]
  for (const { exercise, label, target } of prTargets) {
    const pr = normalizedPRs[exercise]
    if (!pr) continue
    ms.push({
      id:      `pr_${exercise}_${target}`,
      label,
      detail:  `${target}kg on ${normalizeExerciseName(exercise)}.`,
      date:    pr.weightKg >= target ? pr.date : null,
      reached: pr.weightKg >= target,
      type:    "pr",
    })
  }

  // Weight milestones
  if (weightChangeTotalKg !== null && Math.abs(weightChangeTotalKg) > 1) {
    for (const delta of [5, 10, 15]) {
      if (Math.abs(weightChangeTotalKg) >= delta) {
        ms.push({
          id:      `weight_${delta}`,
          label:   `${delta}kg ${weightChangeTotalKg > 0 ? "Gained" : "Lost"}`,
          detail:  `${delta}kg of body ${weightChangeTotalKg > 0 ? "gained" : "lost"}.`,
          date:    null,
          reached: true,
          type:    "weight",
        })
      }
    }
  }

  // Sort: reached first, then by type
  return ms.sort((a, b) => {
    if (a.reached !== b.reached) return a.reached ? -1 : 1
    const order = { session: 0, streak: 1, pr: 2, weight: 3, goal: 4 }
    return order[a.type] - order[b.type]
  })
}

// ─────────────────────────────────────────────────────────────────────────────

function buildStory(
  daysWithKivo:        number,
  sessionsCompleted:   number,
  weightChangeTotalKg: number | null,
  strengthSummary:     string | null,
  longestStreak:       number,
  comebackCount:       number,
  breakthroughCount:   number,
  dominantChapterType: ChapterType | null,
): string[] {
  const lines: string[] = []

  lines.push(`You joined Kivo ${daysWithKivo} day${daysWithKivo !== 1 ? "s" : ""} ago.`)

  if (sessionsCompleted > 0) {
    lines.push(`Since then you've completed ${sessionsCompleted} workout session${sessionsCompleted !== 1 ? "s" : ""}.`)
  } else {
    lines.push("You haven't logged a workout yet — your story starts with the first session.")
    return lines
  }

  if (weightChangeTotalKg !== null && Math.abs(weightChangeTotalKg) > 0.5) {
    const dir = weightChangeTotalKg > 0 ? "increased" : "decreased"
    lines.push(`Your weight has ${dir} by ${Math.abs(weightChangeTotalKg).toFixed(1)}kg.`)
  }

  if (strengthSummary) {
    lines.push(`Your biggest strength gain: ${strengthSummary}.`)
  }

  if (longestStreak >= 7) {
    lines.push(`Your longest streak: ${longestStreak} consecutive training days.`)
  }

  if (comebackCount > 0) {
    lines.push(`You've come back ${comebackCount} time${comebackCount !== 1 ? "s" : ""} after a break — and kept going each time.`)
  }

  if (breakthroughCount > 0) {
    lines.push(`${breakthroughCount} plateau${breakthroughCount !== 1 ? "s" : ""} broken.`)
  }

  const improvementMap: Partial<Record<ChapterType, string>> = {
    consistency: "consistency — showing up when it's hard",
    strength:    "raw strength",
    bulk:        "building lean mass",
    cut:         "body composition",
  }
  if (dominantChapterType && improvementMap[dominantChapterType]) {
    lines.push(`Your biggest improvement has been ${improvementMap[dominantChapterType]}.`)
  }

  return lines
}

// ─────────────────────────────────────────────────────────────────────────────

function emptyJourney(telegramConnected: boolean, isRexUser: boolean): JourneyPageData {
  return {
    telegramConnected,
    isRexUser,
    hasAnyData: false,
    summary: {
      daysWithKivo: 0, sessionsCompleted: 0, weightChangeTotalKg: null,
      strengthChangeSummary: null, longestStreak: 0, currentStreak: 0,
      joinedDate: isoDate(new Date()), latestSessionDate: null,
    },
    timeline: [], chapters: [], biggestWins: [], comebacks: [],
    breakthroughs: [], milestones: [], yearInReview: {
      thisMonth:   { sessions: 0, weightDelta: null, topLiftLabel: null },
      last3Months: { sessions: 0, weightDelta: null, topLiftLabel: null },
      allTime:     { sessions: 0, weightDeltaKg: null, longestStreak: 0, totalPRs: 0 },
    },
    memories: [], story: { lines: [] },
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/journey
// ═══════════════════════════════════════════════════════════════════════════════

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  const now    = new Date()
  const userId = session.userId

  try {
    const profile = await prisma.userProfile.findUnique({
      where:  { userId },
      select: { telegramChatId: true, primaryPersona: true },
    })

    const telegramConnected = !!(profile?.telegramChatId)
    const isRexUser         = profile?.primaryPersona === "rex"

    if (!profile?.telegramChatId || !isRexUser) {
      return NextResponse.json(emptyJourney(telegramConnected, isRexUser))
    }

    const messenger = await prisma.messengerUser.findUnique({
      where:  { platform_platformChatId: { platform: "telegram", platformChatId: profile.telegramChatId } },
      select: { id: true, personalRecords: true, createdAt: true },
    })
    if (!messenger) return NextResponse.json(emptyJourney(telegramConnected, isRexUser))

    const messengerId    = messenger.id
    const platformChatId = profile.telegramChatId
    const joinedDate     = messenger.createdAt   // when they first connected Kivo

    const cutoff30d  = daysBefore(now, 30)
    const cutoff90d  = daysBefore(now, 90)
    const cutoff365d = daysBefore(now, 365)

    // ── Parallel batch ─────────────────────────────────────────────────────────
    const [
      mentorState,
      allSessions,
      allBodyweights,
      achievementFacts,
      goalFacts,
    ] = await Promise.all([
      getMentorState(platformChatId),
      prisma.telegramWorkoutSession.findMany({
        where:   { messengerUserId: messengerId },
        orderBy: { date: "asc" },
        select:  { id: true, date: true, completed: true },
      }),
      prisma.bodyweightHistory.findMany({
        where:   { userId: messengerId },
        orderBy: { recordedAt: "asc" },
        select:  { weightKg: true, recordedAt: true },
      }),
      prisma.memoryFact.findMany({
        where:   { userId: messengerId, type: "achievement" },
        orderBy: { updatedAt: "desc" },
        take:    10,
        select:  { value: true, updatedAt: true },
      }),
      prisma.memoryFact.findMany({
        where:   { userId: messengerId, type: { in: ["goal", "goal_history"] } },
        orderBy: { updatedAt: "desc" },
        take:    8,
        select:  { value: true, updatedAt: true },
      }),
    ])

    const completedSessions = allSessions.filter(s => s.completed)
    const sortedDates       = completedSessions.map(s => new Date(s.date)).sort((a, b) => a.getTime() - b.getTime())

    // Set logs for last 365d (for PR progression charts and breakthrough detection)
    const sessionIds365d = allSessions
      .filter(s => s.completed && new Date(s.date) >= cutoff365d)
      .map(s => s.id)

    const rawSets365d = sessionIds365d.length > 0
      ? await prisma.telegramSetLog.findMany({
          where:  { sessionId: { in: sessionIds365d }, completed: true },
          select: { exerciseName: true, weightKg: true, sessionId: true },
        })
      : []

    const sessionDateMap = new Map<string, Date>(allSessions.map(s => [s.id, new Date(s.date)]))
    const setsWithDates  = rawSets365d.map(s => ({
      exerciseName: s.exerciseName,
      weightKg:     s.weightKg,
      sessionDate:  sessionDateMap.get(s.sessionId) ?? new Date(),
    }))
    const prHistory = buildPRHistory(setsWithDates)

    // Personal records JSON (current PRs, all-time)
    const personalRecords: Record<string, { weightKg: number; reps: number; date: string }> =
      (typeof messenger.personalRecords === "object" && messenger.personalRecords !== null)
        ? messenger.personalRecords as Record<string, { weightKg: number; reps: number; date: string }>
        : {}

    const totalSessions   = completedSessions.length
    const longestStreak   = mentorState.longestStreak
    const currentStreak   = mentorState.streakDays
    const hasAnyData      = totalSessions > 0 || allBodyweights.length > 0 || Object.keys(personalRecords).length > 0

    // ── Weight change all-time ─────────────────────────────────────────────────
    const firstBodyweight  = allBodyweights[0]?.weightKg ?? null
    const latestBodyweight = allBodyweights[allBodyweights.length - 1]?.weightKg ?? null
    const weightChangeTotalKg = (firstBodyweight !== null && latestBodyweight !== null)
      ? Math.round((latestBodyweight - firstBodyweight) * 10) / 10
      : null

    // ── Strength summary (biggest PR gain from personalRecords) ────────────────
    let strengthChangeSummary: string | null = null
    let biggestPRGainKg = 0
    let biggestPRExercise = ""
    for (const [exercise, pr] of Object.entries(personalRecords)) {
      const history = prHistory[exercise.toLowerCase()] ?? []
      if (history.length >= 2) {
        const gain = pr.weightKg - history[0]!.weightKg
        if (gain > biggestPRGainKg) {
          biggestPRGainKg   = Math.round(gain * 10) / 10
          biggestPRExercise = exercise
        }
      }
    }
    if (biggestPRGainKg > 0) {
      strengthChangeSummary = `+${biggestPRGainKg}kg on ${normalizeExerciseName(biggestPRExercise)}`
    }

    // ── Section computations ───────────────────────────────────────────────────

    // S1 — Summary
    const daysWithKivo = Math.max(1, Math.round((now.getTime() - joinedDate.getTime()) / 86_400_000))
    const latestSessionDate = sortedDates.length > 0 ? isoDate(sortedDates[sortedDates.length - 1]!) : null

    const summary: JourneyPageData["summary"] = {
      daysWithKivo,
      sessionsCompleted:     totalSessions,
      weightChangeTotalKg,
      strengthChangeSummary,
      longestStreak,
      currentStreak,
      joinedDate:            isoDate(joinedDate),
      latestSessionDate,
    }

    // S5 — Comebacks (needed before timeline)
    const comebacks = detectComebacks(sortedDates)

    // S6 — Breakthroughs (needed before timeline)
    const breakthroughs = detectBreakthroughs(prHistory, allBodyweights)

    // S2 — Timeline
    const timeline = buildTimeline(
      sortedDates, allBodyweights, personalRecords,
      achievementFacts, goalFacts, comebacks, breakthroughs,
      joinedDate, firstBodyweight, longestStreak,
    )

    // S3 — Chapters
    const chapters = detectChapters(sortedDates, allBodyweights, joinedDate, now)
    const dominantChapterType: ChapterType | null = chapters.length > 1
      ? (chapters[1]?.type ?? chapters[0]?.type ?? null)
      : chapters[0]?.type ?? null

    // S4 — Biggest Wins
    const biggestWins: JourneyPageData["biggestWins"] = []
    if (biggestPRGainKg > 0) {
      biggestWins.push({
        type:   "pr",
        title:  "Biggest Strength Gain",
        value:  `+${biggestPRGainKg}kg`,
        detail: `Added ${biggestPRGainKg}kg to ${normalizeExerciseName(biggestPRExercise)}.`,
      })
    }
    if (longestStreak >= 7) {
      biggestWins.push({
        type:   "streak",
        title:  "Longest Streak",
        value:  `${longestStreak} days`,
        detail: `${longestStreak} consecutive training days — unbroken.`,
      })
    }
    if (weightChangeTotalKg !== null && Math.abs(weightChangeTotalKg) > 1) {
      const dir = weightChangeTotalKg > 0 ? "Gained" : "Lost"
      biggestWins.push({
        type:   "weight",
        title:  `Weight ${dir}`,
        value:  `${Math.abs(weightChangeTotalKg).toFixed(1)}kg`,
        detail: `Total weight ${dir.toLowerCase()}: ${Math.abs(weightChangeTotalKg).toFixed(1)}kg since starting.`,
      })
    }
    if (totalSessions >= 10) {
      biggestWins.push({
        type:   "volume",
        title:  "Total Sessions",
        value:  `${totalSessions}`,
        detail: `${totalSessions} completed workouts across ${daysWithKivo} days.`,
      })
    }

    // S7 — Milestone Wall
    const milestones = buildMilestoneWall(totalSessions, longestStreak, weightChangeTotalKg, personalRecords)

    // S8 — Year In Review
    const sessionsThisMonth   = sortedDates.filter(d => d >= cutoff30d).length
    const sessions3Months     = sortedDates.filter(d => d >= cutoff90d).length

    // Weight deltas for review periods
    const bwThisMonthArr      = allBodyweights.filter(b => b.recordedAt >= cutoff30d)
    const bw3monthsArr        = allBodyweights.filter(b => b.recordedAt >= cutoff90d)

    const weightDeltaThisMonth = bwThisMonthArr.length >= 2
      ? Math.round((bwThisMonthArr[bwThisMonthArr.length - 1]!.weightKg - bwThisMonthArr[0]!.weightKg) * 10) / 10
      : null
    const weightDelta3months   = bw3monthsArr.length >= 2
      ? Math.round((bw3monthsArr[bw3monthsArr.length - 1]!.weightKg - bw3monthsArr[0]!.weightKg) * 10) / 10
      : null

    // Top lift this month (highest PR set in last 30 days)
    const setsThisMonth = setsWithDates.filter(s => s.sessionDate >= cutoff30d)
    let topLiftThisMonth: string | null = null
    if (setsThisMonth.length > 0) {
      const byEx: Record<string, number> = {}
      for (const s of setsThisMonth) {
        const k = s.exerciseName.toLowerCase()
        byEx[k] = Math.max(byEx[k] ?? 0, s.weightKg)
      }
      const top = Object.entries(byEx).sort((a, b) => b[1] - a[1])[0]
      if (top) topLiftThisMonth = `${normalizeExerciseName(top[0])}: ${top[1]}kg`
    }

    // Top lift last 3 months
    const sets3months = setsWithDates.filter(s => s.sessionDate >= cutoff90d && s.sessionDate < cutoff30d)
    let topLift3months: string | null = null
    if (sets3months.length > 0) {
      const byEx: Record<string, number> = {}
      for (const s of sets3months) {
        const k = s.exerciseName.toLowerCase()
        byEx[k] = Math.max(byEx[k] ?? 0, s.weightKg)
      }
      const top = Object.entries(byEx).sort((a, b) => b[1] - a[1])[0]
      if (top) topLift3months = `${normalizeExerciseName(top[0])}: ${top[1]}kg`
    }

    const yearInReview: JourneyPageData["yearInReview"] = {
      thisMonth: {
        sessions:      sessionsThisMonth,
        weightDelta:   weightDeltaThisMonth,
        topLiftLabel:  topLiftThisMonth,
      },
      last3Months: {
        sessions:      sessions3Months - sessionsThisMonth,
        weightDelta:   weightDelta3months,
        topLiftLabel:  topLift3months,
      },
      allTime: {
        sessions:      totalSessions,
        weightDeltaKg: weightChangeTotalKg,
        longestStreak,
        totalPRs:      Object.keys(personalRecords).length,
      },
    }

    // S9 — Memories (ranked)
    const memories: JourneyPageData["memories"] = []
    for (const f of achievementFacts) {
      if (typeof f.value !== "string" || !f.value) continue
      memories.push({ date: isoDate(f.updatedAt), type: "achievement", text: f.value, weight: 3 })
    }
    for (const f of goalFacts) {
      if (typeof f.value !== "string" || !f.value) continue
      memories.push({ date: isoDate(f.updatedAt), type: "goal", text: f.value, weight: 2 })
    }
    for (const b of breakthroughs) {
      memories.push({ date: b.date, type: "breakthrough", text: b.detail, weight: 3 })
    }
    memories.sort((a, b) => b.weight - a.weight || b.date.localeCompare(a.date))

    // S10 — Story
    const story: JourneyPageData["story"] = {
      lines: buildStory(
        daysWithKivo, totalSessions, weightChangeTotalKg,
        strengthChangeSummary, longestStreak,
        comebacks.length, breakthroughs.length,
        dominantChapterType,
      ),
    }

    return NextResponse.json({
      telegramConnected,
      isRexUser,
      hasAnyData,
      summary,
      timeline,
      chapters,
      biggestWins,
      comebacks,
      breakthroughs,
      milestones,
      yearInReview,
      memories: memories.slice(0, 10),
      story,
    } satisfies JourneyPageData)
  } catch (e) {
    console.error("[JOURNEY ERROR]", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
