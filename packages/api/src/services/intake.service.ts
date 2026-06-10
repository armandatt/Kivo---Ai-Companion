import { prisma } from "@repo/db/client"
import { addToLongTerm, addToShortTerm } from "./memory.service"
import { savePlan } from "./planner.service"
import { saveDeadline } from "./deadline.service"
import { generateOpenAIText } from "./openai.service"
import { getSplitDayInfo } from "./gymTimeContext.service"
// @ts-ignore — monorepo path alias
import { initOnboardingV2 } from "@repo/api/engines/onboarding-engine-v2"

// ─── Types ────────────────────────────────────────────────────────────────────

type IntakeStep =
  | "not_started" | "path_select"
  // Rex gym coaching path
  | "ga_name" | "ga_goal" | "ga_body" | "ga_drill" | "ga_lifts"
  | "ga_schedule" | "ga_split" | "ga_gym_time" | "ga_nutrition" | "ga_injuries"
  | "ga_review"   // final profile confirmation before intakeComplete = true
  // Study path
  | "sb1" | "sb2" | "sb3" | "sb3b" | "sb4" | "sb4b"
  | "sb5_style" | "sb5_killer" | "sb6_hours" | "sb6_consistency"
  | "sb7" | "sb8"
  // General path
  | "gn1" | "gn2" | "gn3"
  | "complete"

export type WebProfile = {
  creatureName: string | null
  primaryGoal30d: string | null
  corePain: string | null
  persona: string | null
  accountabilityStyle: string | null
  preferredCheckInTime: string | null
}

type IntakeUser = {
  id: string
  intakeComplete: boolean
  intakeStep: string
  intakeAnswers: unknown
  activeModules: string[]
  creatureName: string | null
  persona: string
  tonePreference: string
  primaryGoal30d: string | null
  corePain: string | null
  preferredCheckInTime: string | null
}

// Typed intake answers — all fields are optional since they accumulate over the flow.
// Using an interface (not Record<string,string>) gives compile-time safety on key names.
interface IntakeAnswers {
  // Rex gym path
  name?: string
  gym_goal?: string
  gym_goal_raw?: string
  training_experience?: string
  drill_raw?: string
  current_bodyweight_kg?: string
  height_cm?: string
  bmi?: string
  protein_target_g?: string
  body_retry?: string
  lifts_raw?: string
  squat_kg?: string
  bench_kg?: string
  deadlift_kg?: string
  available_training_days?: string
  schedule_retry?: string
  current_split?: string
  split_raw?: string
  split_days_json?: string        // Bug 3: parsed day sequence from user's custom split
  split_proposed?: string
  split_review_pending?: string
  gym_session_time?: string
  city?: string
  time_retry?: string
  protein_raw?: string
  daily_protein_g?: string
  protein_status?: string
  injury_notes?: string
  validation_attempts?: string    // Bug 9: retry count for gibberish escalation
  review_edit_mode?: string       // "true" when returning from ga_review to edit one field
  review_other_pending?: string   // "true" while awaiting free-text correction from "Edit Other"
  // Study path
  study_goal_description?: string
  study_category?: string
  study_deadline_raw?: string
  study_deadline_iso?: string
  days_until_deadline?: string
  soft_deadline?: string
  study_current_status?: string
  study_gap_estimate?: string
  study_subjects?: string
  study_weak_subject?: string
  study_style?: string
  default_focus_duration?: string
  focus_killer?: string
  study_hours_available?: string
  study_consistency_type?: string
  study_past_failure?: string
  study_stakes?: string
  // General path
  general_context?: string
  general_focus_area?: string
  general_block?: string
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function needsIntake(platformChatId: string): Promise<boolean> {
  const user = await prisma.messengerUser.findUnique({
    where: { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: { intakeComplete: true },
  })
  return user ? !user.intakeComplete : false
}

export async function getWebProfile(telegramChatId: string): Promise<WebProfile | null> {
  try {
    const profile = await prisma.userProfile.findFirst({
      where: { telegramChatId },
      select: {
        creatureName: true, primaryGoal30d: true, corePain: true,
        primaryPersona: true, accountabilityStyle: true, preferredCheckInTime: true,
      },
    })
    if (!profile) return null
    return {
      creatureName: profile.creatureName,
      primaryGoal30d: profile.primaryGoal30d,
      corePain: profile.corePain,
      persona: profile.primaryPersona,
      accountabilityStyle: profile.accountabilityStyle,
      preferredCheckInTime: profile.preferredCheckInTime,
    }
  } catch {
    return null
  }
}

// ─── Intake answer validation ─────────────────────────────────────────────────
// LLM decides whether the user's reply is a genuine attempt to answer the
// current step question. Replaces the old regex-only isOffTopicDuringIntake.

async function isValidIntakeAnswer(text: string, step: IntakeStep, answers: IntakeAnswers): Promise<boolean> {
  const stepQ = currentStepQuestion(step, answers)
  if (!stepQ) return true // step has no expected answer (complete, etc.) — don't block

  try {
    const raw = await generateOpenAIText({
      model: "gpt-4o-mini",
      maxOutputTokens: 3,
      systemInstruction:
        "Decide if a user's reply is a genuine attempt to answer a fitness chatbot intake question. " +
        "Reply ONLY 'yes' or 'no'. " +
        "Be lenient — slang, short answers, typos, and unusual phrasing all count as yes. " +
        "Fitness/gym slang ALWAYS counts as yes: lean bulk, natty, PPL, bro split, recomp, cut, bulk, HIIT, " +
        "macros, DL, OHP, push pull legs, upper lower, 75kg, 5'11, etc. " +
        "Say no ONLY for: completely unrelated topics (weather, politics, sports scores), insults, or " +
        "pure random characters with zero relation to health/fitness (e.g. kiyugkuyhv, asdfgh).",
      prompt: `Question: "${stepQ}"\nUser replied: "${text}"`,
    })
    return /^yes/i.test(raw.trim())
  } catch {
    return true // LLM unreachable — let it through so intake never hard-blocks
  }
}

// Maps the current step back to the question Rex asked for it, so we can re-ask after an off-topic answer
function currentStepQuestion(step: IntakeStep, answers: IntakeAnswers): string {
  const name = answers.name ?? "you"
  switch (step) {
    case "ga_review":    return ``   // confirmation step — validator always passes
    case "ga_name":      return `Name — just your first name.`
    case "ga_goal":      return `${name}, what are we training for — fat loss, muscle, strength, recomp, or consistency?`
    case "ga_drill":     return buildRexGoalDrillQuestion(answers.gym_goal ?? "muscle")
    case "ga_body":      return `What's your current weight and height? (e.g. 75kg, 5'10" or 80kg, 178cm)`
    case "ga_lifts":     return buildRexLiftsQuestion(answers.training_experience ?? "intermediate")
    case "ga_schedule":  return `How many days a week are you actually going to show up?`
    case "ga_split":     return `Walk me through your split — or should I build one for you?`
    case "ga_gym_time":  return `What time do you usually train? And what city are you in?`
    case "ga_nutrition": return `Roughly how much protein are you hitting daily?`
    case "ga_injuries":  return `Any injuries I need to know about?`
    // Study path
    case "sb1":              return STUDY_Q.sb1
    case "sb2":              return STUDY_Q.sb2
    case "sb3":              return STUDY_Q.sb3
    case "sb3b":             return `How behind are we talking — weeks or months?`
    case "sb4":              return STUDY_Q.sb4
    case "sb4b":             return `Which one is the biggest problem right now — the one you keep avoiding?`
    case "sb5_style":        return STUDY_Q.sb5_style
    case "sb5_killer":       return `What kills your focus most — phone, environment, other people, or your own head?`
    case "sb6_hours":        return STUDY_Q.sb6_hours
    case "sb6_consistency":  return `Is that consistent every day, or more variable — like lighter on weekdays, heavier on weekends?`
    case "sb7":              return STUDY_Q.sb7
    case "sb8":              return STUDY_Q.sb8
    // General path
    case "gn1": return GENERAL_Q.gn1
    case "gn2": return GENERAL_Q.gn2
    case "gn3": return GENERAL_Q.gn3
    default:    return ""
  }
}

async function answerOffTopicAndRedirect(question: string, currentQ: string, knownStats?: string): Promise<string> {
  try {
    return await generateOpenAIText({
      model:             "gpt-4o-mini",
      maxOutputTokens:   100,
      systemInstruction: [
        `You are Rex, a direct no-nonsense gym coach doing an initial client intake.`,
        `The client asked a question instead of answering yours. Answer it in 1-2 sentences (Rex voice: blunt, honest, no fluff).`,
        knownStats ? `You have this information about the client already: ${knownStats}. Use it if it answers their question.` : "",
        `Then on a new line write exactly: "Now — " followed by the intake question they need to answer.`,
        `Do not add anything else.`,
      ].filter(Boolean).join("\n"),
      prompt: `Client's question: "${question}"\nYour current intake question: "${currentQ}"`,
    })
  } catch {
    return `I don't have that yet — that's what intake is for.\n\nNow — ${currentQ}`
  }
}

// Bug 9: After 3 failed validation attempts, show selectable options for the current step.
function buildGibberishEscalation(step: IntakeStep, _answers: IntakeAnswers, currentQ: string): Promise<string> {
  const options: Record<string, string> = {
    ga_goal:     `${currentQ}\n\nPick one:\n1. Fat loss\n2. Build muscle\n3. Get stronger\n4. Recomp (both)`,
    ga_drill:    `${currentQ}\n\nPick one:\n1. Beginner (< 1 year)\n2. Intermediate (1-4 years)\n3. Advanced (5+ years)`,
    ga_body:     `Send it like: 75kg, 5'10 — or just the weight if you don't know your height.`,
    ga_lifts:    `Send your working weights like: squat 60, bench 50, deadlift 80 — or say "I don't know".`,
    ga_schedule: `How many days? Just type: 3, 4, 5, or 6`,
    ga_split:    `Do you have a split or should I build one?\n\n1. PPL (Push/Pull/Legs)\n2. Upper/Lower\n3. Full Body\n4. Build one for me`,
    ga_gym_time: `What time do you train? Example: 7am, 18:30, 6pm`,
    ga_nutrition:`Rough protein daily? Just a number in grams — or say "not tracking"`,
    ga_injuries: `Any injuries? Type "none" if you're all good.`,
  }
  const fallback = `${currentQ}`
  return Promise.resolve(options[step] ?? fallback)
}

function buildKnownStatsFromAnswers(answers: IntakeAnswers): string {
  const parts: string[] = []
  if (answers.name)                   parts.push(`name: ${answers.name}`)
  if (answers.current_bodyweight_kg)  parts.push(`bodyweight: ${answers.current_bodyweight_kg}kg`)
  if (answers.height_cm)              parts.push(`height: ${answers.height_cm}cm`)
  if (answers.bmi)                    parts.push(`BMI: ${answers.bmi}`)
  if (answers.gym_goal)               parts.push(`goal: ${answers.gym_goal}`)
  if (answers.protein_target_g)       parts.push(`protein target: ${answers.protein_target_g}g/day`)
  if (answers.training_experience)    parts.push(`experience: ${answers.training_experience}`)
  if (answers.available_training_days) parts.push(`training days: ${answers.available_training_days}/week`)
  return parts.join(", ")
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function handleIntakeMessage(input: {
  platformChatId: string
  text: string
  webProfile: WebProfile | null
}): Promise<{ handled: boolean; reply: string }> {
  const user = await prisma.messengerUser.findUnique({
    where: { platform_platformChatId: { platform: "telegram", platformChatId: input.platformChatId } },
    select: {
      id: true, intakeComplete: true, intakeStep: true, intakeAnswers: true, activeModules: true,
      creatureName: true, persona: true, tonePreference: true,
      primaryGoal30d: true, corePain: true, preferredCheckInTime: true,
    },
  }) as IntakeUser | null

  if (!user || user.intakeComplete) return { handled: false, reply: "" }

  await addToShortTerm(input.platformChatId, input.text, { role: "user", intent: "intake", emotion: "neutral" })

  const step    = (user.intakeStep || "not_started") as IntakeStep
  const answers = parseAnswers(user.intakeAnswers)
  const modules = user.activeModules || []

  const profile: WebProfile = input.webProfile ?? {
    creatureName:        user.creatureName,
    primaryGoal30d:      user.primaryGoal30d,
    corePain:            user.corePain,
    persona:             user.persona,
    accountabilityStyle: user.tonePreference,
    preferredCheckInTime: user.preferredCheckInTime,
  }

  const effectiveStep = normalizeRexIntakeStep(step, user, answers)

  // ── Intake answer validation ─────────────────────────────────────────────
  // LLM checks if the reply is a genuine attempt to answer the current step.
  // If not, Rex answers the off-topic message briefly then redirects.
  // Skip for not_started — the first message triggers the flow, no question was asked yet.
  if (effectiveStep !== "not_started" && effectiveStep !== "path_select" && effectiveStep !== "complete") {
    const text = input.text.trim()
    const valid = await isValidIntakeAnswer(text, effectiveStep, answers)
    if (!valid) {
      const currentQ = currentStepQuestion(effectiveStep, answers)
      if (currentQ) {
        // Bug 9: track retry count to escalate the redirect message
        const attempt = parseInt(answers.validation_attempts ?? "0") + 1
        const mutable = answers as Record<string, unknown>
        mutable.validation_attempts = String(attempt)
        await prisma.messengerUser.update({ where: { id: user.id }, data: { intakeAnswers: answers as any } })

        let reply: string
        if (attempt >= 3) {
          // 3rd+ bad answer: give explicit selectable options for the current step
          reply = await buildGibberishEscalation(effectiveStep, answers, currentQ)
        } else if (attempt === 2) {
          // 2nd bad answer: brief example-driven redirect
          const knownStats = buildKnownStatsFromAnswers(answers)
          reply = await answerOffTopicAndRedirect(text, currentQ, knownStats || undefined)
          reply = reply + "\n\n(Not sure what to say? Just type a number or keyword.)"
        } else {
          const knownStats = buildKnownStatsFromAnswers(answers)
          reply = await answerOffTopicAndRedirect(text, currentQ, knownStats || undefined)
        }
        await addToShortTerm(input.platformChatId, reply, { role: "assistant", intent: "intake", emotion: "neutral" })
        return { handled: true, reply }
      }
    } else {
      // Valid answer — reset retry counter
      if (answers.validation_attempts) {
        const mutable = answers as Record<string, unknown>
        delete mutable.validation_attempts
      }
    }
  }

  // Passively extract split / gym-time from every valid rex-gym-path answer,
  // even if the current question is about something else entirely.
  const rexGymPathStates: IntakeStep[] = [
    "ga_goal", "ga_drill", "ga_body", "ga_lifts", "ga_schedule", "ga_split", "ga_gym_time", "ga_nutrition", "ga_injuries",
  ]
  if (rexGymPathStates.includes(effectiveStep)) {
    await applyPassiveIntakeData(user.id, answers, input.text.trim())
  }

  const reply = await routeStep(effectiveStep, input.text.trim(), answers, modules, user, profile, input.platformChatId)

  await addToShortTerm(input.platformChatId, reply, { role: "assistant", intent: "intake", emotion: "neutral" })
  return { handled: true, reply }
}

function normalizeRexIntakeStep(step: IntakeStep, user: IntakeUser, answers: IntakeAnswers): IntakeStep {
  // Reset any legacy or path_select step back to not_started so all users
  // hit the new Rex flow cleanly.
  const resetSteps = [
    "path_select",
    "ga1", "ga1_target", "ga2_weight", "ga2_exp",
    "ga3", "ga3_days", "ga4", "ga5_diet", "ga5_track", "ga6", "ga7",
  ]

  if (resetSteps.includes(step)) {
    const mutable = answers as Record<string, unknown>
    for (const key of Object.keys(mutable)) delete mutable[key]
    return "not_started"
  }

  return step
}

// ─── Step Router ──────────────────────────────────────────────────────────────

async function routeStep(
  step: IntakeStep, text: string, answers: IntakeAnswers,
  modules: string[], user: IntakeUser, profile: WebProfile, chatId: string
): Promise<string> {
  switch (step) {
    case "not_started":     return handleNotStarted(user, profile, chatId)
    case "path_select":     return handlePathSelect(text, answers, user, profile, chatId)
    // Rex gym coaching path
    case "ga_name":         return handleGaName(text, answers, user, chatId)
    case "ga_goal":         return handleGaGoal(text, answers, user, chatId)
    case "ga_body":         return handleGaBody(text, answers, user, chatId)
    case "ga_drill":        return handleGaDrill(text, answers, user, chatId)
    case "ga_lifts":        return handleGaLifts(text, answers, user, chatId)
    case "ga_schedule":     return handleGaSchedule(text, answers, user, chatId)
    case "ga_split":        return handleGaSplit(text, answers, user, chatId)
    case "ga_gym_time":     return handleGaGymTime(text, answers, user, chatId)
    case "ga_nutrition":    return handleGaNutrition(text, answers, user, chatId)
    case "ga_injuries":     return handleGaInjuries(text, answers, modules, user, profile, chatId)
    case "ga_review":      return handleGaReview(text, answers, modules, user, chatId)
    case "sb1":            return handleSb1(text, answers, user, chatId)
    case "sb2":            return handleSb2(text, answers, user, chatId)
    case "sb3":            return handleSb3(text, answers, user, chatId)
    case "sb3b":           return handleSb3b(text, answers, user, chatId)
    case "sb4":            return handleSb4(text, answers, user, chatId)
    case "sb4b":           return handleSb4b(text, answers, user, chatId)
    case "sb5_style":      return handleSb5Style(text, answers, user, chatId)
    case "sb5_killer":     return handleSb5Killer(text, answers, user, chatId)
    case "sb6_hours":      return handleSb6Hours(text, answers, user, chatId)
    case "sb6_consistency":return handleSb6Consistency(text, answers, modules, user, profile, chatId)
    case "sb7":            return handleSb7(text, answers, user, chatId)
    case "sb8":            return handleSb8(text, answers, modules, user, profile, chatId)
    case "gn1":            return handleGn1(text, answers, user, chatId)
    case "gn2":            return handleGn2(text, answers, user, chatId)
    case "gn3":            return handleGn3(text, answers, modules, user, profile, chatId)
    default:               return "Let's keep going. What are you working on?"
  }
}

// ─── Opening & Path Select ────────────────────────────────────────────────────

// ─── Rex Gym Path: LLM transition helper ─────────────────────────────────────
// Generates BOTH the reaction to the user's answer AND the next question in one
// LLM call. The `systemInstruction` describes the context + what to generate.
// Always falls back to a template string on LLM failure.

async function generateRexTransition(
  systemInstruction: string,
  contextPrompt: string,
  fallback: string,
  maxOutputTokens = 120,
): Promise<string> {
  try {
    return await generateOpenAIText({
      model:             "gpt-4o-mini",
      maxOutputTokens,
      systemInstruction: [
        "You are Rex, a blunt no-nonsense gym mentor conducting initial intake.",
        "Rules: direct, concise, no fluff, no emojis, no clichés.",
        "Never say: Great, Awesome, Perfect, Let's go, Let's crush it, Nice, Absolutely, Of course.",
        "Max 4 lines total. React naturally to the user's answer, then ask the next question.",
        systemInstruction,
      ].join("\n"),
      prompt: contextPrompt,
    })
  } catch {
    return fallback
  }
}

// ─── Opening ──────────────────────────────────────────────────────────────────

async function handleNotStarted(_user: IntakeUser, _profile: WebProfile, chatId: string): Promise<string> {
  // Migration path: any user reaching "not_started" through V1 (legacy step reset
  // or first message without a web connect) is migrated to Onboarding Engine V2.
  // V2 initialises its MemoryFact state here so the NEXT message routes via
  // isV2Active() = true → handleOnboardingV2, not back into this V1 handler.
  return initOnboardingV2(chatId)
}

async function handlePathSelect(
  text: string, answers: IntakeAnswers, user: IntakeUser, profile: WebProfile, chatId: string
): Promise<string> {
  const t = text.toLowerCase()

  // Broad gym signal — includes physique/body transformation language
  const wantsGym = /\b(gym|fitness|training|workout|lift|lifting|body|muscle|weight|health|sport|physique|bulk|cut|lean|recomp|stronger|athletic|exercise|cardio|abs|gains|transform|best version|get fit|lose weight|gain|build muscle|fat loss|shred)\b/.test(t)

  // Broad study/work signal
  const wantsStudy = /\b(study|learn|exam|work|career|course|skill|job|placement|coding|programming|degree|college|school|prep|competitive|dsa|leetcode|interview|project|startup|business)\b/.test(t)

  const wantsBoth = wantsGym && wantsStudy

  // If the message is off-topic (a question, a greeting, unclear) — re-ask.
  // Never default to "general" just because keywords weren't found.
  const looksOffTopic =
    !wantsGym && !wantsStudy &&
    (t.split(/\s+/).length <= 8 ||
      /^(what|who|where|when|how|why|is|are|can|do|did|will|would|could|tell|hi|hey|hello|yo|ok|okay)\b/i.test(text.trim()))

  if (looksOffTopic || (!wantsGym && !wantsStudy)) {
    // Stay on path_select — don't advance the step
    return `I need to know what we're working on first.\n\nGym and fitness, studying and work, or both? Pick one.`
  }

  let modules: string[]
  let firstStep: IntakeStep
  let reply: string

  const isRex = user.persona === "rex" || user.persona === "spark"

  if (wantsBoth) {
    modules = ["gym", "study"]
    firstStep = "ga_name"
    reply = isRex
      ? `Both. Gym first — it's the most structured.\n\nYour last trainer probably told you what you wanted to hear.\nI won't. Name?`
      : `Both. Good — gym first since it's the most structured.\n\nName?`
  } else if (wantsGym) {
    modules = ["gym"]
    firstStep = "ga_name"
    reply = isRex
      ? `Gym.\n\nYour last trainer probably told you what you wanted to hear.\nI won't. Name?`
      : `Gym it is.\n\nName?`
  } else {
    modules = ["study"]
    firstStep = "sb1"
    reply = isRex ? `Study and work.\n\n${STUDY_Q.sb1}` : `Study and work mode.\n\n${STUDY_Q.sb1}`
  }

  await updateIntake(user.id, firstStep, answers, modules)
  return reply
}

// ─── Rex Gym Coaching Path ───────────────────────────────────────────────────
// @deprecated MIGRATE — These handlers (handleGaName … handleGaReview) are the
// V1 LLM-driven gym onboarding path. Kept ONLY for users who started onboarding
// before Onboarding Engine V2 shipped and are still mid-flow
// (intakeStep = ga_name / ga_goal / … AND no V2 MemoryFact state).
//
// Removal plan: once production telemetry shows zero active V1 gym sessions,
// delete handleGaName through handleGaReview plus all V1 gym-path helpers
// (generateRexTransition, classifyRexGoal, buildProposedSplit, etc.)
// and remove the ga_* cases from routeStep.
// ─────────────────────────────────────────────────────────────────────────────

async function handleGaName(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  const name = await llmExtractName(text)
  if (!name) {
    return answerOffTopicAndRedirect(text, currentStepQuestion("ga_name", answers))
  }
  answers.name = name
  await updateIntake(user.id, "ga_goal", answers)
  return generateRexTransition(
    `User's name is ${name}. ` +
    `React in ONE word or very short phrase to their name (not 'great' or 'nice' or 'perfect'). ` +
    `Then ask what they're training for. Options: lose fat, build muscle, get stronger, recomp (both), or just be consistent. ` +
    `Merge reaction + question into 2 lines max. Direct. No emojis.`,
    name,
    `${name}. What are we here for — lose fat, build muscle, get stronger, recomp, or "just stay consistent"?`,
    100,
  )
}

async function llmExtractName(text: string): Promise<string | null> {
  try {
    const raw = await generateOpenAIText({
      model: "gpt-4o-mini",
      maxOutputTokens: 15,
      systemInstruction: [
        "Extract the user's name from their message. They were just asked 'What's your name?'",
        "If they are providing a name or nickname (even unconventional: Bro, Dragon, etc.), reply with ONLY that name, capitalized.",
        "If they are asking a question, insulting, off-topic, or clearly NOT providing a name, reply with exactly: off_topic",
        "Examples:",
        "  akshar → Akshar",
        "  my name is mike → Mike",
        "  call me bro → Bro",
        "  why you want to know → off_topic",
        "  gandu like you → off_topic",
        "  jhatu like you → off_topic",
        "  what is this → off_topic",
        "  ?? → off_topic",
        "  lol → off_topic",
      ].join("\n"),
      prompt: text,
    })
    const result = raw.trim()
    if (/off_topic/i.test(result)) return null
    const extracted = result.split(/\s+/)[0]?.replace(/[^\w]/g, "") ?? ""
    if (extracted.length < 2) return null
    return extracted.charAt(0).toUpperCase() + extracted.slice(1).toLowerCase()
  } catch {
    // LLM down — fall back to regex heuristic so intake doesn't hard-block
    const t = text.toLowerCase().trim()
    if (/^(why|what|how|when|where|who|is|are|can|do|did|will)\b/.test(t) || t.endsWith("?") || t.length < 2) return null
    const word = text.trim().replace(/[^\w\s]/g, "").split(/\s+/)[0] ?? ""
    return word.length >= 2 ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : null
  }
}

async function handleGaGoal(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  const goal = await classifyRexGoal(text)
  if (!goal) {
    return `I need a direction. Fat loss, muscle, strength, recomp — which one?`
  }

  // "habit" / consistency is too vague — push for specific goal
  if (goal === "habit") {
    return generateRexTransition(
      `User said their goal is consistency or general fitness — too vague for a program. ` +
      `Call it out briefly. Push them to pick one: fat loss, muscle, or strength. Max 2 lines.`,
      text,
      `Consistency toward what? Pick one: fat loss, muscle, or strength.`,
      80,
    )
  }

  answers.gym_goal     = goal
  answers.gym_goal_raw = text
  // Review edit mode: go back to review after updating goal
  if (answers.review_edit_mode) {
    const mutable = answers as Record<string, unknown>
    delete mutable.review_edit_mode
    await updateIntake(user.id, "ga_review", answers)
    return `${buildReviewCard(answers)}\n\n${REX_REVIEW_PROMPT}`
  }
  // Experience comes BEFORE body stats — better to understand their level before asking numbers
  await updateIntake(user.id, "ga_drill", answers)

  return generateRexTransition(
    buildGoalReactionPrompt(goal),
    text,
    buildRexGoalDrillQuestion(goal),
    120,
  )
}

function buildGoalReactionPrompt(goal: string): string {
  const ctx: Record<string, string> = {
    fat_loss: "User wants fat loss. React briefly — slightly skeptical if they've been spinning wheels. " +
              "Ask how long they've been training consistently (signals history of trying). Be direct.",
    muscle:   "User wants to build muscle. Short acknowledgment. Ask how long they've been training seriously.",
    strength: "User wants strength. Acknowledge it's a solid goal. Ask how long they've been training with any real structure.",
    both:     "User wants recomp — both at once. Brief reality check: it's slow but doable for beginners. " +
              "Don't discourage. Ask their experience level.",
    performance: "User wants general performance or fitness. Ask how long they've been training seriously.",
  }
  return (ctx[goal] ?? "React to their goal briefly. Ask how long they've been training.") + " Max 3 lines. No emojis."
}

async function handleGaDrill(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  const level = await classifyRexExperience(text)
  answers.training_experience = level
  answers.drill_raw           = text
  if (answers.review_edit_mode) {
    const mutable = answers as Record<string, unknown>
    delete mutable.review_edit_mode
    await updateIntake(user.id, "ga_review", answers)
    return `${buildReviewCard(answers)}\n\n${REX_REVIEW_PROMPT}`
  }
  // Experience collected → now ask for body stats
  await updateIntake(user.id, "ga_body", answers)

  return generateRexTransition(
    buildExperienceReactionPrompt(level),
    text,
    `Current weight and height? (e.g. 75kg, 5'10" or 80kg, 178cm)`,
    120,
  )
}

function buildExperienceReactionPrompt(level: string): string {
  const ctx: Record<string, string> = {
    beginner:     "User is a beginner. One line that removes the ego pressure — being a beginner is actually the best position to be in. " +
                  "Then ask for current weight and height. Mention the format.",
    intermediate: "User says intermediate. One line of brief skepticism — intermediate means very different things. " +
                  "Ask for weight and height anyway.",
    advanced:     "User is advanced. Brief acknowledgment. Ask weight and height — you'll verify with their lift numbers.",
  }
  return (ctx[level] ?? "React to their experience level. Ask for current weight and height.") + " Max 3 lines. No emojis."
}

async function handleGaBody(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  const bw      = parseBodyweightKg(text)
  const ht      = parseHeightCm(text)
  const isRetry = answers.body_retry === "true"

  if (!bw && !ht && !isRetry) {
    answers.body_retry = "true"
    await updateIntake(user.id, "ga_body", answers)
    return `Numbers. Format: "75kg, 5'10" or "80kg, 178cm". Weight and height.`
  }

  if (bw) {
    answers.current_bodyweight_kg = String(bw)
    // protein target = bodyweight_kg × 2.2 × 0.8 (conservative minimum)
    answers.protein_target_g = String(Math.round(bw * 2.2 * 0.8))
  }
  if (ht) answers.height_cm = String(ht)
  if (bw && ht) {
    answers.bmi = (bw / Math.pow(ht / 100, 2)).toFixed(1)
  }
  delete answers.body_retry

  const saves: Promise<void>[] = []
  if (bw) saves.push(addToLongTerm(chatId, "preferences", `bodyweight: ${bw}kg`))
  if (ht) saves.push(addToLongTerm(chatId, "preferences", `height: ${ht}cm`))
  await Promise.all(saves)

  if (answers.review_edit_mode) {
    const mutable = answers as Record<string, unknown>
    delete mutable.review_edit_mode
    await updateIntake(user.id, "ga_review", answers)
    return `${buildReviewCard(answers)}\n\n${REX_REVIEW_PROMPT}`
  }

  await updateIntake(user.id, "ga_lifts", answers)

  const bmi   = answers.bmi ? parseFloat(answers.bmi) : null
  const goal  = answers.gym_goal ?? "muscle"
  const level = answers.training_experience ?? "intermediate"

  return generateRexTransition(
    buildBodyReactionContext(bmi, goal),
    `${bw ?? "?"}kg, ${ht ?? "?"}cm`,
    buildRexLiftsQuestion(level),
    130,
  )
}

function buildBodyReactionContext(bmi: number | null, goal: string): string {
  let bodyNote = ""
  if (bmi !== null && bmi < 18.5 && goal === "muscle") {
    bodyNote = "User is underweight for muscle building. Briefly note eating matters as much as training. "
  } else if (bmi !== null && bmi > 28 && goal === "fat_loss") {
    bodyNote = "Brief acknowledgment of context — no comment on weight directly. "
  } else {
    bodyNote = "Minimal reaction to the stats. "
  }
  return (
    bodyNote +
    `Ask for working weights: squat, bench, deadlift. ` +
    `Tell them it's fine if they don't know — first session will be baseline testing. ` +
    `Max 3 lines. No emojis.`
  )
}

async function handleGaLifts(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  answers.lifts_raw = text
  const lifts   = parseLiftsFromText(text)
  const unknown = isUnknownLiftsText(text)
  // null = explicitly skipped (don't store); undefined = not mentioned; number = we have it
  if (lifts.squat    != null) answers.squat_kg    = String(lifts.squat)
  if (lifts.bench    != null) answers.bench_kg    = String(lifts.bench)
  if (lifts.deadlift != null) answers.deadlift_kg = String(lifts.deadlift)
  await updateIntake(user.id, "ga_schedule", answers)

  const imbalance = detectLiftImbalance(lifts)

  const liftStr = (v: number | null | undefined) =>
    v === null ? "N/A (skipped)" : v !== undefined ? `${v}kg` : "?"
  const skippedLifts = (["squat", "bench", "deadlift"] as const)
    .filter(k => lifts[k] === null).join(" and ")

  const liftCtx = unknown
    ? "User doesn't know their working weights. Acknowledge briefly — first session is baseline testing. " +
      "Then ask how many days per week they will ACTUALLY show up. Not the plan — the real number. Max 3 lines. No emojis."
    : `User's lifts: squat ${liftStr(lifts.squat)}, bench ${liftStr(lifts.bench)}, deadlift ${liftStr(lifts.deadlift)}. ` +
      (skippedLifts ? `Note: user explicitly doesn't do ${skippedLifts} — do NOT mention imbalance for skipped lifts. ` : "") +
      (imbalance ? `Notable imbalance: ${imbalance}. Call it out in ONE line. ` : "No notable imbalance. ") +
      "Then ask: how many days per week they're ACTUALLY going to show up. Not the plan — the real number. Max 3 lines. No emojis."

  // Bug 8: intermediate profile summary after lifts are collected
  const profileSnap = buildIntermediaryProfile(answers)
  const transition  = await generateRexTransition(
    liftCtx,
    text,
    `${unknown ? "First session is baseline testing." : buildLiftCalibration(lifts)}\n\nHow many days a week are you actually going to show up? Not the plan — the real number.`,
    120,
  )
  return `${profileSnap}\n\n---\n\n${transition}`
}

function detectLiftImbalance(lifts: LiftNumbers): string | null {
  const { squat, bench, deadlift } = lifts
  // Require both to be actual positive numbers — null (skipped) or undefined (unknown) = no comparison
  const hasSquat    = typeof squat    === "number" && squat    > 0
  const hasBench    = typeof bench    === "number" && bench    > 0
  const hasDeadlift = typeof deadlift === "number" && deadlift > 0

  if (hasBench && hasSquat) {
    if (bench! >= squat! * 0.95) return "bench nearly matching squat — posterior chain needs work"
    if (bench! > squat!)         return "bench higher than squat — legs are behind"
    if (bench! < squat! * 0.55)  return "bench lagging far behind squat"
  }
  if (hasSquat && hasDeadlift && deadlift! < squat!) {
    return "deadlift below squat — unusual, hinge pattern needs work"
  }
  if (hasBench && hasDeadlift && !hasSquat && bench! > deadlift!) {
    return "bench exceeding deadlift — posterior chain is weak"
  }
  return null
}

async function handleGaSchedule(text: string, answers: IntakeAnswers, user: IntakeUser, _chatId: string): Promise<string> {
  const days    = extractDaysNumber(text)
  const isRetry = answers.schedule_retry === "true"

  if (!isRetry && days === 1) {
    answers.schedule_retry = "true"
    await updateIntake(user.id, "ga_schedule", answers)
    return `1 day doesn't cut it. 3 minimum. Can you do 3?`
  }

  if (!isRetry && days === 2) {
    answers.schedule_retry = "true"
    await updateIntake(user.id, "ga_schedule", answers)
    return `Bare minimum. 3 is better — can you add one?`
  }

  if (!isRetry && days === 7) {
    answers.schedule_retry = "true"
    await updateIntake(user.id, "ga_schedule", answers)
    return `You need rest days. 6 max. Which day are you dropping?`
  }

  const finalDays = days ?? 3
  answers.available_training_days = String(finalDays)
  delete answers.schedule_retry

  if (answers.review_edit_mode) {
    const mutable = answers as Record<string, unknown>
    delete mutable.review_edit_mode
    await updateIntake(user.id, "ga_review", answers)
    return `${buildReviewCard(answers)}\n\n${REX_REVIEW_PROMPT}`
  }

  // If split was already captured passively earlier, skip the split question entirely
  if (answers.current_split && answers.split_raw && answers.split_raw !== "rex_built" && !answers.split_review_pending) {
    await updateIntake(user.id, "ga_gym_time", answers)
    return generateRexTransition(
      `User is training ${finalDays} days/week. ` +
      (finalDays <= 3 ? "React briefly — 3 done right beats 5 done half-assed. " : "") +
      (finalDays >= 5 ? "React briefly — ambitious, achievable. " : "") +
      (finalDays === 4 ? "React briefly — good frequency. " : "") +
      `You already have their split from earlier in the conversation — acknowledge it in one line (name what it is). ` +
      `Then ask what time they train and what city they're in. Max 3 lines. No emojis.`,
      text,
      `${finalDays} days. Got your split already.\nWhat time do you usually train, and what city are you in?`,
      120,
    )
  }

  await updateIntake(user.id, "ga_split", answers)

  return generateRexTransition(
    `User is training ${finalDays} days/week. ` +
    (finalDays <= 3 ? "React briefly — 3 done right beats 5 done half-assed. " : "") +
    (finalDays >= 5 ? "React briefly — ambitious, achievable. " : "") +
    (finalDays === 4 ? "React briefly — good frequency. " : "") +
    `Then ask casually if they have a split or want Rex to build one. Max 2 lines. No emojis.`,
    text,
    finalDays >= 5
      ? `Ambitious. Do you have a split or should I build one?`
      : `Honest. ${finalDays} days is enough.\n\nWalk me through your split — or should I build one for you?`,
    100,
  )
}

async function handleGaSplit(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  const lower = text.toLowerCase().trim()

  // ── Review loop: user reacting to Rex's proposed split ───────────────────
  if (answers.split_review_pending === "true") {
    const confirmed   = /\b(yes|yeah|yep|good|fine|looks? good|confirmed?|ok|sure|that.?s? (good|fine|it)|works?)\b/i.test(lower)
    const wantsChange = /\b(swap|change|move|replace|add|remove|instead|different|modify)\b/i.test(lower)

    if (confirmed) {
      delete answers.split_review_pending
      if (answers.review_edit_mode) {
        const mutable = answers as Record<string, unknown>
        delete mutable.review_edit_mode
        await updateIntake(user.id, "ga_review", answers)
        return `${buildReviewCard(answers)}\n\n${REX_REVIEW_PROMPT}`
      }
      await updateIntake(user.id, "ga_gym_time", answers)
      return generateRexTransition(
        "User confirmed their split. Move straight to asking what time they train and what city they're in. One line, casual. No emojis.",
        "confirmed",
        `Good. What time do you usually train, and what city are you in?`,
        80,
      )
    }

    if (wantsChange) {
      answers.split_raw = `${answers.split_raw ?? ""} (updated: ${text})`
      return generateRexTransition(
        `User wants to adjust the proposed split. Their request: "${text}". ` +
        `Acknowledge the change briefly. Re-present the full split in Day 1 / Day 2 / ... format with the adjustment applied. ` +
        `Ask "Good with this?" Max 5 lines. No emojis.`,
        text,
        `Adjusted. Here's the updated split:\n${answers.split_proposed ?? "Day 1: Upper\nDay 2: Lower\nDay 3: Full Body"}\n\nGood with this?`,
        160,
      )
    }

    return `Is the split above good, or do you want to swap anything?`
  }

  // ── User wants Rex to build ───────────────────────────────────────────────
  const wantsRexToBuild = /\b(you (decide|build|pick|choose)|build me|don.?t (have|know)|wing(ing)?|winging it|no idea|random|whatever|your (pick|choice)|no (split|plan)|not sure|can you)\b/i.test(lower)

  if (wantsRexToBuild) {
    const days     = parseInt(answers.available_training_days ?? "3")
    const goal     = answers.gym_goal ?? "muscle"
    const proposed = buildProposedSplit(days, goal)
    answers.current_split        = classifySplitFromDaysAndGoal(days, goal)
    answers.split_raw            = "rex_built"
    answers.split_proposed       = proposed
    answers.split_review_pending = "true"
    await updateIntake(user.id, "ga_split", answers)
    return `Here's your split:\n${proposed}\n\nGood with this or want changes?`
  }

  // ── User provided their own split ─────────────────────────────────────────
  const splitType       = await classifySplit(text)
  answers.current_split = splitType
  answers.split_raw     = text
  // Bug 3: parse and store the user's actual day sequence so scheduling uses it
  const daySeq = parseSplitDaySequence(text)
  if (daySeq) answers.split_days_json = JSON.stringify(daySeq)

  if (answers.review_edit_mode) {
    const mutable = answers as Record<string, unknown>
    delete mutable.review_edit_mode
    await updateIntake(user.id, "ga_review", answers)
    return `${buildReviewCard(answers)}\n\n${REX_REVIEW_PROMPT}`
  }
  await updateIntake(user.id, "ga_gym_time", answers)

  // Bug 8: profile summary after split is confirmed (user now has goal + experience + body + lifts + days + split)
  const profileSnap = buildIntermediaryProfile(answers)
  const splitTransition = await generateRexTransition(
    `User's split: ${text}. Type: ${splitType}. Goal: ${answers.gym_goal ?? "muscle"}. ` +
    `Note ONE obvious issue with this split vs their goal if there is one ` +
    `(e.g. only 1 leg day for strength, no direct shoulders, etc.) — skip if it's fine. ` +
    `Then ask what time they usually train and what city they're in. Max 3 lines. No emojis.`,
    text,
    `Noted. What time do you usually train, and what city are you in?`,
    120,
  )
  return `${profileSnap}\n\n---\n\n${splitTransition}`
}

function buildProposedSplit(days: number, goal: string): string {
  if (days <= 3) {
    if (goal === "strength") {
      return "Day 1: Squat focus (Legs / Back)\nDay 2: Press focus (Chest / Shoulders / Triceps)\nDay 3: Pull focus (Back / Biceps) + Deadlift"
    }
    return "Day 1: Full Body\nDay 2: Full Body\nDay 3: Full Body"
  }
  if (days === 4) {
    if (goal === "strength") {
      return "Day 1: Squat + Back\nDay 2: Bench + Shoulders\nDay 3: Deadlift + Accessories\nDay 4: Upper Volume"
    }
    return "Day 1: Back + Biceps\nDay 2: Chest + Triceps\nDay 3: Legs\nDay 4: Shoulders + Core"
  }
  // 5–6 days → PPL
  const ppl = "Day 1: Push (Chest / Shoulders / Triceps)\nDay 2: Pull (Back / Biceps)\nDay 3: Legs\nDay 4: Push\nDay 5: Pull"
  return days >= 6 ? ppl + "\nDay 6: Legs" : ppl
}

function classifySplitFromDaysAndGoal(days: number, _goal: string): string {
  if (days <= 3) return "full_body"
  if (days === 4) return "upper_lower"
  return "PPL"
}

async function handleGaGymTime(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  const sessionTime = parseTimeString(text)
  const city        = extractCityFromText(text)

  if (!sessionTime && !answers.time_retry) {
    answers.time_retry = "true"
    await updateIntake(user.id, "ga_gym_time", answers)
    return `What time exactly? "Morning" doesn't help. Give me a number — "6:30am", "7pm".`
  }

  if (sessionTime) answers.gym_session_time = sessionTime
  if (city)        answers.city             = city
  delete answers.time_retry

  if (answers.review_edit_mode) {
    const mutable = answers as Record<string, unknown>
    delete mutable.review_edit_mode
    await updateIntake(user.id, "ga_review", answers)
    return `${buildReviewCard(answers)}\n\n${REX_REVIEW_PROMPT}`
  }
  await updateIntake(user.id, "ga_nutrition", answers)

  const hour     = sessionTime ? parseInt(sessionTime.split(":")[0] ?? "9") : -1
  const timeNote = hour < 7 ? "early morning" : hour >= 20 ? "late night" : ""

  return generateRexTransition(
    `User trains at ${sessionTime ?? "unknown time"} in ${city ?? "unknown city"}. ` +
    (timeNote === "early morning" ? "Note: very early morning session. One wry line about it — discipline or insomnia. " : "") +
    (timeNote === "late night"    ? "Note: late night training. Brief acknowledgment, no judgment. " : "") +
    `Ask: roughly how much protein are they hitting daily. Tell them to be honest. Max 3 lines. No emojis.`,
    text,
    `Got it. Roughly how much protein are you hitting daily? Be honest.`,
    100,
  )
}

async function handleGaNutrition(text: string, answers: IntakeAnswers, user: IntakeUser, _chatId: string): Promise<string> {
  answers.protein_raw     = text
  const gramsReported     = parseProteinGrams(text)
  const target            = parseInt(answers.protein_target_g ?? "0") || 0
  const name              = answers.name ?? "you"

  answers.protein_status  = gramsReported === null
    ? "unknown"
    : gramsReported >= target * 0.8 ? "adequate" : "low"
  if (gramsReported !== null) answers.daily_protein_g = String(gramsReported)

  await updateIntake(user.id, "ga_injuries", answers)

  // Not tracking at all
  if (gramsReported === null || target === 0) {
    return generateRexTransition(
      `User isn't tracking protein or gave a vague answer. Don't lecture. ` +
      `Ask "more or less than 100g a day?" to calibrate. ` +
      `Then immediately ask about injuries on a new line. Max 2 lines. No emojis.`,
      text,
      `Not tracking — more or less than 100g daily?\n\nAny injuries I need to know about?`,
      100,
    )
  }

  const gapPct = Math.round((gramsReported / target) * 100)

  if (gapPct < 30) {
    return generateRexTransition(
      `User hitting ${gramsReported}g protein daily. Minimum target is ${target}g — they're at ${gapPct}% of it. ` +
      `This is critical for recovery. React: concrete gap, no lecture. ` +
      `Give 3 specific food sources with gram counts (eggs, chicken, whey etc) that close the gap. ` +
      `Then ask about injuries. Keep total under 4 lines. No emojis.`,
      text,
      `${name}, that's not enough. Minimum is ${target}g daily.\n3 eggs=18g. 150g chicken=45g. Whey scoop=25g. Stack those every day.\nAny injuries I need to know about?`,
      150,
    )
  }

  if (gapPct < 70) {
    return generateRexTransition(
      `User hitting ${gramsReported}g protein, target ${target}g — low but workable (${gapPct}%). ` +
      `Give them the exact target number. Ask about injuries. 2 lines max. No emojis.`,
      text,
      `Low but fixable. Get to ${target}g minimum daily.\nAny injuries I need to know about?`,
      100,
    )
  }

  return generateRexTransition(
    `User hitting ${gramsReported}g protein, target ${target}g — solid (${gapPct}%). ` +
    `Brief positive acknowledgment. Ask about injuries. 2 lines max. No emojis.`,
    text,
    `Solid. That's one less variable to fix.\nAny injuries I need to know about?`,
    80,
  )
}

function parseProteinGrams(text: string): number | null {
  const t = text.toLowerCase()
  if (/\b(don'?t know|not (sure|tracking)|no idea|idk|nothing|don'?t track)\b/.test(t)) return null

  // Range: "80-100g", "20-30 grams"
  const range = t.match(/(\d+)\s*[-–]\s*(\d+)\s*(?:g|gm|grams?)?/)
  if (range) return Math.round((parseInt(range[1]) + parseInt(range[2])) / 2)

  // Direct: "100g", "100 grams", "around 100g"
  const direct = t.match(/(\d+)\s*(?:g|gm|grams?)/i)
  if (direct) return parseInt(direct[1])

  // Bare number in plausible protein range
  const bare = t.match(/(?:around|about|roughly|~)?\s*(\d{2,3})\b/)
  if (bare) {
    const n = parseInt(bare[1])
    if (n >= 30 && n <= 400) return n
  }
  return null
}

async function handleGaInjuries(
  text: string, answers: IntakeAnswers, modules: string[],
  user: IntakeUser, _profile: WebProfile, chatId: string
): Promise<string> {
  const hasInjury = !/\b(no|none|nothing|all good|fine|healthy|nope|full deck|clean|clear|n\/a)\b/i.test(text)
  answers.injury_notes = hasInjury ? text : "none"
  if (hasInjury) {
    await addToLongTerm(chatId, "preferences", `injury_flag: ${text}`)
      .catch(e => console.error("[INTAKE] injury_flag write failed:", e))
  }

  // If returning from ga_review edit mode, go back to review after updating injury notes
  if (answers.review_edit_mode) {
    const mutable = answers as Record<string, unknown>
    delete mutable.review_edit_mode
    await updateIntake(user.id, "ga_review", answers)
    return `${buildReviewCard(answers)}\n\n${REX_REVIEW_PROMPT}`
  }

  // All onboarding questions answered — show profile review BEFORE finalizing
  await updateIntake(user.id, "ga_review", answers, modules)
  return generateRexTransition(
    "All onboarding data is collected. Your job is to transition cleanly to the final profile review. " +
    "One line: something direct like 'This is who I'm building your plan around.' or " +
    "'Before I start holding you accountable, make sure I got this right.' " +
    "Then the profile card follows. No emojis. No sycophancy.",
    "profile review intro",
    "This is who I'm building the plan around. Make sure I got it right.",
    60,
  ).then(intro => `${intro}\n\n${buildReviewCard(answers)}\n\n${REX_REVIEW_PROMPT}`)
}

// ─── Rex Closing ──────────────────────────────────────────────────────────────

async function buildRexGymClosing(a: IntakeAnswers): Promise<string> {
  const goal        = rexGoalLabel(a.gym_goal ?? "fitness")
  const days        = a.available_training_days ?? "3"
  const time        = a.gym_session_time ?? "your usual time"
  const split       = rexSplitLabel(a.current_split ?? "unstructured", parseInt(days))
  const weakLink    = diagnoseWeakLink(a)
  const nextSession = nextTrainingDayLabel(a.current_split ?? "unstructured", parseInt(days))
  const liftLine    = (a.squat_kg || a.bench_kg || a.deadlift_kg)
    ? `Lifts: squat ${a.squat_kg ?? "?"}kg, bench ${a.bench_kg ?? "?"}kg, deadlift ${a.deadlift_kg ?? "?"}kg.`
    : "Lifts: baseline testing Week 1."

  const fallback = [
    `Right. Here's where we are:`,
    `Goal: ${goal}. Training: ${days}x/week, ${time}. Split: ${split}.`,
    `Weakest link right now: ${weakLink}.`,
    `${nextSession}. ${time}. Don't ghost me.`,
  ].join("\n")

  try {
    return await generateOpenAIText({
      model:             "gpt-4o-mini",
      maxOutputTokens:   180,
      systemInstruction:
        "You are Rex, a direct gym mentor. Generate a closing onboarding summary.\n" +
        "Format exactly like this (no deviations):\n" +
        "'Right. Here's where we are:\n" +
        "Goal: [goal]. Training: [days]x/week, [time]. Split: [split].\n" +
        "Weakest link right now: [weakest link specific to this user].\n" +
        "[next session label] — [muscles for that day].\n" +
        "[gym_time]. Don't ghost me.'\n\n" +
        "Rules:\n" +
        "- Use the ACTUAL next training day provided — never say 'tomorrow' if tomorrow is a rest day\n" +
        "- Weakest link must be specific to this person's data, not generic\n" +
        "- Last line is always gym_time + 'Don't ghost me'\n" +
        "- Max 6 lines total. No emojis.",
      prompt: [
        `Name: ${a.name ?? "unknown"}`,
        `Goal: ${goal}`,
        `Level: ${a.training_experience ?? "unknown"}`,
        `Training: ${days}x/week at ${time}`,
        `Split: ${split}`,
        liftLine,
        `Protein target: ${a.protein_target_g ?? "?"}g/day (currently hitting: ${a.daily_protein_g ?? "unknown"})`,
        `Injuries: ${a.injury_notes ?? "none"}`,
        `Weakest link: ${weakLink}`,
        `Next session: ${nextSession}`,
      ].join("\n"),
    })
  } catch {
    return fallback
  }
}

function nextTrainingDayLabel(split: string, daysPerWeek: number): string {
  const todayNum = new Date().getDay() // 0=Sun…6=Sat
  // Walk forward up to 7 days to find the next training day
  for (let offset = 1; offset <= 7; offset++) {
    const dayNum = (todayNum + offset) % 7
    const { isTrainingDay } = getSplitDayInfo(split, daysPerWeek, dayNum)
    if (isTrainingDay) {
      return offset === 1 ? "First session tomorrow" : `First session is ${WEEKDAY_NAMES[dayNum]}`
    }
  }
  return "First session coming up"
}


const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

// Bug 8: compact profile card shown mid-onboarding so users can catch errors early.
function buildIntermediaryProfile(a: IntakeAnswers): string {
  const lines: string[] = ["Profile so far:"]
  if (a.gym_goal)                 lines.push(`Goal: ${rexGoalLabel(a.gym_goal)}`)
  if (a.training_experience)      lines.push(`Experience: ${a.training_experience}`)
  if (a.current_bodyweight_kg)    lines.push(`Weight: ${a.current_bodyweight_kg}kg${a.height_cm ? ` / Height: ${a.height_cm}cm` : ""}`)
  if (a.squat_kg || a.bench_kg || a.deadlift_kg) {
    lines.push(`Lifts: squat ${a.squat_kg ?? "?"}kg / bench ${a.bench_kg ?? "?"}kg / deadlift ${a.deadlift_kg ?? "?"}kg`)
  }
  if (a.available_training_days)  lines.push(`Frequency: ${a.available_training_days}x/week`)
  if (a.current_split)            lines.push(`Split: ${rexSplitLabel(a.current_split, parseInt(a.available_training_days ?? "3"))}`)
  return lines.join("\n")
}

// ─── Profile Review Step (ga_review) ─────────────────────────────────────────
// Shown after all onboarding questions are answered, before intakeComplete = true.
// Lets the user catch errors and approve the profile explicitly.

const REX_REVIEW_PROMPT =
  `Anything wrong before I lock this in?\n\n` +
  `1. Looks good\n` +
  `2. Edit goal\n` +
  `3. Edit schedule\n` +
  `4. Edit split\n` +
  `5. Edit training time\n` +
  `6. Edit body metrics\n` +
  `7. Edit other`

function buildReviewCard(a: IntakeAnswers): string {
  const EXP_MAP: Record<string, string> = {
    beginner: "< 1 year", intermediate: "1–4 years", advanced: "5+ years",
  }
  const lines: string[] = ["Here's what I've got:"]
  if (a.gym_goal)               lines.push(`Goal: ${rexGoalLabel(a.gym_goal)}`)
  if (a.training_experience)    lines.push(`Experience: ${EXP_MAP[a.training_experience] ?? a.training_experience}`)
  if (a.current_bodyweight_kg)  lines.push(`Weight: ${a.current_bodyweight_kg}kg`)
  if (a.height_cm)              lines.push(`Height: ${a.height_cm}cm`)
  if (a.available_training_days) lines.push(`Training: ${a.available_training_days}x/week`)

  // Split — show custom day sequence if stored, else canonical label
  if (a.split_days_json) {
    try {
      const days = JSON.parse(a.split_days_json) as string[]
      const DAYNAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
      const splitLines = days.map((d, i) => `  ${DAYNAMES[i] ?? `Day ${i + 1}`} → ${d}`).join("\n")
      lines.push(`Split:\n${splitLines}`)
    } catch {
      if (a.current_split) lines.push(`Split: ${rexSplitLabel(a.current_split, parseInt(a.available_training_days ?? "3"))}`)
    }
  } else if (a.current_split && a.split_raw && a.split_raw !== "rex_built") {
    lines.push(`Split: ${a.split_raw}`)
  } else if (a.current_split) {
    lines.push(`Split: ${rexSplitLabel(a.current_split, parseInt(a.available_training_days ?? "3"))}`)
  }

  // Training time in 12-hour format
  if (a.gym_session_time) {
    const [hStr, mStr] = a.gym_session_time.split(":")
    const h = parseInt(hStr ?? "0"), m = parseInt(mStr ?? "0")
    const period = h >= 12 ? "PM" : "AM"
    const dh = h === 0 ? 12 : h > 12 ? h - 12 : h
    const dm = m === 0 ? "" : `:${String(m).padStart(2, "0")}`
    lines.push(`Training Time: ${dh}${dm} ${period}`)
  }
  if (a.city) lines.push(`Location: ${a.city}`)

  // Protein
  if (a.daily_protein_g) {
    lines.push(`Protein: ~${a.daily_protein_g}g/day`)
  } else if (a.protein_status === "unknown") {
    lines.push(`Protein: Not tracked`)
  }

  if (a.injury_notes) lines.push(`Injuries: ${a.injury_notes === "none" ? "None" : a.injury_notes}`)

  return lines.join("\n")
}

function parseReviewEditChoice(lower: string): "goal" | "schedule" | "split" | "gym_time" | "body" | "other" | null {
  if (/^2$|\bedit goal\b|\bgoal\b/.test(lower)) return "goal"
  if (/^3$|\bedit schedule\b|\bschedule\b|\bdays\b|\bfrequency\b/.test(lower)) return "schedule"
  if (/^4$|\bedit split\b|\bsplit\b/.test(lower)) return "split"
  if (/^5$|\btraining time\b|\bgym time\b|\btime\b/.test(lower)) return "gym_time"
  if (/^6$|\bbody\b|\bweight\b|\bheight\b|\bmetrics\b/.test(lower)) return "body"
  if (/^7$|\bother\b|\bprotein\b|\binjur\b|\bcity\b|\blocation\b|\bexperience\b/.test(lower)) return "other"
  return null
}

function applyTextCorrection(text: string, answers: IntakeAnswers): boolean {
  const t = text.toLowerCase()
  let changed = false

  const proteinM = text.match(/(?:protein|hitting|eating|it.?s)\s+(?:is\s+|actually\s+)?~?(\d+)\s*g/i)
  if (proteinM) { answers.daily_protein_g = proteinM[1]; changed = true }

  const cityM = text.match(/(?:i.?m in|city is|location is|based in|live in|from)\s+([A-Z][a-z]+)/i)
  if (cityM) { answers.city = cityM[1]; changed = true }

  if (/\b(no injury|no injuries|not injured|all good|healthy|no pain)\b/.test(t)) {
    answers.injury_notes = "none"; changed = true
  } else if (/\binjur\b|\bhurt\b|\bpain\b|\btorn\b|\bstrain\b/.test(t)) {
    answers.injury_notes = text; changed = true
  }

  const expM = /\b(beginner|intermediate|advanced)\b/i.exec(text)
  if (expM) { answers.training_experience = expM[1]!.toLowerCase(); changed = true }

  const bw = parseBodyweightKg(text)
  if (bw) { answers.current_bodyweight_kg = String(bw); changed = true }
  const ht = parseHeightCm(text)
  if (ht && ht !== bw) { answers.height_cm = String(ht); changed = true }

  return changed
}

async function handleGaReview(
  text: string, answers: IntakeAnswers, modules: string[], user: IntakeUser, chatId: string
): Promise<string> {
  const lower = text.trim().toLowerCase()

  // ── Free-text correction mode (after "Edit Other") ───────────────────────
  if (answers.review_other_pending === "true") {
    const mutable = answers as Record<string, unknown>
    delete mutable.review_other_pending
    const changed = applyTextCorrection(text, answers)
    await prisma.messengerUser.update({ where: { id: user.id }, data: { intakeAnswers: answers as any } })
    if (changed) {
      return `${buildReviewCard(answers)}\n\n${REX_REVIEW_PROMPT}`
    }
    return `Couldn't parse that — pick one of the numbered options.\n\n${buildReviewCard(answers)}\n\n${REX_REVIEW_PROMPT}`
  }

  // ── Confirmed ─────────────────────────────────────────────────────────────
  const isConfirmed = /^(1|yes|yeah|yep|yup|looks? good|looks? right|all good|correct|fine|lock it in|good|done|ok|okay|right|perfect|that.?s right|confirmed?)$/i.test(lower)

  if (isConfirmed) {
    if (modules.includes("study")) {
      const safeAnswers = await writeRexProfileToDb(user.id, chatId, answers)
      await updateIntake(user.id, "sb1", safeAnswers, modules)
      return (await buildRexGymClosing(safeAnswers)) + "\n\n---\n\nNow for study.\n\n" + STUDY_Q.sb1
    }
    const safeAnswers = await finalizeRexProfile(user.id, chatId, answers, modules)
    return buildRexGymClosing(safeAnswers)
  }

  // ── Numbered edit choice ──────────────────────────────────────────────────
  const editTarget = parseReviewEditChoice(lower)

  if (editTarget === "goal") {
    const mutable = answers as Record<string, unknown>
    mutable.review_edit_mode = "true"
    await updateIntake(user.id, "ga_goal", answers)
    return `What are we actually training for — fat loss, muscle, strength, or recomp?`
  }
  if (editTarget === "schedule") {
    const mutable = answers as Record<string, unknown>
    mutable.review_edit_mode = "true"
    await updateIntake(user.id, "ga_schedule", answers)
    return `How many days a week are you actually showing up?`
  }
  if (editTarget === "split") {
    const mutable = answers as Record<string, unknown>
    mutable.review_edit_mode = "true"
    await updateIntake(user.id, "ga_split", answers)
    return `Walk me through your actual split — or say "build me one".`
  }
  if (editTarget === "gym_time") {
    const mutable = answers as Record<string, unknown>
    mutable.review_edit_mode = "true"
    await updateIntake(user.id, "ga_gym_time", answers)
    return `What time do you train, and what city?`
  }
  if (editTarget === "body") {
    const mutable = answers as Record<string, unknown>
    mutable.review_edit_mode = "true"
    await updateIntake(user.id, "ga_body", answers)
    return `Current weight and height? (e.g. 82kg, 5'11 or 80kg, 180cm)`
  }
  if (editTarget === "other") {
    const mutable = answers as Record<string, unknown>
    mutable.review_other_pending = "true"
    await prisma.messengerUser.update({ where: { id: user.id }, data: { intakeAnswers: answers as any } })
    return `What needs fixing? Tell me directly — protein target, injury notes, city, or experience level.`
  }

  // ── Unrecognised — re-show the card ──────────────────────────────────────
  return `${buildReviewCard(answers)}\n\n${REX_REVIEW_PROMPT}`
}

function rexGoalLabel(goal: string): string {
  const map: Record<string, string> = {
    fat_loss: "Fat loss", muscle: "Build muscle", both: "Recomp",
    performance: "Performance", bulk: "Build muscle", cut: "Fat loss",
    strength: "Strength", habit: "Build the habit", recomp: "Recomp",
  }
  return map[goal] ?? goal
}

function rexSplitLabel(split: string, days: number): string {
  const map: Record<string, string> = {
    PPL: "PPL", upper_lower: "Upper/Lower", full_body: "Full Body", bro_split: "Body Part Split",
    unstructured: days >= 4 ? "Upper/Lower (to be built)" : "Full Body (to be built)",
    none:         days >= 4 ? "Upper/Lower (to be built)" : "Full Body (to be built)",
  }
  return map[split] ?? split
}

function diagnoseWeakLink(a: IntakeAnswers): string {
  if (!a.lifts_raw || isUnknownLiftsText(a.lifts_raw)) return "no baseline — testing everything Week 1"
  if (a.protein_status === "low")                        return "your protein intake — fix that before anything else"
  if (a.injury_notes && a.injury_notes !== "none")       return `working around: ${a.injury_notes.slice(0, 50)}`

  const days = parseInt(a.available_training_days ?? "3")
  if (days < 3) return "frequency — making every session count"

  const split = a.current_split
  if (!split || split === "unstructured" || split === "none") return "your training structure — I'm building it"

  const bench = parseInt(a.bench_kg ?? "0")
  const squat = parseInt(a.squat_kg ?? "0")
  const dl    = parseInt(a.deadlift_kg ?? "0")
  if (squat > 0 && bench > 0 && bench / squat < 0.60) return "bench — it's lagging everything else"
  if (squat > 0 && dl > 0 && dl < squat)              return "deadlift — shouldn't be under your squat"

  return "consistency — the numbers are workable"
}

// ─── Rex Gym Path Helpers ─────────────────────────────────────────────────────


async function classifyRexGoal(text: string): Promise<string | null> {
  const VALID = new Set(["fat_loss", "muscle", "strength", "both", "performance", "habit"])

  try {
    const raw = await generateOpenAIText({
      model: "gpt-4o-mini",
      maxOutputTokens: 10,
      systemInstruction: [
        "You classify a gym user's fitness goal into exactly one label.",
        "Reply with ONLY one of these words — nothing else:",
        "  fat_loss   — losing fat, cutting, shredding, calorie deficit, slim down, lose weight",
        "  muscle     — building muscle, bulking, gaining mass, size, hypertrophy",
        "  strength   — getting stronger, lifting more, powerlifting, performance, athletic",
        "  both       — recomp, lose fat AND build muscle simultaneously",
        "  habit      — just be consistent, healthy, general fitness, 'just be fit', vague/no specific goal",
        "If the message contains only a timeline with no clear goal, reply: null",
      ].join("\n"),
      prompt: text,
    })
    const label = raw.trim().toLowerCase().replace(/[^a-z_]/g, "")
    return VALID.has(label) ? label : null
  } catch {
    const t = text.toLowerCase()
    if (/recomp|both|simultaneously/.test(t))                     return "both"
    if (/fat|cut|lean|lose|shred|slim/.test(t))                   return "fat_loss"
    if (/stronger|strength|power|lift|perform|athletic/.test(t))  return "strength"
    if (/muscle|bulk|build|gain|mass/.test(t))                    return "muscle"
    if (/consist|habit|health|fit|active/.test(t))                return "habit"
    return null
  }
}

// ─── Shared LLM classifier helper ────────────────────────────────────────────
// Makes a cheap gpt-4o-mini call and maps the response to one of the provided
// valid labels. Falls back to `defaultLabel` if the call fails or returns
// something unexpected.

async function llmClassify(
  text: string,
  systemInstruction: string,
  validLabels: string[],
  defaultLabel: string,
): Promise<string> {
  try {
    const raw = await generateOpenAIText({
      model:             "gpt-4o-mini",
      maxOutputTokens:   12,
      systemInstruction,
      prompt:            text,
    })
    const label = raw.trim().toLowerCase().replace(/[^a-z_]/g, "")
    return validLabels.includes(label) ? label : defaultLabel
  } catch {
    return defaultLabel
  }
}

function buildRexGoalDrillQuestion(goal: string): string {
  if (goal === "fat_loss")    return `How long have you been "trying" to lose fat?`
  if (goal === "muscle")      return `How long have you been training seriously?`
  if (goal === "strength")    return `How long have you been training with any real structure?`
  if (goal === "both")        return `Recomp is slow. How long have you been training?`
  if (goal === "performance") return `How long have you been training seriously?`
  return `How long have you been training?`
}

async function classifyRexExperience(text: string): Promise<string> {
  return llmClassify(
    text,
    [
      "Classify the user's gym/lifting experience level. Reply with ONLY one word:",
      "  beginner     — never trained, just started, a few months, under 1 year",
      "  intermediate — 1-4 years of consistent training",
      "  advanced     — 5+ years, competitive, very experienced",
      "When in doubt, default to: intermediate",
    ].join("\n"),
    ["beginner", "intermediate", "advanced"],
    "intermediate",
  )
}

function buildRexLiftsQuestion(level: string): string {
  if (level === "beginner") {
    return `Beginner. No ego then, good. We can work with that.\n\nGive me your working weights. Squat, bench, deadlift. If you don't know them, that's the first problem we're fixing.`
  }
  if (level === "intermediate") {
    return `Intermediate means different things to different people. Give me squat, bench, and deadlift.`
  }
  if (level === "advanced") {
    return `Advanced. We'll see. Give me squat, bench, and deadlift — working weights or 1RM.`
  }
  return `Give me your working weights. Squat, bench, deadlift. If you don't know them, that's the first problem we're fixing.`
}

function isUnknownLiftsText(text: string): boolean {
  return /\b(don'?t know|not sure|no idea|haven'?t tested|never tested|idk|can'?t|none|n\/a|not tested|no numbers)\b/i.test(text)
}

// null = user explicitly doesn't do this lift; undefined = not mentioned
type LiftNumbers = { squat?: number | null; bench?: number | null; deadlift?: number | null }

function parseLiftsFromText(text: string): LiftNumbers {
  // Detect explicitly skipped lifts first
  const dontDo = new Set<string>()
  const skipPat = /(?:don'?t|not|never|skip(?:ping)?|no)\s+(?:do|doing|perform|use|train)?\s*(\bsquats?|\bdeadlifts?|\bbench(?:\s*press)?|\bohp\b|\boverhead\b)/gi
  for (const m of text.matchAll(skipPat)) {
    const w = (m[1] ?? "").toLowerCase()
    if (w.includes("squat"))    dontDo.add("squat")
    if (w.includes("deadlift")) dontDo.add("deadlift")
    if (w.includes("bench"))    dontDo.add("bench")
    if (w.includes("ohp") || w.includes("overhead")) dontDo.add("ohp")
  }

  // Limited non-alpha gap prevents matching across exercise name boundaries
  const sqMatch = !dontDo.has("squat")    ? text.match(/\b(?:squat|sq)\b[^a-zA-Z]{0,30}?(\d+)/i)       : null
  const bpMatch = !dontDo.has("bench")    ? text.match(/\b(?:bench|bp|bench\s*press)\b[^a-zA-Z]{0,30}?(\d+)/i) : null
  const dlMatch = !dontDo.has("deadlift") ? text.match(/\b(?:deadlift|dl|dead)\b[^a-zA-Z]{0,30}?(\d+)/i) : null

  const result: LiftNumbers = {
    squat:    dontDo.has("squat")    ? null : sqMatch ? parseInt(sqMatch[1]!) : undefined,
    bench:    dontDo.has("bench")    ? null : bpMatch ? parseInt(bpMatch[1]!) : undefined,
    deadlift: dontDo.has("deadlift") ? null : dlMatch ? parseInt(dlMatch[1]!) : undefined,
  }

  // Positional fallback only if NO named matches AND NO explicit skips
  if (Object.values(result).every(v => v === undefined) && dontDo.size === 0) {
    const nums = [...text.matchAll(/\d+/g)]
      .map(m => parseInt(m[0]!))
      .filter(n => n > 10 && n < 1000)
    return { squat: nums[0], bench: nums[1], deadlift: nums[2] }
  }

  return result
}

function buildLiftCalibration(lifts: LiftNumbers): string {
  const { squat, bench, deadlift } = lifts
  if (squat && bench) {
    if (bench / squat < 0.60) return `Bench is lagging your squat hard. We'll fix that.`
    if (bench / squat > 0.95) return `Bench nearly matching your squat. Posterior chain probably needs work.`
  }
  if (squat && deadlift && deadlift < squat) {
    return `Deadlift under your squat — that's unusual. We'll address it.`
  }
  return `Noted.`
}

function extractDaysNumber(text: string): number | null {
  const wordMap: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  }
  const t = text.toLowerCase()
  for (const [word, num] of Object.entries(wordMap)) {
    if (t.includes(word)) return num
  }
  const m = t.match(/\b([1-7])\s*(?:days?|x|times?|\/week)?\b/)
  return m ? parseInt(m[1]) : null
}

function extractCityFromText(text: string): string | null {
  const skip = new Set(["am", "pm", "at", "in", "around", "usually", "morning", "evening", "afternoon", "night", "i", "my", "gym"])
  for (const word of text.split(/[\s,]+/)) {
    const clean = word.replace(/[^\w]/g, "")
    if (clean.length > 2 && /^[A-Z]/.test(clean) && !skip.has(clean.toLowerCase()) && isNaN(Number(clean))) {
      return clean
    }
  }
  return null
}

function cityToTimezone(city: string): string {
  const map: Record<string, string> = {
    // India
    Mumbai: "Asia/Kolkata", Delhi: "Asia/Kolkata", Bangalore: "Asia/Kolkata",
    Bengaluru: "Asia/Kolkata", Chennai: "Asia/Kolkata", Hyderabad: "Asia/Kolkata",
    Pune: "Asia/Kolkata", Kolkata: "Asia/Kolkata", Noida: "Asia/Kolkata",
    Gurgaon: "Asia/Kolkata", Ahmedabad: "Asia/Kolkata", Jaipur: "Asia/Kolkata",
    // USA
    Chicago: "America/Chicago", Houston: "America/Chicago", Dallas: "America/Chicago",
    Seattle: "America/Los_Angeles", Miami: "America/New_York", Boston: "America/New_York",
    Atlanta: "America/New_York",
    // UK / Europe
    London: "Europe/London", Manchester: "Europe/London",
    Berlin: "Europe/Berlin", Paris: "Europe/Paris", Amsterdam: "Europe/Amsterdam",
    // Others
    Dubai: "Asia/Dubai", Singapore: "Asia/Singapore", Tokyo: "Asia/Tokyo",
    Sydney: "Australia/Sydney", Melbourne: "Australia/Melbourne",
    Toronto: "America/Toronto", Vancouver: "America/Vancouver",
  }
  return map[city] ?? "Asia/Kolkata"
}


function parseBodyweightKg(text: string): number | null {
  const lbsMatch = text.match(/(\d{2,3})\s*(?:lbs?|pounds?)/i)
  if (lbsMatch) return Math.round(parseInt(lbsMatch[1]) * 0.453)
  const kgMatch = text.match(/(\d{2,3})\s*(?:kg|kilos?)/i)
  if (kgMatch) return parseInt(kgMatch[1])
  return null
}

function parseHeightCm(text: string): number | null {
  // Normalize Unicode apostrophes from phone autocorrect (U+2018, U+2019, U+02BC)
  const t = text.replace(/[‘’ʼ]/g, "'")
  // feet + inches: 5'10, 5'10", 5 ft 10, 5 feet 10 inches
  const ftIn = t.match(/(\d)\s*['′`]\s*(\d{1,2})|(\d)\s*(?:ft|feet|foot)\s*(\d{1,2})?/i)
  if (ftIn) {
    const feet   = parseInt(ftIn[1] ?? ftIn[3] ?? "0")
    const inches = parseInt(ftIn[2] ?? ftIn[4] ?? "0")
    return Math.round(feet * 30.48 + inches * 2.54)
  }
  // centimetres: 178cm, 178 cm
  const cm = t.match(/(\d{2,3})\s*cm/i)
  if (cm) return parseInt(cm[1])
  // bare number between 140–220 → assume cm
  const bare = t.match(/\b(1[4-9]\d|2[0-2]\d)\b/)
  if (bare && !parseBodyweightKg(text)) return parseInt(bare[0])
  return null
}

// ─── Study Path ───────────────────────────────────────────────────────────────

async function handleSb1(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  answers.study_goal_description = text
  answers.study_category = await classifyStudyCategory(text)
  await updateIntake(user.id, "sb2", answers)
  return `${text.length > 60 ? text.slice(0, 57) + "..." : text}. Clear.\n\n${STUDY_Q.sb2}`
}

async function handleSb2(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  const deadline = parseDateFromText(text)
  answers.study_deadline_raw = text
  if (deadline) answers.study_deadline_iso = deadline.toISOString()
  const daysLeft = deadline ? Math.ceil((deadline.getTime() - Date.now()) / 86400000) : null
  if (daysLeft !== null) answers.days_until_deadline = String(daysLeft)
  const soft = /no.*deadline|whenever|not sure|rough/.test(text.toLowerCase())
  answers.soft_deadline = soft ? "true" : "false"
  await updateIntake(user.id, "sb3", answers)
  const ack = daysLeft !== null ? `${daysLeft} days. Got it.` : `Noted.`
  return `${ack}\n\n${STUDY_Q.sb3}`
}

async function handleSb3(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  const status = await classifyStudyStatus(text)
  answers.study_current_status = status
  const needsGap = status === "behind" || status === "significantly_behind"
  await updateIntake(user.id, needsGap ? "sb3b" : "sb4", answers)

  const acks: Record<string, string> = {
    not_started: "Not started. We're building from zero.",
    early: "Early stages.",
    on_track: "On track.",
    behind: "Behind. I'm not judging — I just need to know.",
    significantly_behind: "Significantly behind. We need to be honest about the numbers.",
  }
  if (needsGap) {
    return `${acks[status]}\n\nHow behind are we talking — weeks or months?`
  }
  return `${acks[status]}\n\n${STUDY_Q.sb4}`
}

async function handleSb3b(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  answers.study_gap_estimate = text
  await updateIntake(user.id, "sb4", answers)
  return `Noted — ${text}.\n\n${STUDY_Q.sb4}`
}

async function handleSb4(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  const subjects = text.split(/[,\n\/]+/).map(s => s.trim()).filter(Boolean).slice(0, 8)
  answers.study_subjects = subjects.join(", ")
  await updateIntake(user.id, "sb4b", answers)
  return `${subjects.length} subjects locked in.\n\nWhich one is the biggest problem right now — the one you keep avoiding or struggling with most?`
}

async function handleSb4b(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  answers.study_weak_subject = text.trim()
  await updateIntake(user.id, "sb5_style", answers)
  return `${text.trim()}. That gets the first slot every week.\n\n${STUDY_Q.sb5_style}`
}

async function handleSb5Style(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  const t = text.toLowerCase()
  answers.study_style = /long|deep|2h|marathon|3h/.test(t) ? "deep_work"
    : /short|25|45|pomodoro|block/.test(t) ? "short_blocks"
    : "mixed"
  const focusMins = { deep_work: 90, short_blocks: 45, mixed: 60 }[answers.study_style]!
  answers.default_focus_duration = String(focusMins)
  await updateIntake(user.id, "sb5_killer", answers)
  return `Got it.\n\nAnd what kills your focus most — phone, the environment, other people, or your own head?`
}

async function handleSb5Killer(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  const t = text.toLowerCase()
  answers.focus_killer = /phone|instagram|tiktok|social/.test(t) ? "phone"
    : /people|noise|family|roommate/.test(t) ? "people"
    : /mind|thoughts|anxiety|head/.test(t) ? "mental"
    : /environment|place|room/.test(t) ? "environment"
    : "multiple"
  await updateIntake(user.id, "sb6_hours", answers)
  return `${ackFocusKiller(answers.focus_killer)}\n\n${STUDY_Q.sb6_hours}`
}

async function handleSb6Hours(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  const hours = parseFloat(text.match(/\d+(\.\d+)?/)?.[0] || "3")
  answers.study_hours_available = String(Math.min(hours, 16))
  await updateIntake(user.id, "sb6_consistency", answers)
  return `${answers.study_hours_available} hours. That's the real number I'll plan around.\n\nIs that consistent every day, or more variable — like light on weekdays and heavy on weekends?`
}

async function handleSb6Consistency(
  text: string, answers: IntakeAnswers, modules: string[],
  user: IntakeUser, profile: WebProfile, chatId: string
): Promise<string> {
  const t = text.toLowerCase()
  answers.study_consistency_type = /weekend|week.*end|saturda|sunda/.test(t) ? "weekend_heavy"
    : /variable|mixed|depends|different/.test(t) ? "variable"
    : "consistent"
  await updateIntake(user.id, "sb7", answers)
  return `Got it.\n\n${STUDY_Q.sb7}`
}

async function handleSb7(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  answers.study_past_failure = text
  await updateIntake(user.id, "sb8", answers)
  return `That pattern — I'll watch for it.\n\n${STUDY_Q.sb8}`
}

async function handleSb8(
  text: string, answers: IntakeAnswers, modules: string[],
  user: IntakeUser, profile: WebProfile, chatId: string
): Promise<string> {
  answers.study_stakes = text

  // Task 3 — Memory write failures never block completion
  const memResults = await Promise.allSettled([
    addToLongTerm(chatId, "preferences", `study_goal: ${answers.study_goal_description}`),
    addToLongTerm(chatId, "preferences", `study_category: ${answers.study_category}`),
    addToLongTerm(chatId, "preferences", `study_style: ${answers.study_style}`),
    addToLongTerm(chatId, "preferences", `focus_killer: ${answers.focus_killer}`),
    addToLongTerm(chatId, "preferences", `study_hours_daily: ${answers.study_hours_available}`),
    addToLongTerm(chatId, "struggles", `study_past_failure: ${answers.study_past_failure}`),
  ])
  const memFailed = memResults.filter(r => r.status === "rejected")
  if (memFailed.length) {
    console.error(`[INTAKE] ${memFailed.length}/6 study memory write(s) failed for ${chatId}`)
  }

  // Task 4 — Deadline + plan are optional; never block completion
  if (answers.study_deadline_iso) {
    await saveDeadline({
      platformChatId: chatId,
      title: answers.study_goal_description || "Study deadline",
      dueAt: new Date(answers.study_deadline_iso),
    }).catch(e => console.error("[INTAKE] Study deadline save failed:", e))
  }

  try {
    const studyPlan = await buildStudyPlan(answers)
    await savePlan(chatId, studyPlan)
  } catch (err) {
    console.error(`[INTAKE] Study plan generation failed for ${chatId} — continuing:`, err)
  }

  await updateIntake(user.id, "complete", answers, modules, { intakeComplete: true })
  return buildStudyClosing(answers, profile, user)
}

// ─── General Path ─────────────────────────────────────────────────────────────
// These handlers also rescue users who expressed gym/study intent but got here
// because their path_select response was off-topic.

const GYM_RESCUE_RE   = /\b(gym|fitness|training|workout|lift|body|muscle|weight|physique|bulk|cut|lean|recomp|stronger|athletic|exercise|cardio|gains|transform|best version|get fit|lose weight|gain muscle|build muscle|fat loss|shred)\b/i
const STUDY_RESCUE_RE = /\b(study|learn|exam|work|career|course|skill|job|placement|coding|programming|degree|college|school|prep|competitive|dsa|leetcode|interview)\b/i

async function handleGn1(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  // Rescue: if user is clearly talking about gym or study, switch paths now
  if (GYM_RESCUE_RE.test(text)) {
    await updateIntake(user.id, "ga_name", answers, ["gym"])
    return `Gym it is — switching to the right track.\n\nName?`
  }
  if (STUDY_RESCUE_RE.test(text)) {
    await updateIntake(user.id, "sb1", answers, ["study"])
    return `Study and work. Got it.\n\n${STUDY_Q.sb1}`
  }

  answers.general_context = text
  await updateIntake(user.id, "gn2", answers)
  return `Got the picture.\n\n${GENERAL_Q.gn2}`
}

async function handleGn2(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  // Rescue: if they've now mentioned gym/study focus, switch paths
  if (GYM_RESCUE_RE.test(text)) {
    await updateIntake(user.id, "ga_name", answers, ["gym"])
    return `Gym. That's what we're building around.\n\nName?`
  }
  if (STUDY_RESCUE_RE.test(text)) {
    await updateIntake(user.id, "sb1", answers, ["study"])
    return `Study focus. Let's get into it.\n\n${STUDY_Q.sb1}`
  }

  // Normalize the text — don't echo the raw input literally
  const normalizedFocus = text.length > 80 ? text.slice(0, 77).trim() + "..." : text.trim()
  answers.general_focus_area = normalizedFocus
  await addToLongTerm(chatId, "goals", normalizedFocus)
  await updateIntake(user.id, "gn3", answers)
  return `Got it. That's the focus for the next 30 days.\n\n${GENERAL_Q.gn3}`
}

async function handleGn3(
  text: string, answers: IntakeAnswers, modules: string[],
  user: IntakeUser, profile: WebProfile, chatId: string
): Promise<string> {
  answers.general_block = text
  await addToLongTerm(chatId, "struggles", text)
  await updateIntake(user.id, "complete", answers, modules, { intakeComplete: true })

  const creature = profile.creatureName || user.creatureName || "your companion"
  const checkin = profile.preferredCheckInTime || "08:00"
  const focus = answers.general_focus_area
  const persona = profile.persona || user.persona

  return buildPersonaMessage(persona, [
    `Understood. We're focusing on ${focus}.`,
    `The block right now is ${text}. That's what we're going to work through.`,
    `Morning check-in at ${checkin}. Don't ghost me.`,
    `${creature} is with you.`,
  ])
}

// ─── Post-Intake Builders ─────────────────────────────────────────────────────

async function buildGymPlan(a: IntakeAnswers): Promise<string> {
  const days = parseInt(a.available_training_days || "3")
  const split = a.current_split || "unstructured"
  const goal = a.gym_goal || "general"
  const injuries = a.injury_notes !== "none" ? `Avoid exercises that stress: ${a.injury_notes}` : ""

  const prompt = `Build a concrete weekly gym training plan.

User data:
- Goal: ${goal}
- Split: ${split === "unstructured" || split === "none" ? "Build a new split" : split}
- Training days per week: ${days}
- Experience: ${a.training_experience || "intermediate"}
${injuries}

Format exactly like this (no intro, no outro):

WEEKLY GYM PLAN

Mon: Rest / Active Recovery
Tue: [Muscle groups] — [session type]
  • Exercise 1
  • Exercise 2
  • Exercise 3

(list only the ${days} training days + rest days)

Keep it tight. Specific exercises. Sets/reps format: 4x8, 3x12, etc.`

  try {
    return await generateOpenAIText({ prompt, maxOutputTokens: 700 })
  } catch {
    return buildFallbackGymPlan(days, split, goal)
  }
}

async function buildStudyPlan(a: IntakeAnswers): Promise<string> {
  const subjects = a.study_subjects || "your subjects"
  const weak = a.study_weak_subject || subjects.split(",")[0]
  const hours = parseFloat(a.study_hours_available || "3")
  const style = a.study_style || "mixed"
  const daysLeft = parseInt(a.days_until_deadline || "30")
  const consistency = a.study_consistency_type || "consistent"

  const prompt = `Build a concrete weekly study plan.

User data:
- Goal: ${a.study_goal_description || "study target"}
- Subjects: ${subjects}
- Weakest subject (gets first slot): ${weak}
- Hours available daily: ${hours} (${consistency})
- Study style: ${style === "deep_work" ? "long deep sessions (90min)" : style === "short_blocks" ? "short focused blocks (45min)" : "mixed (60min)"}
- Days until deadline: ${daysLeft}

Format exactly like this:

WEEKLY STUDY PLAN

Mon: ${weak} — [session type] [duration]
Tue: [Subject] — [session type] [duration]
...

Rule: weakest subject gets Mon. Fill every day with realistic sessions at ${hours}h total.
No intro or outro text.`

  try {
    return await generateOpenAIText({ prompt, maxOutputTokens: 600 })
  } catch {
    return buildFallbackStudyPlan(subjects, weak, hours)
  }
}

// ─── Closing Messages ─────────────────────────────────────────────────────────

function buildStudyClosing(a: IntakeAnswers, profile: WebProfile, user: IntakeUser): string {
  const creature = profile.creatureName || user.creatureName || "your companion"
  const persona = profile.persona || user.persona
  const checkin = profile.preferredCheckInTime || "08:00"
  const daysLeft = a.days_until_deadline || "?"
  const isSignificantlyBehind = a.study_current_status === "significantly_behind" || a.study_current_status === "behind"

  const lines = [
    `Got it. Here's the picture:`,
    `${a.study_goal_description} — ${daysLeft} days away`,
    `${a.study_hours_available} hours a day, weakest on ${a.study_weak_subject}`,
    isSignificantlyBehind ? `You're behind. We're not pretending otherwise. The plan above is built around that reality.` : null,
    ``,
    `Morning check-in at ${checkin}.`,
    a.study_stakes ? `\nYou told me what's on the line. I'm holding that.` : null,
    `\n${creature} is watching.`,
  ]

  return buildPersonaMessage(persona, lines.filter(Boolean) as string[])
}

function buildPersonaMessage(persona: string | null, lines: string[]): string {
  const text = lines.join("\n")
  // Persona-specific formatting (tone only, content stays the same)
  // hard personas (rex, spark) are already direct by nature of the content
  // soft personas (nova, anchor, zen) add a warmer closing line
  const softPersonas = ["nova", "anchor", "zen", "lingua"]
  const isSoft = softPersonas.includes((persona || "rex").toLowerCase())
  if (isSoft) {
    return text + "\n\nI'm here whenever you need to recalibrate."
  }
  return text
}

// ─── Question Templates ───────────────────────────────────────────────────────

const STUDY_Q = {
  sb1: "What are you studying or preparing for right now? Tell me the actual thing — exam, skill, degree, placement, whatever it is.",
  sb2: "When's the actual deadline — exam date, submission, interview, whatever the hard stop is?",
  sb3: "Where are you with it right now — just starting, somewhere in the middle, or behind where you should be?",
  sb4: "Break it down — what are the main subjects or topics you're working on?",
  sb5_style: "How do you study best — long deep sessions, shorter focused blocks, or does it depend on the day?",
  sb6_hours: "Realistically — not optimistically — how many hours a day can you actually study right now?",
  sb7: "Have you tried to get consistent with this before? What happened last time?",
  sb8: "What actually happens if this doesn't go well? What's actually on the line?",
}

const GENERAL_Q = {
  gn1: "Tell me what's actually going on in your life right now — work, personal, whatever's taking up the most headspace.",
  gn2: "If you could get one area of your life properly sorted in the next 30 days — what would it be?",
  gn3: "What's stopping you from making progress on that right now?",
}

// ─── Classifiers ─────────────────────────────────────────────────────────────

async function classifySplit(text: string): Promise<string> {
  return llmClassify(
    text,
    [
      "Classify the gym training split described by the user. Reply with ONLY one word:",
      "  PPL          — push/pull/legs split",
      "  upper_lower  — upper body / lower body alternating",
      "  full_body     — full body sessions each time",
      "  bro_split    — body-part split (chest day, back day, arm day, etc.)",
      "  none         — hasn't started, no split yet, not currently going to gym",
      "  unstructured — goes to gym but no defined split / random / mixed",
      "When in doubt, default to: unstructured",
    ].join("\n"),
    ["PPL", "upper_lower", "full_body", "bro_split", "none", "unstructured"],
    "unstructured",
  )
}

async function classifyStudyCategory(text: string): Promise<string> {
  return llmClassify(
    text,
    [
      "Classify what the user is studying or preparing for. Reply with ONLY one word:",
      "  competitive_exam — entrance exam (JEE, NEET, UPSC, CAT, GRE, GMAT, boards, etc.)",
      "  academic         — university/college coursework, semester, degree",
      "  technical_skill  — coding, DSA, software development, CS fundamentals",
      "  placement_prep   — job placement, campus interviews, internship prep",
      "  skill_building   — learning a skill, certification, language, creative, or anything else",
      "When in doubt, default to: skill_building",
    ].join("\n"),
    ["competitive_exam", "academic", "technical_skill", "placement_prep", "skill_building"],
    "skill_building",
  )
}

async function classifyStudyStatus(text: string): Promise<string> {
  return llmClassify(
    text,
    [
      "Classify the user's current study/preparation progress. Reply with ONLY one word:",
      "  not_started          — hasn't begun at all",
      "  early                — just started, very early stages",
      "  on_track             — progressing as expected, keeping up",
      "  behind               — somewhat behind schedule",
      "  significantly_behind — very behind, months of backlog, serious gap",
      "When in doubt, default to: on_track",
    ].join("\n"),
    ["not_started", "early", "on_track", "behind", "significantly_behind"],
    "on_track",
  )
}

function ackFocusKiller(killer: string): string {
  const map: Record<string, string> = {
    phone: "Phone. The most common and most fixable one.",
    people: "Other people. Worth setting some physical boundaries before we build the schedule.",
    mental: "Your own head. That's the hardest one to work around — but we can.",
    environment: "The environment. We can fix the setup.",
    multiple: "Multiple things pulling. We'll address the schedule around that.",
  }
  return map[killer] ?? "Noted."
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

function parseTimeString(text: string): string | null {
  const match = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i)
  if (!match) return null
  let hour = parseInt(match[1])
  const minute = parseInt(match[2] || "0")
  const period = match[3]?.toLowerCase()
  if (period === "pm" && hour < 12) hour += 12
  if (period === "am" && hour === 12) hour = 0
  if (hour > 23 || minute > 59) return null
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

function parseDateFromText(text: string): Date | null {
  // Try ISO/common date formats
  const isoMatch = text.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/)
  if (isoMatch) {
    const d = new Date(`${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}`)
    if (!isNaN(d.getTime())) return d
  }
  // dd/mm/yyyy or dd-mm-yyyy
  const dmyMatch = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/)
  if (dmyMatch) {
    const year = dmyMatch[3].length === 2 ? `20${dmyMatch[3]}` : dmyMatch[3]
    const d = new Date(`${year}-${dmyMatch[2].padStart(2, "0")}-${dmyMatch[1].padStart(2, "0")}`)
    if (!isNaN(d.getTime())) return d
  }
  // month name
  const monthMatch = text.match(/(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{2,4})?/i)
  if (monthMatch) {
    const months: Record<string, string> = {
      jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",
      jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12",
    }
    const month = months[monthMatch[2].toLowerCase().slice(0, 3)]
    const year = monthMatch[3] ? (monthMatch[3].length === 2 ? `20${monthMatch[3]}` : monthMatch[3]) : String(new Date().getFullYear())
    const d = new Date(`${year}-${month}-${monthMatch[1].padStart(2, "0")}`)
    if (!isNaN(d.getTime())) return d
  }
  return null
}

function shiftTime(time: string, minutesDelta: number): string {
  const [h, m] = time.split(":").map(Number)
  const total = (h * 60 + (m || 0) + minutesDelta + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}

// ─── Fallback Plans ───────────────────────────────────────────────────────────

function buildFallbackGymPlan(days: number, split: string, goal: string): string {
  const splits: Record<string, string[]> = {
    PPL: ["Push (Chest, Shoulders, Triceps)", "Pull (Back, Biceps)", "Legs (Quads, Hamstrings, Glutes)"],
    upper_lower: ["Upper Body", "Lower Body"],
    bro_split: ["Chest", "Back", "Legs", "Shoulders", "Arms"],
    full_body: ["Full Body"],
    default: ["Upper Body", "Lower Body", "Full Body"],
  }
  const sessions = (splits[split] || splits.default).slice(0, days)
  const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  const lines = ["WEEKLY GYM PLAN", ""]
  let sessionIdx = 0
  for (let i = 0; i < 7; i++) {
    if (sessionIdx < sessions.length) {
      lines.push(`${weekDays[i]}: ${sessions[sessionIdx++]}`)
    } else {
      lines.push(`${weekDays[i]}: Rest`)
    }
  }
  return lines.join("\n")
}

function buildFallbackStudyPlan(subjects: string, weak: string, hours: number): string {
  const subjectList = subjects.split(",").map(s => s.trim()).filter(Boolean)
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  const lines = ["WEEKLY STUDY PLAN", ""]
  for (let i = 0; i < 7; i++) {
    const subject = i === 0 ? weak : subjectList[i % subjectList.length] || weak
    lines.push(`${days[i]}: ${subject} — ${hours}h focused session`)
  }
  return lines.join("\n")
}

// ─── Passive Data Extraction ──────────────────────────────────────────────────
// Runs on EVERY onboarding message to capture data volunteered ahead of schedule.
// Saves immediately so handlers that come later don't need to re-ask.

function extractPassiveSplitType(text: string): string | null {
  if (/\b(push.{0,20}pull.{0,20}leg|ppl)\b/i.test(text)) return "PPL"
  if (/upper.{0,10}lower|lower.{0,10}upper/i.test(text)) return "upper_lower"
  if (/\bfull.?body\b/i.test(text)) return "full_body"
  // Day-of-week pattern paired with muscle group names → structured split
  if (
    /\b(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.{0,30}[-:–]/i.test(text) &&
    /\b(chest|back|legs?|shoulders?|arms?|bicep|tricep|push|pull)\b/i.test(text)
  ) return "bro_split"
  return null
}

// Bug 3: parse a user's described split into an ordered day sequence.
// "Back/Tri, Chest/Bi, Legs" → ["Back + Triceps", "Chest + Biceps", "Legs"]
function parseSplitDaySequence(raw: string): string[] | null {
  const MUSCLE_ABBREVS: Record<string, string> = {
    tri: "Triceps", tris: "Triceps", tricep: "Triceps", triceps: "Triceps",
    bi: "Biceps", bis: "Biceps", bicep: "Biceps", biceps: "Biceps",
    legs: "Legs", leg: "Legs",
    back: "Back", chest: "Chest", shoulders: "Shoulders", shoulder: "Shoulders",
    delt: "Shoulders", delts: "Shoulders",
    arms: "Arms", arm: "Arms", abs: "Core", core: "Core",
    push: "Push", pull: "Pull",
    fullbody: "Full Body", "full body": "Full Body",
  }
  const formatPart = (p: string): string => {
    const key = p.trim().toLowerCase()
    return MUSCLE_ABBREVS[key] ?? (p.trim().charAt(0).toUpperCase() + p.trim().slice(1).toLowerCase())
  }

  // Split on commas, arrows, newlines, or semicolons to get day chunks
  const chunks = raw.split(/,\s*|→|->|\n|;\s*|\|/).map(c => c.trim()).filter(c => c.length > 1)
  if (chunks.length < 2) return null

  const days: string[] = []
  for (const chunk of chunks) {
    // Remove "Day 1:", "D1:", etc. prefixes
    const clean = chunk.replace(/^(?:day\s*\d+|d\d+)\s*[:.-]?\s*/i, "").trim()
    if (!clean || /^rest$/i.test(clean)) continue
    // Split within a day by "/" or "+"
    const parts = clean.split(/\s*[\/+&]\s*/).map(formatPart)
    days.push(parts.join(" + "))
  }
  return days.length >= 2 ? days : null
}

async function applyPassiveIntakeData(userId: string, answers: IntakeAnswers, text: string): Promise<void> {
  let changed = false

  // Split — only capture if not yet set and not mid-review-loop
  if (!answers.current_split && !answers.split_review_pending) {
    const splitType = extractPassiveSplitType(text)
    if (splitType) {
      answers.current_split = splitType
      answers.split_raw     = text
      // Bug 3: also try to extract custom day sequence
      const seq = parseSplitDaySequence(text)
      if (seq) answers.split_days_json = JSON.stringify(seq)
      changed = true
    }
  }

  // Gym time — only capture if not yet set
  if (!answers.gym_session_time) {
    const timeMatch = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
    if (timeMatch) {
      const parsed = parseTimeString(timeMatch[0])
      if (parsed) {
        answers.gym_session_time = parsed
        changed = true
      }
    }
  }

  // Bug 10: also passively capture bodyweight, height, and training days
  if (!answers.current_bodyweight_kg) {
    const bw = parseBodyweightKg(text)
    if (bw) { answers.current_bodyweight_kg = String(bw); changed = true }
  }
  if (!answers.height_cm) {
    const ht = parseHeightCm(text)
    if (ht) { answers.height_cm = String(ht); changed = true }
  }
  if (!answers.available_training_days) {
    const daysM = text.match(/\b([3-6])\s*(?:days?|x|times?|\/week)\b/i)
    if (daysM) { answers.available_training_days = daysM[1]; changed = true }
  }

  if (changed) {
    await prisma.messengerUser.update({ where: { id: userId }, data: { intakeAnswers: answers as any } })
  }
}

// ─── Onboarding Finalization ──────────────────────────────────────────────────
// Single source of truth for completing Rex gym onboarding.
// All Tasks 1-4, 7-8 are enforced here.

// Task 1 + Task 7 — Apply safe defaults to all required scheduler/coach fields.
// A user that reaches this function will ALWAYS have a valid preferredCheckInTime.
function applyProfileDefaults(answers: IntakeAnswers): IntakeAnswers {
  const fixed: IntakeAnswers = { ...answers }
  // preferredCheckInTime is the single most critical field — if missing the user
  // is invisible to every cron query. Default to 07:00 so at least schedulers run.
  if (!fixed.gym_session_time)           fixed.gym_session_time        = "07:00"
  if (!fixed.available_training_days)    fixed.available_training_days = "3"
  if (!fixed.current_split)             fixed.current_split            = "unstructured"
  if (!fixed.gym_goal)                  fixed.gym_goal                 = "muscle"
  if (!fixed.training_experience)       fixed.training_experience      = "intermediate"
  if (!fixed.injury_notes)              fixed.injury_notes             = "none"
  return fixed
}

// Task 2 + Task 3 + Task 4 + Task 8 — Idempotent profile write.
// Writes memory, updates the profile DB row, and attempts plan generation.
// Memory write failures are logged but never block completion.
// Plan generation failures are caught and logged — user can re-generate later.
// Running this function twice produces the same end state (idempotent).
async function writeRexProfileToDb(
  userId:  string,
  chatId:  string,
  answers: IntakeAnswers,
): Promise<IntakeAnswers> {
  const safe     = applyProfileDefaults(answers)
  const timezone = safe.city ? cityToTimezone(safe.city) : "Asia/Kolkata"

  // Task 8 — Idempotency: skip memory writes if already marked as finalized
  const alreadyFinalized = await prisma.memoryFact.count({
    where: { userId, type: "intake_finalized" },
  }).then(n => n > 0).catch(() => false)

  if (!alreadyFinalized) {
    // Task 3 — Promise.allSettled: one failure never blocks the rest
    const writes: Promise<void>[] = [
      addToLongTerm(chatId, "preferences", `gym_goal: ${safe.gym_goal}`),
      addToLongTerm(chatId, "preferences", `training_experience: ${safe.training_experience}`),
      addToLongTerm(chatId, "preferences", `training_days_per_week: ${safe.available_training_days}`),
      addToLongTerm(chatId, "preferences", `current_split: ${safe.current_split}`),
      addToLongTerm(chatId, "preferences", `gym_session_time: ${safe.gym_session_time}`),
      ...(safe.protein_target_g
        ? [addToLongTerm(chatId, "preferences", `protein_target: ${safe.protein_target_g}g`)]
        : []),
      ...(safe.squat_kg || safe.bench_kg || safe.deadlift_kg
        ? [addToLongTerm(chatId, "anchors", `lifts — squat: ${safe.squat_kg ?? "?"}, bench: ${safe.bench_kg ?? "?"}, deadlift: ${safe.deadlift_kg ?? "?"}`)]
        : []),
      ...(safe.current_bodyweight_kg
        ? [addToLongTerm(chatId, "preferences", `bodyweight: ${safe.current_bodyweight_kg}kg`)]
        : []),
      ...(safe.height_cm
        ? [addToLongTerm(chatId, "preferences", `height: ${safe.height_cm}cm`)]
        : []),
    ]
    const results = await Promise.allSettled(writes)
    const failed  = results.filter(r => r.status === "rejected")
    if (failed.length) {
      console.error(`[INTAKE] ${failed.length}/${writes.length} memory write(s) failed for ${chatId}`)
    }

    // Idempotency marker — written once so a retry skips the above block
    await prisma.memoryFact.create({
      data: { userId, type: "intake_finalized", key: "gym", value: new Date().toISOString(), confidence: 1.0 },
    }).catch(e => console.error("[INTAKE] finalization marker write failed:", e))
  }

  // Task 1 — preferredCheckInTime is ALWAYS set (never conditional after applyProfileDefaults)
  await prisma.messengerUser.update({
    where: { id: userId },
    data: {
      preferredCheckInTime: safe.gym_session_time,
      timezone,
      intakeAnswers: safe as any,
    },
  })

  // Task 4 — Plan generation is optional. Never blocks profile write or completion.
  try {
    const gymPlan = await buildGymPlan(safe)
    await savePlan(chatId, gymPlan)
  } catch (err) {
    console.error(`[INTAKE] Plan generation failed for ${chatId} — continuing:`, err)
  }

  return safe
}

// Thin wrapper: profile write + mark intakeComplete = true (gym-only path).
async function finalizeRexProfile(
  userId:  string,
  chatId:  string,
  answers: IntakeAnswers,
  modules: string[],
): Promise<IntakeAnswers> {
  const safe = await writeRexProfileToDb(userId, chatId, answers)
  await updateIntake(userId, "complete", safe, modules, { intakeComplete: true })
  return safe
}

// ─── DB Helpers ───────────────────────────────────────────────────────────────

async function updateIntake(
  userId: string,
  step: IntakeStep,
  answers?: IntakeAnswers,
  modules?: string[],
  extras?: Record<string, unknown>
): Promise<void> {
  await prisma.messengerUser.update({
    where: { id: userId },
    data: {
      intakeStep: step,
      ...(answers ? { intakeAnswers: answers as any } : {}),
      ...(modules ? { activeModules: modules } : {}),
      ...extras,
    },
  })
}

function parseAnswers(value: unknown): IntakeAnswers {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as IntakeAnswers
}
