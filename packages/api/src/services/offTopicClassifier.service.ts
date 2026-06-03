import { prisma } from "@repo/db/client"
import { generateOpenAIText } from "./openai.service"

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface MessageClassification {
  type:      "training_related" | "hardcoded" | "gibberish" | "needs_llm"
  category?: string
  confidence: number
}

interface OffTopicContext {
  nextMuscles:  string
  streak:       number
  userName:     string | null
  stalledLift:  { exercise: string; weight: number } | null
  userId:       string | null
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 1 — CHEAP DETECTION (zero tokens, runs first)
// ═══════════════════════════════════════════════════════════════════════════════

// Any match here → immediate pass-through to normal mentor flow
const TRAINING_KEYWORDS =
  /\b(gym|train|workout|lift|squat|bench|deadlift|press|pull|push|protein|calories|macro|bulk|cut|sleep|recover|log|sets|reps|weight|kg|lbs|progress|pr|streak|split|session|exercise|muscle|cardio|run|diet|eat|food|form|technique|volume|frequency|overload|deload|hypertrophy|strength|cut|bulk|lean|tone)\b/i

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

export function classifyMessage(text: string): MessageClassification {
  const t = text.trim()

  // Training-related → pass straight through (no cost, normal flow)
  if (TRAINING_KEYWORDS.test(t)) {
    return { type: "training_related", confidence: 1 }
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
      return `Bold from someone who hasn't logged ${nextMuscles} yet.\nTrain first. Talk after. 💪`

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
  (m) => `That's not a log. What are we doing?`,
  (m) => `I don't speak that. Reps and weight — that's the language here.`,
  (m) => `${m} day. Less typing, more lifting.`,
  (m) => `Try again with actual words. Or just go train.`,
]

function pickGibberishResponse(ctx: OffTopicContext): string {
  const fn = GIBBERISH_RESPONSES[Math.floor(Math.random() * GIBBERISH_RESPONSES.length)]!
  return fn(ctx.nextMuscles)
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPEAT OFFENDER (tracked via CompanionMessage.intent — zero schema changes)
// ═══════════════════════════════════════════════════════════════════════════════

async function getPreviousOffTopicCountToday(userId: string, now: Date): Promise<number> {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return prisma.companionMessage.count({
    where: {
      userId,
      role:      "assistant",
      intent:    { startsWith: "off_topic_" },
      createdAt: { gte: dayStart },
    },
  })
}

function withRepeatOffenderNote(reply: string, prevCount: number, nextMuscles: string): string {
  if (prevCount === 1) {
    // This is the 2nd off-topic response today
    return `${reply}\n\nYou've dodged training twice today. Everything actually okay?`
  }
  if (prevCount >= 2) {
    // 3rd+ — replace the whole thing
    return `Third time avoiding ${nextMuscles} today.\nThat's not boredom. What's going on?`
  }
  return reply
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXT LOADER (minimal — fast single query, no gym pipeline)
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

async function loadOffTopicContext(platformChatId: string): Promise<OffTopicContext> {
  const user = await prisma.messengerUser.findUnique({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: {
      id:              true,
      displayName:     true,
      gymStreak:       true,
      intakeAnswers:   true,
      splitState:      true,
      personalRecords: true,
    },
  })

  if (!user) {
    return { nextMuscles: "your next session", streak: 0, userName: null, stalledLift: null, userId: null }
  }

  const nextMuscles = getNextMusclesFromState(user.intakeAnswers, user.splitState)
  const streak      = user.gymStreak ?? 0
  const userName    = user.displayName ?? null

  // Stalled lift: cheaply inferred from personalRecords entry age isn't available here,
  // so we skip the extra query and leave it null — hardcoded responses degrade gracefully.
  const stalledLift = null

  return { nextMuscles, streak, userName, stalledLift, userId: user.id }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 3 — LLM FALLBACK (gpt-4o-mini, 80-token hard cap)
// Only fires for messages that escaped all regex — sarcastic rants, trolling,
// creative edge cases. Minimal prompt, no personality re-dump.
// ═══════════════════════════════════════════════════════════════════════════════

async function callLLMFallback(text: string, ctx: OffTopicContext): Promise<string> {
  const quickCtx = [
    `Next session: ${ctx.nextMuscles}.`,
    ctx.streak > 0   ? `Streak: ${ctx.streak} days.`         : "",
    ctx.stalledLift  ? `Stalled: ${ctx.stalledLift.exercise} ${ctx.stalledLift.weight}kg.` : "",
  ].filter(Boolean).join(" ")

  return generateOpenAIText({
    systemInstruction:
      `You are Rex, a no-nonsense gym mentor. ` +
      `User is going off-topic. Reply in MAX 2 lines. ` +
      `User data: ${quickCtx} ` +
      `Rules: don't answer the off-topic question. Stay in character. ` +
      `Redirect to training. Be sarcastic if warranted. ` +
      `Allowed emojis: 🔥 💪 🐉 only. No others.`,
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

  const ctx = await loadOffTopicContext(platformChatId)

  let reply: string
  let intent: string

  switch (cls.type) {
    case "hardcoded":
      reply  = buildHardcodedResponse(cls.category!, ctx)
      intent = "off_topic_hardcoded"

      // Space requests ("let me focus") are not repeat-offender-tracked
      if (cls.category === "space") {
        return { handled: true, reply, intent }
      }
      break

    case "gibberish":
      reply  = pickGibberishResponse(ctx)
      intent = "off_topic_gibberish"
      break

    case "needs_llm": {
      try {
        reply = await callLLMFallback(text, ctx)
      } catch {
        // If LLM call fails, degrade gracefully to hardcoded offtopic response
        reply = buildHardcodedResponse("offtopic", ctx)
      }
      intent = "off_topic_llm"
      break
    }

    default:
      return { handled: false }
  }

  // Repeat offender logic — append note or replace reply
  if (ctx.userId) {
    const prevCount = await getPreviousOffTopicCountToday(ctx.userId, now)
    reply = withRepeatOffenderNote(reply, prevCount, ctx.nextMuscles)
  }

  return { handled: true, reply, intent }
}
