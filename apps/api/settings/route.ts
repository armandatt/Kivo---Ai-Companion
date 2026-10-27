import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@repo/db/client"
import { getSession } from "../lib/auth/session"
//@ts-ignore
import { parseCheckinTime } from "@repo/api/nova/decision/proactive-decision"
//@ts-ignore
import { normalizeAccountability } from "@repo/api/personality/mentor-compatibility"
//@ts-ignore
import { currentZoneName, isValidTimezone } from "@repo/api/nova/engines/learner-calendar"
import { normalizeLearningContexts } from "@repo/api/nova/product/learning-context"
//@ts-ignore
import { ANSWER_KEYS, FIRST_FOCUS_KEY, LEARNING_CONTEXTS_KEY, firstFocusIn, learningContextsIn, signupAnswersIn } from "@repo/api/nova/adapters/account-preferences-adapter"
import { checkFirstFocus } from "@repo/api/nova/product/first-focus"
import { checkCreatureName, checkNickname, DEFAULT_CREATURE_NAME } from "@repo/api/nova/product/onboarding-answers"
import { OBSTACLES, OBSTACLE_LABELS, WORKING_ON, WORKING_ON_LABELS, checkMultiAnswer, checkWeeklyHours, withoutNotSure } from "@repo/api/nova/product/onboarding-options"
import { accountabilityOfTone, isTone } from "@repo/api/nova/product/tone"
import { REPLY_LANGUAGES } from "@repo/api/nova/types/understanding.types"
import { PROFILE_KEY, checkProfessionalProfile, profileIn } from "@repo/api/nova/product/professional-profile"

const COMPANIONS = new Set(["nova", "rex", "zen"])

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  try {
    const [user, profile, googleAccount] = await Promise.all([
      prisma.user.findUnique({
        where: { id: session.userId },
        select: { email: true, name: true, image: true, emailVerified: true, password: true },
      }),
      prisma.userProfile.findUnique({
        where: { userId: session.userId },
        select: {
          primaryPersona: true,
          preferredCheckInTime: true,
          accountabilityStyle: true,
          timezone: true,
          telegramConnected: true,
          telegramChatId: true,
          browserNotifications: true,
          emailDigest: true,
          creatureName: true,
          onboardingAnswers: true,
          createdAt: true,
        },
      }),
      prisma.account.findFirst({
        where: { userId: session.userId, provider: "google" },
        select: { id: true },
      }),
    ])

    return NextResponse.json({
      email: user?.email ?? "",
      name: user?.name ?? "",
      // The photo Google gave the account, if any (only an https address is shown).
      image: user?.image && user.image.startsWith("https://") ? user.image : null,
      isGoogleOAuth: !!googleAccount,
      // Whether the address was confirmed (a sign-up code, a reset, or Google's
      // word) and whether there is a password to reset. Never the password.
      emailVerified: !!user?.emailVerified,
      hasPassword: !!user?.password,
      // When this account set up Kivo (the profile row's creation), for "Member since".
      memberSince: profile?.createdAt?.toISOString() ?? null,
      // What they say about themselves professionally (product/professional-profile.ts).
      professional: profileIn(profile?.onboardingAnswers),
      persona: profile?.primaryPersona ?? null,
      checkInTime: profile?.preferredCheckInTime ?? null,
      accountabilityStyle: profile?.accountabilityStyle ?? null,
      timezone: profile?.timezone ?? null,
      tier: "free",
      browserNotifications: profile?.browserNotifications ?? true,
      emailDigest: profile?.emailDigest ?? true,
      // The onboarding answers a learner can correct here. The creature's
      // name is its own: Nova is called Nova whatever it is.
      creatureName: profile?.creatureName ?? DEFAULT_CREATURE_NAME,
      learningContexts: learningContextsIn(profile?.onboardingAnswers),
      firstFocus: firstFocusIn(profile?.onboardingAnswers),
      ...(() => {
        const a = signupAnswersIn(profile?.onboardingAnswers, profile?.accountabilityStyle ?? null)
        return { workingOn: a.workingOn, weeklyHours: a.weeklyHours, obstacles: a.obstacles, language: a.language, tone: a.tone, nickname: a.nickname }
      })(),
      platforms: {
        telegram: {
          connected: profile?.telegramConnected ?? false,
          handle: profile?.telegramChatId ?? null,
          broken: false,
        },
        whatsapp: { connected: false, handle: null, broken: false },
      },
    })
  } catch (e) {
    console.error("[SETTINGS GET ERROR]", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

  try {
    // A session can outlive its account (the cookie lasts thirty days). There
    // is nothing to save settings on, and trying would fail on the database.
    const account = await prisma.user.findUnique({ where: { id: session.userId }, select: { id: true } })
    if (!account) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

    const body = await req.json()
    const { persona, checkInTime, accountabilityStyle, timezone, name, learningContexts, firstFocus, workingOn, weeklyHours, obstacles, language, tone, nickname, professional } = body
    // companionName is the older name of the same field, from a page loaded
    // before the creature was named apart from Nova.
    const creatureName = body.creatureName !== undefined ? body.creatureName : body.companionName
    // What this request changed, so the page says "saved" only for that.
    const saved: string[] = []

    const profileUpdates: Record<string, unknown> = {}
    // The companion is one of the ones that exist. It decides which learner
    // the account is, so nothing else may be written here.
    if (persona !== undefined) {
      const chosen = String(persona).trim().toLowerCase()
      if (!COMPANIONS.has(chosen)) return NextResponse.json({ error: "Unknown companion" }, { status: 400 })
      profileUpdates.primaryPersona = chosen
    }
    // A check-in time is "HH:MM", or nothing (null or "" clears it). Anything
    // else is refused: the scheduler would silently ignore it.
    if (checkInTime !== undefined) {
      if (checkInTime === null || checkInTime === "") profileUpdates.preferredCheckInTime = null
      else {
        const minute = parseCheckinTime(String(checkInTime))
        if (minute === null) return NextResponse.json({ error: "Check-in time must be HH:MM" }, { status: 400 })
        profileUpdates.preferredCheckInTime = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`
      }
    }
    // Stored the way onboarding stores it: "soft" (Gentle Nudges) or "hard" (No Mercy).
    if (accountabilityStyle !== undefined) profileUpdates.accountabilityStyle = normalizeAccountability(String(accountabilityStyle)) ?? String(accountabilityStyle)
    // A tone (product/tone.ts) also sets the older soft/hard answer it stands
    // for, so every reader agrees; a tone with neither meaning clears it.
    if (tone !== undefined) {
      if (!isTone(tone)) return NextResponse.json({ error: "Unknown tone" }, { status: 400 })
      profileUpdates.accountabilityStyle = accountabilityOfTone(tone)
    }
    // A real timezone, or nothing. Anything else is refused: the scheduler
    // would read it as "no timezone" and lose the one already on record.
    if (timezone !== undefined) {
      if (timezone === null || timezone === "") profileUpdates.timezone = null
      else if (typeof timezone === "string" && timezone.length <= 64 && isValidTimezone(timezone)) profileUpdates.timezone = currentZoneName(timezone)
      else return NextResponse.json({ error: "Unknown timezone" }, { status: 400 })
    }

    // The creature's display name. Empty puts the default back. It names
    // nothing else: Nova and the learner stay who they are.
    if (creatureName !== undefined) {
      const checked = checkCreatureName(creatureName)
      if (!checked.ok) return NextResponse.json({ error: checked.message }, { status: 400 })
      profileUpdates.creatureName = checked.name
      saved.push("creatureName")
    }

    // Two of the onboarding answers, kept with the others in onboardingAnswers:
    // what they are learning for (a list of known contexts, [] to say nothing)
    // and what they want help with first (null to say nothing). The others
    // are read first and written back unchanged.
    const answerUpdates: Record<string, unknown> = {}
    if (learningContexts !== undefined) {
      const contexts = normalizeLearningContexts(learningContexts)
      if (contexts === null) return NextResponse.json({ error: "Unknown learning context" }, { status: 400 })
      answerUpdates[LEARNING_CONTEXTS_KEY] = contexts
    }
    if (firstFocus !== undefined) {
      if (firstFocus === null) answerUpdates[FIRST_FOCUS_KEY] = null
      else {
        const checked = checkFirstFocus(firstFocus)
        if (!checked.ok) return NextResponse.json({ error: checked.reason === "detail_too_long" ? "Keep that to a sentence." : "Unknown first focus" }, { status: 400 })
        answerUpdates[FIRST_FOCUS_KEY] = checked.value
      }
    }
    // The v3 answers, each checked as onboarding checks it.
    if (workingOn !== undefined) {
      const checked = checkMultiAnswer(workingOn, WORKING_ON, WORKING_ON_LABELS, { required: false })
      if (!checked.ok) return NextResponse.json({ error: "Check what you're working on: choose from the list or add short entries of your own." }, { status: 400 })
      answerUpdates[ANSWER_KEYS.workingOn] = checked.value.selected.length + checked.value.custom.length > 0 ? checked.value : null
      // It replaces the older single "help with first" answer: the setup
      // page's templates then follow what they are working on now.
      if (firstFocus === undefined) answerUpdates[FIRST_FOCUS_KEY] = null
    }
    if (obstacles !== undefined) {
      const checked = checkMultiAnswer(obstacles, OBSTACLES, OBSTACLE_LABELS, { required: false })
      if (!checked.ok) return NextResponse.json({ error: "Check what gets in your way: choose from the list or add short entries of your own." }, { status: 400 })
      answerUpdates[ANSWER_KEYS.obstacles] = checked.value.selected.length + checked.value.custom.length > 0 ? withoutNotSure(checked.value) : null
    }
    if (weeklyHours !== undefined) {
      if (weeklyHours === null) answerUpdates[ANSWER_KEYS.weeklyHours] = null
      else {
        const checked = checkWeeklyHours(weeklyHours)
        if (!checked.ok) return NextResponse.json({ error: checked.message }, { status: 400 })
        answerUpdates[ANSWER_KEYS.weeklyHours] = checked.value
      }
    }
    if (language !== undefined) {
      if (language !== null && !REPLY_LANGUAGES.some(l => l === language)) return NextResponse.json({ error: "Unknown language" }, { status: 400 })
      answerUpdates[ANSWER_KEYS.language] = language
    }
    if (tone !== undefined) answerUpdates[ANSWER_KEYS.tone] = tone
    // What Nova calls them; empty or null goes back to their account name.
    if (nickname !== undefined) {
      const checked = checkNickname(nickname)
      if (!checked.ok) return NextResponse.json({ error: checked.message }, { status: 400 })
      answerUpdates[ANSWER_KEYS.nickname] = checked.nickname
    }
    // Their professional profile, checked whole: a saved one replaces the one
    // before, null clears it, and nothing is cut to fit.
    if (professional !== undefined) {
      const checked = checkProfessionalProfile(professional)
      if (!checked.ok) return NextResponse.json({ error: checked.message, field: checked.field }, { status: 400 })
      answerUpdates[PROFILE_KEY] = checked.profile
    }
    if (Object.keys(answerUpdates).length > 0) {
      const current = await prisma.userProfile.findUnique({ where: { userId: session.userId }, select: { onboardingAnswers: true } })
      const answers = current?.onboardingAnswers && typeof current.onboardingAnswers === "object" && !Array.isArray(current.onboardingAnswers)
        ? current.onboardingAnswers as Record<string, unknown> : {}
      profileUpdates.onboardingAnswers = { ...answers, ...answerUpdates }
      saved.push(...Object.keys(answerUpdates))
    }

    if (Object.keys(profileUpdates).length > 0) {
      await prisma.userProfile.upsert({
        where: { userId: session.userId },
        update: profileUpdates,
        create: { userId: session.userId, secondaryDomains: [], aspirationWords: [], ...profileUpdates },
      })
    }

    if (name !== undefined && typeof name === "string" && name.trim()) {
      if (name.trim().length > 80) return NextResponse.json({ error: "Keep your name under 80 characters.", field: "name" }, { status: 400 })
      await prisma.user.update({
        where: { id: session.userId },
        data: { name: name.trim() },
      })
      saved.push("name")
    }

    return NextResponse.json({ ok: true, saved })
  } catch (e) {
    console.error("[SETTINGS PATCH ERROR]", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
