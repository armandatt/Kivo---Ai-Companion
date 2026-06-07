import { generateOpenAIText } from "./openai.service"
import type {
  SchedulerMessageProvider,
  SchedulerJobContext,
  WeeklySummaryStats,
} from "./schedulerEngine.service"

// ─── Rex Message Provider ─────────────────────────────────────────────────────

class RexSchedulerMessages implements SchedulerMessageProvider {
  readonly persona = "rex"

  // ── 1.0 Daily Check-In ───────────────────────────────────────────────────────
  async dailyCheckIn(ctx: SchedulerJobContext, _now: Date): Promise<string> {
    const { gymCtx, user, dailyCheckInExtras } = ctx
    const intake = parseAnswers(user.intakeAnswers)
    const streak = user.gymStreak
    const goal   = intake.gym_goal ?? intake.fitness_goal ?? "build"

    const contextLines: string[] = []
    if (gymCtx?.isTrainingDay) {
      contextLines.push(`Training today: ${gymCtx.todayMuscles}`)
      contextLines.push(`Gym at: ${gymCtx.gymTimeStr}`)
    } else if (gymCtx) {
      contextLines.push("Rest day")
    }
    if (streak > 0)            contextLines.push(`Streak: ${streak} sessions`)
    if (gymCtx?.lastLiftSummary) contextLines.push(`Last session: ${gymCtx.lastLiftSummary}`)
    contextLines.push(`Goal: ${goal}`)

    // Pattern alert takes priority over all other framing
    if (dailyCheckInExtras?.interventionMessage) {
      contextLines.push(`Pattern alert: ${dailyCheckInExtras.interventionMessage}`)
    } else if (dailyCheckInExtras?.patternFlags.length) {
      contextLines.push(`Training flags: ${dailyCheckInExtras.patternFlags.slice(0, 2).join(", ")}`)
    }

    // Active commitment close to deadline
    if (dailyCheckInExtras?.activeCommitments.length) {
      const c = dailyCheckInExtras.activeCommitments[0]!
      contextLines.push(`Active commitment: "${c.title}" — ${c.daysLeft} day(s) left`)
    }

    const systemInstruction = dailyCheckInExtras?.interventionMessage
      ? "You are Rex, a direct gym coach. A training pattern alert is in the context. Make it the center of today's message — don't bury it. 2-3 lines, no greeting, no emoji. Blunt."
      : "You are Rex, a direct gym coach. Write a short daily check-in (2-4 lines, no greeting, no emoji). Be specific to the user's data. If training day: muscle group and one thing to focus on. If commitment is close: reference it. Never say 'Hey' or 'Good morning'."

    try {
      return await generateOpenAIText({
        model:             "gpt-4o-mini",
        maxOutputTokens:   80,
        systemInstruction,
        prompt:            contextLines.join("\n"),
      })
    } catch {
      return gymCtx?.isTrainingDay
        ? `${gymCtx.todayMuscles} day at ${gymCtx.gymTimeStr}.\nShow up.`
        : `Rest day.\nEat the protein. Sleep it off.`
    }
  }

  // ── 1.1 Pre-Session Fire-Up ───────────────────────────────────────────────────
  async preSessionFireUp(ctx: SchedulerJobContext): Promise<string> {
    const { gymCtx, preSessionExtras, user } = ctx
    if (!gymCtx) return "Time to train."

    const intake = parseAnswers(user.intakeAnswers)
    const level  = intake.training_experience ?? "intermediate"
    const streak = user.gymStreak

    // Deload: clear rule, no LLM needed
    if (preSessionExtras?.isDeloadWeek) {
      return [
        `${gymCtx.todayMuscles} day — deload week.`,
        `60% of top weight. 2 sets max.`,
        `Don't be a hero.`,
      ].join("\n")
    }

    const feel     = preSessionExtras?.lastFeelRating ?? null
    const stall    = preSessionExtras?.stallInfo ?? null
    const atWeight = preSessionExtras?.sessionsAtWeight ?? null

    const contextLines: string[] = [
      `Muscle group: ${gymCtx.todayMuscles}`,
      gymCtx.lastLiftSummary ? `Last session: ${gymCtx.lastLiftSummary}` : "No previous session for this muscle group.",
      feel      ? `How last session felt: ${feel}` : null,
      stall
        ? `${stall.exercise} has been ${stall.weightKg}kg for ${stall.sessions} sessions — stalled`
        : atWeight
          ? `Primary lift (${atWeight.exercise}): ${atWeight.weightKg}kg for ${atWeight.count} session(s)`
          : null,
      streak > 0 ? `Training streak: ${streak} sessions` : null,
      level !== "intermediate" ? `Experience level: ${level}` : null,
    ].filter(Boolean) as string[]

    const systemPrompt = [
      "You are Rex, a direct gym coach. Write a pre-session message (2-4 lines, no greeting, no emoji).",
      "Decide today's weight target based on the context:",
      "  - feel=easy or feel=moderate: confirm or name the weight increase",
      "  - feel=hard: keep the same weight, say why in one clause",
      "  - feel=failed: step back 5%, name the adjusted weight",
      "  - stalled 3+ sessions: give one specific fix (add a rep, drop 10%, change rep range)",
      "  - no previous session: set expectations for finding a working weight",
      "  - no feel data: use last lift data to project a sensible target",
      "Be specific. Name the weight. Do not use motivational phrases or generic encouragement.",
    ].join("\n")

    try {
      return await generateOpenAIText({
        model:             "gpt-4o-mini",
        maxOutputTokens:   80,
        systemInstruction: systemPrompt,
        prompt:            contextLines.join("\n"),
      })
    } catch {
      // Fallback: derive advice without LLM
      const primaryLift = primaryLiftForMuscles(gymCtx.todayMuscles)
      const lastKg      = extractLastKg(gymCtx.lastLiftSummary, primaryLift)

      if (feel === "failed") {
        const backoff = lastKg ? Math.round(lastKg * 0.95 / 2.5) * 2.5 : null
        return [
          `${gymCtx.todayMuscles} day.`,
          backoff
            ? `Missed reps last session. ${primaryLift}: ${backoff}kg today — clean sets before adding weight.`
            : "Missed reps last session. Drop the weight and nail the form first.",
        ].join("\n")
      }
      if (feel === "hard") {
        return [`${gymCtx.todayMuscles} day.`, `Last session was hard. Same weights.`].join("\n")
      }
      const targetKg = lastKg ? lastKg + 2.5 : null
      return [
        `${gymCtx.todayMuscles} day.`,
        gymCtx.lastLiftSummary ? `Last: ${gymCtx.lastLiftSummary}.` : null,
        targetKg ? `Today: ${primaryLift} ${targetKg}kg.` : null,
      ].filter(Boolean).join("\n")
    }
  }

  // ── 1.2 Post Session Log Prompt ───────────────────────────────────────────────
  postSessionLogPrompt(muscles: string): string {
    return `${muscles} — what did you hit today?`
  }

  // ── 1.3 Missed Session Chase ──────────────────────────────────────────────────
  async missedSessionChase(attempt: 1 | 2, ctx: SchedulerJobContext): Promise<string> {
    const { chaseExtras, user, gymCtx } = ctx
    const muscles   = chaseExtras?.todayMuscles ?? gymCtx?.todayMuscles ?? "today's session"
    const misses    = chaseExtras?.consecutiveMisses ?? 1
    const streak    = user.gymStreak
    const lastMs    = chaseExtras?.lastSessionMuscles ?? null
    const daysAgo   = chaseExtras?.lastSessionDaysAgo ?? null

    const contextLines: string[] = [
      `Muscle group scheduled today: ${muscles}`,
      `Consecutive missed training days: ${misses}`,
      streak > 0 ? `Current streak: ${streak} sessions` : "Streak: at zero",
      lastMs && daysAgo !== null ? `Last completed: ${lastMs}, ${daysAgo} day(s) ago` : null,
      attempt === 2 ? "This is the second and final check today." : "This is the first check today.",
    ].filter(Boolean) as string[]

    const systemPrompt = attempt === 1
      ? [
          "You are Rex. Write a short accountability check (2-3 lines, no greeting, no emoji).",
          "Tone: direct but not hostile. Name the muscle group. Ask whether they trained.",
          "If consecutive misses > 1: acknowledge the pattern, not just today.",
          "If streak > 7: mention what's at stake without overdramatizing.",
          "Do not use: 'let's go', 'you got this', 'keep pushing', generic motivation.",
        ].join("\n")
      : [
          "You are Rex. Write a direct missed session message (2-3 lines, no greeting, no emoji).",
          "Tone: blunt. No softening. Name what was missed.",
          "If consecutive misses > 1: address the streak, not just today.",
          "End with one specific ask — log anything, even partial. Give them a way back in.",
          "Do not say 'last chance' or use motivational phrases.",
        ].join("\n")

    try {
      return await generateOpenAIText({
        model:             "gpt-4o-mini",
        maxOutputTokens:   70,
        systemInstruction: systemPrompt,
        prompt:            contextLines.join("\n"),
      })
    } catch {
      if (attempt === 1) return `${muscles} was on the plan today.\nDid you train? Quick log.`
      return misses > 1
        ? `${misses} training days missed.\n${muscles}. Send the main lifts — anything counts.`
        : `Still no log for today.\n${muscles}. Exercise. Weight. Sets.`
    }
  }

  // ── 1.4 Rest Day Morning ──────────────────────────────────────────────────────
  async restDayMorning(ctx: SchedulerJobContext): Promise<string | null> {
    const { restDayExtras, user } = ctx
    const streak    = user.gymStreak
    const stall     = restDayExtras?.stallInfo ?? null
    const feel      = restDayExtras?.lastFeelRating ?? null
    const next      = restDayExtras?.nextSessionMuscles ?? "next session"
    const daysUntil = restDayExtras?.daysUntilNextSession ?? 1

    // Silence gate: experienced consistent lifter with nothing to flag
    const hasFlag = stall || feel === "hard" || feel === "failed" || streak < 5 || daysUntil > 2
    if (!hasFlag && streak > 21) return null

    const contextLines: string[] = [
      "Today: rest day",
      `Next session: ${next} (in ${daysUntil} day${daysUntil !== 1 ? "s" : ""})`,
      feel      ? `Last session felt: ${feel}` : null,
      stall
        ? `Stalled: ${stall.exercise} at ${stall.weightKg}kg for ${stall.sessions} sessions`
        : null,
      streak > 0 ? `Streak: ${streak} sessions` : null,
    ].filter(Boolean) as string[]

    const systemPrompt = [
      "You are Rex. Write a rest day message (1-3 lines, no greeting, no emoji).",
      stall
        ? `There is a stall on ${stall.exercise}. One line on what to think about before next session.`
        : feel === "hard" || feel === "failed"
          ? "Last session was rough. One line about what matters most today (sleep, food, not overreaching)."
          : "Nothing critical. Say something genuinely useful about rest or next session, or say nothing.",
      "If you have nothing worth saying, output exactly the word: SKIP",
      "Do not generically tell them to eat protein, rest well, or stay hydrated.",
    ].join("\n")

    try {
      const text = await generateOpenAIText({
        model:             "gpt-4o-mini",
        maxOutputTokens:   60,
        systemInstruction: systemPrompt,
        prompt:            contextLines.join("\n"),
      })
      if (!text || text.trim().toUpperCase().startsWith("SKIP")) return null
      return text
    } catch {
      if (stall) return `Rest day.\n${stall.exercise} stuck at ${stall.weightKg}kg. Think technique before ${next}.`
      if (feel === "hard") return `Rest day.\nLast one was hard. Sleep and food today.`
      return null
    }
  }

  // ── 1.5 Backdate Prompt ───────────────────────────────────────────────────────
  backdatePrompt(): string {
    return "You didn't log yesterday.\n\nDid you train?\nI can backdate it. Yes or no."
  }

  // ── 3.4 Silence Reactivation ─────────────────────────────────────────────────
  async silenceReactivation(hasSessions: boolean, ctx: SchedulerJobContext): Promise<string> {
    if (!hasSessions) {
      return "Haven't heard from you since we set up.\nWhen's your first session?"
    }

    const { reactivationExtras, gymCtx } = ctx
    const lastMessages  = reactivationExtras?.lastUserMessages ?? []
    const lastMuscles   = reactivationExtras?.lastWorkoutMuscles ?? gymCtx?.todayMuscles ?? "your last session"
    const daysAgo       = reactivationExtras?.lastWorkoutDaysAgo ?? ctx.gymCtx?.lastSessionDaysAgo ?? 5

    const contextLines: string[] = [
      `User has been silent for ${daysAgo} days.`,
      `Last trained: ${lastMuscles}.`,
      lastMessages.length
        ? `Last things they said before going quiet:\n${lastMessages.map(m => `- "${m}"`).join("\n")}`
        : null,
    ].filter(Boolean) as string[]

    try {
      return await generateOpenAIText({
        model:             "gpt-4o-mini",
        maxOutputTokens:   70,
        systemInstruction: [
          "You are Rex. Write a reactivation message (2-3 lines, no greeting, no emoji).",
          "The user went quiet. Reference what they were last doing or saying — be specific.",
          "Don't guilt-trip. Be real. Ask one direct question that requires an actual answer.",
          "Do not use: 'miss you', 'hope you're okay', 'come back', generic motivation.",
        ].join("\n"),
        prompt: contextLines.join("\n"),
      })
    } catch {
      return `${daysAgo} days.\n${lastMuscles} session is overdue. What happened?`
    }
  }

  // ── 3.1 Streak Milestone ─────────────────────────────────────────────────────
  streakMilestone(streak: number): string {
    const msgs: Record<number, string> = {
      3:   `3 sessions in.\nPattern forming.`,
      7:   `Week one done.\nStreak is real now.`,
      14:  `14 days.\nHabit locked. Keep the chain.`,
      21:  `21 days.\nThis is who you are now.`,
      30:  `30 days.\nMost people quit before this. You didn't.`,
      60:  `60 days.\nYou're in a different category now.`,
      100: `100 days.\nThat's not motivation anymore. That's discipline.`,
    }
    return msgs[streak] ?? `${streak} days.\nKeep going.`
  }

  // ── 3.2 PR Alert ─────────────────────────────────────────────────────────────
  prAlert(exercise: string, weightKg: number, reps: number): string {
    const ex      = exercise.charAt(0).toUpperCase() + exercise.slice(1)
    const repNote = reps > 1 ? ` × ${reps}` : ""
    return `PR.\n${ex}: ${weightKg}kg${repNote}.\nSaved.`
  }

  // ── 3.6 Weekly Summary ────────────────────────────────────────────────────────
  async weeklySummary(stats: WeeklySummaryStats, _ctx: SchedulerJobContext): Promise<string> {
    const { sessionsCompleted, sessionsPlanned, bestLift, gapArea, cycleNumber, feelRatingTrend, commitmentProgress, momentContext } = stats

    const contextLines = [
      `Cycle ${cycleNumber} done.`,
      `Sessions: ${sessionsCompleted} of ${sessionsPlanned} planned.`,
      bestLift ? `Best lift: ${bestLift.exercise} ${bestLift.weightKg}kg × ${bestLift.reps}` : "No standout lift this week.",
      gapArea  ? `Volume gap: ${gapArea} was under-trained.` : null,
      feelRatingTrend?.length
        ? `Session feel this week: ${feelRatingTrend.join(", ")}`
        : null,
      commitmentProgress ? `Commitment progress: ${commitmentProgress}` : null,
      momentContext?.length
        ? `Journey context (reference naturally, don't recite):\n${momentContext.join("\n")}`
        : null,
    ].filter(Boolean).join("\n")

    try {
      return await generateOpenAIText({
        model:             "gpt-4o-mini",
        maxOutputTokens:   120,
        systemInstruction:
          "You are Rex, a direct gym coach. Summarize this training week. " +
          "No fixed structure — say what's actually worth saying. " +
          "If feel trend was hard or failed: address recovery. " +
          "If session count was low: address it directly, no shame. " +
          "If there's a commitment: note progress. " +
          "One strength, one fix, one directive. No greeting. No emoji. 3-5 lines. Blunt.",
        prompt: contextLines,
      })
    } catch {
      return [
        `Cycle ${cycleNumber}.`,
        `${sessionsCompleted}/${sessionsPlanned} sessions.`,
        bestLift ? `Best: ${bestLift.exercise} ${bestLift.weightKg}kg.` : null,
        gapArea  ? `Fix: ${gapArea} volume.`                              : null,
        "Next cycle: bring the same intensity.",
      ].filter(Boolean).join("\n")
    }
  }

  // ── 3.7 Commitment Follow-Ups ─────────────────────────────────────────────────
  async commitmentFollowUp(title: string, daysLeft: number, ctx: SchedulerJobContext): Promise<string> {
    const progress = ctx.commitmentExtras?.progressSummary ?? null

    const contextLines = [
      `Commitment: "${title}"`,
      `Days remaining: ${daysLeft}`,
      progress ? `Recent progress: ${progress}` : null,
    ].filter(Boolean) as string[]

    try {
      return await generateOpenAIText({
        model:             "gpt-4o-mini",
        maxOutputTokens:   60,
        systemInstruction: [
          "You are Rex. Write a commitment check-in (2-3 lines, no greeting, no emoji).",
          progress
            ? "You have progress data. Reference it specifically. Say whether they're on track or not."
            : "No progress data. Ask directly and specifically what the current status is.",
          "Do not use: 'going for it?', 'you got this', generic encouragement.",
        ].join("\n"),
        prompt: contextLines.join("\n"),
      })
    } catch {
      return progress
        ? `${daysLeft} day${daysLeft !== 1 ? "s" : ""} left.\n${title}\n${progress}`
        : `${daysLeft} day${daysLeft !== 1 ? "s" : ""} left.\n${title}\n\nWhere are you with this?`
    }
  }

  commitmentMissed(title: string): string {
    return `Deadline passed.\n${title}\n\nWhat's the new target?`
  }
}

export const rexMessageProvider: SchedulerMessageProvider = new RexSchedulerMessages()

// ─── Private helpers ──────────────────────────────────────────────────────────

function primaryLiftForMuscles(muscles: string): string {
  const m = muscles.toLowerCase()
  if (m.includes("chest") || m.includes("push"))  return "bench"
  if (m.includes("leg")   || m.includes("lower")) return "squat"
  if (m.includes("back")  || m.includes("pull"))  return "deadlift"
  return "squat"
}

function extractLastKg(summary: string, liftName: string): number | null {
  if (!summary) return null
  const regex = new RegExp(`${liftName}\\s*([\\d.]+)\\s*kg`, "i")
  const match = regex.exec(summary)
  return match ? parseFloat(match[1]!) : null
}

function parseAnswers(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return raw as Record<string, string>
}
