import { prisma } from "@repo/db/client"

type IntakePath = "gym" | "study" | "general"

const DOMAIN_FIRST_STEP: Record<IntakePath, string> = {
  gym: "ga1",
  study: "sb1",
  general: "gn1",
}

const DOMAIN_OPENER_QUESTION: Record<IntakePath, string> = {
  gym: "What's the actual goal right now — building muscle, losing weight, getting stronger, or just making gym a consistent habit?",
  study: "What are you studying or preparing for right now? Give me the actual thing — exam, skill, degree, placement.",
  general: "What's actually going on in your life right now — what's taking up most of your headspace?",
}

function buildOpenerMessage(opts: {
  creatureName: string
  primaryGoal: string
  coreGap: string
  domain: IntakePath
  persona: string
  toneModifier: string | null
}): string {
  const { creatureName, primaryGoal, coreGap, domain, persona, toneModifier } = opts
  const q = DOMAIN_OPENER_QUESTION[domain]
  const name = creatureName || "your companion"
  const goal = primaryGoal || "something important"
  const gap = coreGap || "the thing you keep putting off"

  // rex + firm_not_brutal: direct, 2-3 sentences, no warmth but not aggressive
  if (persona === "rex" && toneModifier === "firm_not_brutal") {
    return `${name} brought me here.\n\nYou're aiming for ${goal} — and ${gap} keeps getting in the way. I see it.\n\nBefore we move, tell me where things actually stand.\n\n${q}`
  }

  // rex default: sharp, 1-2 sentences, challenge-framed
  if (persona === "rex") {
    return `${name} sent me.\n\nYou said ${goal}. And ${gap} is what keeps stopping you. Let's be straight about that.\n\n${q}`
  }

  // nova + structured_direct: warm but focused, no fluff, deadline-oriented
  if (persona === "nova" && toneModifier === "structured_direct") {
    return `${name} brought me here.\n\nYou want ${goal}, and ${gap} has been the block. We're going to fix that — but I need specifics first.\n\n${q}`
  }

  // nova default: warm, calm, patient, structured
  if (persona === "nova") {
    return `${name} brought me here.\n\nI already know a bit about you — you want ${goal}, and the thing you keep not fixing is ${gap}.\n\nBefore I can actually help, I need to understand your situation properly.\n\n${q}`
  }

  // zen + purposeful_direct: thoughtful but pointed, clear direction
  if (persona === "zen" && toneModifier === "purposeful_direct") {
    return `${name} sent me.\n\nYou want ${goal}. What pulls you back is ${gap}. Let's look at that directly.\n\n${q}`
  }

  // zen default: slow, open, philosophical, never rushed
  return `${name} brought me here.\n\nI know you're working toward ${goal}. And ${gap} keeps showing up — most things worth doing have something like that.\n\nBefore I can be useful to you, I need to understand where you are right now.\n\n${q}`
}

// Maps energy pattern text to a morning checkin time
function energyPatternToCheckin(energyText: string | null, explicitTime: string | null): string {
  if (explicitTime) return explicitTime

  const text = (energyText || "").toLowerCase()
  if (/\b(early|dawn|5am|6am|7am|gym|workout|run|ready|awake|rise)\b/.test(text)) return "07:30"
  if (/\b(10am|11am|noon|midday|late morning)\b/.test(text)) return "10:00"
  if (/\b(3pm|4pm|5pm|6pm|7pm|evening|afternoon)\b/.test(text)) return "17:00"
  if (/\b(night|late|asleep|tired|dragging|slow|scrolling|snooze)\b/.test(text)) return "20:00"
  return "08:00"
}

function nextMessageTimeUTC(morningCheckin: string): Date {
  const [h, m] = morningCheckin.split(":").map(Number)
  const t = new Date()
  t.setUTCDate(t.getUTCDate() + 1)
  t.setUTCHours(h, m ?? 0, 0, 0)
  return t
}

// Called from the onboarding completion route to pre-wire the schedule
export function buildOnboardingSchedulePayload(opts: {
  energyPattern: string | null
  preferredCheckInTime: string | null
}): {
  messageSchedule: { morningCheckin: string }
  nextMessageTime: Date
  mentorIntakeStarted: boolean
  mentorIntakeComplete: boolean
} {
  const morningCheckin = energyPatternToCheckin(opts.energyPattern, opts.preferredCheckInTime)
  return {
    messageSchedule: { morningCheckin },
    nextMessageTime: nextMessageTimeUTC(morningCheckin),
    mentorIntakeStarted: false,
    mentorIntakeComplete: false,
  }
}

// Called from the Telegram /start handler the moment telegramConnected flips to true
export async function fireMentorIntakeOpener(
  profileId: string,
  telegramChatId: string,
  sendFn: (chatId: string, text: string) => Promise<void>,
): Promise<void> {
  const profile = await prisma.userProfile.findUnique({
    where: { id: profileId },
    select: {
      creatureName: true,
      primaryGoal30d: true,
      corePain: true,
      primaryPersona: true,
      mentorDomain: true,
      toneModifier: true,
    },
  })
  if (!profile) return

  const domain: IntakePath =
    profile.mentorDomain === "gym" ? "gym" :
    profile.mentorDomain === "study" ? "study" : "general"

  const firstStep = DOMAIN_FIRST_STEP[domain]

  const message = buildOpenerMessage({
    creatureName: profile.creatureName ?? "",
    primaryGoal: profile.primaryGoal30d ?? "",
    coreGap: profile.corePain ?? "",
    domain,
    persona: profile.primaryPersona ?? "nova",
    toneModifier: profile.toneModifier ?? null,
  })

  await sendFn(telegramChatId, message)

  // Mark intake started and write initial state to UserProfile (web-side tracking)
  const intakeState = {
    path: domain,
    currentQuestion: firstStep.toUpperCase(),
    answeredQuestions: [] as string[],
    complete: false,
  }
  await prisma.userProfile.update({
    where: { id: profileId },
    data: { mentorIntakeStarted: true, intakeState },
  })

  // Advance MessengerUser intakeStep past not_started/path_select to the first domain question.
  // The existing intake handler (intake.service.ts) will pick up from this step on the
  // next user message, skipping the generic opener it would otherwise send.
  await prisma.messengerUser.update({
    where: {
      platform_platformChatId: { platform: "telegram", platformChatId: telegramChatId },
    },
    data: { intakeStep: firstStep },
  })
}
