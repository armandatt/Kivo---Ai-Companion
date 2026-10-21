// ─── Telegram actions ─────────────────────────────────────────────────────────
// What a button, a command or a decided request DOES. Every action here is a
// call to a product function the web app also calls: the session commands,
// the Today view, the planning inputs. Telegram owns no session, no plan, no
// mastery and no timer.
//
// A result is reported only after the operation has been read back from the
// database. "Started" is never said on the strength of having asked.
// No LLM call.

import { loadAccountPreferences } from "../adapters/account-preferences-adapter";
import { loadNovaToday } from "../product/today";
import { lastSessionWasAbandoned, loadNovaSession, runNovaSessionCommand } from "../product/session";
import { recordStatedMinutes } from "../product/planning-inputs";
import { addExam } from "../product/exams";
import { dayKey, resolveTimezone } from "../engines/learner-calendar";
import { loadStudySnapshot } from "../engines/study-snapshot";
import { subjectsNamedIn, topicsNamedBy } from "../engines/topic-mastery-engine";
import { getAllTopicMasteries } from "../engines/knowledge-engine";
import { loadNovaPlanner } from "../product/planner";
import { loadNovaProgress } from "../product/progress";
import { listTasks } from "../product/tasks";
import { changeTodayPlan } from "../product/plan-overrides";
import type { NovaTodayReady, TodayAction } from "../product/today.types";
import { loadChannel, pauseProactiveUntil, setProactiveEnabled } from "./channel-store";
import {
  alternativeReply, changePlanReply, confirmPlanChangeReply, endedReply, minutesChoiceReply, outcomeReply, planChangedReply,
  progressReply, recommendationReply, relatedTopicsReply, sessionReply, settingsReply, setupOfferReply, setupSavedText,
  statusReply, timeChoiceReply, todayReply, weekReply, MIN_SESSION_MINUTES, textFor,
} from "./telegram-replies";
import type { OptionAction, PlanChangeKind, TelegramReply } from "./telegram.types";
import { adviseOnTopic, planBlockFor } from "../interaction/advice";
import { decideFirstUse, type FirstUse } from "../interaction/first-use";
import { nextSetupQuestion } from "../interaction/initialization";
import { applySetup, loadSetupFacts, proposeSetup } from "../product/setup";
import type { ReplyLanguage, SetupStatement } from "../types/understanding.types";

export interface ActionContext {
  chatId:    string;       // the platform chat id, which is how Nova's product functions name a learner
  profileId: string;
  timezone:  string | null;
  name:      string | null;
  now:       Date;
  // The language replies are worded in (interaction/language.ts).
  language:  ReplyLanguage;
  // The language they chose for Nova, if they did: what a sentence the
  // reading cannot place is answered in, instead of English.
  preferredLanguage?: ReplyLanguage | null;
}

export interface ActionResult {
  reply:     TelegramReply;
  operation: { name: string; ok: boolean };
  // Lines from the record the reply rests on, for a reply that will be
  // reworded: the only figures the wording may use.
  facts?:    string[];
}

const MAX_SESSION_MINUTES = 180;
const clampMinutes = (m: number) => Math.max(MIN_SESSION_MINUTES, Math.min(MAX_SESSION_MINUTES, Math.round(m)));

const done = (name: string, reply: TelegramReply, ok = true): ActionResult => ({ reply, operation: { name, ok } });

// The first instant of the learner's next calendar day. Found by walking
// forward, so a daylight-saving change cannot put it an hour out.
export function nextLocalMidnight(now: Date, timezone: string | null): Date {
  const zone  = resolveTimezone(timezone);
  const today = dayKey(now, zone);
  const STEP  = 15 * 60_000;
  let at = new Date(Math.floor(now.getTime() / STEP) * STEP + STEP);
  for (let i = 0; i < 30 * 4 && dayKey(at, zone) === today; i++) at = new Date(at.getTime() + STEP);
  return at;
}

async function todayView(ctx: ActionContext, minutes: number | null): Promise<NovaTodayReady | null> {
  const view = await loadNovaToday(ctx.chatId, { availableMinutes: minutes, learnerName: ctx.name, now: ctx.now });
  return view.status === "ready" ? view : null;
}

// What to start when the learner named something ("let's do OS"): the plan's
// own block for that topic or subject if it has one, else the topic as said.
// With nothing named, the plan's recommendation. The Planning Engine chooses;
// this only finds its choice.
export function pickStart(
  view:     NovaTodayReady,
  named:    string | null,
  // The learner's subjects, so a subject can be named by its code ("OS").
  subjects: Array<{ name: string; code?: string | null }> = [],
): TodayAction | { topicName: string; subjectName: null; durationMinutes: null } | null {
  const planned = [view.recommendation, ...view.alternatives].filter((a): a is TodayAction => a !== null);
  if (!named) return planned[0] ?? null;
  return planBlockFor(view, named, subjects)
    ?? { topicName: named.trim().slice(0, 120), subjectName: null, durationMinutes: null };
}

export async function showToday(ctx: ActionContext, statedMinutes: number | null): Promise<ActionResult> {
  // What the learner says they have today is recorded, so the Planner and
  // Home fit the same day to it until the day ends.
  if (statedMinutes !== null) await recordStatedMinutes(ctx.chatId, statedMinutes, ctx.now);
  const [view, session] = await Promise.all([todayView(ctx, statedMinutes), loadNovaSession(ctx.chatId, ctx.now)]);
  if (!view) return done("show_today", { text: textFor(ctx.language).finishSetup }, false);
  // Nothing to plan from: ask for the one thing that is missing, not for
  // anything already on record.
  const facts = !session && view.emptyReason === "no_topics" ? await loadSetupFacts(ctx.chatId, ctx.now) : null;
  return done("show_today", todayReply(view, session, facts ? nextSetupQuestion(facts) : null));
}

// "Should I study deadlocks tonight?" Answered from today's plan and the
// record. When the answer is yes, the way to start is attached.
export async function advise(ctx: ActionContext, topic: string): Promise<ActionResult> {
  // Everything the answer and its offer need, read once and together.
  const [view, snapshot, session] = await Promise.all([todayView(ctx, null), loadStudySnapshot(ctx.chatId), loadNovaSession(ctx.chatId, ctx.now)]);
  if (!view) return done("advise", { text: textFor(ctx.language).finishSetup }, false);
  const subjects = snapshot.subjects;
  const advice   = adviseOnTopic(view, topic, subjects);
  const offer    = advice.block ? recommendationReply(view, advice.block).prompt
    : advice.verdict === "review_due" || advice.verdict === "not_planned" ? offerFrom(ctx, view, session, subjects, topic, null).reply.prompt
    : undefined;
  return { reply: { text: advice.text, ...(offer ? { prompt: offer } : {}) }, operation: { name: `advise:${advice.verdict}`, ok: true }, facts: advice.facts };
}

export async function askMinutes(choices: [number, number]): Promise<ActionResult> {
  return done("ask_minutes", minutesChoiceReply(choices));
}

// What the learner said a subject covers, shown back. Nothing is saved here.
export async function offerSetup(ctx: ActionContext, stated: SetupStatement): Promise<ActionResult> {
  const subjects = (await loadStudySnapshot(ctx.chatId)).subjects;
  const proposal = proposeSetup(stated, subjects);
  if (!proposal) return done("offer_setup", { text: subjects.length === 0 ? textFor(ctx.language).finishSetup : textFor(ctx.language).setupNoSubject }, false);
  return done("offer_setup", setupOfferReply(proposal));
}

// The first message in a newly connected chat: what Nova would do now, from
// the learner's record, with the way to do it attached. What it is about is
// decided by interaction/first-use.ts; the Response Brain may word it. Never
// a list of commands.
export async function firstUse(
  ctx:  ActionContext,
  word: (decision: FirstUse, hasButtons: boolean, activeReality: string[], daysUntilExam: number | null) => Promise<string>,
): Promise<ActionResult> {
  const [view, session] = await Promise.all([todayView(ctx, null), loadNovaSession(ctx.chatId, ctx.now)]);
  if (!view) return done("first_use", { text: textFor(ctx.language).finishSetup }, false);
  const facts    = view.emptyReason === "no_topics" ? await loadSetupFacts(ctx.chatId, ctx.now) : null;
  const decision = decideFirstUse(view, facts ? nextSetupQuestion(facts) : null);
  // The same buttons the plan and a running session already carry.
  const prompt = decision.kind === "session" && session ? sessionReply(session).prompt
    : decision.kind === "recommend" && decision.block ? recommendationReply(view, decision.block).prompt
    : undefined;
  const text = await word(decision, prompt !== undefined, view.constraints.map(c => c.category), view.nextDeadline?.daysUntil ?? null);
  return { reply: { text, ...(prompt ? { prompt } : {}) }, operation: { name: `first_use:${decision.kind}`, ok: true }, facts: decision.facts };
}

export async function showStatus(ctx: ActionContext): Promise<ActionResult> {
  const [view, session] = await Promise.all([todayView(ctx, null), loadNovaSession(ctx.chatId, ctx.now)]);
  if (!view) return done("show_status", { text: textFor(ctx.language).finishSetup }, false);
  return done("show_status", statusReply(view, session));
}

// An offer to start, for /focus and for a start request that is not sure
// enough to start a timer by itself.
export async function offerStart(ctx: ActionContext, named: string | null, statedMinutes: number | null = null): Promise<ActionResult> {
  if (statedMinutes !== null) await recordStatedMinutes(ctx.chatId, statedMinutes, ctx.now);
  const [view, session, snapshot] = await Promise.all([
    todayView(ctx, statedMinutes), loadNovaSession(ctx.chatId, ctx.now), named ? loadStudySnapshot(ctx.chatId) : null,
  ]);
  if (!view) return done("offer_start", { text: textFor(ctx.language).finishSetup }, false);
  return offerFrom(ctx, view, session, snapshot?.subjects ?? [], named, statedMinutes);
}

// The offer itself, from state the caller has already read. No reads, no
// writes: a caller that holds the Today view does not load it a second time.
function offerFrom(
  ctx:           ActionContext,
  view:          NovaTodayReady,
  session:       Awaited<ReturnType<typeof loadNovaSession>>,
  subjects:      Array<{ name: string; code?: string | null }>,
  named:         string | null,
  statedMinutes: number | null,
): ActionResult {
  if (session) return done("offer_start", sessionReply(session, "You already have one going."));
  const pick = pickStart(view, named, subjects);
  if (!pick) return done("offer_start", todayReply(view, null));
  if ("urgency" in pick) return done("offer_start", recommendationReply(view, pick));

  // A topic today's plan does not have. It can be studied, but it has to be
  // filed under one of the learner's subjects for the session to count
  // toward anything, and Nova does not guess which. If the name itself says
  // (a subject's name or code is in it), that is the subject; otherwise the
  // learner picks.
  const minutes = clampMinutes(statedMinutes ?? 25);
  const said    = subjectsNamedIn(pick.topicName, subjects);
  const choices = said.length === 1 ? said : subjects.slice(0, 4);
  if (choices.length === 0) return done("offer_start", { text: textFor(ctx.language).finishSetup }, false);
  const reply: TelegramReply = {
    text: choices.length === 1
      ? `${pick.topicName} (${choices[0]!.name})\nNot on today's plan, but it's yours to pick.`
      : `${pick.topicName}\nNot on today's plan yet. Which subject is it part of?`,
    prompt: {
      kind: "start",
      options: [
        ...choices.map((subject, i) => ({
          id: "abcd"[i]!,
          label: choices.length === 1 ? `Start ${minutes} min` : `${subject.name} · ${minutes} min`.slice(0, 40),
          action: { type: "start" as const, topicName: pick.topicName, subjectName: subject.name, minutes },
        })),
        { id: "e", label: "Later", action: { type: "later" as const } },
      ],
    },
  };
  return done("offer_start", reply);
}

export async function startSession(
  ctx:   ActionContext,
  start: { topicName: string; subjectName: string | null; minutes: number },
): Promise<ActionResult> {
  // Already studying: say so, and show that session. Nothing is started.
  const running = await loadNovaSession(ctx.chatId, ctx.now);
  if (running) return done("session_start", sessionReply(running, "You already have one going."), false);

  const result = await runNovaSessionCommand(ctx.chatId, {
    action: "start", topicName: start.topicName, subjectName: start.subjectName,
    plannedMinutes: clampMinutes(start.minutes),
  }, ctx.now, "telegram");
  // Read back: "Started" is said about the session that now exists.
  if (!result.ok || !result.session) return done("session_start", { text: result.ok ? textFor(ctx.language).failed : result.message }, false);
  return done("session_start", sessionReply(result.session, "Started."));
}

// A start asked for in words, naming what to study. It runs only when the
// name is something Nova already has on today's plan (a topic, or a subject
// with a block). A name the plan does not know is offered instead: a timer
// is not started on a word the model picked out of a sentence.
export async function startFromRequest(ctx: ActionContext, named: string, minutes: number | null): Promise<ActionResult> {
  const [view, snapshot] = await Promise.all([todayView(ctx, minutes), loadStudySnapshot(ctx.chatId)]);
  if (!view) return done("session_start", { text: textFor(ctx.language).finishSetup }, false);
  const pick = pickStart(view, named, snapshot.subjects);
  if (!pick || !("urgency" in pick)) {
    // Not on today's plan: offered, from the plan already in hand.
    if (minutes !== null) await recordStatedMinutes(ctx.chatId, minutes, ctx.now);
    return offerFrom(ctx, view, await loadNovaSession(ctx.chatId, ctx.now), snapshot.subjects, named, minutes);
  }
  if (minutes !== null) await recordStatedMinutes(ctx.chatId, minutes, ctx.now);
  return startSession(ctx, {
    topicName:   pick.topicName,
    subjectName: pick.subjectName,
    minutes:     minutes ?? pick.durationMinutes ?? 25,
  });
}

// Why a session command found nothing to act on, in the learner's language.
function notRunningText(ctx: ActionContext, result: { error: string; message: string }): string {
  if (result.error === "session_abandoned") return textFor(ctx.language).sessionAbandoned;
  return result.error === "no_active_session" ? textFor(ctx.language).nothingRunning : result.message;
}

export async function pauseOrResume(ctx: ActionContext, action: "pause" | "resume"): Promise<ActionResult> {
  const result = await runNovaSessionCommand(ctx.chatId, { action }, ctx.now, "telegram");
  if (!result.ok) {
    return done(`session_${action}`, { text: notRunningText(ctx, result) }, false);
  }
  if (!result.session) return done(`session_${action}`, { text: textFor(ctx.language).nothingRunning }, false);
  return done(`session_${action}`, sessionReply(result.session));
}

export async function askOutcome(ctx: ActionContext, stated: OptionActionOutcome | null): Promise<ActionResult> {
  const session = await loadNovaSession(ctx.chatId, ctx.now);
  if (!session) {
    const text = await lastSessionWasAbandoned(ctx.profileId) ? textFor(ctx.language).sessionAbandoned : textFor(ctx.language).nothingRunning;
    return done("ask_outcome", { text }, false);
  }
  return done("ask_outcome", outcomeReply(session.topicName, stated));
}
type OptionActionOutcome = Extract<OptionAction, { type: "end" }>["outcome"];

export async function endSession(ctx: ActionContext, outcome: OptionActionOutcome): Promise<ActionResult> {
  const result = await runNovaSessionCommand(ctx.chatId, { action: "end", outcome }, ctx.now, "telegram");
  if (!result.ok) {
    return done("session_end", { text: notRunningText(ctx, result) }, false);
  }
  // Closed by someone else a moment ago (the web app, a second tap): the
  // evidence is theirs and nothing was written twice.
  if (!result.ended) return done("session_end", { text: textFor(ctx.language).alreadyEnded }, false);
  return done("session_end", endedReply(result.ended));
}

// ── The week, progress, and changing today ────────────────────────────────────

// The next seven days: the Planner's read model built from today, and the
// learner's tasks. Read-only.
export async function showWeek(ctx: ActionContext): Promise<ActionResult> {
  const [planner, tasks] = await Promise.all([
    loadNovaPlanner(ctx.chatId, { now: ctx.now, ahead: true }),
    listTasks(ctx.profileId, { now: ctx.now }),
  ]);
  if (planner.status !== "ready") return done("show_week", { text: textFor(ctx.language).finishSetup }, false);
  return done("show_week", weekReply(planner, tasks.status === "ready" ? tasks.tasks : []));
}

// How they are doing over time: the Progress read model, and today's planned
// and done minutes from the Planner's. Read-only.
export async function showProgress(ctx: ActionContext): Promise<ActionResult> {
  const [progress, planner] = await Promise.all([
    loadNovaProgress(ctx.chatId, { now: ctx.now }),
    loadNovaPlanner(ctx.chatId, { now: ctx.now }),
  ]);
  if (progress.status !== "ready") return done("show_progress", { text: textFor(ctx.language).finishSetup }, false);
  const today = planner.status === "ready"
    ? { doneMinutes: planner.today.doneMinutes, plannedMinutes: planner.today.blocks.reduce((sum, b) => sum + b.durationMinutes, 0) }
    : null;
  return done("show_progress", progressReply(progress, today));
}

// "I want to change today's plan." Nothing changes here: what can change is
// shown back, and the tap applies it (applyPlanChange).
//   a time        the day is refitted to it, which is the recorded stated
//                 time: the same write "I have 30 minutes" makes
//   a topic       on today's plan: offered to leave out; one of theirs not
//                 on it: offered to add; not theirs: offered to add to
//                 their subjects (the setup offer, saved only on a tap)
//   neither       the plan, with the changes there are
export async function changePlan(ctx: ActionContext, topic: string | null, minutes: number | null): Promise<ActionResult> {
  if (minutes !== null && topic === null) {
    const today = await showToday(ctx, minutes);
    if (!today.operation.ok) return { ...today, operation: { name: "change_plan:time", ok: false } };
    return { ...today, reply: { ...today.reply, text: `Today is now fitted to ${minutes} min.\n\n${today.reply.text}` }, operation: { name: "change_plan:time", ok: true } };
  }
  const view = await todayView(ctx, null);
  if (!view) return done("change_plan", { text: textFor(ctx.language).finishSetup }, false);
  if (topic === null) return done("change_plan:ask", changePlanReply(view));

  const planned = [view.recommendation, ...view.alternatives].filter((a): a is TodayAction => a !== null && Boolean(a.topicId));
  const [topics, snapshot] = await Promise.all([getAllTopicMasteries(ctx.profileId, ctx.now), loadStudySnapshot(ctx.chatId)]);
  const named = topicsNamedBy(topic, topics, snapshot.subjects);
  const onPlan = planned.filter(b => named.some(t => t.topicId === b.topicId));
  if (onPlan.length > 0) {
    return done("change_plan:offer_skip", confirmPlanChangeReply("skip", onPlan.slice(0, 1).map(b => ({ topicId: b.topicId!, topicName: b.topicName, subjectName: b.subjectName }))));
  }
  if (named.length > 0) {
    return done("change_plan:offer_add", confirmPlanChangeReply("add", named.map(t => ({ topicId: t.topicId, topicName: t.topicName, subjectName: t.subjectName }))));
  }
  return notOnRecord(ctx, topic, snapshot.subjects, "change_plan:not_on_record");
}

// A tapped change to today, through the one owner of plan changes. Then the
// plan is read back, and what it now shows is what is said.
export async function applyPlanChange(ctx: ActionContext, change: { change: PlanChangeKind; topicId: string; topicName: string }): Promise<ActionResult> {
  const name = `plan_change:${change.change}`;
  let body: Record<string, unknown>;
  if (change.change === "first") {
    const view = await todayView(ctx, null);
    if (!view) return done(name, { text: textFor(ctx.language).finishSetup }, false);
    const rest = [view.recommendation, ...view.alternatives]
      .map(a => a?.topicId ?? null)
      .filter((id): id is string => id !== null && id !== change.topicId);
    body = { action: "order", topicIds: [change.topicId, ...rest] };
  } else {
    body = change.change === "skip" ? { action: "skip", topicId: change.topicId }
      : change.change === "add"     ? { action: "pin", topicId: change.topicId }
      : change.change === "unskip"  ? { action: "clear", kind: "skip", topicId: change.topicId }
      :                               { action: "clear", kind: "pin", topicId: change.topicId };
  }
  const result = await changeTodayPlan(ctx.profileId, body, ctx.now);
  if (!result.ok) return done(name, { text: `${result.message} Nothing was changed.` }, false);

  const view = await todayView(ctx, null);
  if (!view) return done(name, { text: textFor(ctx.language).finishSetup }, false);
  const blocks = [view.recommendation, ...view.alternatives].filter((a): a is TodayAction => a !== null);
  const onPlan = blocks.some(b => b.topicId === change.topicId);
  const held = change.change === "skip" || change.change === "unadd" ? !onPlan
    : change.change === "first" ? blocks[0]?.topicId === change.topicId
    : change.change === "add" ? onPlan
    : true;
  return done(name, planChangedReply(change, view, held), held || change.change === "add" || change.change === "first");
}

// A topic the learner named that is nowhere in their subjects: said so, and
// offered as an addition to one of them. Saved only on a tap.
async function notOnRecord(ctx: ActionContext, topic: string, subjects: Array<{ name: string; code?: string | null }>, name: string): Promise<ActionResult> {
  const lead = `${topic} isn't one of your subjects or topics yet, so there's nothing on record to pick from.`;
  const proposal = subjects.length > 0 ? proposeSetup({ subjects: [], subject: null, topics: [topic.trim().slice(0, 120)], dailyMinutes: null, studyTime: null }, subjects) : null;
  if (!proposal) return done(name, { text: `${lead} Add it in Knowledge on the web.`, link: { label: "Open Knowledge", path: "/knowledge" } });
  const offer = setupOfferReply(proposal);
  return done(name, { ...offer, text: `${lead}\n${offer.text}` });
}

// "Something else, about deep learning": what the learner named, matched to
// their own subjects and topics. A block of today's plan among them is the
// engine's own choice and is offered first; otherwise their matching topics;
// otherwise the name is not on record, and adding it is offered.
export async function alternativeFor(ctx: ActionContext, topic: string): Promise<ActionResult> {
  const [view, topics, snapshot] = await Promise.all([todayView(ctx, null), getAllTopicMasteries(ctx.profileId, ctx.now), loadStudySnapshot(ctx.chatId)]);
  if (!view) return done("show_alternative", { text: textFor(ctx.language).finishSetup }, false);
  const named = topicsNamedBy(topic, topics, snapshot.subjects);
  if (named.length === 0) return notOnRecord(ctx, topic, snapshot.subjects, "show_alternative:not_on_record");
  const block = [view.recommendation, ...view.alternatives]
    .find((a): a is TodayAction => a !== null && named.some(t => t.topicId === a.topicId || t.topicName.toLowerCase() === a.topicName.toLowerCase()));
  if (block) return done("show_alternative:planned", recommendationReply(view, block));
  return done("show_alternative:related", relatedTopicsReply(topic, named));
}

export async function showSettings(ctx: ActionContext): Promise<ActionResult> {
  const [state, account] = await Promise.all([loadChannel(ctx.profileId), loadAccountPreferences(ctx.chatId)]);
  return done("show_settings", settingsReply({
    proactiveEnabled: state.proactiveEnabled, pausedUntil: state.proactivePausedUntil, timezone: ctx.timezone,
    checkinTime: account.checkinTime,
  }, ctx.now));
}

// ── A button, by its stored action ────────────────────────────────────────────

export async function runOptionAction(action: OptionAction, ctx: ActionContext): Promise<ActionResult> {
  switch (action.type) {
    case "start":       return startSession(ctx, action);
    case "pause":       return pauseOrResume(ctx, "pause");
    case "resume":      return pauseOrResume(ctx, "resume");
    case "ask_outcome": return askOutcome(ctx, null);
    case "end":         return endSession(ctx, action.outcome);
    case "today":       return showToday(ctx, action.minutes);
    case "status":      return showStatus(ctx);
    case "something_else": {
      const view = await todayView(ctx, null);
      return view ? done("show_alternative", alternativeReply(view, action.skip))
                  : done("show_alternative", { text: textFor(ctx.language).finishSetup }, false);
    }
    case "later":   return done("later", { text: textFor(ctx.language).later });
    case "dismiss": return done("dismiss", { text: textFor(ctx.language).dismissed });
    case "not_today":
      await pauseProactiveUntil(ctx.profileId, nextLocalMidnight(ctx.now, ctx.timezone));
      return done("pause_nudges", { text: textFor(ctx.language).notToday });
    case "plan_change": return applyPlanChange(ctx, action);
    case "pick_time":   return done("pick_time", timeChoiceReply());
    case "set_proactive":
      await setProactiveEnabled(ctx.profileId, action.enabled);
      return done("set_proactive", { text: action.enabled ? textFor(ctx.language).nudgesOn : textFor(ctx.language).nudgesOff });
    case "save_setup": {
      const saved = await applySetup(ctx.chatId, action);
      if (saved.status !== "saved") return done("save_setup", { text: saved.status === "unknown_subject" ? textFor(ctx.language).setupNoSubject : textFor(ctx.language).finishSetup }, false);
      // Then the next thing, if there is one: the plan it made possible, or
      // the one piece still missing.
      const facts = await loadSetupFacts(ctx.chatId, ctx.now);
      const ask   = facts ? nextSetupQuestion(facts) : null;
      const lead  = setupSavedText(saved);
      // Not enough to plan from yet, or a subject still has nothing in it.
      if (ask && (!saved.complete || ask.gap === "topics")) return done("save_setup", { text: `${lead}\n\n${ask.question}` });
      const today = await showToday(ctx, null);
      return done("save_setup", { ...today.reply, text: `${lead}\n\n${today.reply.text}` });
    }
    case "add_exam": {
      const result = await addExam(ctx.chatId, action, ctx.now);
      if (result.status === "added" || result.status === "exists") {
        const today = await showToday(ctx, null);
        const lead  = result.status === "added" ? `Added: ${result.title} on ${result.date}.` : `${result.title} on ${result.date} was already there.`;
        return done("add_exam", { ...today.reply, text: `${lead}\n\n${today.reply.text}` });
      }
      return done("add_exam", { text: "I couldn't add that exam. Add it in Nova on the web.", link: { label: "Open Planner", path: "/planner" } }, false);
    }
  }
}
