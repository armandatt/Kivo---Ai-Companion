import { NextResponse } from "next/server"
import { prisma } from "@repo/db/client"
import { getSession } from "../lib/auth/session"
//@ts-ignore
import { parseCheckinTime } from "@repo/api/nova/decision/proactive-decision"
//@ts-ignore
import { currentZoneName, isValidTimezone } from "@repo/api/nova/engines/learner-calendar"
import { normalizeLearningContexts, type LearningContext } from "@repo/api/nova/product/learning-context"
//@ts-ignore
import { buildOnboardingSchedulePayload } from "@repo/api/services/mentorIntake.service"
import { matchMentor, type MentorMatch } from "@repo/api/personality/mentor-compatibility"
import { scoreSignal, validateSignalAnswers, type PersonalitySignal, type SignalAnswers } from "@repo/api/personality/signal-scoring"
import { recordOnboardingMatch, saveStyleAssessment, type MatchResolution } from "@repo/api/personality/personality.service"
import { checkOnboardingV2, isOnboardingV2 } from "@repo/api/nova/product/onboarding-answers"
//@ts-ignore
import { completeOnboardingOnce, profileFromAnswers } from "@repo/api/nova/product/onboarding-completion"

export async function POST(req: Request) {
  try {
    const session = await getSession()

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Not authenticated" },
        { status: 401 }
      )
    }

    // A session can outlive its account. There is no one to onboard.
    const account = await prisma.user.findUnique({ where: { id: session.userId }, select: { id: true } })
    if (!account) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    }

    const body = await req.json().catch(() => null)

    // The current quiz (v2) and, for a page loaded before it shipped, the
    // older payload. Both end in the same one-time write below.
    let profileData: Record<string, unknown>
    let afterWrite: () => Promise<void>
    if (isOnboardingV2(body)) {
      const checked = checkOnboardingV2(body)
      if (!checked.ok) {
        return NextResponse.json({ success: false, error: checked.message, field: checked.field }, { status: 400 })
      }
      const v2 = profileFromAnswers(checked.answers, readTimezone((body as { timezone?: unknown }).timezone))
      profileData = v2.profileData
      afterWrite = async () => {
        // The stated preferences are kept apart from the profile, as the
        // signal was: one assessment row, never inside onboardingAnswers.
        await saveStyleAssessment(session.userId, checked.answers.style)
        await recordOnboardingMatch({
          userId: session.userId, answers: null, signal: null,
          resolution: "engine", match: v2.match, assignedMentorId: v2.profileData.primaryPersona,
        })
      }
    } else {
      const payload = normalizePayload(body)
      if (!payload) {
        return NextResponse.json(
          { success: false, error: "Missing onboarding data" },
          { status: 400 }
        )
      }

      // Personality signal (questions 7-10). Optional: older clients do not send
      // it, and an incomplete or invalid set is ignored rather than failing signup.
      const validation = validateSignalAnswers((body as { signalAnswers?: unknown })?.signalAnswers)
      const signalAnswers: SignalAnswers | null = validation.ok ? validation.answers : null
      const signal: PersonalitySignal | null = signalAnswers ? scoreSignal(signalAnswers) : null

      const legacy = mapToDB(payload, signal)
      profileData = legacy.profileData
      afterWrite = () => recordOnboardingMatch({
        userId: session.userId,
        answers: signalAnswers,
        signal,
        resolution: legacy.resolution,
        match: legacy.match,
        assignedMentorId: legacy.profileData.primaryPersona,
      })
    }

    // Onboarding completes once. A refresh, a retry or a second tab finds it
    // done and is answered with the profile as it stands; nothing is written
    // again, so no second assessment row and no changed answers.
    const outcome = await completeOnboardingOnce(session.userId, profileData)
    const savedProfile = await prisma.userProfile.findUnique({ where: { userId: session.userId } })
    if (!savedProfile) {
      return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 })
    }

    if (outcome === "completed") {
      // Best effort: once the profile is stored, a failure writing the
      // preferences, the signal or the match is logged and does not fail the
      // request. This does NOT cover a database that lacks the schema: the
      // write above already reads every UserProfile column, mentorMatch
      // included.
      try {
        await afterWrite()
      } catch (error) {
        console.error("[ONBOARDING] preferences or match not stored:", error)
      }
    }

    // mentorMatch holds the engine's working (need vector, signal-derived tags).
    // The browser has no use for it, so it is not sent back.
    const { mentorMatch: _mentorMatch, ...profile } = savedProfile

    return NextResponse.json({
      success: true,
      alreadyComplete: outcome === "already_complete",
      profile,
    })
  } catch (error) {
    console.error("[ONBOARDING ERROR]", error)

    return NextResponse.json(
      { success: false, error: "Internal Server Error" },
      { status: 500 }
    )
  }
}

type QuizAnswers = {
  energyPattern?: string
  corePain?: string
  mentorDomain?: string | null
  primaryGoal?: string
  accountabilityStyle?: string | null
  aspirationWords?: string[]
}

type OnboardingPayload = {
  quizAnswers: QuizAnswers
  // What they said they are learning for. Kept with the other answers
  // (onboardingAnswers.learningContexts); Nova reads it through its account
  // preferences adapter. Absent when they skipped the question.
  learningContexts?: LearningContext[]
  personaName?: string
  personaDescription?: string
  toneModifier?: string
  creatureType?: string | number
  creatureColor?: string
  creatureName?: string
  checkInTime?: string
  timezone?: string
}

function normalizePayload(body: unknown): OnboardingPayload | null {
  if (!body || typeof body !== "object") return null

  const data = body as Partial<OnboardingPayload> & Partial<QuizAnswers>
  const quizAnswers = data.quizAnswers ?? {
    energyPattern: data.energyPattern,
    corePain: data.corePain,
    primaryGoal: data.primaryGoal,
    accountabilityStyle: data.accountabilityStyle,
    aspirationWords: data.aspirationWords,
  }

  if (!quizAnswers || typeof quizAnswers !== "object") return null

  // Raw personality-signal answers belong only in PersonalityAssessment, so
  // they never ride along into UserProfile.onboardingAnswers.
  delete (quizAnswers as Record<string, unknown>).signalAnswers

  // Asked in the quiz, kept beside it. Only a list of known contexts is
  // kept; anything else is as if the question was skipped.
  const learningContexts = normalizeLearningContexts((quizAnswers as Record<string, unknown>).learningContexts ?? (data as Record<string, unknown>).learningContexts)
  delete (quizAnswers as Record<string, unknown>).learningContexts

  return {
    quizAnswers,
    ...(learningContexts && learningContexts.length > 0 ? { learningContexts } : {}),
    personaName: readString(data.personaName),
    personaDescription: readString(data.personaDescription),
    toneModifier: readString(data.toneModifier),
    creatureType: readString(data.creatureType),
    creatureColor: readString(data.creatureColor),
    creatureName: readString(data.creatureName),
    checkInTime: readCheckInTime(data.checkInTime),
    timezone: readTimezone(data.timezone),
  }
}

// "HH:MM", stored the way Settings stores it. Anything else is no time: the
// scheduler would ignore it, and the learner would be told nothing.
function readCheckInTime(value: unknown) {
  const minute = parseCheckinTime(readString(value))
  return minute === null ? undefined : `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`
}

// A real timezone, under its current name, or none.
function readTimezone(value: unknown) {
  const zone = readString(value)
  return zone && zone.length <= 64 && isValidTimezone(zone) ? currentZoneName(zone) : undefined
}

function readString(value: unknown) {
  if (typeof value === "number") return String(value)
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function normalizeAccountability(value?: string | null) {
  if (!value) return null
  if (value.toLowerCase().includes("gentle")) return "soft"
  if (value.toLowerCase().includes("mercy")) return "hard"
  return value
}

const PERSONA_DESCRIPTIONS: Record<string, string> = {
  REX:  "No excuses. Just results.",
  NOVA: "Steady. Structured. Always here.",
  ZEN:  "Slow down. Go further.",
}

const LEGACY_PERSONAS = new Set(["REX", "NOVA", "ZEN"])

function mapToDB(payload: OnboardingPayload, signal: PersonalitySignal | null) {
  const words = Array.isArray(payload.quizAnswers.aspirationWords)
    ? payload.quizAnswers.aspirationWords.map((word) => word.trim()).filter(Boolean).slice(0, 3)
    : []
  const accountabilityStyle = normalizeAccountability(payload.quizAnswers.accountabilityStyle)

  // The mentor is decided here, on the server, by the compatibility engine.
  // The domain answer is a hard constraint; see packages/api/src/personality.
  const engineMatch: MentorMatch = matchMentor({
    domain: payload.quizAnswers.mentorDomain,
    accountabilityStyle,
    goalCategory: categorizeGoal(payload.quizAnswers.primaryGoal),
    signal,
  })

  // Clients that predate the domain question sent only a persona name. Keep
  // honouring that, as before; everyone else gets the engine's answer.
  const clientPersona = payload.personaName?.toUpperCase()
  const legacyClient = !payload.quizAnswers.mentorDomain && !!clientPersona && LEGACY_PERSONAS.has(clientPersona)
  const personaName = legacyClient ? clientPersona! : engineMatch.mentorId.toUpperCase()
  const toneModifier = legacyClient ? payload.toneModifier ?? null : engineMatch.toneModifier

  // Say how the assignment came about. When the engine did not choose it, no
  // match is stored: the engine's guess for a missing domain is not a match.
  const resolution: Exclude<MatchResolution, "predates_matching"> = legacyClient
    ? "legacy_client_persona"
    : payload.quizAnswers.mentorDomain ? "engine" : "domain_missing_default"
  const match: MentorMatch | null = legacyClient ? null : engineMatch
  const energyPattern = readString(payload.quizAnswers.energyPattern) ?? null
  const preferredCheckInTime = payload.checkInTime ?? null

  const schedule = buildOnboardingSchedulePayload({ energyPattern, preferredCheckInTime })

  const profileData = {
    primaryPersona: personaName.toLowerCase(),
    tone: accountabilityStyle,
    toneModifier,
    energyPattern,
    corePain: readString(payload.quizAnswers.corePain) ?? null,
    primaryGoal30d: readString(payload.quizAnswers.primaryGoal) ?? null,
    goalCategory: categorizeGoal(payload.quizAnswers.primaryGoal),
    accountabilityStyle,
    aspirationWords: words,
    personaName,
    personaDescription:
      PERSONA_DESCRIPTIONS[personaName] ?? payload.personaDescription ?? "No excuses. Just results.",
    creatureType: payload.creatureType ? String(payload.creatureType) : null,
    creatureColor: payload.creatureColor ?? null,
    creatureName: payload.creatureName ?? null,
    preferredCheckInTime,
    timezone: payload.timezone ?? null,
    mentorDomain: payload.quizAnswers.mentorDomain ?? null,
    onboardingComplete: true,
    onboardingAnswers: payload,
    ...schedule,
  }

  return { profileData, match, resolution }
}

function categorizeGoal(goal?: string) {
  const text = goal?.toLowerCase() ?? ""
  if (!text) return null
  if (/(gym|fitness|weight|workout|run|lift|health)/.test(text)) return "fitness"
  if (/(study|exam|learn|course|school|college)/.test(text)) return "study"
  if (/(work|job|startup|business|product|ship|career)/.test(text)) return "work"
  if (/(habit|routine|sleep|life|discipline)/.test(text)) return "life"
  return "general"
}
