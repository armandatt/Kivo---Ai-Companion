import { prisma } from "@repo/db/client"

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export enum TrainingWindow {
  MORNING   = "morning",   // 05:00–11:00 local
  AFTERNOON = "afternoon", // 11:00–17:00 local
  EVENING   = "evening",   // 17:00–22:00 local
  FLEXIBLE  = "flexible",  // no consistent pattern or no history
}

export enum TrainingState {
  UPCOMING             = "upcoming",             // rest window not elapsed; too early to prompt
  DUE                  = "due",                  // inside training window, session not yet logged
  PENDING_CONFIRMATION = "pending_confirmation", // training window passed, session unconfirmed
  COMPLETED            = "completed",            // session logged today
  SKIPPED              = "skipped",              // user explicitly skipped today
  UNKNOWN              = "unknown",              // insufficient data to determine
}

export interface SchedulerContextV2 {
  trainingState:         TrainingState
  observedWindow:        TrainingWindow
  windowConfidence:      "high" | "medium" | "low"

  // V2: cycle-based — never derived from weekday
  pendingMuscles:        string | null   // next session in cycle (null = no split configured)
  pendingSplitDayIndex:  number | null
  completedTodayMuscles: string | null   // what was actually logged today (null = nothing yet)

  consecutiveMisses:     number
  lastSessionDate:       string | null   // YYYY-MM-DD local
  lastSessionMuscles:    string | null
  daysSinceLastSession:  number

  avgDurationMin:        number
  completionRate7d:      number          // 0.0–1.0
  daysPerWeek:           number

  isFlexibleUser:        boolean         // preferredCheckInTime is null
  hasAnyHistory:         boolean
}

// Minimal split state fields needed by the scheduler engine
export interface SplitStateMinimal {
  lastCompletedDayIndex: number | null
  avgSessionDurationMin: number
  lastSkipDate:          string | null
  lastSessionDate:       string | null
}

// ═══════════════════════════════════════════════════════════════════════════════
// CYCLE-BASED SPLIT RESOLUTION
// Replaces getSplitDayInfo() for all scheduler use cases.
// ═══════════════════════════════════════════════════════════════════════════════

function buildDayList(
  split: string,
  daysPerWeek: number,
  splitDaysJson: string | undefined,
): string[] {
  if (splitDaysJson) {
    try {
      const days = JSON.parse(splitDaysJson) as string[]
      if (Array.isArray(days) && days.length >= 2) return days
    } catch { /* fall through to canonical */ }
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
  if (split === "full_body") return ["Full Body", "Full Body", "Full Body"]
  if (split === "bro_split") return ["Chest", "Back", "Legs", "Shoulders", "Arms"]
  const n = Math.min(Math.max(daysPerWeek, 2), 6)
  return Array<string>(n).fill("Full Body")
}

/**
 * Returns the next pending split day using cycle index.
 * This is the canonical V2 replacement for getSplitDayInfo(split, daysPerWeek, weekdayNum).
 *
 * Never uses day of week. Only uses lastCompletedDayIndex from splitState.
 */
export function resolveNextCycleDay(
  splitStateRaw: unknown,
  intakeAnswers: unknown,
): { muscles: string; splitDayIndex: number } | null {
  const intake  = parseRaw(intakeAnswers)
  const state   = parseSplitStateMinimal(splitStateRaw)
  const split   = intake.current_split ?? "unstructured"
  const days    = parseInt(intake.available_training_days ?? "3") || 3
  const dayList = buildDayList(split, days, intake.split_days_json)

  if (!dayList.length) return null

  const lastIdx = state.lastCompletedDayIndex
  const nextIdx = lastIdx === null ? 0 : (lastIdx + 1) % dayList.length
  return { muscles: dayList[nextIdx] ?? "Full Body", splitDayIndex: nextIdx }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRAINING WINDOW DERIVATION
// Derived from actual workout timestamps — not from user-declared gym time.
// ═══════════════════════════════════════════════════════════════════════════════

export function classifyHourToWindow(localHour: number): TrainingWindow | null {
  if (localHour >= 5  && localHour < 11) return TrainingWindow.MORNING
  if (localHour >= 11 && localHour < 17) return TrainingWindow.AFTERNOON
  if (localHour >= 17 && localHour < 22) return TrainingWindow.EVENING
  return null  // midnight / early-morning hours: don't count toward window
}

/**
 * Derives the user's typical training window from their session history.
 * Requires at least 3 sessions for a meaningful result; returns FLEXIBLE with
 * low confidence otherwise.
 */
export function deriveTrainingWindow(
  sessions: Array<{ date: Date }>,
  timezone: string,
): { window: TrainingWindow; confidence: "high" | "medium" | "low" } {
  if (sessions.length < 3) return { window: TrainingWindow.FLEXIBLE, confidence: "low" }

  const counts: Record<TrainingWindow, number> = {
    [TrainingWindow.MORNING]:   0,
    [TrainingWindow.AFTERNOON]: 0,
    [TrainingWindow.EVENING]:   0,
    [TrainingWindow.FLEXIBLE]:  0,
  }

  let countable = 0
  for (const s of sessions) {
    const hour = getLocalHour(s.date, timezone)
    const win  = classifyHourToWindow(hour)
    if (win !== null) {
      counts[win]++
      countable++
    }
  }

  if (countable === 0) return { window: TrainingWindow.FLEXIBLE, confidence: "low" }

  const [best, bestCount] = (
    Object.entries(counts) as [TrainingWindow, number][]
  )
    .filter(([w]) => w !== TrainingWindow.FLEXIBLE)
    .sort(([, a], [, b]) => b - a)[0] ?? [TrainingWindow.FLEXIBLE, 0]

  const ratio = bestCount / countable
  if (ratio >= 0.70) return { window: best, confidence: "high" }
  if (ratio >= 0.50) return { window: best, confidence: "medium" }
  return { window: TrainingWindow.FLEXIBLE, confidence: "low" }
}

/**
 * The "virtual" gym time for a flexible user based on their observed window.
 * Used as the timing anchor for cron offsets when no preferredCheckInTime is set.
 */
export function deriveVirtualGymTime(window: TrainingWindow): string {
  const times: Record<TrainingWindow, string> = {
    [TrainingWindow.MORNING]:   "07:00",
    [TrainingWindow.AFTERNOON]: "13:00",
    [TrainingWindow.EVENING]:   "18:00",
    [TrainingWindow.FLEXIBLE]:  "10:00",
  }
  return times[window]
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRAINING DAY CHECK (frequency-based, not calendar-based)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Returns true if today is likely a training day based on frequency and
 * how long ago the user last trained.
 *
 * Logic: minimum rest days between sessions = max(0, floor(7/daysPerWeek) - 1)
 *   3d/wk → 1 rest day minimum (train every 2nd day on average)
 *   4d/wk → 0 rest days minimum (can train consecutive days)
 *   5d/wk+ → 0 rest days minimum
 *
 * @param daysSinceLastSession - 0 = trained today, 999 = no history
 */
export function isTrainingDayByFrequency(
  daysPerWeek: number,
  daysSinceLastSession: number,
): boolean {
  if (daysSinceLastSession === 0) return false  // already trained today
  const minRestDays = Math.max(0, Math.floor(7 / daysPerWeek) - 1)
  return daysSinceLastSession > minRestDays
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRAINING STATE RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════════

export function resolveTrainingState(opts: {
  now:                   Date
  timezone:              string
  observedWindow:        TrainingWindow
  preferredCheckInTime:  string | null
  lastSkipDateISO:       string | null
  completedTodayMuscles: string | null
  daysSinceLastSession:  number
  daysPerWeek:           number
  hasAnyHistory:         boolean
}): TrainingState {
  const {
    now, timezone, observedWindow, preferredCheckInTime,
    lastSkipDateISO, completedTodayMuscles,
    daysSinceLastSession, daysPerWeek, hasAnyHistory,
  } = opts

  if (!hasAnyHistory && daysSinceLastSession > 998) return TrainingState.UNKNOWN

  if (completedTodayMuscles !== null) return TrainingState.COMPLETED

  const todayISO = getLocalDateISO(now, timezone)
  if (lastSkipDateISO === todayISO) return TrainingState.SKIPPED

  if (!isTrainingDayByFrequency(daysPerWeek, daysSinceLastSession)) return TrainingState.UPCOMING

  const localHour    = getLocalHour(now, timezone)
  const windowEnd    = resolveWindowEndHour(observedWindow, preferredCheckInTime)
  const windowStart  = resolveWindowStartHour(observedWindow, preferredCheckInTime)

  if (localHour >= windowEnd)   return TrainingState.PENDING_CONFIRMATION
  if (localHour >= windowStart) return TrainingState.DUE
  return TrainingState.UPCOMING
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSECUTIVE MISS COUNTER (cycle/frequency-based)
// Replaces the weekday-iteration version in gymCron.service.ts
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Count consecutive expected training days that had no completed session,
 * between the most recent session and today.
 *
 * Algorithm: walk FORWARD from the last session date to today. For each day:
 *   - Within rest window of the last reference event → skip (recovery day).
 *   - Session logged → reset miss counter, update reference.
 *   - No session → miss++, update reference (recovery window resets from miss day).
 *   - Reaches today → stop (we don't count today yet).
 *
 * Returns 0 when: trained today, no history, or all recent gaps fall within rest windows.
 */
export function computeConsecutiveMissesV2(
  completedDateISOs: string[],  // YYYY-MM-DD strings of all completed session dates
  daysPerWeek:       number,
  todayISO:          string,
): number {
  const sessionSet = new Set(completedDateISOs)

  // Trained today → 0 consecutive misses
  if (sessionSet.has(todayISO)) return 0

  // No history → 0 misses (no reference point to count from)
  if (completedDateISOs.length === 0) return 0

  const minRestDays = Math.max(0, Math.floor(7 / daysPerWeek) - 1)

  // Find the most recent session before today
  const lastSessionISO = [...completedDateISOs].sort().at(-1)!

  let misses  = 0
  let lastRef = lastSessionISO
  const totalDays = daysBetween(lastSessionISO, todayISO)

  for (let step = 1; step <= totalDays; step++) {
    const checkISO = addDaysISO(lastSessionISO, step)
    if (checkISO >= todayISO) break  // don't count today (user may still train)

    const gapFromRef = daysBetween(lastRef, checkISO)
    if (gapFromRef <= minRestDays) continue  // still in recovery window

    if (sessionSet.has(checkISO)) {
      // Session found — reset consecutive count, update reference
      misses  = 0
      lastRef = checkISO
    } else {
      // Expected training day missed
      misses++
      lastRef = checkISO  // recovery window resets from the missed day
    }
  }

  return misses
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUIET HOURS — V2 (non-silent, queue to next morning)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Given a candidate fire time (HH:MM), return the actual delivery time (HH:MM)
 * accounting for quiet hours.  If the candidate is inside quiet hours, return
 * the wake time so the cron can check for it on the next morning tick.
 * Returns null if no adjustment is needed.
 */
export function adjustForQuietHours(
  candidateHHMM: string,
  intakeAnswers:  unknown,
): string | null {
  const answers  = parseRaw(intakeAnswers)
  const sleepStr = answers.sleep_time  ?? answers.quiet_start ?? "23:00"
  const wakeStr  = answers.wake_time   ?? answers.quiet_end   ?? "07:00"

  if (!isInQuietHoursRange(candidateHHMM, sleepStr, wakeStr)) return null  // no adjustment
  return wakeStr  // deliver at wake time instead
}

function isInQuietHoursRange(current: string, sleepStr: string, wakeStr: string): boolean {
  const c = hhmmToMinutes(current)
  const s = hhmmToMinutes(sleepStr)
  const w = hhmmToMinutes(wakeStr)
  if (s > w) return c >= s || c < w   // overnight (e.g. 23:00 → 07:00)
  return c >= s && c < w
}

/**
 * Returns the effective target time for a chase prompt, adjusted for quiet hours.
 * If gym_time + offsetMin falls in quiet hours, the effective target becomes wake_time.
 */
export function getEffectiveChaseTime(
  gymTime:       string,
  offsetMin:     number,
  intakeAnswers: unknown,
): string {
  const raw      = addMinutesHHMM(gymTime, offsetMin)
  const adjusted = adjustForQuietHours(raw, intakeAnswers)
  return adjusted ?? raw
}

// ═══════════════════════════════════════════════════════════════════════════════
// FULL CONTEXT BUILDER (async — used by orchestrator + cron)
// ═══════════════════════════════════════════════════════════════════════════════

export async function buildSchedulerContextV2(
  platformChatId: string,
  now:            Date,
): Promise<SchedulerContextV2 | null> {
  const user = await prisma.messengerUser.findUnique({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: {
      id:                   true,
      splitState:           true,
      intakeAnswers:        true,
      timezone:             true,
      preferredCheckInTime: true,
    },
  })

  if (!user) return null

  const timezone    = user.timezone ?? "Asia/Kolkata"
  const intake      = parseRaw(user.intakeAnswers)
  const state       = parseSplitStateMinimal(user.splitState)
  const daysPerWeek = parseInt(intake.available_training_days ?? "3") || 3
  const isFlexible  = !user.preferredCheckInTime

  const recentSessions = await prisma.telegramWorkoutSession.findMany({
    where:   { messengerUserId: user.id, completed: true },
    orderBy: { date: "desc" },
    take:    15,
    select:  { date: true, musclesTrained: true },
  })

  const hasAnyHistory = recentSessions.length > 0

  // Observed training window from session timestamps
  const { window: observedWindow, confidence: windowConfidence } = deriveTrainingWindow(
    recentSessions.map(s => ({ date: new Date(s.date) })),
    timezone,
  )

  const todayISO = getLocalDateISO(now, timezone)

  // Completed today
  const todaySession = recentSessions.find(s =>
    getLocalDateISO(new Date(s.date), timezone) === todayISO
  )
  const completedTodayMuscles = todaySession
    ? todaySession.musclesTrained.join(", ")
    : null

  // Last completed session (excluding today)
  const prevSession = recentSessions.find(s =>
    getLocalDateISO(new Date(s.date), timezone) !== todayISO
  ) ?? (completedTodayMuscles ? null : recentSessions[0] ?? null)

  const lastSessionDate    = prevSession
    ? getLocalDateISO(new Date(prevSession.date), timezone)
    : state.lastSessionDate
  const lastSessionMuscles = prevSession?.musclesTrained.join(", ") ?? null
  const daysSinceLastSession = lastSessionDate
    ? daysBetween(lastSessionDate, todayISO)
    : 999

  // Completion rate last 7 days
  const weekAgo     = new Date(now.getTime() - 7 * 86_400_000)
  const completed7d = recentSessions.filter(s => new Date(s.date) >= weekAgo).length
  const completionRate7d = Math.min(1, completed7d / Math.max(1, daysPerWeek))

  // Consecutive misses
  const completedDateISOs = recentSessions.map(s =>
    getLocalDateISO(new Date(s.date), timezone)
  )
  const consecutiveMisses = computeConsecutiveMissesV2(
    completedDateISOs,
    daysPerWeek,
    todayISO,
  )

  // Next pending cycle day
  const nextDay = resolveNextCycleDay(user.splitState, user.intakeAnswers)

  // Training state
  const trainingState = resolveTrainingState({
    now,
    timezone,
    observedWindow,
    preferredCheckInTime:  user.preferredCheckInTime,
    lastSkipDateISO:       state.lastSkipDate,
    completedTodayMuscles,
    daysSinceLastSession,
    daysPerWeek,
    hasAnyHistory,
  })

  return {
    trainingState,
    observedWindow,
    windowConfidence,

    pendingMuscles:        nextDay?.muscles       ?? null,
    pendingSplitDayIndex:  nextDay?.splitDayIndex ?? null,
    completedTodayMuscles,

    consecutiveMisses,
    lastSessionDate,
    lastSessionMuscles,
    daysSinceLastSession,

    avgDurationMin:    state.avgSessionDurationMin,
    completionRate7d,
    daysPerWeek,

    isFlexibleUser:   isFlexible,
    hasAnyHistory,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARSERS (exported for use in gymCron.service.ts)
// ═══════════════════════════════════════════════════════════════════════════════

export function parseSplitStateMinimal(raw: unknown): SplitStateMinimal {
  const def: SplitStateMinimal = {
    lastCompletedDayIndex: null,
    avgSessionDurationMin: 60,
    lastSkipDate:          null,
    lastSessionDate:       null,
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return def
  const s = raw as Record<string, unknown>
  return {
    lastCompletedDayIndex: typeof s.lastCompletedDayIndex === "number" ? s.lastCompletedDayIndex : null,
    avgSessionDurationMin: typeof s.avgSessionDurationMin === "number" ? s.avgSessionDurationMin : 60,
    lastSkipDate:          typeof s.lastSkipDate   === "string" ? s.lastSkipDate   : null,
    lastSessionDate:       typeof s.lastSessionDate === "string" ? s.lastSessionDate : null,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATE / TIME UTILITIES (exported for gymCron use)
// ═══════════════════════════════════════════════════════════════════════════════

export function getLocalDateISO(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(date)
}

export function getLocalHour(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", hour12: false, timeZone: timezone,
  }).formatToParts(date)
  return parseInt(parts.find(p => p.type === "hour")?.value ?? "0")
}

export function daysBetween(isoA: string, isoB: string): number {
  const a = new Date(isoA + "T00:00:00Z")
  const b = new Date(isoB + "T00:00:00Z")
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 86_400_000))
}

export function subtractDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

function addDaysISO(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function addMinutesHHMM(hhmm: string, minutes: number): string {
  const [h = "0", m = "0"] = hhmm.split(":")
  const total = ((Number(h) * 60 + Number(m) + minutes) % (24 * 60) + 24 * 60) % (24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function hhmmToMinutes(hhmm: string): number {
  const [h = "0", m = "0"] = hhmm.split(":")
  return parseInt(h) * 60 + parseInt(m)
}

function resolveWindowEndHour(window: TrainingWindow, preferredTime: string | null): number {
  if (preferredTime) {
    const h = parseInt(preferredTime.split(":")[0] ?? "18")
    return Math.min(23, h + 3)
  }
  const map: Record<TrainingWindow, number> = {
    [TrainingWindow.MORNING]:   13,
    [TrainingWindow.AFTERNOON]: 19,
    [TrainingWindow.EVENING]:   23,
    [TrainingWindow.FLEXIBLE]:  22,
  }
  return map[window]
}

function resolveWindowStartHour(window: TrainingWindow, preferredTime: string | null): number {
  if (preferredTime) {
    const h = parseInt(preferredTime.split(":")[0] ?? "9")
    return Math.max(0, h - 1)
  }
  const map: Record<TrainingWindow, number> = {
    [TrainingWindow.MORNING]:   5,
    [TrainingWindow.AFTERNOON]: 11,
    [TrainingWindow.EVENING]:   17,
    [TrainingWindow.FLEXIBLE]:  8,
  }
  return map[window]
}

function parseRaw(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return raw as Record<string, string>
}
