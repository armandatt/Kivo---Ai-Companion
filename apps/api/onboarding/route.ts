import { NextResponse } from "next/server"
import { prisma } from "@repo/db/client"
import { getSession } from "../lib/auth/session"

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

    const profileData = mapToDB(payload)
    const savedProfile = await prisma.userProfile.upsert({
      where: { userId: session.userId },
      update: profileData,
      create: {
        userId: session.userId,
        ...profileData,
      },
    })

    return NextResponse.json({
      success: true,
      profile: savedProfile,
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
  primaryGoal?: string
  accountabilityStyle?: string | null
  aspirationWords?: string[]
}

type OnboardingPayload = {
  quizAnswers: QuizAnswers
  personaName?: string
  personaDescription?: string
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

  return {
    quizAnswers,
    personaName: readString(data.personaName),
    personaDescription: readString(data.personaDescription),
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

function mapToDB(payload: OnboardingPayload) {
  const words = Array.isArray(payload.quizAnswers.aspirationWords)
    ? payload.quizAnswers.aspirationWords.map((word) => word.trim()).filter(Boolean).slice(0, 3)
    : []
  const accountabilityStyle = normalizeAccountability(payload.quizAnswers.accountabilityStyle)
  const personaName = payload.personaName ?? (accountabilityStyle === "soft" ? "NOVA" : "REX")

  return {
    primaryPersona: personaName.toLowerCase(),
    tone: accountabilityStyle,
    energyPattern: readString(payload.quizAnswers.energyPattern) ?? null,
    corePain: readString(payload.quizAnswers.corePain) ?? null,
    primaryGoal30d: readString(payload.quizAnswers.primaryGoal) ?? null,
    goalCategory: categorizeGoal(payload.quizAnswers.primaryGoal),
    accountabilityStyle,
    aspirationWords: words,
    personaName,
    personaDescription:
      payload.personaDescription ?? (personaName === "NOVA" ? "Gentle progress. Real momentum." : "No excuses. Just results."),
    creatureType: payload.creatureType ? String(payload.creatureType) : null,
    creatureColor: payload.creatureColor ?? null,
    creatureName: payload.creatureName ?? null,
    preferredCheckInTime: payload.checkInTime ?? null,
    timezone: payload.timezone ?? null,
    onboardingComplete: true,
    onboardingAnswers: payload,
  }
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
