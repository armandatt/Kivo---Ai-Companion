import { prisma } from "@repo/db/client"
import type { GymTimeContext } from "./gymTimeContext.service"
import type { FeelRating } from "./workoutTracking.service"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PreSessionExtras {
  stallInfo:         { exercise: string; weightKg: number; sessions: number } | null
  isDeloadWeek:      boolean
  lastFeelRating:    FeelRating | null
  sessionsAtWeight:  { exercise: string; weightKg: number; count: number } | null
}

export interface ChaseExtras {
  todayMuscles:       string
  consecutiveMisses:  number
  lastSessionMuscles: string | null
  lastSessionDaysAgo: number | null
}

export interface RestDayExtras {
  lastFeelRating:       FeelRating | null
  nextSessionMuscles:   string
  daysUntilNextSession: number
  stallInfo:            { exercise: string; weightKg: number; sessions: number } | null
}

export interface DailyCheckInExtras {
  patternFlags:      string[]
  activeCommitments: Array<{ title: string; daysLeft: number }>
}

export interface ReactivationExtras {
  lastUserMessages:   string[]
  lastWorkoutMuscles: string | null
  lastWorkoutDaysAgo: number
}

export interface CommitmentExtras {
  progressSummary: string | null
}

export interface SchedulerJobContext {
  platformChatId: string
  gymCtx:         GymTimeContext | null
  user: {
    displayName:   string | null
    gymStreak:     number
    intakeAnswers: unknown
    splitState:    unknown
  }
  preSessionExtras?:   PreSessionExtras
  chaseExtras?:        ChaseExtras
  restDayExtras?:      RestDayExtras
  dailyCheckInExtras?: DailyCheckInExtras
  reactivationExtras?: ReactivationExtras
  commitmentExtras?:   CommitmentExtras
}

export interface WeeklySummaryStats {
  sessionsCompleted:   number
  sessionsPlanned:     number
  bestLift:            { exercise: string; weightKg: number; reps: number } | null
  gapArea:             string | null
  cycleNumber:         number
  feelRatingTrend?:    string[]
  commitmentProgress?: string | null
  momentContext?:      string[]
}

// ─── Message Provider Interface ───────────────────────────────────────────────

export interface SchedulerMessageProvider {
  readonly persona: string

  // Category 1 — Check-In Schedulers
  dailyCheckIn(ctx: SchedulerJobContext, now: Date):                              Promise<string>
  preSessionFireUp(ctx: SchedulerJobContext):                                     Promise<string>
  postSessionLogPrompt(muscles: string):                                          string
  missedSessionChase(attempt: 1 | 2, ctx: SchedulerJobContext):                  Promise<string>
  restDayMorning(ctx: SchedulerJobContext):                                       Promise<string | null>
  backdatePrompt():                                                               string

  // Category 3 — Preset / Event Schedulers
  silenceReactivation(hasSessions: boolean, ctx: SchedulerJobContext):           Promise<string>
  streakMilestone(streak: number):                                               string
  prAlert(exercise: string, weightKg: number, reps: number):                    string
  weeklySummary(stats: WeeklySummaryStats, ctx: SchedulerJobContext):           Promise<string>
  commitmentFollowUp(title: string, daysLeft: number, ctx: SchedulerJobContext): Promise<string>
  commitmentMissed(title: string):                                               string
}

// ─── Quiet Hours ──────────────────────────────────────────────────────────────

const DEFAULT_QUIET_START = 23
const DEFAULT_QUIET_END   = 7

export function isInQuietHours(intakeAnswers: unknown, localHHMM: string): boolean {
  const answers   = parseAnswers(intakeAnswers)
  const sleepStr  = answers.sleep_time  ?? answers.quiet_start ?? `${DEFAULT_QUIET_START}:00`
  const wakeStr   = answers.wake_time   ?? answers.quiet_end   ?? `${DEFAULT_QUIET_END}:00`

  const current  = hhmmToMinutes(localHHMM)
  const sleepMin = hhmmToMinutes(sleepStr)
  const wakeMin  = hhmmToMinutes(wakeStr)

  if (sleepMin > wakeMin) return current >= sleepMin || current < wakeMin
  return current >= sleepMin && current < wakeMin
}

// ─── Global Fire Rules ────────────────────────────────────────────────────────

export interface GlobalFireRulesInput {
  platformChatId: string
  timezone:       string
  now:            Date
  intakeAnswers:  unknown
  intakeComplete: boolean
  splitState:     unknown
}

export async function checkGlobalFireRules(input: GlobalFireRulesInput): Promise<boolean> {
  const { platformChatId, timezone, now, intakeAnswers, intakeComplete, splitState } = input

  if (!intakeComplete) return false
  if (isInActiveLogging(splitState)) return false

  const localHHMM = getLocalHHMM(now, timezone)
  if (isInQuietHours(intakeAnswers, localHHMM)) return false

  if (await messagedRecently(platformChatId, now, 10)) return false

  return true
}

async function messagedRecently(platformChatId: string, now: Date, minutes: number): Promise<boolean> {
  const since = new Date(now.getTime() - minutes * 60 * 1000)
  const user  = await prisma.messengerUser.findUnique({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: {
      messages: {
        where:  { role: "user", createdAt: { gte: since } },
        select: { id: true },
        take:   1,
      },
    },
  })
  return Boolean(user?.messages.length)
}

function isInActiveLogging(splitState: unknown): boolean {
  if (!splitState || typeof splitState !== "object" || Array.isArray(splitState)) return false
  const s = splitState as Record<string, unknown>
  return s.activeLogging !== null && s.activeLogging !== undefined
}

// ─── Merge Engine ─────────────────────────────────────────────────────────────

export function mergeSchedulerMessages<
  T extends { chatId: string; text: string; intent: string }
>(messages: T[]): T[] {
  const byChat = new Map<string, T[]>()
  for (const m of messages) {
    const bucket = byChat.get(m.chatId) ?? []
    bucket.push(m)
    byChat.set(m.chatId, bucket)
  }

  const merged: T[] = []
  for (const [, bucket] of byChat) {
    if (bucket.length === 1) {
      merged.push(bucket[0]!)
      continue
    }
    const sorted  = [...bucket].sort((a, b) => intentPriority(a.intent) - intentPriority(b.intent))
    const primary = sorted[0]!
    const text    = sorted.map(m => m.text).join("\n\n---\n\n")
    merged.push({ ...primary, text, intent: primary.intent })
  }

  return merged
}

const INTENT_PRIORITY: Record<string, number> = {
  commitment_followup: 1,
  rex_pre_session:     2,
  rex_daily_checkin:   2,
  rex_auto_prompt:     3,
  rex_post_session:    3,
  custom_reminder:     4,
  rex_weekly_summary:  5,
  rex_rest_day:        5,
  rex_silence_check:   6,
}

function intentPriority(intent: string): number {
  return INTENT_PRIORITY[intent] ?? 9
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseAnswers(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return raw as Record<string, string>
}

function hhmmToMinutes(hhmm: string): number {
  const [h = "0", m = "0"] = hhmm.split(":")
  return parseInt(h, 10) * 60 + parseInt(m, 10)
}

export function getLocalHHMM(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone,
  }).format(now)
}
