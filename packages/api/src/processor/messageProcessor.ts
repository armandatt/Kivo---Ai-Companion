import { parseDate } from "chrono-node"
import { generateOpenAIText } from "../services/openai.service"

// ── Types ─────────────────────────────────────────────────────────────────────

type Intent =
  | "recovery_query" | "nutrition_query" | "pain_report" | "pr_log" | "lift_log"
  | "gym_checkin" | "soreness_log" | "missed_session" | "weight_log" | "energy_checkin"
  | "checkin_cancel" | "checkin_schedule" | "schedule_adjust" | "focus_start"
  | "planning" | "streak_check" | "progress_check" | "emotional_trigger"
  | "rest_day" | "deadline_set" | "weekly_review" | "completion" | "goal_set"
  | "general_chat"

type Emotion = "positive" | "negative" | "neutral"

type LLMAnalysis = {
  intent:           Intent
  emotion:          Emotion
  focusDurationMin: number | null
  timeShiftMin:     number | null
}

const VALID_INTENTS = new Set<string>([
  "recovery_query", "nutrition_query", "pain_report", "pr_log", "lift_log",
  "gym_checkin", "soreness_log", "missed_session", "weight_log", "energy_checkin",
  "checkin_cancel", "checkin_schedule", "schedule_adjust", "focus_start",
  "planning", "streak_check", "progress_check", "emotional_trigger",
  "rest_day", "deadline_set", "weekly_review", "completion", "goal_set",
  "general_chat",
])

// ── LLM call ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You classify messages sent to an AI accountability companion (gym + study + life goals).
Output ONLY a JSON object — no explanation, no markdown.

{
  "intent": <best matching intent>,
  "emotion": "positive" | "negative" | "neutral",
  "focusDurationMin": <integer minutes if user is starting a focus/study/work session with a stated duration, else null>,
  "timeShiftMin": <integer minutes if user asks to push/delay a scheduled check-in, else null>
}

INTENT OPTIONS (pick exactly one):
  recovery_query    — asking if it's okay to train, about overtraining, soreness
  nutrition_query   — asking about protein, diet, macros, food choices
  pain_report       — reporting an injury or pain during/after training
  pr_log            — logging a new personal record / max lift
  lift_log          — logging a specific set/rep/weight (squat, bench, deadlift, etc.)
  gym_checkin       — reporting they finished a workout session
  soreness_log      — reporting muscle soreness or DOMS
  missed_session    — reporting they skipped a planned workout
  weight_log        — logging their body weight
  energy_checkin    — reporting their energy or mood level
  checkin_cancel    — asking to stop or disable check-ins / reminders
  checkin_schedule  — asking to be checked on after a specific time ("check me in 30 min")
  schedule_adjust   — asking to push/delay something by a time amount
  focus_start       — starting a focus, study, or deep work session
  planning          — asking to create or update a weekly/daily plan
  streak_check      — asking about their streak count
  progress_check    — asking about progress, stats, or how they're doing
  emotional_trigger — expressing stress, burnout, feeling overwhelmed or emotional
  rest_day          — declaring they are taking a rest day
  deadline_set      — setting a new deadline for a task or exam
  weekly_review     — requesting a weekly summary or review
  completion        — reporting they completed a task, exam, workout, or goal
  goal_set          — setting a new goal
  general_chat      — everything else`

async function llmAnalyze(text: string): Promise<LLMAnalysis> {
  const raw = await generateOpenAIText({
    model:             "gpt-4o-mini",
    maxOutputTokens:   80,
    systemInstruction: SYSTEM_PROMPT,
    prompt:            text,
  })

  const json = JSON.parse(raw.replace(/```json|```/g, "").trim()) as Partial<LLMAnalysis>

  return {
    intent:           VALID_INTENTS.has(json.intent ?? "") ? (json.intent as Intent) : "general_chat",
    emotion:          (["positive", "negative", "neutral"] as const).includes(json.emotion as Emotion)
                        ? json.emotion as Emotion
                        : "neutral",
    focusDurationMin: typeof json.focusDurationMin === "number" ? json.focusDurationMin : null,
    timeShiftMin:     typeof json.timeShiftMin     === "number" ? json.timeShiftMin     : null,
  }
}

// ── Regex fallback (only used when OpenAI is unreachable) ─────────────────────

function regexIntent(t: string): Intent {
  if (/\b(should i train|overtraining|ok to train|train on sore)\b/.test(t))           return "recovery_query"
  if (/\b(how much protein|what should i eat|protein sources)\b/.test(t))              return "nutrition_query"
  if (/\b(pain|hurts|injury|sore.*when)\b/.test(t))                                    return "pain_report"
  if (/\b(new.*\bpr\b|new max|\bpr\b)\b/.test(t))                                      return "pr_log"
  if (/\b(bench|squat|deadlift|press|row|curl)\b.*\b(\d+\s*kg|\d+\s*x\s*\d+)\b/.test(t)) return "lift_log"
  if (/\b(done.*workout|finished.*training|hit the gym)\b/.test(t))                    return "gym_checkin"
  if (/\b(sore|doms)\b/.test(t))                                                        return "soreness_log"
  if (/\b(skipped|missed.*workout|didn.?t go)\b/.test(t))                              return "missed_session"
  if (/\b(i weigh|\d+\s*kg)\b/.test(t))                                                return "weight_log"
  if (/\b(no energy|low energy|feeling flat|energized)\b/.test(t))                     return "energy_checkin"
  if (/\b(stop|cancel|disable)\b.*\b(check.?in|remind)\b/.test(t))                     return "checkin_cancel"
  if (/\b(check|remind|ping|text me)\b.*\b\d+\s*(min|hour)\b/.test(t))                return "checkin_schedule"
  if (/\b(push|extend|delay)\b.*\b(hour|min)\b/.test(t))                               return "schedule_adjust"
  if (/\b(focus|pomodoro|timer|deep work)\b/.test(t))                                   return "focus_start"
  if (/\bplan\b.*\b(week|day|today)\b/.test(t))                                         return "planning"
  if (/\bstreak\b/.test(t))                                                             return "streak_check"
  if (/\b(progress|how am i|stats)\b/.test(t))                                         return "progress_check"
  if (/\b(burnout|overwhelmed|can.?t do this|rough day)\b/.test(t))                    return "emotional_trigger"
  if (/\b(rest day|skip today|day off)\b/.test(t))                                      return "rest_day"
  if (/\b(due|deadline|submit by|hand in)\b/.test(t))                                  return "deadline_set"
  if (/\b(weekly review|week in review)\b/.test(t))                                    return "weekly_review"
  if (/\b(done|finished|completed|passed)\b/.test(t))                                  return "completion"
  if (/\b(i want|my goal|i.?m trying to)\b/.test(t))                                   return "goal_set"
  return "general_chat"
}

function regexEmotion(t: string): Emotion {
  if (/tired|sad|bad|rough|exhausted|anxious|stressed|overwhelmed|lost/.test(t)) return "negative"
  if (/great|amazing|good|productive|excited|proud|done|finished/.test(t))       return "positive"
  return "neutral"
}

function extractFocusDurationMin(text: string): number | null {
  const m = text.match(/\b(\d{1,3})\s*(min|mins|minute|minutes)\b/)
  if (m) return Number(m[1])
  const h = text.match(/\b(\d{1,2})\s*(hour|hours|hr|hrs)\b/)
  if (h) return Number(h[1]) * 60
  return null
}

function extractTimeShiftMin(text: string): number | null {
  const h = text.match(/\b(\d{1,2})\s*(hour|hours|hr|hrs)\b/)
  if (h) return Number(h[1]) * 60
  const m = text.match(/\b(\d{1,3})\s*(min|mins|minute|minutes)\b/)
  if (m) return Number(m[1])
  return null
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function processMessage(text: string) {
  const cleanedText = text.toLowerCase().trim()

  let intent:           Intent = "general_chat"
  let emotion:          Emotion = "neutral"
  let focusDurationMin: number | null = null
  let timeShiftMin:     number | null = null

  try {
    const analysis    = await llmAnalyze(text)
    intent            = analysis.intent
    emotion           = analysis.emotion
    focusDurationMin  = analysis.focusDurationMin ?? extractFocusDurationMin(cleanedText)
    timeShiftMin      = analysis.timeShiftMin     ?? extractTimeShiftMin(cleanedText)
  } catch {
    // OpenAI unreachable — fall back to regex so the bot stays online
    intent           = regexIntent(cleanedText)
    emotion          = regexEmotion(cleanedText)
    focusDurationMin = extractFocusDurationMin(cleanedText)
    timeShiftMin     = extractTimeShiftMin(cleanedText)
  }

  // Date and deadline extraction stay with chrono-node — it's reliable
  const date           = parseDate(text)
  const deadlineLabel  = intent === "deadline_set"
    ? text.replace(/\b(due|deadline|by|on|at)\b/gi, " ").replace(/\s+/g, " ").trim()
    : null

  const entities = {
    date,
    goal:             intent === "goal_set" ? text : null,
    deadline:         deadlineLabel && date ? { label: deadlineLabel, dueAt: date } : null,
    focusDurationMin,
    timeShiftMin,
  }

  return {
    cleanedText,
    intent,
    emotion,
    entities,
    triggers: {
      startFocus:   intent === "focus_start",
      planning:     intent === "planning",
      saveDeadline: intent === "deadline_set",
      emotional:    intent === "emotional_trigger",
      gym:
        intent.startsWith("gym_") ||
        intent.endsWith("_log") ||
        intent === "missed_session" ||
        intent === "weight_log" ||
        intent === "energy_checkin" ||
        intent === "recovery_query" ||
        intent === "nutrition_query" ||
        intent === "pain_report",
    },
  }
}
