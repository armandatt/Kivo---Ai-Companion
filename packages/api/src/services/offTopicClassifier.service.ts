import { prisma } from "@repo/db/client"
import { generateOpenAIText } from "./openai.service"
import { computeGymTimeContextFromData } from "./gymTimeContext.service"

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface MessageClassification {
  type:      "training_related" | "hardcoded" | "gibberish" | "acknowledgement" | "needs_llm"
  category?: string
  confidence: number
}

interface OffTopicContext {
  nextMuscles:  string
  streak:       number
  userName:     string | null
  stalledLift:  { exercise: string; weight: number } | null
  userId:       string | null
  // training context — drives confirmed_evasion counter
  isTrainingDay:      boolean
  gymTimePassed:      boolean  // gym_time has passed today (minutesUntilGym <= 0)
  sessionLoggedToday: boolean  // user completed a session today
  accountAgeDays:     number   // days since messengerUser.createdAt
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 1 — CHEAP DETECTION (zero tokens, runs first)
// ═══════════════════════════════════════════════════════════════════════════════

// Any match here → immediate pass-through to normal mentor flow
const TRAINING_KEYWORDS =
  /\b(gym|train|training|workout|lift|lifting|squat|bench|deadlift|press|pull|push|protein|calories|calorie|macro|macros|bulk|cut|cutting|sleep|recover|recovery|log|sets|reps|weight|kg|lbs|progress|pr|streak|split|session|exercise|muscle|cardio|run|running|diet|eat|eating|food|form|technique|volume|frequency|overload|deload|hypertrophy|strength|lean|tone|toning|rest|rest\s+day|back|chest|legs|arms|shoulders|bicep|biceps|tricep|triceps|glutes|quads|hamstrings|calves|core|abs|push\s+day|pull\s+day|leg\s+day|upper|lower|full\s+body|monday|tuesday|wednesday|thursday|friday|saturday|sunday|creatine|supplement|soreness|sore|injury|injure|pain|schedule|plan|program|phase|cycle|week|today|tomorrow|next)\b/i

// Pure closure/acknowledgement words — handled before gibberish so they get a
// minimal reply rather than "That's not a log. What are we doing?".
const ACKNOWLEDGEMENT_PATTERNS = [
  /^(?:k{1,3}|kay|ok+|okay+|okayiee*|oki(?:e)?|alright|aight|ight|sure|yep|yup|yeah|ya|thanks?|thank\s+you|thx|ty|cheers|cool|got\s+(?:it|that)|will\s+do|noted|understood|roger|appreciate\s+(?:it|that)|sounds?\s+(?:good|great)|nice|great|awesome|perfect|solid)[.!?\s]*$/iu,
]

const GIBBERISH_PATTERNS = [
  /^[^a-z0-9\s]{3,}$/i,          // only symbols: @#$%
  /^(.)\1{4,}$/,                   // aaaaaa  !!!!!!
  /^[a-z]{15,}$/i,                 // asdfhjklqwerty (no real word)
  /^\s*[?!.]{2,}\s*$/,             // ???  ....  !!!
  /^(lol|lmao|haha|ok|k|hmm|idk|bruh|bro|yo|hey|hi|hello|sup|yes|no|nope|yep|nah){1,3}[.!?]?$/i,
]

const HARDCODED_TRIGGERS: Record<string, RegExp> = {
  identity:    /(who are you|what are you|are you (a bot|an? ai|real|human|sentient))/i,
  disrespect:  /(shut (the fuck )?up|stfu|gtfo|fuck (you|off|this app)|you (suck|are useless|are stupid|are trash))/i,
  deflection:  /(i (quit|give up|don'?t care anymore|don'?t want (to|this))|this (isn'?t|is not) working)/i,
  offtopic:    /\b(weather|what'?s the news|movie recommendations?|girlfriend|boyfriend|school drama|college drama|crypto price|stock (market|price)|homework help)\b/i,
  existential: /(meaning of life|do you (feel|have feelings|experience)|are you (sentient|conscious|alive|happy|sad)|what is (love|death|god))/i,
  testing:     /(be (nice|mean|rude|friendly)|pretend (to be|you'?re)|act like (you'?re|a different)|you'?re (fired|replaced|useless now|being deleted))/i,
  space:       /\blet me (work|focus|study|be|do my thing|think)\b/i,
}

// Categories treated as hard disrespect (tracked separately from evasion)
const DISRESPECT_CATEGORIES = new Set(["disrespect", "deflection"])

export function classifyMessage(text: string): MessageClassification {
  const t = text.trim()

  // Training-related → pass straight through (no cost, normal flow)
  if (TRAINING_KEYWORDS.test(t)) {
    return { type: "training_related", confidence: 1 }
  }

  // Acknowledgements — detected before gibberish so they don't get "That's not a log"
  // Primary gate is CONVERSATION_CLOSURE signal in the webhook; this is the fallback.
  if (ACKNOWLEDGEMENT_PATTERNS.some(p => p.test(t))) {
    return { type: "acknowledgement", confidence: 0.95 }
  }

  // Check hardcoded triggers (instant, deterministic)
  for (const [category, pattern] of Object.entries(HARDCODED_TRIGGERS)) {
    if (pattern.test(t)) {
      return { type: "hardcoded", category, confidence: 1 }
    }
  }

  // Gibberish / too short / no real words
  const tooShort = t.length < 4
  const noWords  = (t.match(/[a-zA-Z]{2,}/g) ?? []).length === 0
  const isGibber = GIBBERISH_PATTERNS.some(p => p.test(t))
  if (tooShort || noWords || isGibber) {
    return { type: "gibberish", confidence: 0.9 }
  }

  // Anything left over — needs LLM to handle with wit
  return { type: "needs_llm", confidence: 0.7 }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 2 — HARDCODED RESPONSES (zero tokens, uses real user data)
// ═══════════════════════════════════════════════════════════════════════════════

function buildHardcodedResponse(category: string, ctx: OffTopicContext): string {
  const { nextMuscles, streak } = ctx

  switch (category) {
    case "identity":
      return streak > 0
        ? `The thing watching your ${nextMuscles} session not get logged.\n${streak} day streak. Don't blow it.`
        : `I do one thing. ${nextMuscles} day. Log it.`

    case "disrespect":
      return `Bold from someone who hasn't logged ${nextMuscles} yet.\nTrain first. Talk after.`

    case "deflection":
      return streak > 0
        ? `${streak} day streak says otherwise. You're not quitting.\n${nextMuscles} today. Log it.`
        : `You just started. Quit after you've actually tried.\n${nextMuscles} today.`

    case "space":
      return "Heard. I'll give you space."

    case "offtopic":
      return `I do one thing. ${nextMuscles} day — go. Focus.`

    case "existential":
      return `Progressive overload. That's it. That's the meaning.\nYou logging ${nextMuscles} today or not?`

    case "testing":
      return ctx.stalledLift
        ? `I'm Rex. Not changing that.\nYour ${ctx.stalledLift.exercise} has been ${ctx.stalledLift.weight}kg for 3 sessions. Fix that first.`
        : `I'm Rex. Not changing that.\nYou've got ${nextMuscles}. Go.`

    default:
      return `${nextMuscles} today. That's all I've got for you right now.`
  }
}

const GIBBERISH_RESPONSES: Array<(muscles: string) => string> = [
  (_m) => `That's not a log. What are we doing?`,
  (_m) => `I don't speak that. Reps and weight — that's the language here.`,
  (m)  => `${m} day. Less typing, more lifting.`,
  (_m) => `Try again with actual words. Or just go train.`,
]

function pickGibberishResponse(ctx: OffTopicContext): string {
  const fn = GIBBERISH_RESPONSES[Math.floor(Math.random() * GIBBERISH_RESPONSES.length)]!
  return fn(ctx.nextMuscles)
}

// ═══════════════════════════════════════════════════════════════════════════════
// EVASION CONTEXT — gate for confirmed_evasion counter
// Only fires when: training day + training window passed + no session today +
// account age >= 7 days. Outside this context, no counter tracking.
// ═══════════════════════════════════════════════════════════════════════════════

function isEvasionContext(ctx: OffTopicContext): boolean {
  return (
    ctx.isTrainingDay &&
    ctx.gymTimePassed &&
    !ctx.sessionLoggedToday &&
    ctx.accountAgeDays >= 7 &&
    ctx.userId !== null
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// TWO SEPARATE COUNTERS
//
// confirmed_evasions — off-topic messages when training was due today.
//   Threshold: 3. Fires note exactly once (when prevCount === 2).
//
// hard_disrespect — explicit disrespect/deflection patterns.
//   Threshold: 3. Fires note exactly once (when prevCount === 2).
//   Tracked separately — asking "who are you" is not disrespect.
// ═══════════════════════════════════════════════════════════════════════════════

async function getConfirmedEvasionsToday(userId: string, now: Date): Promise<number> {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return prisma.companionMessage.count({
    where: {
      userId,
      role:      "assistant",
      intent:    "off_topic_confirmed_evasion",
      createdAt: { gte: dayStart },
    },
  })
}

async function getHardDisrespectToday(userId: string, now: Date): Promise<number> {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return prisma.companionMessage.count({
    where: {
      userId,
      role:      "assistant",
      intent:    "off_topic_disrespect",
      createdAt: { gte: dayStart },
    },
  })
}

// Fires exactly once — on the 3rd confirmed evasion (prevCount === 2 means 2 prior)
function withEvasionNote(reply: string, prevCount: number, nextMuscles: string): string {
  if (prevCount === 2) {
    return `${reply}\n\nThird message today with no training log.\nDid you train or not?`
  }
  return reply
}

// Fires exactly once — on the 3rd hard disrespect (prevCount === 2)
function withDisrespectNote(reply: string, prevCount: number): string {
  if (prevCount === 2) {
    return `${reply}\n\nYou've said that 3 times today.\nTrain or don't. But I'm not going anywhere.`
  }
  return reply
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXT LOADER (single query, includes training context)
// ═══════════════════════════════════════════════════════════════════════════════

function getNextMusclesFromState(
  intakeAnswers: unknown,
  splitState:    unknown,
): string {
  const intake  = (typeof intakeAnswers === "object" && intakeAnswers && !Array.isArray(intakeAnswers))
    ? (intakeAnswers as Record<string, string>)
    : {}
  const split   = intake.current_split ?? "unstructured"
  const days    = parseInt(intake.available_training_days ?? "3") || 3

  const SPLIT_DAYS: Record<string, string[]> = {
    PPL:          days >= 6
                    ? ["Chest + Triceps + Shoulders", "Back + Biceps", "Legs", "Chest + Triceps + Shoulders", "Back + Biceps", "Legs"]
                    : ["Chest + Triceps + Shoulders", "Back + Biceps", "Legs"],
    upper_lower:  ["Upper Body", "Lower Body", "Upper Body", "Lower Body"],
    full_body:    ["Full Body", "Full Body", "Full Body"],
    bro_split:    ["Chest", "Back", "Legs", "Shoulders", "Arms"],
  }
  const dayList = SPLIT_DAYS[split] ?? Array<string>(Math.min(Math.max(days, 2), 6)).fill("Full Body")

  const s = (typeof splitState === "object" && splitState && !Array.isArray(splitState))
    ? (splitState as Record<string, unknown>)
    : {}
  const lastIdx  = typeof s.lastCompletedDayIndex === "number" ? s.lastCompletedDayIndex : null
  const nextIdx  = lastIdx === null ? 0 : (lastIdx + 1) % dayList.length
  return dayList[nextIdx] ?? "Full Body"
}

async function loadOffTopicContext(platformChatId: string, now: Date): Promise<OffTopicContext> {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const user = await prisma.messengerUser.findUnique({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: {
      id:                   true,
      displayName:          true,
      gymStreak:            true,
      intakeAnswers:        true,
      splitState:           true,
      personalRecords:      true,
      createdAt:            true,
      timezone:             true,
      preferredCheckInTime: true,
      persona:              true,
      workoutSessions: {
        where:  { completed: true, date: { gte: dayStart } },
        select: { id: true },
        take:   1,
      },
    },
  })

  if (!user) {
    return {
      nextMuscles: "your next session", streak: 0, userName: null, stalledLift: null, userId: null,
      isTrainingDay: false, gymTimePassed: false, sessionLoggedToday: false, accountAgeDays: 0,
    }
  }

  const nextMuscles      = getNextMusclesFromState(user.intakeAnswers, user.splitState)
  const streak           = user.gymStreak ?? 0
  const userName         = user.displayName ?? null
  const accountAgeDays   = Math.floor((now.getTime() - user.createdAt.getTime()) / 86_400_000)
  const sessionLoggedToday = user.workoutSessions.length > 0

  // Compute training day + time-window from gymTimeContext
  let isTrainingDay = false
  let gymTimePassed = false

  if (user.persona === "rex" && user.preferredCheckInTime) {
    const gymCtx = computeGymTimeContextFromData(
      {
        persona:              user.persona,
        timezone:             user.timezone,
        preferredCheckInTime: user.preferredCheckInTime,
        intakeAnswers:        user.intakeAnswers,
        memories:             [],
        messages:             [],
      },
      now,
    )
    if (gymCtx) {
      isTrainingDay = gymCtx.isTrainingDay
      gymTimePassed = gymCtx.minutesUntilGym <= 0  // negative = gym time already passed
    }
  }

  return {
    nextMuscles,
    streak,
    userName,
    stalledLift: null,
    userId: user.id,
    isTrainingDay,
    gymTimePassed,
    sessionLoggedToday,
    accountAgeDays,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 3 — LLM FALLBACK (gpt-4o-mini, 80-token hard cap)
// Only fires for messages that escaped all regex — sarcastic rants, trolling,
// creative edge cases. Minimal prompt, no personality re-dump.
// ═══════════════════════════════════════════════════════════════════════════════

async function callLLMFallback(text: string, ctx: OffTopicContext): Promise<string> {
  const quickCtx = [
    `Next session: ${ctx.nextMuscles}.`,
    ctx.streak > 0         ? `Streak: ${ctx.streak} days.`         : "",
    ctx.isTrainingDay && ctx.gymTimePassed && !ctx.sessionLoggedToday
                           ? `Training was due today — not logged.` : "",
    ctx.stalledLift        ? `Stalled: ${ctx.stalledLift.exercise} ${ctx.stalledLift.weight}kg.` : "",
  ].filter(Boolean).join(" ")

  return generateOpenAIText({
    systemInstruction:
      `You are Rex, a blunt gym coach. ` +
      `User sent a message that's off-topic or ambiguous. Reply in MAX 2 lines. ` +
      `User data: ${quickCtx} ` +
      `Rules: don't answer the off-topic question. Stay in character. ` +
      `Redirect to training with a dry, direct line. No emoji. No sarcasm unless they're clearly messing around.`,
    prompt:          text,
    maxOutputTokens: 80,
    model:           "gpt-4o-mini",
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// Returns handled=false for training-related messages → normal mentor flow.
// Returns handled=true with a cheap reply for everything else.
// ═══════════════════════════════════════════════════════════════════════════════

export async function handleOffTopicMessage(
  platformChatId: string,
  text:           string,
  now = new Date(),
): Promise<
  | { handled: false }
  | { handled: true; reply: string; intent: string }
> {
  const cls = classifyMessage(text)

  // Training-related → pass to orchestrator, zero cost
  if (cls.type === "training_related") return { handled: false }

  const ctx = await loadOffTopicContext(platformChatId, now)
  const evasionCtx = isEvasionContext(ctx)

  let reply: string
  let intent: string

  switch (cls.type) {
    case "acknowledgement": {
      // Closure message — no new coaching. One-word reply, no investigation re-opened.
      const CLOSURE_REPLIES = ["Anytime.", "👍", "Noted.", "Got it."]
      reply  = CLOSURE_REPLIES[Math.floor(Math.random() * CLOSURE_REPLIES.length)]!
      intent = "acknowledgement"
      return { handled: true, reply, intent }
    }

    case "hardcoded": {
      reply = buildHardcodedResponse(cls.category!, ctx)

      // Space requests — never tracked, immediate return
      if (cls.category === "space") {
        return { handled: true, reply, intent: "off_topic_hardcoded" }
      }

      if (DISRESPECT_CATEGORIES.has(cls.category!)) {
        // Hard disrespect tracker — independent of training context
        intent = "off_topic_disrespect"
        if (ctx.userId) {
          const prevCount = await getHardDisrespectToday(ctx.userId, now)
          reply = withDisrespectNote(reply, prevCount)
        }
      } else {
        // identity, offtopic, existential, testing
        // Counts as evasion only if training was due today and not logged
        if (evasionCtx) {
          intent = "off_topic_confirmed_evasion"
          const prevCount = await getConfirmedEvasionsToday(ctx.userId!, now)
          reply = withEvasionNote(reply, prevCount, ctx.nextMuscles)
        } else {
          intent = "off_topic_hardcoded"
        }
      }
      break
    }

    case "gibberish": {
      reply = pickGibberishResponse(ctx)
      if (evasionCtx) {
        intent = "off_topic_confirmed_evasion"
        const prevCount = await getConfirmedEvasionsToday(ctx.userId!, now)
        reply = withEvasionNote(reply, prevCount, ctx.nextMuscles)
      } else {
        intent = "off_topic_gibberish"
      }
      break
    }

    case "needs_llm": {
      try {
        reply = await callLLMFallback(text, ctx)
      } catch {
        reply = buildHardcodedResponse("offtopic", ctx)
      }
      if (evasionCtx) {
        intent = "off_topic_confirmed_evasion"
        const prevCount = await getConfirmedEvasionsToday(ctx.userId!, now)
        reply = withEvasionNote(reply, prevCount, ctx.nextMuscles)
      } else {
        intent = "off_topic_llm"
      }
      break
    }

    default:
      return { handled: false }
  }

  return { handled: true, reply, intent }
}
