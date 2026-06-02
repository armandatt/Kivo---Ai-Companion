import { prisma } from "@repo/db/client"
import { addToLongTerm, addToShortTerm } from "./memory.service"
import { savePlan } from "./planner.service"
import { saveDeadline } from "./deadline.service"
import { generateOpenAIText } from "./openai.service"

// ─── Types ────────────────────────────────────────────────────────────────────

type IntakeStep =
  | "not_started" | "path_select"
  | "ga1" | "ga1_target" | "ga2_weight" | "ga2_exp"
  | "ga3" | "ga3_days" | "ga4" | "ga5_diet" | "ga5_track" | "ga6" | "ga7"
  | "sb1" | "sb2" | "sb3" | "sb3b" | "sb4" | "sb4b"
  | "sb5_style" | "sb5_killer" | "sb6_hours" | "sb6_consistency"
  | "sb7" | "sb8"
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

type IntakeAnswers = Record<string, string>

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

  const step = (user.intakeStep || "not_started") as IntakeStep
  const answers = parseAnswers(user.intakeAnswers)
  const modules = user.activeModules || []

  const profile: WebProfile = input.webProfile ?? {
    creatureName: user.creatureName,
    primaryGoal30d: user.primaryGoal30d,
    corePain: user.corePain,
    persona: user.persona,
    accountabilityStyle: user.tonePreference,
    preferredCheckInTime: user.preferredCheckInTime,
  }

  const reply = await routeStep(step, input.text.trim(), answers, modules, user, profile, input.platformChatId)

  await addToShortTerm(input.platformChatId, reply, { role: "assistant", intent: "intake", emotion: "neutral" })
  return { handled: true, reply }
}

// ─── Step Router ──────────────────────────────────────────────────────────────

async function routeStep(
  step: IntakeStep, text: string, answers: IntakeAnswers,
  modules: string[], user: IntakeUser, profile: WebProfile, chatId: string
): Promise<string> {
  switch (step) {
    case "not_started":    return handleNotStarted(user, profile, chatId)
    case "path_select":    return handlePathSelect(text, answers, user, profile, chatId)
    case "ga1":            return handleGa1(text, answers, user, chatId)
    case "ga1_target":     return handleGa1Target(text, answers, user, chatId)
    case "ga2_weight":     return handleGa2Weight(text, answers, user, chatId)
    case "ga2_exp":        return handleGa2Exp(text, answers, user, chatId)
    case "ga3":            return handleGa3(text, answers, user, chatId)
    case "ga3_days":       return handleGa3Days(text, answers, user, chatId)
    case "ga4":            return handleGa4(text, answers, user, chatId)
    case "ga5_diet":       return handleGa5Diet(text, answers, user, chatId)
    case "ga5_track":      return handleGa5Track(text, answers, user, chatId)
    case "ga6":            return handleGa6(text, answers, user, chatId)
    case "ga7":            return handleGa7(text, answers, modules, user, profile, chatId)
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

async function handleNotStarted(user: IntakeUser, profile: WebProfile, chatId: string): Promise<string> {
  await updateIntake(user.id, "path_select", {}, [])

  const persona  = profile.persona || user.persona || "nova"
  const creature = profile.creatureName || user.creatureName || null
  // Only use goal/pain if they are real values, not the generic fallbacks
  const goal = (profile.primaryGoal30d && profile.primaryGoal30d !== "something important")
    ? profile.primaryGoal30d : null
  const pain = (profile.corePain && profile.corePain !== "the thing you keep not doing")
    ? profile.corePain : null

  const pathQ = "Gym and fitness, studying and work, or both? Pick one."

  if (persona === "rex" || persona === "spark") {
    const creatureLine = creature ? `${creature} sent me.` : "I'm here."
    const goalLine     = goal ? `You want ${goal}.` : "You have a goal. Let's make it concrete."
    const painLine     = pain ? `And ${pain} keeps getting in the way.` : ""
    return [creatureLine, goalLine, painLine, `\nNo warm-up. A few direct questions and we'll have something to work with.\n\n${pathQ}`]
      .filter(Boolean).join(" ")
  }

  if (persona === "zen") {
    const creatureLine = creature ? `${creature} brought me here.` : "Something brought you here."
    const goalLine     = goal ? `You're working toward ${goal}.` : "You have something you're working toward."
    const painLine     = pain ? `And ${pain} keeps pulling you back.` : ""
    return [creatureLine, goalLine, painLine, `\nBefore I can be useful, I need to understand where you actually are. A few questions — answer from what's real, not what sounds good.\n\n${pathQ}`]
      .filter(Boolean).join(" ")
  }

  // Nova / default
  const creatureLine = creature ? `${creature} brought me here.` : "I'm here."
  const goalLine     = goal ? `I already know you want ${goal}.` : "I'm here to help you build something real."
  const painLine     = pain ? `And the thing that keeps getting in the way is ${pain}.` : ""
  return [creatureLine, goalLine, painLine, `\nBefore I can actually help, I need to understand your situation. Going to ask you a few things. The more honest you are, the more useful I'll be.\n\n${pathQ}`]
    .filter(Boolean).join("\n\n")
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

  const q = gymQ(user.persona)
  const isRex = user.persona === "rex" || user.persona === "spark"

  if (wantsBoth) {
    modules = ["gym", "study"]
    firstStep = "ga1"
    reply = isRex
      ? `Both. Gym first — it's the most structured.\n\n${q.ga1}`
      : `Both. Good — that means we're building the full picture.\n\nLet's start with gym since it's the most structured part.\n\n${q.ga1}`
  } else if (wantsGym) {
    modules = ["gym"]
    firstStep = "ga1"
    reply = isRex ? `Gym.\n\n${q.ga1}` : `Gym it is.\n\n${q.ga1}`
  } else {
    modules = ["study"]
    firstStep = "sb1"
    reply = isRex ? `Study and work.\n\n${STUDY_Q.sb1}` : `Study and work mode.\n\n${STUDY_Q.sb1}`
  }

  await updateIntake(user.id, firstStep, answers, modules)
  return reply
}

// ─── Gym Path ─────────────────────────────────────────────────────────────────

async function handleGa1(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  const goal = classifyGymGoal(text)
  answers.gym_goal = goal
  const needsTarget = goal === "bulk" || goal === "cut" || goal === "recomp"
  const next: IntakeStep = needsTarget ? "ga1_target" : "ga2_weight"
  const q = gymQ(user.persona)
  await updateIntake(user.id, next, answers)

  const ack = {
    bulk:     "Building.",
    cut:      "Cutting.",
    strength: "Strength.",
    habit:    "Consistency.",
    recomp:   "Recomp.",
  }[goal] ?? "Got it."

  if (needsTarget) {
    return `${ack} Give me a target — where do you want to be in 3 months? Weight, lift number, whatever.`
  }
  return `${ack}\n\n${q.ga2_weight}`
}

async function handleGa1Target(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  answers.gym_target_3m = text
  await updateIntake(user.id, "ga2_weight", answers)
  return `Locked.\n\n${gymQ(user.persona).ga2_weight}`
}

async function handleGa2Weight(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  const kg = parseWeight(text)
  if (kg) {
    answers.current_bodyweight_kg = String(kg)
    const goal = answers.gym_goal || "bulk"
    const protein = Math.round(kg * (goal === "cut" ? 2.2 : 1.8))
    answers.protein_target_g = String(protein)
  } else {
    answers.current_bodyweight_kg = text
    answers.protein_target_g = "160"
  }
  await updateIntake(user.id, "ga2_exp", answers)
  return `Noted.\n\n${gymQ(user.persona).ga2_exp}`
}

async function handleGa2Exp(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  answers.training_experience = classifyTrainingExp(text)
  await updateIntake(user.id, "ga3", answers)
  return `${ackExp(answers.training_experience)}\n\n${gymQ(user.persona).ga3}`
}

async function handleGa3(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  const split = classifySplit(text)
  answers.current_split = split
  const needsDays = split === "unstructured" || split === "none"
  const next: IntakeStep = needsDays ? "ga3_days" : "ga4"
  const q = gymQ(user.persona)
  await updateIntake(user.id, next, answers)

  const acks: Record<string, string> = {
    PPL:         "PPL.",
    upper_lower: "Upper/lower.",
    bro_split:   "Bro split.",
    full_body:   "Full body.",
    unstructured:"No structure yet.",
    none:        "Starting fresh.",
  }
  const ack = acks[split] ?? "Got it."

  if (needsDays) {
    return `${ack} How many days a week can you actually train? Real number.`
  }
  return `${ack}\n\n${q.ga4}`
}

async function handleGa3Days(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  const days = parseInt(text.match(/\d/)?.[0] || "3")
  answers.available_training_days = String(Math.min(Math.max(days, 1), 7))
  await updateIntake(user.id, "ga4", answers)
  return `${answers.available_training_days} days. That's what we build around.\n\n${gymQ(user.persona).ga4}`
}

async function handleGa4(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  const time = parseTimeString(text) || text.trim()
  answers.gym_session_time = time
  await updateIntake(user.id, "ga5_diet", answers)
  return `${time}. Pre-session cue and post-session check-in will run around that.\n\n${gymQ(user.persona).ga5_diet}`
}

async function handleGa5Diet(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  const t = text.toLowerCase()
  answers.diet_type = /\bvegan\b/.test(t) ? "vegan" : /\bveg\b|vegetarian/.test(t) ? "veg" : "non_veg"
  await updateIntake(user.id, "ga5_track", answers)
  return `Got it.\n\n${gymQ(user.persona).ga5_track}`
}

async function handleGa5Track(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  const t = text.toLowerCase()
  answers.diet_tracking = /track|myfitnesspal|count|log/.test(t)
    ? "tracking"
    : /rough|sort of|kind of|aware/.test(t)
    ? "rough_awareness"
    : "not_tracking"
  await updateIntake(user.id, "ga6", answers)
  return `Got it.\n\n${gymQ(user.persona).ga6}`
}

async function handleGa6(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  const hasInjury = !/\b(no|none|nothing|all good|fine|healthy|nope)\b/i.test(text)
  answers.injury_notes = hasInjury ? text : "none"
  if (hasInjury) {
    await addToLongTerm(chatId, "preferences", `injury_flag: ${text}`)
  }
  await updateIntake(user.id, "ga7", answers)

  const ack = hasInjury ? `Noted — working around that.` : `Clean.`
  return `${ack}\n\n${gymQ(user.persona).ga7}`
}

async function handleGa7(
  text: string, answers: IntakeAnswers, modules: string[],
  user: IntakeUser, profile: WebProfile, chatId: string
): Promise<string> {
  answers.gym_motivation_core = text

  // Store all gym data to long-term memory
  await Promise.all([
    addToLongTerm(chatId, "preferences", `gym_goal: ${answers.gym_goal}`),
    addToLongTerm(chatId, "preferences", `protein_target: ${answers.protein_target_g}g`),
    addToLongTerm(chatId, "preferences", `gym_session_time: ${answers.gym_session_time}`),
    addToLongTerm(chatId, "preferences", `training_experience: ${answers.training_experience}`),
    addToLongTerm(chatId, "preferences", `current_split: ${answers.current_split}`),
    addToLongTerm(chatId, "preferences", `diet_type: ${answers.diet_type}`),
    answers.available_training_days
      ? addToLongTerm(chatId, "preferences", `training_days_per_week: ${answers.available_training_days}`)
      : Promise.resolve(),
  ])

  // Update MessengerUser with session time and gym mode
  const sessionTime = parseTimeString(answers.gym_session_time)
  await prisma.messengerUser.update({
    where: { id: user.id },
    data: {
      ...(sessionTime ? { preferredCheckInTime: profile.preferredCheckInTime || "08:00" } : {}),
      intakeAnswers: answers,
    },
  })

  // Build and save weekly gym plan
  const gymPlan = await buildGymPlan(answers)
  await savePlan(chatId, gymPlan)

  // Check if study path is also queued
  const studyQueued = modules.includes("study")
  if (studyQueued) {
    await updateIntake(user.id, "sb1", answers, modules)
    return buildGymClosing(answers, profile, user) + "\n\n---\n\nNow for study.\n\n" + STUDY_Q.sb1
  }

  await updateIntake(user.id, "complete", answers, modules, { intakeComplete: true })
  return buildGymClosing(answers, profile, user)
}

// ─── Study Path ───────────────────────────────────────────────────────────────

async function handleSb1(text: string, answers: IntakeAnswers, user: IntakeUser, chatId: string): Promise<string> {
  answers.study_goal_description = text
  answers.study_category = classifyStudyCategory(text)
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
  const status = classifyStudyStatus(text)
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

  await Promise.all([
    addToLongTerm(chatId, "preferences", `study_goal: ${answers.study_goal_description}`),
    addToLongTerm(chatId, "preferences", `study_category: ${answers.study_category}`),
    addToLongTerm(chatId, "preferences", `study_style: ${answers.study_style}`),
    addToLongTerm(chatId, "preferences", `focus_killer: ${answers.focus_killer}`),
    addToLongTerm(chatId, "preferences", `study_hours_daily: ${answers.study_hours_available}`),
    addToLongTerm(chatId, "struggles", `study_past_failure: ${answers.study_past_failure}`),
  ])

  // Save deadline if we have one
  if (answers.study_deadline_iso) {
    await saveDeadline({
      platformChatId: chatId,
      title: answers.study_goal_description || "Study deadline",
      dueAt: new Date(answers.study_deadline_iso),
    })
  }

  // Build and save study plan
  const studyPlan = await buildStudyPlan(answers)
  await savePlan(chatId, studyPlan)

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
    await updateIntake(user.id, "ga1", answers, ["gym"])
    return `Gym it is — switching to the right track.\n\n${GYM_Q.ga1}`
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
    await updateIntake(user.id, "ga1", answers, ["gym"])
    return `Gym. That's what we're building around.\n\n${GYM_Q.ga1}`
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

function buildGymClosing(a: IntakeAnswers, profile: WebProfile, user: IntakeUser): string {
  const creature = profile.creatureName || user.creatureName || "your companion"
  const persona = profile.persona || user.persona
  const checkin = profile.preferredCheckInTime || "08:00"
  const sessionTime = a.gym_session_time || "your session time"
  const preTime = shiftTime(parseTimeString(sessionTime) || "07:00", -30)

  const lines = [
    `Right. Here's where we are:`,
    `Goal: ${a.gym_goal}${a.gym_target_3m ? ` — targeting ${a.gym_target_3m}` : ""}`,
    `Protein: ${a.protein_target_g}g a day starting now`,
    `Training: ${a.current_split}${a.available_training_days ? `, ${a.available_training_days} days a week` : ""} at ${sessionTime}`,
    a.injury_notes && a.injury_notes !== "none" ? `Keeping ${a.injury_notes} out of the programme for now.` : null,
    ``,
    `Protein sources for ${a.diet_type === "veg" ? "you: eggs, paneer, soya chunks, curd, dal" : a.diet_type === "vegan" ? "you: tofu, soya chunks, lentils, chickpeas" : "you: chicken breast, eggs, fish, paneer"}.`,
    ``,
    `First session cue at ${preTime}. Morning check-in at ${checkin}.`,
    a.gym_motivation_core ? `\nYou said this matters because: ${a.gym_motivation_core}.\nI won't forget that.` : null,
    `\n${creature} grows when you show up.`,
  ]

  return buildPersonaMessage(persona, lines.filter(Boolean) as string[])
}

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

// Rex / Spark — short, direct, no hedging
const REX_GYM_Q = {
  ga1: "Goal — bulk, cut, strength, or just make it a consistent habit?",
  ga2_weight: "Weight right now. Just the number.",
  ga2_exp: "How long have you been training? Beginner, a few months, or been at it for a while?",
  ga3: "Current split — PPL, upper/lower, bro split, full body, or no structure?",
  ga4: "What time are you training?",
  ga5_diet: "Veg or non-veg?",
  ga5_track: "Tracking food or going by feel?",
  ga6: "Injuries I need to work around?",
  ga7: "Last one — why does this actually matter? Not the goal. The real reason underneath it.",
}

// Nova / Zen / others — full, contextual
const GYM_Q = {
  ga1: "What's the actual goal right now — building muscle, losing weight, getting stronger, or just making gym a consistent thing?",
  ga2_weight: "What do you weigh right now? Rough number is fine.",
  ga2_exp: "How long have you been training consistently — just starting out, been at it a while, or somewhere in between?",
  ga3: "What does training look like right now — do you follow a split or is it more random?",
  ga4: "What time do you usually train, or want to train?",
  ga5_diet: "Veg or non-veg? Need this for diet advice.",
  ga5_track: "Are you tracking food at all, or is it more by feel?",
  ga6: "Any injuries or body parts giving you trouble I should know about before I start recommending things?",
  ga7: "Last gym question — why does this actually matter to you? Not the fitness goal. The thing underneath it.",
}

// Returns the right question set for the given persona
function gymQ(persona: string | null | undefined): typeof GYM_Q {
  const p = (persona ?? "nova").toLowerCase()
  return (p === "rex" || p === "spark") ? REX_GYM_Q : GYM_Q
}

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

function classifyGymGoal(text: string): string {
  const t = text.toLowerCase()
  if (/\b(bulk|muscle|mass|size|gain|build)\b/.test(t)) return "bulk"
  if (/\b(cut|lose|fat|lean|slim|deficit|weight loss|shred)\b/.test(t)) return "cut"
  if (/\b(strength|strong|power|lift|deadlift|squat|bench press)\b/.test(t)) return "strength"
  if (/\b(recomp|both|fat loss.*muscle|muscle.*fat loss)\b/.test(t)) return "recomp"
  return "habit"
}

function classifyTrainingExp(text: string): string {
  const t = text.toLowerCase()
  if (/\b(beginner|new|just start|never|first time|no experience)\b/.test(t)) return "beginner"
  if (/\b(few months?|6 months?|less than a year|started recently)\b/.test(t)) return "early"
  if (/\b(2\+? years?|advanced|serious|competitive)\b/.test(t)) return "advanced"
  return "intermediate"
}

function classifySplit(text: string): string {
  const t = text.toLowerCase()
  if (/\bppl\b|push.?pull.?leg/.test(t)) return "PPL"
  if (/upper.?lower/.test(t)) return "upper_lower"
  if (/full.?body/.test(t)) return "full_body"
  if (/bro|chest day|arm day|body part/.test(t)) return "bro_split"
  if (/nothing|haven.?t started|not going|no gym yet/.test(t)) return "none"
  return "unstructured"
}

function classifyStudyCategory(text: string): string {
  const t = text.toLowerCase()
  if (/\b(jee|neet|upsc|ias|board|competitive|cat|gre|gmat)\b/.test(t)) return "competitive_exam"
  if (/\b(degree|semester|college|uni|btech|mtech|bsc)\b/.test(t)) return "academic"
  if (/\b(coding|dsa|programming|dev|software|cs|leet)\b/.test(t)) return "technical_skill"
  if (/\b(placement|interview|job|internship|campus)\b/.test(t)) return "placement_prep"
  return "skill_building"
}

function classifyStudyStatus(text: string): string {
  const t = text.toLowerCase()
  if (/\b(haven.?t|not started|zero|beginning|just start)\b/.test(t)) return "not_started"
  if (/\b(early|just begun|starting out|beginning)\b/.test(t)) return "early"
  if (/\b(on track|going okay|good|fine|scheduled)\b/.test(t)) return "on_track"
  if (/\b(very behind|a lot|significantly|way behind|months behind)\b/.test(t)) return "significantly_behind"
  if (/\b(behind|late|falling|behind schedule)\b/.test(t)) return "behind"
  return "on_track"
}

function ackExp(exp: string): string {
  const map: Record<string, string> = {
    beginner: "Starting from scratch.",
    early: "A few months in.",
    intermediate: "Some solid time in.",
    advanced: "You've been at this.",
  }
  return map[exp] ?? "Got it."
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

function parseWeight(text: string): number | null {
  const match = text.match(/(\d+(\.\d+)?)\s*(kg|kgs|kilos?)?/i)
  if (!match) return null
  const val = parseFloat(match[1])
  const isLbs = /\blb|pound/.test(text.toLowerCase())
  return isLbs ? Math.round(val * 0.453) : val
}

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
      ...(answers ? { intakeAnswers: answers } : {}),
      ...(modules ? { activeModules: modules } : {}),
      ...extras,
    },
  })
}

function parseAnswers(value: unknown): IntakeAnswers {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as IntakeAnswers
}
