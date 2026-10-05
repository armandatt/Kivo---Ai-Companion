import { NextResponse } from "next/server"
import { prisma } from "@repo/db/client"
import { getSession } from "../lib/auth/session"
//@ts-ignore
import { buildOnboardingSchedulePayload } from "@repo/api/services/mentorIntake.service"
import { matchMentor, type MentorMatch } from "@repo/api/personality/mentor-compatibility"
import { scoreSignal, validateSignalAnswers, type PersonalitySignal, type SignalAnswers } from "@repo/api/personality/signal-scoring"
import { recordOnboardingMatch, type MatchResolution } from "@repo/api/personality/personality.service"

export async function POST(req: Request) {
  try {
    const session = await getSession()

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Not authenticated" },
        { status: 401 }
      )
    }

    const body = await req.json()
    const payload = normalizePayload(body)

    if (!payload) {
      return NextResponse.json(
        { success: false, error: "Missing onboarding data" },
        { status: 400 }
      )
    }

    // Personality signal (questions 7-10). Optional: older clients do not send
    // it, and an incomplete or invalid set is ignored rather than failing signup.
    const validation = validateSignalAnswers(body?.signalAnswers)
    const signalAnswers: SignalAnswers | null = validation.ok ? validation.answers : null
    const signal: PersonalitySignal | null = signalAnswers ? scoreSignal(signalAnswers) : null

    const { profileData, match, resolution } = mapToDB(payload, signal)
    const savedProfile = await prisma.userProfile.upsert({
      where: { userId: session.userId },
      update: profileData,
      create: {
        userId: session.userId,
        secondaryDomains: [],
        ...profileData,
      },
    })

    // Best effort: once the profile is stored, a failure writing the signal or
    // the match is logged and does not fail the request. This does NOT cover a
    // database that lacks the new schema. The upsert above already reads every
    // UserProfile column, mentorMatch included, so the PersonalityAssessment
    // table and UserProfile.mentorMatch must exist before this code is deployed.
    try {
      await recordOnboardingMatch({
        userId: session.userId,
        answers: signalAnswers,
        signal,
        resolution,
        match,
        assignedMentorId: profileData.primaryPersona,
      })
    } catch (error) {
      console.error("[ONBOARDING] personality signal not stored:", error)
    }

    // mentorMatch holds the engine's working (need vector, signal-derived tags).
    // The browser has no use for it, so it is not sent back.
    const { mentorMatch: _mentorMatch, ...profile } = savedProfile

    return NextResponse.json({
      success: true,
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

  return {
    quizAnswers,
    personaName: readString(data.personaName),
    personaDescription: readString(data.personaDescription),
    toneModifier: readString(data.toneModifier),
    creatureType: readString(data.creatureType),
    creatureColor: readString(data.creatureColor),
    creatureName: readString(data.creatureName),
    checkInTime: readString(data.checkInTime),
    timezone: readString(data.timezone),
  }
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
