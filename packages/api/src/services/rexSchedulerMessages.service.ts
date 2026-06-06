import { generateOpenAIText } from "./openai.service"
import type {
  SchedulerMessageProvider,
  SchedulerJobContext,
  WeeklySummaryStats,
} from "./schedulerEngine.service"

// ─── Rex Message Provider ─────────────────────────────────────────────────────
// Implements SchedulerMessageProvider for the Rex gym-mentor persona.
// Swap this out for a different provider (NovaMessages, etc.) to reuse the
// scheduler engine with a different companion.

class RexSchedulerMessages implements SchedulerMessageProvider {
  readonly persona = "rex"

  // ── 1.0 Daily Check-In ───────────────────────────────────────────────────────
  async dailyCheckIn(ctx: SchedulerJobContext, _now: Date): Promise<string> {
    const { gymCtx, user } = ctx
    const intake  = parseAnswers(user.intakeAnswers)
    const streak  = user.gymStreak
    const goal    = intake.gym_goal ?? intake.fitness_goal ?? "build"

    const contextLines: string[] = []
    if (gymCtx?.isTrainingDay) {
      contextLines.push(`Training today: ${gymCtx.todayMuscles}`)
      contextLines.push(`Gym at: ${gymCtx.gymTimeStr}`)
    } else if (gymCtx) {
      contextLines.push("Rest day")
    }
    if (streak > 0) contextLines.push(`Streak: ${streak} days`)
    if (gymCtx?.lastLiftSummary) contextLines.push(`Last session: ${gymCtx.lastLiftSummary}`)
    contextLines.push(`Goal: ${goal}`)

    try {
      return await generateOpenAIText({
        model:           "gpt-4o-mini",
        maxOutputTokens: 80,
        systemInstruction:
          "You are Rex, a direct gym coach. Generate a short daily check-in (2–4 lines, no greeting, no emoji). " +
          "Be punchy and specific to the user's data. If it's a training day, mention the muscle group and targets. " +
          "If rest day, mention recovery. Never say 'Hey' or 'Good morning'.",
        prompt: contextLines.join("\n"),
      })
    } catch {
      return gymCtx?.isTrainingDay
        ? `${gymCtx.todayMuscles} day at ${gymCtx.gymTimeStr}.\nShow up.`
        : `Rest day.\nEat the protein. Sleep it off.`
    }
  }

  // ── 1.1 Pre-Session Fire-Up ───────────────────────────────────────────────────
  preSessionFireUp(ctx: SchedulerJobContext): string {
    const { gymCtx, preSessionExtras } = ctx
    if (!gymCtx) return "Time to train."

    const parts: string[] = []

    // Deload week override
    if (preSessionExtras?.isDeloadWeek) {
      parts.push(
        `${gymCtx.todayMuscles} day — deload week.`,
        `60% of top weight. 2 sets max.`,
        `Don't be a hero.`,
      )
      return parts.join("\n")
    }

    // Stall injection
    if (preSessionExtras?.stallInfo) {
      const { exercise, weightKg, sessions } = preSessionExtras.stallInfo
      parts.push(
        `${gymCtx.todayMuscles} day.`,
        `${exercise} has been ${weightKg}kg for ${sessions} sessions.`,
        `Drop to ${Math.round(weightKg * 0.9)}kg, run 4×6. Reset the pattern.`,
      )
      return parts.join("\n")
    }

    // Normal pre-session
    if (!gymCtx.lastLiftSummary) {
      return `${gymCtx.todayMuscles} day.\nFirst session for this. Find your working weight.`
    }

    const primaryLift = primaryLiftForMuscles(gymCtx.todayMuscles)
    const liftRegex   = new RegExp(`${primaryLift}\\s*([\\d.]+)kg`, "i")
    const match       = liftRegex.exec(gymCtx.lastLiftSummary)
    const lastKg      = match ? parseFloat(match[1]!) : null
    const targetKg    = lastKg ? lastKg + 2.5 : null

    parts.push(`${gymCtx.todayMuscles} day.`)
    parts.push(`Last: ${gymCtx.lastLiftSummary}.`)
    if (targetKg) parts.push(`Today: ${primaryLift} ${targetKg}kg.`)
    parts.push(pickPreSessionMindset(gymCtx.todayMuscles))

    return parts.join("\n")
  }

  // ── 1.2 Post Session Log Prompt ───────────────────────────────────────────────
  postSessionLogPrompt(muscles: string): string {
    return `${muscles} — what did you hit today?`
  }

  // ── 1.3 Missed Session Chase ──────────────────────────────────────────────────
  missedSessionChase(attempt: 1 | 2): string {
    if (attempt === 1) return "Did you train today?\nQuick log — just the main lifts."
    return "Last chance to log today.\nExercise. Weight. Sets."
  }

  // ── 1.4 Rest Day Morning ──────────────────────────────────────────────────────
  restDayMorning(ctx: SchedulerJobContext): string {
    const muscles = ctx.gymCtx?.todayMuscles ?? "next session"
    const days    = ctx.gymCtx?.daysPerWeek  ?? 3
    const idx     = Math.floor(Math.random() * REST_DAY_VARIANTS.length)
    return REST_DAY_VARIANTS[idx]!(muscles, days)
  }

  // ── 1.5 Backdate Prompt ───────────────────────────────────────────────────────
  backdatePrompt(): string {
    return "You didn't log yesterday.\n\nDid you train?\nI can backdate it. Yes or no."
  }

  // ── 3.4 Silence Reactivation ─────────────────────────────────────────────────
  silenceReactivation(hasSessions: boolean, ctx: SchedulerJobContext): string {
    if (!hasSessions) {
      return "Haven't heard from you since we set up.\nWhen's your first session?"
    }
    const muscles = ctx.gymCtx?.todayMuscles ?? "next"
    const days    = ctx.gymCtx?.lastSessionDaysAgo ?? 5
    return `Still alive?\nYour ${muscles} session is ${days} days overdue.`
  }

  // ── 3.1 Streak Milestone (event-driven inline, but provider exposes it) ───────
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
    const { sessionsCompleted, sessionsPlanned, bestLift, gapArea, cycleNumber } = stats

    const contextLines = [
      `Week ${cycleNumber} done.`,
      `Sessions: ${sessionsCompleted}/${sessionsPlanned} completed.`,
      bestLift ? `Best: ${bestLift.exercise} ${bestLift.weightKg}kg × ${bestLift.reps}` : "No PRs this week.",
      gapArea  ? `Gap: ${gapArea} volume was low.`                                       : null,
    ].filter(Boolean).join("\n")

    try {
      return await generateOpenAIText({
        model:           "gpt-4o-mini",
        maxOutputTokens: 100,
        systemInstruction:
          "You are Rex, a direct gym coach. Write a weekly summary in exactly 4 lines. " +
          "Line 1: week + sessions. Line 2: best lift. Line 3: one fix. Line 4: next directive. " +
          "No greeting. No emoji. Blunt.",
        prompt: contextLines,
      })
    } catch {
      return [
        `Week ${cycleNumber} done.`,
        `${sessionsCompleted}/${sessionsPlanned} sessions.`,
        bestLift ? `Best: ${bestLift.exercise} ${bestLift.weightKg}kg.` : null,
        gapArea  ? `Fix: ${gapArea} volume.`                            : "Fix: keep adding weight where RPE allowed.",
        "Next cycle: add reps before adding weight.",
      ].filter(Boolean).join("\n")
    }
  }

  // ── 3.7 Commitment Follow-Ups ─────────────────────────────────────────────────
  commitmentFollowUp(title: string, daysLeft: number): string {
    return `${daysLeft} day${daysLeft !== 1 ? "s" : ""} left.\n${title}\n\nGoing for it?`
  }

  commitmentMissed(title: string): string {
    return `Deadline passed.\n${title}\n\nWhat's the new target?`
  }
}

export const rexMessageProvider: SchedulerMessageProvider = new RexSchedulerMessages()

// ─── Private builders ─────────────────────────────────────────────────────────

const REST_DAY_VARIANTS: Array<(muscles: string, days: number) => string> = [
  (_m, _d) => `Rest day.\nEat your protein.`,
  (m,  _d) => `Recovery day.\n${m} next.\n8hrs sleep.`,
  (m,   d) =>
    d > 2
      ? `${d} sessions this week. Good.\nRest today — ${m} next.`
      : `Rest day. ${m} next.\nProtein and sleep, in that order.`,
]

function primaryLiftForMuscles(muscles: string): string {
  const m = muscles.toLowerCase()
  if (m.includes("chest") || m.includes("push"))  return "bench"
  if (m.includes("leg")   || m.includes("lower")) return "squat"
  if (m.includes("back")  || m.includes("pull"))  return "deadlift"
  return "squat"
}

const MINDSET: Record<string, string[]> = {
  chest:   ["CNS is fresh. Use it.", "No grinding through — attack it."],
  legs:    ["Leg days build everything else. Don't cut depth.", "Full range. No partials."],
  back:    ["Pull heavy. Control the negative.", "Back work is what most people do wrong. Not you."],
  default: ["Show up and do the work.", "This one matters."],
}

function pickPreSessionMindset(muscles: string): string {
  const m   = muscles.toLowerCase()
  const key = m.includes("chest") || m.includes("push") ? "chest"
    : m.includes("leg") || m.includes("lower") ? "legs"
    : m.includes("back") || m.includes("pull") ? "back"
    : "default"
  const lines = MINDSET[key] ?? MINDSET.default!
  return lines[Math.floor(Math.random() * lines.length)]!
}

function parseAnswers(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return raw as Record<string, string>
}
