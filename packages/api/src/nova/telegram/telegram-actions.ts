// ─── Telegram actions ─────────────────────────────────────────────────────────
// What a button, a command or a decided request DOES. Every action here is a
// call to a product function the web app also calls: the session commands,
// the Today view, the planning inputs. Telegram owns no session, no plan, no
// mastery and no timer.
//
// A result is reported only after the operation has been read back from the
// database. "Started" is never said on the strength of having asked.
// No LLM call.

import { loadNovaToday } from "../product/today";
import { loadNovaSession, runNovaSessionCommand } from "../product/session";
import { recordStatedMinutes } from "../product/planning-inputs";
import { addExam } from "../product/exams";
import { dayKey, resolveTimezone } from "../engines/learner-calendar";
import { loadStudySnapshot } from "../engines/study-snapshot";
import type { NovaTodayReady, TodayAction } from "../product/today.types";
import { loadChannel, pauseProactiveUntil, setProactiveEnabled } from "./channel-store";
import {
  alternativeReply, endedReply, outcomeReply, recommendationReply, sessionReply, settingsReply,
  statusReply, todayReply, MIN_SESSION_MINUTES, TEXT,
} from "./telegram-replies";
import type { OptionAction, TelegramReply } from "./telegram.types";

export interface ActionContext {
  chatId:    string;       // the platform chat id, which is how Nova's product functions name a learner
  profileId: string;
  timezone:  string | null;
  name:      string | null;
  now:       Date;
}

export interface ActionResult {
  reply:     TelegramReply;
  operation: { name: string; ok: boolean };
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
  const want    = named.trim().toLowerCase();
  const subject = subjects.find(s => s.name.toLowerCase() === want || (s.code ?? "").toLowerCase() === want)?.name.toLowerCase() ?? want;
  return planned.find(a => a.topicName.toLowerCase() === want)
    ?? planned.find(a => a.subjectName.toLowerCase() === subject)
    ?? { topicName: named.trim().slice(0, 120), subjectName: null, durationMinutes: null };
}

export async function showToday(ctx: ActionContext, statedMinutes: number | null): Promise<ActionResult> {
  // What the learner says they have today is recorded, so the Planner and
  // Home fit the same day to it until the day ends.
  if (statedMinutes !== null) await recordStatedMinutes(ctx.chatId, statedMinutes, ctx.now);
  const [view, session] = await Promise.all([todayView(ctx, statedMinutes), loadNovaSession(ctx.chatId, ctx.now)]);
  if (!view) return done("show_today", { text: TEXT.finishSetup }, false);
  return done("show_today", todayReply(view, session));
}

export async function showStatus(ctx: ActionContext): Promise<ActionResult> {
  const [view, session] = await Promise.all([todayView(ctx, null), loadNovaSession(ctx.chatId, ctx.now)]);
  if (!view) return done("show_status", { text: TEXT.finishSetup }, false);
  return done("show_status", statusReply(view, session));
}

// An offer to start, for /focus and for a start request that is not sure
// enough to start a timer by itself.
export async function offerStart(ctx: ActionContext, named: string | null, statedMinutes: number | null = null): Promise<ActionResult> {
  if (statedMinutes !== null) await recordStatedMinutes(ctx.chatId, statedMinutes, ctx.now);
  const [view, session] = await Promise.all([todayView(ctx, statedMinutes), loadNovaSession(ctx.chatId, ctx.now)]);
  if (!view) return done("offer_start", { text: TEXT.finishSetup }, false);
  if (session) return done("offer_start", sessionReply(session, "You already have one going."));
  const pick = pickStart(view, named, named ? (await loadStudySnapshot(ctx.chatId)).subjects : []);
  if (!pick) return done("offer_start", todayReply(view, null));
  const asAction: TodayAction = "urgency" in pick ? pick : {
    topicName: pick.topicName, subjectName: "your choice", activityType: "practice",
    durationMinutes: 25, urgency: "normal", reasons: [], rationale: "",
  };
  const reply = recommendationReply(view, asAction);
  // A topic the plan does not know has no subject to file it under.
  if (!("urgency" in pick) && reply.prompt) {
    reply.text = `${pick.topicName}\nNot on today's plan, but it's yours to pick.`;
    reply.prompt.options = reply.prompt.options
      .filter(o => o.action.type !== "something_else")
      .map(o => o.action.type === "start" ? { ...o, action: { ...o.action, subjectName: null } } : o);
  }
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
  if (!result.ok || !result.session) return done("session_start", { text: result.ok ? TEXT.failed : result.message }, false);
  return done("session_start", sessionReply(result.session, "Started."));
}

// A start asked for in words, naming what to study. It runs only when the
// name is something Nova already has on today's plan (a topic, or a subject
// with a block). A name the plan does not know is offered instead: a timer
// is not started on a word the model picked out of a sentence.
export async function startFromRequest(ctx: ActionContext, named: string, minutes: number | null): Promise<ActionResult> {
  const view = await todayView(ctx, minutes);
  if (!view) return done("session_start", { text: TEXT.finishSetup }, false);
  const pick = pickStart(view, named, (await loadStudySnapshot(ctx.chatId)).subjects);
  if (!pick || !("urgency" in pick)) return offerStart(ctx, named, minutes);
  if (minutes !== null) await recordStatedMinutes(ctx.chatId, minutes, ctx.now);
  return startSession(ctx, {
    topicName:   pick.topicName,
    subjectName: pick.subjectName,
    minutes:     minutes ?? pick.durationMinutes ?? 25,
  });
}

export async function pauseOrResume(ctx: ActionContext, action: "pause" | "resume"): Promise<ActionResult> {
  const result = await runNovaSessionCommand(ctx.chatId, { action }, ctx.now, "telegram");
  if (!result.ok) {
    return done(`session_${action}`, { text: result.error === "no_active_session" ? TEXT.nothingRunning : result.message }, false);
  }
  if (!result.session) return done(`session_${action}`, { text: TEXT.nothingRunning }, false);
  return done(`session_${action}`, sessionReply(result.session));
}

export async function askOutcome(ctx: ActionContext, stated: OptionActionOutcome | null): Promise<ActionResult> {
  const session = await loadNovaSession(ctx.chatId, ctx.now);
  if (!session) return done("ask_outcome", { text: TEXT.nothingRunning }, false);
  return done("ask_outcome", outcomeReply(session.topicName, stated));
}
type OptionActionOutcome = Extract<OptionAction, { type: "end" }>["outcome"];

export async function endSession(ctx: ActionContext, outcome: OptionActionOutcome): Promise<ActionResult> {
  const result = await runNovaSessionCommand(ctx.chatId, { action: "end", outcome }, ctx.now, "telegram");
  if (!result.ok) {
    return done("session_end", { text: result.error === "no_active_session" ? TEXT.nothingRunning : result.message }, false);
  }
  // Closed by someone else a moment ago (the web app, a second tap): the
  // evidence is theirs and nothing was written twice.
  if (!result.ended) return done("session_end", { text: TEXT.alreadyEnded }, false);
  return done("session_end", endedReply(result.ended));
}

export async function showSettings(ctx: ActionContext): Promise<ActionResult> {
  const state = await loadChannel(ctx.profileId);
  return done("show_settings", settingsReply({
    proactiveEnabled: state.proactiveEnabled, pausedUntil: state.proactivePausedUntil, timezone: ctx.timezone,
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
                  : done("show_alternative", { text: TEXT.finishSetup }, false);
    }
    case "later":   return done("later", { text: TEXT.later });
    case "dismiss": return done("dismiss", { text: TEXT.dismissed });
    case "not_today":
      await pauseProactiveUntil(ctx.profileId, nextLocalMidnight(ctx.now, ctx.timezone));
      return done("pause_nudges", { text: TEXT.notToday });
    case "set_proactive":
      await setProactiveEnabled(ctx.profileId, action.enabled);
      return done("set_proactive", { text: action.enabled ? TEXT.nudgesOn : TEXT.nudgesOff });
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
