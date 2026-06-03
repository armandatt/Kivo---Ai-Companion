import { prisma } from "@repo/db/client"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GymTimeContext {
  localTimeStr:       string   // "06:20, Monday 3 June"
  gymTimeStr:         string   // "07:00"
  minutesUntilGym:    number   // negative = gym time already passed today
  isTrainingDay:      boolean
  todayMuscles:       string   // "Chest + Triceps + Shoulders"
  lastSessionDaysAgo: number   // 999 = no gym messages found
  lastLiftSummary:    string   // "bench 82.5kg, squat 100kg, deadlift 120kg"
  mode:               "pre_workout" | "session" | "recovery" | "rest_day"
  daysPerWeek:        number
  splitType:          string
}

export type GymContextInput = {
  timezone:             string | null
  preferredCheckInTime: string | null
  intakeAnswers:        unknown
  memories:             Array<{ key: string | null; value: string }>
  messages:             Array<{ role: string; intent: string | null; createdAt: Date }>
}

const GYM_INTENTS = [
  "gym_checkin", "lift_log", "pr_log", "soreness_log",
  "missed_session", "weight_log", "energy_checkin",
]

// ─── Sync computation (used by orchestrator with preloaded data) ──────────────

export function computeGymTimeContextFromData(
  data: GymContextInput & { persona?: string | null },
  now: Date
): GymTimeContext | null {
  if (data.persona !== undefined && data.persona !== "rex") return null
  if (!data.preferredCheckInTime) return null
  return compute(data, now)
}

// ─── Async build (used by cron jobs — makes its own DB query) ─────────────────

export async function buildGymTimeContext(
  platformChatId: string,
  now: Date
): Promise<GymTimeContext | null> {
  const user = await prisma.messengerUser.findUnique({
    where: { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: {
      persona:              true,
      timezone:             true,
      preferredCheckInTime: true,
      intakeAnswers:        true,
      memories: {
        where:   { type: "anchor" },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select:  { key: true, value: true },
      },
      messages: {
        where:   { role: "user", intent: { in: GYM_INTENTS } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select:  { role: true, intent: true, createdAt: true },
      },
    },
  })

  if (!user || user.persona !== "rex") return null
  return compute(user, now)
}

// ─── Core computation ─────────────────────────────────────────────────────────

function compute(data: GymContextInput, now: Date): GymTimeContext | null {
  if (!data.preferredCheckInTime) return null

  const tz      = data.timezone ?? "Asia/Kolkata"
  const intake  = parseAnswers(data.intakeAnswers)
  const split   = intake.current_split ?? "unstructured"
  const daysPerWeek = parseInt(intake.available_training_days ?? "3") || 3

  const local = getLocalParts(now, tz)
  const minutesUntilGym = minutesBetween(local.hhmm, data.preferredCheckInTime)

  const { isTrainingDay, todayMuscles } = getSplitDayInfo(split, daysPerWeek, local.weekdayNum)

  const liftFact = data.memories.find(
    m => (m.key ?? "").includes("lifts") || m.value.includes("lifts")
  )
  const lastLiftSummary = liftFact ? parseLiftSummary(liftFact.value) : ""

  const gymMessages = data.messages.filter(
    m => m.role === "user" && GYM_INTENTS.includes(m.intent ?? "")
  )
  const lastGymMsg = gymMessages.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )[0]
  const lastSessionDaysAgo = lastGymMsg
    ? Math.floor((now.getTime() - new Date(lastGymMsg.createdAt).getTime()) / 86_400_000)
    : 999

  return {
    localTimeStr:    `${local.timeStr}, ${local.weekday} ${local.dayMonth}`,
    gymTimeStr:      data.preferredCheckInTime,
    minutesUntilGym,
    isTrainingDay,
    todayMuscles,
    lastSessionDaysAgo,
    lastLiftSummary,
    mode:            deriveMode(minutesUntilGym, isTrainingDay),
    daysPerWeek,
    splitType:       split,
  }
}

// ─── Split → day info ─────────────────────────────────────────────────────────

export function getSplitDayInfo(
  split: string,
  daysPerWeek: number,
  weekdayNum: number  // 0=Sun … 6=Sat
): { isTrainingDay: boolean; todayMuscles: string } {
  type DayMap = Record<number, { training: boolean; muscles: string }>
  const rest = { training: false, muscles: "Rest" }

  if (split === "PPL") {
    const map: DayMap = {
      0: rest,
      1: { training: true, muscles: "Chest + Triceps + Shoulders" },
      2: { training: true, muscles: "Back + Biceps" },
      3: { training: true, muscles: "Legs" },
      4: { training: true, muscles: "Chest + Triceps + Shoulders" },
      5: { training: true, muscles: "Back + Biceps" },
      6: { training: true, muscles: "Legs" },
    }
    const d = map[weekdayNum] ?? rest
    return { isTrainingDay: d.training, todayMuscles: d.muscles }
  }

  if (split === "upper_lower") {
    const map: DayMap = {
      0: rest,
      1: { training: true, muscles: "Upper Body (Chest / Back / Shoulders / Arms)" },
      2: { training: true, muscles: "Lower Body (Quads / Hamstrings / Glutes)" },
      3: rest,
      4: { training: true, muscles: "Upper Body (Chest / Back / Shoulders / Arms)" },
      5: { training: true, muscles: "Lower Body (Quads / Hamstrings / Glutes)" },
      6: rest,
    }
    const d = map[weekdayNum] ?? rest
    return { isTrainingDay: d.training, todayMuscles: d.muscles }
  }

  if (split === "full_body") {
    const days = new Set([1, 3, 5])  // MWF
    const training = days.has(weekdayNum)
    return { isTrainingDay: training, todayMuscles: training ? "Full Body" : "Rest" }
  }

  if (split === "bro_split") {
    const map: DayMap = {
      0: rest,
      1: { training: true, muscles: "Chest" },
      2: { training: true, muscles: "Back" },
      3: { training: true, muscles: "Legs" },
      4: { training: true, muscles: "Shoulders" },
      5: { training: true, muscles: "Arms" },
      6: rest,
    }
    const d = map[weekdayNum] ?? rest
    return { isTrainingDay: d.training, todayMuscles: d.muscles }
  }

  // Unstructured: estimate from daysPerWeek
  if (daysPerWeek >= 6) {
    const training = weekdayNum !== 0
    return { isTrainingDay: training, todayMuscles: training ? "Full Body" : "Rest" }
  }
  if (daysPerWeek >= 4) {
    const training = new Set([1, 2, 4, 5]).has(weekdayNum)
    return { isTrainingDay: training, todayMuscles: training ? "Full Body" : "Rest" }
  }
  const training = new Set([1, 3, 5]).has(weekdayNum)  // MWF
  return { isTrainingDay: training, todayMuscles: training ? "Full Body" : "Rest" }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getLocalParts(now: Date, timezone: string) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone,
  })
  const parts = fmt.formatToParts(now)
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "00"

  const hour    = get("hour")
  const minute  = get("minute")
  const weekday = get("weekday")
  const weekdayMap: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  }

  return {
    timeStr:    `${hour}:${minute}`,
    hhmm:       `${hour}:${minute}`,
    weekday:    weekday.charAt(0).toUpperCase() + weekday.slice(1),
    dayMonth:   `${get("day")} ${get("month")}`,
    weekdayNum: weekdayMap[weekday.toLowerCase()] ?? 1,
  }
}

export function minutesBetween(currentHHMM: string, targetHHMM: string): number {
  const [ch = 0, cm = 0] = currentHHMM.split(":").map(Number)
  const [th = 0, tm = 0] = targetHHMM.split(":").map(Number)
  return (th * 60 + tm) - (ch * 60 + cm)
}

function deriveMode(minutesUntilGym: number, isTrainingDay: boolean): GymTimeContext["mode"] {
  if (!isTrainingDay)                                     return "rest_day"
  if (minutesUntilGym > 0 && minutesUntilGym <= 120)     return "pre_workout"
  if (minutesUntilGym <= 0 && minutesUntilGym >= -120)   return "session"
  return "recovery"
}

function parseAnswers(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return raw as Record<string, string>
}

function parseLiftSummary(value: string): string {
  const match = value.match(/(?:lifts\s*[-—]\s*)(.+)/i)
  return match ? match[1].trim() : value
}
