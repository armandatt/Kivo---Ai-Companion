// ─── Telegram replies ─────────────────────────────────────────────────────────
// Plain statements of what Nova's engines already decided, laid out for a
// chat. Pure: no DB, no LLM. Nothing here ranks, recommends or computes a
// learner fact; every number and reason comes from the Today view or the
// session view, exactly as the web app shows them.
//
// These are also what the learner gets when the model is unavailable.

import type { NovaSessionView, NovaTodayReady, TodayAction, NovaSessionOutcome, PlanEmptyReason } from "../product/today.types";
import type { PromptOption, PromptSpec, TelegramReply, OptionAction } from "./telegram.types";

export const START_LENGTHS = [15, 25, 45];
export const MIN_SESSION_MINUTES = 10;

const OPTION_IDS = "abcdefghij";
const options = (items: Array<{ label: string; action: OptionAction }>): PromptOption[] =>
  items.slice(0, OPTION_IDS.length).map((item, i) => ({ id: OPTION_IDS[i]!, ...item }));

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const OUTCOME_LABEL: Record<NovaSessionOutcome, string> = {
  struggled: "Struggled", okay: "Okay", good: "Good", crushed_it: "Crushed it",
};

const EMPTY_PLAN: Record<PlanEmptyReason, string> = {
  no_topics:       "I don't have any topics for you yet. Add your subjects in Nova and I'll have something to point at.",
  too_little_time: `That's shorter than anything worth starting. ${MIN_SESSION_MINUTES} minutes is the smallest block I plan.`,
  recovery:        "Recovery day. Nothing I'd push on you today.",
  nothing_due:     "Nothing is due and no exam is close. Your call today.",
};

// Session lengths on offer: the standard three, cut to what the learner said
// they have. A stated time shorter than all of them is offered as it is.
export function startLengths(statedMinutes: number | null): number[] {
  if (statedMinutes === null) return START_LENGTHS;
  const fitting = START_LENGTHS.filter(m => m <= statedMinutes);
  if (fitting.length > 0) return fitting;
  return statedMinutes >= MIN_SESSION_MINUTES ? [statedMinutes] : [];
}

function describe(action: TodayAction): string {
  const why = action.reasons.slice(0, 2).join(", ");
  return [
    `${action.topicName} (${action.subjectName})`,
    `${action.durationMinutes} min${why ? `. Why: ${why}.` : "."}`,
  ].join("\n");
}

export function recommendationReply(
  view:   NovaTodayReady,
  action: TodayAction,
  extra:  { skipped?: string[]; kind?: "start" | "nudge" } = {},
): TelegramReply {
  const lengths = startLengths(view.availableMinutes);
  const lines   = [describe(action)];
  const exam    = view.nextDeadline;
  if (exam && exam.daysUntil <= 7) {
    lines.push(`${exam.title}: ${exam.daysUntil <= 0 ? "today" : exam.daysUntil === 1 ? "tomorrow" : `in ${exam.daysUntil} days`}.`);
  }
  if (view.constraints[0]) lines.push(`Keeping in mind: ${view.constraints[0].description}`);

  const skip = [...(extra.skipped ?? []), action.topicName];
  return {
    text: lines.join("\n"),
    prompt: {
      kind: extra.kind ?? "start",
      options: options([
        ...lengths.map(minutes => ({
          label:  `Start ${minutes} min`,
          action: { type: "start" as const, topicName: action.topicName, subjectName: action.subjectName, minutes },
        })),
        ...(extra.kind === "nudge"
          ? [{ label: "Later", action: { type: "later" as const } }, { label: "Not today", action: { type: "not_today" as const } }]
          : [{ label: "Something else", action: { type: "something_else" as const, skip } }, { label: "Later", action: { type: "later" as const } }]),
      ]),
    },
  };
}

export function sessionReply(session: NovaSessionView, lead?: string): TelegramReply {
  const minutes = Math.floor(session.elapsedSeconds / 60);
  const planned = session.plannedDurationMinutes > 0 ? ` of ${session.plannedDurationMinutes}` : "";
  const what    = session.topicName ?? "Study session";
  const state   = session.status === "paused" ? "Paused" : "Running";
  return {
    text: `${lead ? `${lead}\n` : ""}${state}: ${what}, ${minutes}${planned} min.`,
    prompt: {
      kind: "session",
      options: options([
        session.status === "paused"
          ? { label: "Resume", action: { type: "resume" } }
          : { label: "Pause", action: { type: "pause" } },
        { label: "End", action: { type: "ask_outcome" } },
      ]),
    },
  };
}

export function todayReply(view: NovaTodayReady, session: NovaSessionView | null): TelegramReply {
  if (session) return sessionReply(session);
  if (!view.recommendation) {
    return { text: EMPTY_PLAN[view.emptyReason ?? "nothing_due"], link: { label: "Open Nova", path: "/home" } };
  }
  return recommendationReply(view, view.recommendation);
}

export function alternativeReply(view: NovaTodayReady, skip: string[]): TelegramReply {
  const skipped = new Set(skip.map(s => s.toLowerCase()));
  const next = [view.recommendation, ...view.alternatives]
    .find((a): a is TodayAction => a !== null && !skipped.has(a.topicName.toLowerCase()));
  if (!next) {
    return { text: "That's everything on today's plan. The Planner has the full picture.", link: { label: "Open Planner", path: "/planner" } };
  }
  return recommendationReply(view, next, { skipped: skip });
}

export function statusReply(view: NovaTodayReady, session: NovaSessionView | null): TelegramReply {
  const lines: string[] = [];
  if (!session) lines.push("No session running.");
  const exam = view.nextDeadline;
  if (exam) lines.push(`Next: ${exam.title}, ${exam.daysUntil <= 0 ? "today" : exam.daysUntil === 1 ? "tomorrow" : `in ${exam.daysUntil} days`}.`);
  if (view.reviewDue.count > 0) lines.push(`${plural(view.reviewDue.count, "topic")} due for review.`);
  if (view.weakArea) lines.push(`Weakest: ${view.weakArea.topicName} (${view.weakArea.masteryPercent}%).`);
  lines.push(`This week: ${plural(view.progress.sessionsThisWeek, "session")}.`);

  if (session) {
    const base = sessionReply(session);
    return { ...base, text: [base.text, ...lines].join("\n") };
  }
  const rec = view.recommendation;
  return rec
    ? { ...recommendationReply(view, rec), text: [...lines, "", describe(rec)].join("\n") }
    : { text: lines.join("\n"), link: { label: "Open Nova", path: "/home" } };
}

export function outcomeReply(topicName: string | null, stated: NovaSessionOutcome | null): TelegramReply {
  const order: NovaSessionOutcome[] = ["struggled", "okay", "good", "crushed_it"];
  // What they already said goes first; the tap is still theirs to make.
  const sorted = stated ? [stated, ...order.filter(o => o !== stated)] : order;
  return {
    text: `${topicName ? `${topicName}. ` : ""}How did it go?`,
    prompt: {
      kind: "session_outcome",
      options: options(sorted.map(outcome => ({ label: OUTCOME_LABEL[outcome], action: { type: "end" as const, outcome } }))),
    },
  };
}

export function endedReply(ended: { topicName: string | null; minutes: number; outcome: NovaSessionOutcome | null; topicRecorded: boolean }): TelegramReply {
  const what = ended.topicName ? ` on ${ended.topicName}` : "";
  const how  = ended.outcome ? ` ${OUTCOME_LABEL[ended.outcome]}.` : "";
  const note = !ended.topicRecorded
    ? " It had no subject, so it's logged as time studied and nothing changed in Knowledge."
    : ended.outcome === "struggled" ? " It comes back for review tomorrow." : "";
  return { text: `Logged: ${ended.minutes} min${what}.${how}${note}`, link: { label: "Open Nova", path: "/knowledge" } };
}

export function settingsReply(state: { proactiveEnabled: boolean; pausedUntil: Date | null; timezone: string | null }, now: Date): TelegramReply {
  const paused = state.pausedUntil !== null && state.pausedUntil > now;
  const lines = [
    `Nudges: ${state.proactiveEnabled ? (paused ? "paused for today" : "on") : "off"}. At most two a day, never between 11pm and 7am.`,
    state.timezone
      ? `Timezone: ${state.timezone}.`
      : "Timezone: not set, so I won't message first. Open Nova on the web once and your device tells me.",
  ];
  return {
    text: lines.join("\n"),
    prompt: {
      kind: "settings",
      options: options([
        state.proactiveEnabled
          ? { label: "Turn nudges off", action: { type: "set_proactive", enabled: false } }
          : { label: "Turn nudges on", action: { type: "set_proactive", enabled: true } },
      ]),
    },
  };
}

export function clarifyReply(session: NovaSessionView | null): TelegramReply {
  return {
    text: "Not sure what you need there. Pick one:",
    prompt: {
      kind: "clarify",
      options: options([
        session
          ? { label: "My session", action: { type: "status" } }
          : { label: "What should I do?", action: { type: "today", minutes: null } },
        { label: "Where do I stand?", action: { type: "status" } },
        { label: "Nothing", action: { type: "dismiss" } },
      ]),
    },
  };
}

export function withExamOffer(reply: TelegramReply, exam: { title: string; date: string }): TelegramReply {
  const ask    = `Add ${exam.title} on ${exam.date} to your exams?`;
  const offer  = { label: `Add exam (${exam.date})`, action: { type: "add_exam" as const, title: exam.title, subjectName: exam.title, date: exam.date } };
  if (reply.prompt) {
    const merged = [...reply.prompt.options.map(o => ({ label: o.label, action: o.action })), offer];
    return { ...reply, text: `${reply.text}\n\n${ask}`, prompt: { kind: reply.prompt.kind, options: options(merged) } };
  }
  const prompt: PromptSpec = { kind: "confirm_exam", options: options([offer, { label: "No", action: { type: "dismiss" } }]) };
  return { ...reply, text: `${reply.text}\n\n${ask}`, prompt };
}

export const TEXT = {
  help: [
    "/today: what to do now",
    "/focus: start a session",
    "/done: end it and say how it went",
    "/status: where you stand",
    "/settings: nudges and timezone",
    "",
    "Or just tell me: how long you have, what came up, what isn't clicking.",
  ].join("\n"),
  linked:          "Connected. I'm Nova, and this chat is the quick way to reach me. /today tells you what to do now.",
  finishSetup:     "Finish setting up with Nova first. It takes a couple of minutes.",
  webOnly:         "That one needs room to work. It lives in Nova on the web.",
  unknownCommand:  "I don't know that command. /today, /focus, /done, /status and /settings are the ones I do.",
  notText:         "I can only read text here. Type it out, or use /today.",
  stale:           "That one's closed.",
  nothingRunning:  "Nothing is running. /focus starts a session.",
  alreadyEnded:    "That session was already closed. Nothing was logged twice.",
  busy:            "Still on your last message. One moment.",
  rateLimited:     "That's a lot at once. Give it a minute.",
  later:           "OK. It'll keep.",
  notToday:        "Got it. Nothing more from me today.",
  dismissed:       "OK.",
  failed:          "That didn't go through on my side. Try again.",
  notUnderstood:   "I couldn't read that just now. /today and /status still work, or say it again in a moment.",
  budget:          "I've done a lot of reading for you today, so I'm on buttons until tomorrow. /today, /focus and /done all still work.",
  selfReport:      "Noted. There was no timer running, so I can only count that as something you told me.",
  converseFallback: "Got that. /today shows what's next.",
  nudgesOn:        "Nudges are on.",
  nudgesOff:       "Nudges are off. I'll only speak when you do.",
};
