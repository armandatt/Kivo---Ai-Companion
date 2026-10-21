// ─── Telegram replies ─────────────────────────────────────────────────────────
// Plain statements of what Nova's engines already decided, laid out for a
// chat. Pure: no DB, no LLM. Nothing here ranks, recommends or computes a
// learner fact; every number and reason comes from the Today view or the
// session view, exactly as the web app shows them.
//
// These are also what the learner gets when the model is unavailable.

import type { NovaSessionView, NovaTodayReady, TodayAction, NovaSessionOutcome, PlanEmptyReason } from "../product/today.types";
import type { NovaPlannerReady } from "../product/planner.types";
import type { NovaProgressReady } from "../product/progress.types";
import type { NovaTaskItem } from "../product/tasks.types";
import type { PromptOption, PromptSpec, TelegramReply, OptionAction } from "./telegram.types";
import type { SetupProposal } from "../product/setup";
import type { SetupQuestion } from "../interaction/initialization";
import type { ReplyLanguage } from "../interaction/language";
import { dayKey } from "../engines/learner-calendar";

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
  no_topics:       "I don't have any topics for you yet, so there's nothing to plan from. Tell me what one of your subjects covers and I'll take it from there.",
  too_little_time: `That's shorter than anything worth starting. ${MIN_SESSION_MINUTES} minutes is the smallest block I plan.`,
  recovery:        "Recovery day. Nothing I'd push on you today.",
  done_today:      "You've done today's study. Nothing more is planned for today.",
  subject_done:    "Nothing is left to plan in that subject today.",
  nothing_due:     "Nothing is due and no exam is close. Your call today.",
};

// Session lengths on offer: the standard three, cut to what the learner said
// they have, plus the length they said when it is not one of the three. They
// said "20", so 20 is there to pick, not only 15.
const MAX_OFFERED_MINUTES = 180;
export function startLengths(statedMinutes: number | null): number[] {
  if (statedMinutes === null) return START_LENGTHS;
  const fitting = START_LENGTHS.filter(m => m <= statedMinutes);
  const own = statedMinutes >= MIN_SESSION_MINUTES && statedMinutes <= MAX_OFFERED_MINUTES && !fitting.includes(statedMinutes);
  return own ? [...fitting, statedMinutes] : fitting;
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

// `ask`: the one thing Nova still needs before it can plan, when the plan is
// empty because there are no topics. Asked instead of the generic line.
export function todayReply(view: NovaTodayReady, session: NovaSessionView | null, ask: SetupQuestion | null = null): TelegramReply {
  if (session) return sessionReply(session);
  if (!view.recommendation) {
    if (view.emptyReason === "no_topics" && ask) return { text: `Nothing to plan from yet. ${ask.question}` };
    return { text: EMPTY_PLAN[view.emptyReason ?? "nothing_due"], link: { label: "Open Nova", path: "/home" } };
  }
  const reply = recommendationReply(view, view.recommendation);
  const lines = dayLines(view);
  return lines.length > 0 ? { ...reply, text: `${reply.text}\n\n${lines.join("\n")}` } : reply;
}

// The rest of today's plan under its first block: the other blocks with
// their lengths, the day's total against its time, and what the learner
// changed. All of it is the Today view's; nothing is worked out here.
function dayLines(view: NovaTodayReady): string[] {
  const lines: string[] = [];
  const rest = view.alternatives.filter((a): a is TodayAction => a !== null);
  if (rest.length > 0) lines.push(`After that: ${rest.map(a => `${a.topicName} ${a.durationMinutes} min`).join(", ")}.`);
  if (view.plan.totalMinutesToday > 0) lines.push(`Today: ${view.plan.totalMinutesToday} of ${view.plan.budgetMinutes} min planned.`);
  const skipped = view.planChanges?.skipped ?? [];
  if (skipped.length > 0) lines.push(`Left out today: ${skipped.map(t => t.topicName).join(", ")}.`);
  return lines;
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

export function endedReply(ended: { topicName: string | null; minutes: number; outcome: NovaSessionOutcome | null; topicRecorded: boolean; counted?: boolean }): TelegramReply {
  const what = ended.topicName ? ` on ${ended.topicName}` : "";
  const how  = ended.outcome ? ` ${OUTCOME_LABEL[ended.outcome]}.` : "";
  // Said exactly as it is: a short session is kept, and changed nothing else.
  const note = ended.counted === false
    ? ` Under ${MIN_SESSION_MINUTES} minutes, so it's kept as a session but nothing changed in Knowledge or Progress.`
    : !ended.topicRecorded
    ? " It had no subject, so it's logged as time studied and nothing changed in Knowledge."
    : ended.outcome === "struggled" ? " It comes back for review tomorrow." : "";
  return { text: `Logged: ${ended.minutes} min${what}.${how}${note}`, link: { label: "Open Nova", path: "/knowledge" } };
}

export function settingsReply(state: { proactiveEnabled: boolean; pausedUntil: Date | null; timezone: string | null; checkinTime?: string | null }, now: Date): TelegramReply {
  const paused = state.pausedUntil !== null && state.pausedUntil > now;
  const lines = [
    `Nudges: ${state.proactiveEnabled ? (paused ? "paused for today" : "on") : "off"}. At most two a day, never between 11pm and 7am unless that is the time you chose.`,
    // What the time they picked actually does, and where it is changed.
    state.checkinTime
      ? `Daily check-in: around ${state.checkinTime}, your time, on days you haven't studied yet. Change it in Settings on the web.`
      : "Daily check-in: no time chosen, so I nudge around your usual study time. Pick a time in Settings on the web.",
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
    text: "I didn't catch that. Tell me what you need, or pick one:",
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

export function withExamOffer(reply: TelegramReply, exam: { title: string; date: string; subjectNames: string[] }): TelegramReply {
  const one    = exam.subjectNames.length === 1;
  const ask    = one ? `Add your ${exam.subjectNames[0]} exam on ${exam.date}?` : `Add an exam on ${exam.date}? Pick the subject it's for.`;
  // With one subject the learner's own words are the title. When they pick
  // the subject, the title is that subject's: their words named none.
  const offers = exam.subjectNames.map(subjectName => ({
    label:  one ? `Add exam (${exam.date})` : `Add: ${subjectName}`.slice(0, 40),
    action: { type: "add_exam" as const, title: one ? exam.title : `${subjectName} exam`, subjectName, date: exam.date },
  }));
  if (reply.prompt) {
    const merged = [...reply.prompt.options.map(o => ({ label: o.label, action: o.action })), ...offers];
    return { ...reply, text: `${reply.text}\n\n${ask}`, prompt: { kind: reply.prompt.kind, options: options(merged) } };
  }
  const prompt: PromptSpec = { kind: "confirm_exam", options: options([...offers, { label: "No", action: { type: "dismiss" } }]) };
  return { ...reply, text: `${reply.text}\n\n${ask}`, prompt };
}

// What the learner said about their term, shown back before anything is
// saved. With one subject the option saves; with several, each option is a
// subject and picking it saves under that one.
export function setupOfferReply(proposal: SetupProposal): TelegramReply {
  const routine: string[] = [];
  if (proposal.dailyMinutes !== null) routine.push(`about ${proposal.dailyMinutes} min on a normal day`);
  if (proposal.studyTime !== null) routine.push(proposal.studyTime === "night" ? "usually at night" : `usually in the ${proposal.studyTime}`);
  const list  = proposal.topics.join(", ");
  const one   = proposal.subjectChoices.length === 1;
  const isNew = (name: string) => proposal.newSubjects.includes(name);
  // New subjects that are not just the home of the topics below.
  const others = proposal.newSubjects.filter(n => !(one && proposal.topics.length > 0 && proposal.subjectChoices[0] === n));
  const lines: string[] = [];
  if (others.length > 0) lines.push(`Add ${others.length === 1 ? "this subject" : "these subjects"}: ${others.join(", ")}?`);
  if (proposal.topics.length > 0) {
    lines.push(one
      ? `Add ${isNew(proposal.subjectChoices[0]!) ? `${proposal.subjectChoices[0]} as a subject, with` : `to ${proposal.subjectChoices[0]}`}: ${list}?`
      : `${list}\nWhich subject are these part of?`);
  }
  if (routine.length > 0) lines.push(`${lines.length > 0 ? "And note" : "Note"} that you study ${routine.join(", ")}?`);
  const save = (subjectName: string | null) => ({
    type: "save_setup" as const, subjects: proposal.newSubjects, subjectName,
    topics: proposal.topics, dailyMinutes: proposal.dailyMinutes, studyTime: proposal.studyTime,
  });
  const choices = proposal.topics.length === 0 ? [{ label: others.length > 0 ? "Add" : "Save", action: save(null) }]
    : one ? [{ label: "Add them", action: save(proposal.subjectChoices[0]!) }]
    : proposal.subjectChoices.map(name => ({ label: name.slice(0, 40), action: save(name) }));
  return { text: lines.join("\n"), prompt: { kind: "confirm_setup", options: options([...choices, { label: "No", action: { type: "dismiss" } }]) } };
}

export function setupSavedText(saved: { subjectName: string | null; addedSubjects?: string[]; added: string[]; existing: string[]; dailyMinutes: number | null; studyTime: string | null }): string {
  const parts: string[] = [];
  const subjects = (saved.addedSubjects ?? []).filter(n => n !== saved.subjectName || saved.added.length === 0);
  if (subjects.length > 0) parts.push(`Added ${subjects.length === 1 ? "subject" : "subjects"}: ${subjects.join(", ")}.`);
  if (saved.subjectName && saved.added.length > 0) parts.push(`Added to ${saved.subjectName}: ${saved.added.join(", ")}.`);
  if (saved.subjectName && saved.added.length === 0 && saved.existing.length > 0) parts.push(`${saved.subjectName} already had those.`);
  if (saved.dailyMinutes !== null) parts.push(`Normal day: about ${saved.dailyMinutes} min.`);
  if (saved.studyTime !== null) parts.push(`Usual time: ${saved.studyTime}.`);
  return parts.join(" ") || "That was already on record.";
}

// "20-30 mins": both ends, for the learner to pick. Neither is recorded
// until they do.
export function minutesChoiceReply(choices: [number, number]): TelegramReply {
  return {
    text: `${choices[0]} or ${choices[1]} minutes?`,
    prompt: { kind: "pick_minutes", options: options(choices.map(minutes => ({ label: `${minutes} min`, action: { type: "today" as const, minutes } }))) },
  };
}

// ── The days ahead ────────────────────────────────────────────────────────────

// "Fri 17 Oct", for a calendar day key. The key is already the learner's day.
export function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

// The next seven days, from the Planner's read model and the learner's
// tasks. Four kinds of thing, never mixed: what is planned (today only:
// Nova plans each day on the day), what was done, tasks with that due day
// (the learner's own dates), reviews the schedule has falling due (not
// booked sessions) and the dates the learner gave. Days with none of them
// are left out.
export function weekReply(planner: NovaPlannerReady, tasks: NovaTaskItem[]): TelegramReply {
  const days  = planner.week;
  const first = days[0]?.date;
  const last  = days[days.length - 1]?.date;
  const lines: string[] = [first && last ? `Next 7 days, ${dayLabel(first)} to ${dayLabel(last)}:` : "Next 7 days:"];
  let anything = false;
  for (const day of days) {
    const rows: string[] = [];
    if (day.relation === "today") {
      if (day.planned.length > 0) {
        const total = day.planned.reduce((sum, b) => sum + b.minutes, 0);
        rows.push(`Planned: ${day.planned.map(b => `${b.topicName} ${b.minutes} min`).join(", ")} (${total} min)`);
      } else if (planner.today.emptyReason) {
        rows.push(`Planned: nothing (${EMPTY_REASON_SHORT[planner.today.emptyReason]})`);
      }
    }
    const done = day.sessions.filter(x => x.status === "completed");
    if (done.length > 0) rows.push(`Done: ${plural(done.length, "session")}, ${done.reduce((sum, x) => sum + x.minutes, 0)} min`);
    const due = tasks.filter(t => t.status !== "done" && t.dueDay === day.date);
    if (due.length > 0) rows.push(`Tasks due: ${due.slice(0, 4).map(t => t.title).join(", ")}${due.length > 4 ? ` and ${due.length - 4} more` : ""}`);
    if (day.reviewsDueCount > 0) {
      const names = day.reviewsDue.map(r => r.topicName);
      rows.push(`Reviews falling due: ${names.join(", ")}${day.reviewsDueCount > names.length ? ` and ${day.reviewsDueCount - names.length} more` : ""}`);
    }
    for (const exam of day.exams) rows.push(`${exam.title}${exam.subjectName ? ` (${exam.subjectName})` : ""}`);
    if (rows.length === 0 && day.relation !== "today") continue;
    anything ||= rows.length > 0;
    lines.push("", `${day.relation === "today" ? "Today, " : ""}${dayLabel(day.date)}`, ...(rows.length > 0 ? rows.map(r => `- ${r}`) : ["- Nothing on record"]));
  }
  const overdue = tasks.filter(t => t.status !== "done" && t.dueInDays !== null && t.dueInDays < 0).length;
  if (overdue > 0) lines.push("", `Overdue: ${plural(overdue, "task")}.`);
  lines.push("", anything
    ? "Only today has a plan: I plan each day on the day, from what is due then. Reviews are when the schedule says a topic is due, not booked sessions, and task dates are the ones you gave."
    : "Nothing is on record for the next seven days yet. I plan each day on the day.");
  return { text: lines.join("\n"), link: { label: "Open Planner", path: "/planner" } };
}

const EMPTY_REASON_SHORT: Record<PlanEmptyReason, string> = {
  no_topics:       "no topics on record yet",
  too_little_time: "less time than the smallest block",
  recovery:        "a recovery day",
  done_today:      "today's study is done",
  subject_done:    "nothing left in that subject today",
  nothing_due:     "nothing is due",
};

// ── Progress ──────────────────────────────────────────────────────────────────

// How they are doing, from the Progress read model: counted sessions only,
// with the window each figure covers, and what was left out. Planned work is
// today's, and is said apart from what was done.
export function progressReply(progress: NovaProgressReady, today: { doneMinutes: number; plannedMinutes: number } | null): TelegramReply {
  const link = { label: "Open Progress", path: "/progress" };
  const left = progress.overview.notCounted;
  const leftOut = [
    left.selfReported > 0 ? `${left.selfReported} you told me about` : null,
    left.underTenMinutes > 0 ? `${left.underTenMinutes} under ${MIN_SESSION_MINUTES} minutes` : null,
    (left.abandoned ?? 0) > 0 ? `${left.abandoned} left open and closed` : null,
  ].filter((x): x is string => x !== null);
  const leftLine = leftOut.length > 0 ? `Not counted: ${leftOut.join(", ")}.` : null;
  if (!progress.hasEvidence) {
    return {
      text: [
        "No counted study sessions on record yet, so there's no progress to show. A session counts when Nova timed it and it ran 10 minutes or more.",
        leftLine,
        today && today.plannedMinutes > 0 ? `Planned today: ${today.plannedMinutes} min.` : null,
      ].filter((x): x is string => x !== null).join("\n"),
      link,
    };
  }
  const weeks   = progress.consistency.weeks;
  const current = weeks.find(w => w.current) ?? null;
  const recent  = weeks.filter(w => !w.current && !w.beforeStart).slice(-4);
  const sum = (ws: typeof weeks, key: "sessions" | "minutes" | "activeDays") => ws.reduce((n, w) => n + w[key], 0);
  const lines = ["Your progress, from counted sessions (timed by Nova, 10 minutes or more):"];
  if (current) lines.push(`This week so far: ${plural(current.sessions, "session")}, ${current.minutes} min, ${plural(current.activeDays, "active day")}.`);
  if (today) lines.push(`Today, every finished session: ${today.doneMinutes} min done${today.plannedMinutes > 0 ? `; ${today.plannedMinutes} min planned` : ""}.`);
  if (recent.length > 0) {
    lines.push(`Last ${plural(recent.length, "finished week")}: ${plural(sum(recent, "sessions"), "session")}, ${sum(recent, "minutes")} min, ${(sum(recent, "activeDays") / recent.length).toFixed(1)} active days a week.`);
  }
  const since = progress.overview.since ? dayLabel(dayKey(new Date(progress.overview.since), progress.consistency.timezone)) : "your first session";
  lines.push(`Since ${since}: ${plural(progress.overview.sessions, "session")}, ${progress.overview.learningMinutes} min, ${plural(progress.overview.activeDays, "active day")} in the last year.`);
  const trend = progress.consistency.trend;
  lines.push(trend === "not_enough_history"
    ? "Consistency: not enough weeks on record yet to say whether it's changing."
    : `Consistency: ${trend === "more_consistent" ? "more consistent" : trend === "less_consistent" ? "less consistent" : "steady"} (${progress.consistency.trendBasis!.recent} active days a week lately, ${progress.consistency.trendBasis!.earlier} before).`);
  for (const change of progress.changes.slice(0, 3)) lines.push(`- ${change.text}`);
  if (leftLine) lines.push(leftLine);
  return { text: lines.join("\n"), link };
}

// ── Changing today's plan ─────────────────────────────────────────────────────

const short = (text: string, max = 40) => text.length <= max ? text : `${text.slice(0, max - 1)}…`;
const blocksOf = (view: NovaTodayReady) => [view.recommendation, ...view.alternatives].filter((a): a is TodayAction => a !== null);

// "What do you want to change about today?", with the changes there are:
// leave out a block, put another first, or say how long today is. Adding a
// topic or a full reorder is named and left to the Planner.
export function changePlanReply(view: NovaTodayReady): TelegramReply {
  const blocks = blocksOf(view).filter(b => b.topicId);
  const lines = ["What do you want to change about today?"];
  if (blocks.length > 0) {
    lines.push(...blocks.map((b, i) => `${i + 1}. ${b.topicName} (${b.subjectName}) ${b.durationMinutes} min`));
    lines.push(`Today: ${view.plan.totalMinutesToday} of ${view.plan.budgetMinutes} min.`);
  } else {
    lines.push("Nothing is planned for today right now.");
  }
  lines.push("", "Pick one below, tell me a topic to leave out or add, or reorder everything in the Planner.");
  const choices: Array<{ label: string; action: OptionAction }> = [
    ...blocks.slice(0, 3).map(b => ({ label: short(`Skip: ${b.topicName}`), action: { type: "plan_change" as const, change: "skip" as const, topicId: b.topicId!, topicName: b.topicName } })),
    ...(blocks[1] ? [{ label: short(`First: ${blocks[1].topicName}`), action: { type: "plan_change" as const, change: "first" as const, topicId: blocks[1].topicId!, topicName: blocks[1].topicName } }] : []),
    { label: "Change my time", action: { type: "pick_time" } },
    { label: "Nothing", action: { type: "dismiss" } },
  ];
  return { text: lines.join("\n"), prompt: { kind: "change_plan", options: options(choices) }, link: { label: "Open Planner", path: "/planner" } };
}

// One change, named in words, shown back for a tap. Nothing changes here.
export function confirmPlanChangeReply(change: "skip" | "add", topics: Array<{ topicId: string; topicName: string; subjectName: string }>): TelegramReply {
  const one = topics.length === 1;
  const text = change === "skip"
    ? `Leave ${topics[0]!.topicName} out of today's plan? It stays on record and comes back tomorrow.`
    : one ? `Add ${topics[0]!.topicName} (${topics[0]!.subjectName}) to today's plan? It goes first, inside today's time.`
          : `Which one should go into today's plan?\n${topics.map(t => `- ${t.topicName} (${t.subjectName})`).join("\n")}`;
  const verb = change === "skip" ? "Skip" : "Add";
  return {
    text,
    prompt: {
      kind: "change_plan",
      options: options([
        ...topics.slice(0, 4).map(t => ({
          label: short(one ? `${verb} it today` : `${verb}: ${t.topicName}`),
          action: { type: "plan_change" as const, change, topicId: t.topicId, topicName: t.topicName },
        })),
        { label: change === "skip" ? "Keep it" : "No", action: { type: "dismiss" as const } },
      ]),
    },
  };
}

// "How long do you have today?" The tap records it and refits the day.
export const TIME_CHOICES = [15, 30, 45, 60, 90, 120];
export function timeChoiceReply(): TelegramReply {
  return {
    text: "How long do you have today? I'll fit the plan to it.",
    prompt: { kind: "pick_minutes", options: options(TIME_CHOICES.map(minutes => ({ label: `${minutes} min`, action: { type: "today" as const, minutes } }))) },
  };
}

// What a tapped change did, said from the plan as it now stands. `held`:
// whether the plan read back shows the change.
export function planChangedReply(
  change: { change: "skip" | "add" | "first" | "unskip" | "unadd"; topicId: string; topicName: string },
  view:   NovaTodayReady,
  held:   boolean,
): TelegramReply {
  const name = change.topicName;
  const lead = change.change === "skip"   ? `Done: ${name} is out of today's plan.`
    : change.change === "unskip"          ? `Done: ${name} is back in the running for today.`
    : change.change === "unadd"           ? `Done: ${name} is no longer added to today.`
    : change.change === "first"           ? (held ? `Done: ${name} is first today.` : `Saved, but ${name} isn't on today's plan right now, so the order can't put it first.`)
    : held                                ? `Done: ${name} is on today's plan.`
    : `Saved, but ${name} doesn't fit in today's time, so it isn't on the plan. Say how long you have to make room.`;
  const blocks = blocksOf(view);
  const plan = blocks.length > 0
    ? ["Today now:", ...blocks.map((b, i) => `${i + 1}. ${b.topicName} ${b.durationMinutes} min`)]
    : ["Nothing is planned for today now."];
  const undo: OptionAction | null = change.change === "skip" ? { type: "plan_change", change: "unskip", topicId: change.topicId, topicName: name }
    : change.change === "add" ? { type: "plan_change", change: "unadd", topicId: change.topicId, topicName: name }
    : null;
  const first = blocks[0];
  const choices: Array<{ label: string; action: OptionAction }> = [
    ...(first ? [{ label: short(`Start: ${first.topicName}`), action: { type: "start" as const, topicName: first.topicName, subjectName: first.subjectName, minutes: first.durationMinutes } }] : []),
    ...(undo ? [{ label: "Undo", action: undo }] : []),
  ];
  return {
    text: [lead, "", ...plan].join("\n"),
    ...(choices.length > 0 ? { prompt: { kind: "change_plan" as const, options: options(choices) } } : {}),
    link: { label: "Open Planner", path: "/planner" },
  };
}

// ── A different topic, named ──────────────────────────────────────────────────

// Topics of theirs that the name refers to, none of them on today's plan:
// offered to start, one button each.
export function relatedTopicsReply(named: string, topics: Array<{ topicName: string; subjectName: string }>): TelegramReply {
  const shown = topics.slice(0, 4);
  return {
    text: [
      `From ${named}, on record:`,
      ...shown.map(t => `- ${t.topicName} (${t.subjectName})`),
      topics.length > shown.length ? `and ${topics.length - shown.length} more in Knowledge.` : null,
      "None of these is on today's plan, so pick one to start.",
    ].filter((x): x is string => x !== null).join("\n"),
    prompt: {
      kind: "start",
      options: options([
        ...shown.map(t => ({ label: short(`${t.topicName} · 25 min`), action: { type: "start" as const, topicName: t.topicName, subjectName: t.subjectName, minutes: 25 } })),
        { label: "Later", action: { type: "later" as const } },
      ]),
    },
  };
}

export const TEXT = {
  help: [
    "/today: what to do now",
    "/week: the next seven days",
    "/progress: how you're doing",
    "/focus: start a session",
    "/done: end it and say how it went",
    "/status: where you stand",
    "/settings: nudges and timezone",
    "",
    "Or just tell me: how long you have, what came up, what isn't clicking.",
  ].join("\n"),
  finishSetup:     "Finish setting up with Nova first. It takes a couple of minutes.",
  webOnly:         "That one needs room to work. It lives in Nova on the web.",
  unknownCommand:  "I don't know that command. /today, /week, /progress, /focus, /done, /status and /settings are the ones I do.",
  notText:         "I can only read text here. Type it out, or use /today.",
  stale:           "That one's closed.",
  nothingRunning:  "Nothing is running. Tell me what you want to study and I'll set it up.",
  alreadyEnded:    "That session was already closed. Nothing was logged twice.",
  sessionAbandoned: "That session was left open past its time, so I closed it and didn't count it. Start a new one when you're ready.",
  busy:            "Still on your last message. One moment.",
  rateLimited:     "That's a lot at once. Give it a minute.",
  later:           "OK. It'll keep.",
  notToday:        "Got it. Nothing more from me today.",
  dismissed:       "OK.",
  failed:          "That didn't go through on my side. Try again.",
  // The model that reads messages did not answer. Nothing was wrong with
  // what they wrote, and the commands do not need it.
  notUnderstood:   "I can't read messages right now, so I didn't take that in. /today, /focus and /done still work. Try me again in a minute.",
  budget:          "I've done a lot of reading for you today, so I'm on buttons until tomorrow. /today, /focus and /done all still work.",
  selfReport:      "Noted. There was no timer running, so I can only count that as something you told me.",
  converseFallback: "Got that. Ask me what to study whenever you're ready.",
  explainFallback: "I can't explain that properly right now. Ask me again in a moment.",
  setupNoSubject:  "I couldn't tell which of your subjects that belongs to. Tell me the subject along with its topics.",
  nothingOnRecord: "I don't have that on record.",
  // Noise, or words with nothing to attach them to, while a question is
  // still open: the buttons already on screen are the options.
  clarifyOpen:     "I didn't catch that. Tell me what you need, or use the buttons above.",
  unsupported:     "That's outside what I do here. I can show today's plan or the week, change today's plan, show your progress, explain a topic, run a session, or take note of what's come up.",
  // Asked for a reminder at a set time. There is no such thing to create, so
  // this says so and says what does exist. Never "I'll remind you".
  reminderUnavailable:    "I can't set a reminder for a set time yet, so nothing has been scheduled. What I do send on my own is a nudge when something is due, at most two a day. /settings shows whether those are on.",
  reminderUnavailableWeb: "I can't set a reminder for a set time yet, so nothing has been scheduled.",
  workspaceOffer:         "Let's shape that together. Open it below: we'll talk it through, you'll see the proposal as it forms, and nothing is created until you approve it.",
  workspaceOfferWeb:      "Let's shape that together in Build with Nova: we'll talk it through, you'll see the proposal as it forms, and nothing is created until you approve it.",
  nudgesOn:        "Nudges are on.",
  nudgesOff:       "Nudges are off. I'll only speak when you do.",
};

// The same lines in Hinglish. They are fixed so that an acknowledgement, an
// error or the day's budget running out never needs a model to be said.
// Nova does not use gendered first-person verbs here.
export const TEXT_HINGLISH: typeof TEXT = {
  help: [
    "/today: abhi kya karna hai",
    "/week: agle saat din",
    "/progress: tumhara progress",
    "/focus: session start karo",
    "/done: session khatam karo aur batao kaisa gaya",
    "/status: tum kahan khade ho",
    "/settings: nudges aur timezone",
    "",
    "Ya seedha bata do: kitna time hai, kya beech mein aa gaya, kya samajh nahi aa raha.",
  ].join("\n"),
  finishSetup:     "Pehle Nova pe setup poora kar lo. Do minute lagenge.",
  webOnly:         "Iske liye thodi jagah chahiye. Ye Nova ke web app pe milega.",
  unknownCommand:  "Ye command yahan nahi chalti. /today, /week, /progress, /focus, /done, /status aur /settings chalti hain.",
  notText:         "Yahan sirf text chalta hai. Likh ke bhejo, ya /today use karo.",
  stale:           "Ye wala band ho chuka hai.",
  nothingRunning:  "Abhi kuch chal nahi raha. Batao kya padhna hai, set ho jayega.",
  alreadyEnded:    "Wo session pehle hi band ho chuka tha. Kuch bhi do baar log nahi hua.",
  sessionAbandoned: "Wo session time se kaafi der tak khula reh gaya tha, isliye maine band kar diya aur count nahi kiya. Jab ready ho, naya start kar lo.",
  busy:            "Tumhara pichla message abhi chal raha hai. Ek second.",
  rateLimited:     "Ek saath bahut zyada ho gaya. Ek minute ruko.",
  later:           "Theek hai. Baad mein sahi.",
  notToday:        "Theek hai. Aaj meri taraf se aur kuch nahi.",
  dismissed:       "Theek hai.",
  failed:          "Meri taraf se ye ho nahi paya. Dobara try karo.",
  notUnderstood:   "Abhi messages padhe nahi ja rahe, to ye wala reh gaya. /today, /focus aur /done abhi bhi chalte hain. Ek minute mein dobara try karo.",
  budget:          "Aaj tumhare liye kaafi padhna ho gaya, to kal tak sirf buttons. /today, /focus aur /done abhi bhi chalte hain.",
  selfReport:      "Note kar liya. Timer nahi chal raha tha, to ye sirf tumhari batayi hui baat ke taur pe gina jayega.",
  converseFallback: "Theek hai. Jab ready ho, pooch lena kya padhna hai.",
  explainFallback: "Abhi ye theek se explain nahi ho payega. Thodi der mein dobara poochho.",
  setupNoSubject:  "Samajh nahi aaya ye kis subject ka hai. Subject ke saath uske topics batao.",
  nothingOnRecord: "Ye mere record mein nahi hai.",
  clarifyOpen:     "Ye samajh nahi aaya. Batao kya chahiye, ya upar wale buttons use karo.",
  unsupported:     "Ye yahan ke kaam ke bahar hai. Yahan ye milta hai: aaj ka ya hafte ka plan, aaj ke plan mein badlav, tumhara progress, kisi topic ka explanation, study session, ya jo beech mein aa gaya uska note.",
  reminderUnavailable:    "Abhi kisi fixed time ka reminder set nahi ho sakta, to kuch schedule nahi hua. Jo apne aap aata hai wo nudge hai jab kuch due ho, din mein zyada se zyada do. /settings mein dikhta hai wo on hain ya nahi.",
  reminderUnavailableWeb: "Abhi kisi fixed time ka reminder set nahi ho sakta, to kuch schedule nahi hua.",
  workspaceOffer:         "Chalo ise saath mein shape karte hain. Neeche kholo: hum baat karenge, proposal banta hua dikhega, aur approve karne tak kuch nahi banega.",
  workspaceOfferWeb:      "Chalo ise Build with Nova mein saath mein shape karte hain: hum baat karenge, proposal banta hua dikhega, aur approve karne tak kuch nahi banega.",
  nudgesOn:        "Nudges on hain.",
  nudgesOff:       "Nudges off hain. Ab pehla message tumhara hi hoga.",
};

// Hindi in Devanagari has no table of its own yet: its fixed lines are the
// Roman-script Hindi ones. Generated replies are in Devanagari.
const TEXTS: Record<ReplyLanguage, typeof TEXT> = { english: TEXT, hinglish: TEXT_HINGLISH, hindi: TEXT_HINGLISH };
export const textFor = (language: ReplyLanguage): typeof TEXT => TEXTS[language];

// Whether a text is already one of the fixed lines of that language, so it
// needs no wording.
const FIXED: Record<ReplyLanguage, ReadonlySet<string>> = {
  english:  new Set(Object.values(TEXT)),
  hinglish: new Set(Object.values(TEXT_HINGLISH)),
  hindi:    new Set(Object.values(TEXT_HINGLISH)),
};
export const isFixedText = (text: string, language: ReplyLanguage): boolean => FIXED[language].has(text);
