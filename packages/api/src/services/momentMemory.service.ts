import { prisma } from "@repo/db/client"
import { generateOpenAIText } from "./openai.service"

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type MomentType =
  | "achievement"
  | "struggle"
  | "promise"
  | "breakthrough"
  | "comeback"
  | "identity_shift"

export type RetrievalSurface =
  | "session_completion"
  | "weekly_summary"
  | "milestone"
  | "commitment"
  | "reactivation"
  | "daily_checkin"

export interface RetrievalContext {
  surface:          RetrievalSurface
  exercise?:        string
  commitmentTitle?: string
  streakCount?:     number
}

// ═══════════════════════════════════════════════════════════════════════════════
// CORE WRITE PRIMITIVES
// ═══════════════════════════════════════════════════════════════════════════════

async function writeMoment(
  userId:     string,
  type:       MomentType,
  key:        string,
  value:      string,
  confidence: number = 0.9,
): Promise<void> {
  await prisma.memoryFact.create({
    data: { userId, type, key, value, confidence },
  })
}

async function archiveMoment(userId: string, type: string, key: string): Promise<void> {
  await prisma.memoryFact.updateMany({
    where: { userId, type, key, archivedAt: null },
    data:  { archivedAt: new Date() },
  })
}

async function momentExistsRecently(
  userId:      string,
  type:        string,
  key:         string,
  withinDays:  number,
): Promise<boolean> {
  const since = new Date(Date.now() - withinDays * 86_400_000)
  const count = await prisma.memoryFact.count({
    where: { userId, type, key, archivedAt: null, createdAt: { gte: since } },
  })
  return count > 0
}

async function resolveMessengerUserId(platformChatId: string): Promise<string | null> {
  const user = await prisma.messengerUser.findUnique({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: { id: true },
  })
  return user?.id ?? null
}

function exerciseKey(exercise: string): string {
  return exercise.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOMENT WRITERS — accept internal messengerUserId
// ═══════════════════════════════════════════════════════════════════════════════

// Called from workoutTracking.service.ts when a PR is recorded
export async function writeMomentPR(
  userId:        string,
  exercise:      string,
  newWeightKg:   number,
  prevWeightKg:  number,
  firstWeightKg: number | null,
  sessionCount:  number,
): Promise<void> {
  const key   = `${exerciseKey(exercise)}_pr`
  const delta = (newWeightKg - prevWeightKg).toFixed(1)
  const fromFirst = firstWeightKg && firstWeightKg < prevWeightKg
    ? ` (first logged: ${firstWeightKg}kg)`
    : ""
  const value = `${exercise} PR: ${newWeightKg}kg (+${delta}kg from ${prevWeightKg}kg)${fromFirst} — session ${sessionCount}`

  await archiveMoment(userId, "achievement", key)
  await writeMoment(userId, "achievement", key, value)
}

// Called from workoutTracking.service.ts when stall is broken (PR AND ≥3 sessions at prev weight)
export async function writeMomentBreakthrough(
  userId:              string,
  exercise:            string,
  oldWeightKg:         number,
  newWeightKg:         number,
  sessionsAtOldWeight: number,
): Promise<void> {
  const key   = `${exerciseKey(exercise)}_stall_broken`
  const value = `${exercise}: broke ${oldWeightKg}kg stall after ${sessionsAtOldWeight} sessions at same weight — lifted ${newWeightKg}kg on ${new Date().toISOString().slice(0, 10)}`
  await archiveMoment(userId, "breakthrough", key)
  await writeMoment(userId, "breakthrough", key, value)
}

// Called from workoutTracking.service.ts when a streak milestone fires
export async function writeMomentStreakMilestone(
  userId:    string,
  threshold: number,
  streak:    number,
): Promise<void> {
  const key   = `streak_${threshold}`
  const value = `${threshold}-day streak milestone hit (${streak} total sessions)`
  await writeMoment(userId, "achievement", key, value)
}

// Called from workoutTracking.service.ts when user returns after 5+ days away
export async function writeMomentComeback(
  userId:     string,
  daysAway:   number,
  prevStreak: number,
  muscles:    string,
): Promise<void> {
  const existing = await prisma.memoryFact.count({ where: { userId, type: "comeback" } })
  const key   = `comeback_${existing + 1}`
  const value = `Returned after ${daysAway} days away — streak was ${prevStreak} — came back and trained ${muscles} on ${new Date().toISOString().slice(0, 10)}`
  await writeMoment(userId, "comeback", key, value)
}

// Called from gymCron.service.ts when consecutiveMisses >= 3
export async function writeMomentStruggle(
  userId:  string,
  pattern: string,
  detail:  string,
): Promise<void> {
  if (await momentExistsRecently(userId, "struggle", pattern, 14)) return
  const value = `${detail} — ${new Date().toISOString().slice(0, 7)}`
  await writeMoment(userId, "struggle", pattern, value, 0.85)
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOMENT WRITERS — accept platformChatId (for telegram route / orchestrator)
// ═══════════════════════════════════════════════════════════════════════════════

export async function writeMomentPromiseFromChat(
  platformChatId: string,
  userText:       string,
): Promise<void> {
  const userId = await resolveMessengerUserId(platformChatId)
  if (!userId) return

  const lower    = userText.toLowerCase()
  const topicKey =
    lower.includes("squat")    ? "squat_target"
    : lower.includes("bench")    ? "bench_target"
    : lower.includes("deadlift") ? "deadlift_target"
    : lower.includes("press")    ? "press_target"
    : lower.includes("session") || lower.includes("train") || lower.includes("days") ? "consistency_goal"
    : lower.includes("breakfast") || lower.includes("protein") || lower.includes("eat") ? "nutrition_habit"
    : "general_promise"

  const key   = `promise_${topicKey}_${Date.now()}`
  const value = `"${userText.slice(0, 200)}" — ${new Date().toISOString().slice(0, 7)}`
  await writeMoment(userId, "promise", key, value, 0.95)
}

export async function writeMomentIdentityShiftFromChat(
  platformChatId: string,
  userText:       string,
  matched:        string,
): Promise<void> {
  const userId = await resolveMessengerUserId(platformChatId)
  if (!userId) return
  if (await momentExistsRecently(userId, "identity_shift", "any", 30)) return

  const gymStreak = await prisma.messengerUser.findUnique({
    where:  { id: userId },
    select: { gymStreak: true },
  })
  const streak = gymStreak?.gymStreak ?? 0

  const value = `"${matched}" — streak ${streak} — ${new Date().toISOString().slice(0, 10)} — full: "${userText.slice(0, 120)}"`
  await writeMoment(userId, "identity_shift", "any", value, 0.9)
}

// ═══════════════════════════════════════════════════════════════════════════════
// IDENTITY SHIFT DETECTOR (sync, no DB)
// ═══════════════════════════════════════════════════════════════════════════════

const IDENTITY_PATTERNS: RegExp[] = [
  /\b(feel like a different person|I'?ve become|I don'?t skip|feels? automatic|part of my routine)\b/i,
  /\b(I actually look forward|I'?m consistent now|I don'?t need to force|it'?s just what I do now)\b/i,
  /\b(training is automatic|don'?t have to think about it|just show up now|natural now|not hard anymore)\b/i,
  /\b(I'?m a different person|couldn'?t imagine (not|skipping)|can'?t skip|won'?t skip)\b/i,
]

export function detectIdentityShift(text: string): string | null {
  for (const pat of IDENTITY_PATTERNS) {
    const m = pat.exec(text)
    if (m) return m[0]!
  }
  return null
}

// ═══════════════════════════════════════════════════════════════════════════════
// STALL DETECTION HELPER
// Returns how many consecutive prior sessions had this exercise at exactly weightKg.
// Used to determine if a PR is also a breakthrough (stall broken).
// ═══════════════════════════════════════════════════════════════════════════════

export async function getConsecutiveSessionsAtWeight(
  userId:    string,
  exercise:  string,
  weightKg:  number,
): Promise<number> {
  const sessions = await prisma.telegramWorkoutSession.findMany({
    where:   { messengerUserId: userId, completed: true },
    orderBy: { date: "desc" },
    take:    8,
    select:  { id: true },
  })
  if (sessions.length < 2) return 0

  const sets = await prisma.telegramSetLog.findMany({
    where: {
      sessionId:    { in: sessions.map(s => s.id) },
      exerciseName: { contains: exercise, mode: "insensitive" },
      completed:    true,
    },
    select: { weightKg: true, sessionId: true },
  })

  const maxBySession: Record<string, number> = {}
  for (const s of sets) {
    maxBySession[s.sessionId] = Math.max(maxBySession[s.sessionId] ?? 0, s.weightKg)
  }

  // Skip the most recent session (the one that just happened), count backwards
  let count = 0
  for (const session of sessions.slice(1)) {
    const maxW = maxBySession[session.id]
    if (maxW !== undefined && Math.abs(maxW - weightKg) < 0.1) count++
    else break
  }

  return count
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOMENT RETRIEVER
// Returns 1-3 ready-to-inject strings. Never raw MemoryFact objects.
// ═══════════════════════════════════════════════════════════════════════════════

export async function retrieveRelevantMoments(
  userId:  string,
  context: RetrievalContext,
): Promise<string[]> {
  switch (context.surface) {
    case "session_completion": return retrieveForSession(userId, context.exercise)
    case "weekly_summary":     return retrieveForWeeklySummary(userId)
    case "milestone":          return retrieveForMilestone(userId)
    case "commitment":         return retrieveForCommitment(userId, context.commitmentTitle)
    case "reactivation":       return retrieveForReactivation(userId)
    case "daily_checkin":      return retrieveForDailyCheckin(userId)
  }
}

async function retrieveForSession(userId: string, exercise?: string): Promise<string[]> {
  if (!exercise) return []
  const key = exerciseKey(exercise)

  const [prFact, breakthroughFact] = await Promise.all([
    prisma.memoryFact.findFirst({
      where:   { userId, type: "achievement", key: `${key}_pr`, archivedAt: null },
      orderBy: { createdAt: "desc" },
      select:  { value: true },
    }),
    prisma.memoryFact.findFirst({
      where:   { userId, type: "breakthrough", key: `${key}_stall_broken`, archivedAt: null },
      orderBy: { createdAt: "desc" },
      select:  { value: true },
    }),
  ])

  return [prFact?.value, breakthroughFact?.value].filter(Boolean) as string[]
}

async function retrieveForWeeklySummary(userId: string): Promise<string[]> {
  const facts = await prisma.memoryFact.findMany({
    where:   { userId, type: { in: ["achievement", "promise", "breakthrough", "identity_shift"] }, archivedAt: null },
    orderBy: { createdAt: "desc" },
    take:    5,
    select:  { type: true, value: true },
  })

  // Order: achievements/breakthroughs first, then promises, then identity shifts
  const ordered = [
    ...facts.filter(f => f.type === "breakthrough"),
    ...facts.filter(f => f.type === "achievement"),
    ...facts.filter(f => f.type === "promise"),
    ...facts.filter(f => f.type === "identity_shift"),
  ]

  return ordered.map(f => f.value).slice(0, 3)
}

async function retrieveForMilestone(userId: string): Promise<string[]> {
  const [achievements, struggles, comebacks, identity] = await Promise.all([
    prisma.memoryFact.findMany({
      where:   { userId, type: "achievement", archivedAt: null },
      orderBy: { createdAt: "asc" },   // oldest first — show the arc
      take:    4,
      select:  { value: true },
    }),
    prisma.memoryFact.findMany({
      where:   { userId, type: "struggle", archivedAt: null },
      orderBy: { createdAt: "asc" },
      take:    2,
      select:  { value: true },
    }),
    prisma.memoryFact.findMany({
      where:   { userId, type: "comeback", archivedAt: null },
      orderBy: { createdAt: "desc" },
      take:    1,
      select:  { value: true },
    }),
    prisma.memoryFact.findFirst({
      where:   { userId, type: "identity_shift", archivedAt: null },
      orderBy: { createdAt: "desc" },
      select:  { value: true },
    }),
  ])

  return [
    ...achievements.map(f => f.value),
    ...struggles.map(f => f.value),
    ...comebacks.map(f => f.value),
    ...(identity ? [identity.value] : []),
  ].slice(0, 5)
}

async function retrieveForCommitment(userId: string, title?: string): Promise<string[]> {
  const lower   = (title ?? "").toLowerCase()
  const keyword = ["squat", "bench", "deadlift", "press", "row", "session", "train", "breakfast", "protein"]
    .find(k => lower.includes(k))

  const [promises, achievements] = await Promise.all([
    prisma.memoryFact.findMany({
      where: {
        userId,
        type:       "promise",
        key:        keyword ? { contains: keyword } : undefined,
        archivedAt: null,
      },
      orderBy: { createdAt: "desc" },
      take:    2,
      select:  { value: true },
    }),
    prisma.memoryFact.findMany({
      where: {
        userId,
        type:       "achievement",
        key:        keyword ? { contains: keyword } : undefined,
        archivedAt: null,
      },
      orderBy: { createdAt: "desc" },
      take:    1,
      select:  { value: true },
    }),
  ])

  return [...promises.map(f => f.value), ...achievements.map(f => f.value)].slice(0, 3)
}

async function retrieveForReactivation(userId: string): Promise<string[]> {
  const [comebacks, struggle, identity] = await Promise.all([
    prisma.memoryFact.findMany({
      where:   { userId, type: "comeback", archivedAt: null },
      orderBy: { createdAt: "desc" },
      take:    2,
      select:  { value: true },
    }),
    prisma.memoryFact.findFirst({
      where:   { userId, type: "struggle", archivedAt: null },
      orderBy: { createdAt: "desc" },
      select:  { value: true },
    }),
    prisma.memoryFact.findFirst({
      where:   { userId, type: "identity_shift", archivedAt: null },
      orderBy: { createdAt: "desc" },
      select:  { value: true },
    }),
  ])

  return [
    ...comebacks.map(f => f.value),
    ...(struggle ? [struggle.value] : []),
    ...(identity ? [identity.value] : []),
  ].slice(0, 3)
}

async function retrieveForDailyCheckin(userId: string): Promise<string[]> {
  const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000)
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000)

  // Recent breakthrough worth reinforcing
  const recentBreakthrough = await prisma.memoryFact.findFirst({
    where:   { userId, type: "breakthrough", archivedAt: null, createdAt: { gte: threeDaysAgo } },
    orderBy: { createdAt: "desc" },
    select:  { value: true },
  })
  if (recentBreakthrough) return [recentBreakthrough.value]

  // Recent identity shift still within reinforcement window
  const recentIdentity = await prisma.memoryFact.findFirst({
    where:   { userId, type: "identity_shift", archivedAt: null, createdAt: { gte: sevenDaysAgo } },
    orderBy: { createdAt: "desc" },
    select:  { value: true },
  })
  if (recentIdentity) return [recentIdentity.value]

  return []
}

// ═══════════════════════════════════════════════════════════════════════════════
// LLM MILESTONE GENERATOR (streaks 30+)
// Returns null when there's no history yet — caller uses hardcoded fallback.
// ═══════════════════════════════════════════════════════════════════════════════

export async function generateLLMMilestoneMessage(
  userId:    string,
  threshold: number,
  streak:    number,
): Promise<string | null> {
  const moments = await retrieveForMilestone(userId)
  if (!moments.length) return null

  try {
    return await generateOpenAIText({
      model:           "gpt-4o-mini",
      maxOutputTokens: 80,
      systemInstruction: [
        "You are Rex, a direct gym coach. Write a streak milestone message (2-4 lines, no greeting).",
        `The user just hit ${threshold} consecutive training days.`,
        "Reference specific facts from their journey — exact weights, specific struggles they overcame, their comebacks.",
        "Never say 'most people quit' or other generic lines — only reference what's in the journey facts below.",
        "End with one forward-looking line. One 🐉 emoji at the very end only.",
      ].join("\n"),
      prompt: `Training journey so far:\n${moments.join("\n")}`,
    })
  } catch {
    return null
  }
}
