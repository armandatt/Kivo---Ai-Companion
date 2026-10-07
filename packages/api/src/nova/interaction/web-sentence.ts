// ─── A sentence typed to Nova on the web ──────────────────────────────────────
// The web chat box, on the path Telegram's words take: one reading with the
// same context, the same safety check, the same decision, the same actions
// and the same canonical turn. It is a surface adapter and keeps no state.
//
// One thing differs, and it is the page's contract, not a second set of
// rules: a sentence typed here does not start, pause, resume or end a
// session. The page has buttons for that. Such a request is answered in
// words and pointed at them. Everything that changes nothing (what to do
// now, where they stand, a question, an explanation) runs as it does on
// Telegram, and so do the two things a learner confirms in words: saving
// what they said about their term, and adding an exam.

import { prisma } from "@repo/db/client";
import { loadConversationHistory, saveAssistantMessage, saveUserMessage } from "../adapters/conversation-adapter";
import { runUnderstandingBrain } from "../brains/understanding-brain";
import { decideAction, type TurnAction } from "../decision/action-decision";
import { safeReading } from "../decision/interpretation-safety";
import { dayKey, resolveTimezone } from "../engines/learner-calendar";
import { loadStudySnapshot } from "../engines/study-snapshot";
import { runNovaOrchestrator } from "../nova-orchestrator";
import { examToOffer } from "../product/exams";
import { learnerKey } from "../product/learner-key";
import { loadNovaSession } from "../product/session";
import { loadNovaToday } from "../product/today";
import { loadOpenPrompt, openPrompt, resolvePrompt, type OpenPrompt } from "../telegram/prompt-store";
import {
  advise, askMinutes, offerSetup, runOptionAction, showStatus, showToday,
  type ActionContext, type ActionResult,
} from "../telegram/telegram-actions";
import { alternativeReply, TEXT, withExamOffer } from "../telegram/telegram-replies";
import type { PromptKind, TelegramReply } from "../telegram/telegram.types";
import type { NovaOrchestratorInput } from "../types/context.types";
import type { UnderstandingContext } from "../types/understanding.types";
import { ensureSetupProfile } from "../product/setup";
import { interpret } from "./semantics";
import { runSetupTurn } from "./setup-turn";

// The questions the web chat can ask and have answered in words. A Start
// offer made on Telegram is not one of them: "yes" typed here must not start
// a session.
const WEB_PROMPTS: ReadonlySet<PromptKind> = new Set<PromptKind>(["confirm_setup", "confirm_exam", "pick_minutes"]);

const ANSWERABLE_HERE: ReadonlySet<string> = new Set(["save_setup", "add_exam", "today", "dismiss"]);

const PROMPT_QUESTION: Partial<Record<PromptKind, string>> = {
  confirm_setup: "Save what you told me about your term?",
  confirm_exam:  "Add this exam?",
  pick_minutes:  "How many minutes do you have?",
};

// Said to the Response Brain on a sentence that asked for a session change.
export const SENTENCE_RUNS_NO_SESSION =
  "This message did not start, pause, resume or end a study session, and nothing was added or scheduled. Do not say or imply otherwise. If the student wants to start or end a session, point them to the Start button on this page or to Focus.";

const NOTHING_WAS_DONE =
  "Nova's system took no action this turn: nothing was started, paused, ended, saved, added or scheduled. Do not say or imply otherwise. Do not state a date, a number of days or any other figure that is not written in the context above.";

export interface WebSentenceInput {
  platformChatId: string;
  text:           string;
  timestamp:      Date;
  awaitPersistence?: boolean;
  // Test seams. Production uses the real brains.
  understand?: typeof runUnderstandingBrain;
  respond?:    NovaOrchestratorInput["respond"];
}

export interface WebSentenceResult {
  reply:        string;
  intervention: string | null;
  // What was decided, for the turn's log line. Not shown to the learner.
  decision:     string;
  kind:         string;
}

// Actions a sentence may not run on this page.
const PAGE_BUTTONS_ONLY: ReadonlySet<TurnAction["type"]> = new Set<TurnAction["type"]>([
  "start_session", "offer_start", "pause_session", "resume_session", "ask_outcome", "defer",
]);

const weekdayIn = (now: Date, zone: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: zone }).format(now);

export async function runWebSentence(input: WebSentenceInput): Promise<WebSentenceResult> {
  const { platformChatId, text, timestamp: now } = input;
  const user = await prisma.messengerUser.findUnique({
    where:  learnerKey(platformChatId),
    select: { id: true, displayName: true, novaAcademicProfile: { select: { id: true, timezone: true } } },
  });
  const profile = user?.novaAcademicProfile;
  if (!user || !profile) throw new Error("no Nova learner behind this key");

  const ctx: ActionContext = { chatId: platformChatId, profileId: profile.id, timezone: profile.timezone, name: user.displayName ?? null, now };
  const zone = resolveTimezone(profile.timezone);
  const day  = dayKey(now, zone);

  const [session, anyPrompt, history] = await Promise.all([
    loadNovaSession(platformChatId, now),
    loadOpenPrompt(profile.id, now),
    loadConversationHistory(user.id),
  ]);
  const prompt: OpenPrompt | null = anyPrompt && WEB_PROMPTS.has(anyPrompt.kind) ? anyPrompt : null;
  const context: UnderstandingContext = {
    today:        `${weekdayIn(now, zone)} ${day}`,
    session:      session ? (session.status === "paused" ? "paused" : "running") : "none",
    sessionTopic: session?.topicName ?? null,
    openPrompt:   prompt ? { question: PROMPT_QUESTION[prompt.kind] ?? "", options: prompt.options.map(o => ({ id: o.id, label: o.label })) } : null,
  };

  // The one reading of this message, and what of it may be used.
  const read = await (input.understand ?? runUnderstandingBrain)(text, history, context);
  if (read.malformed) return { reply: TEXT.notUnderstood, intervention: null, decision: "unreadable", kind: "unclear" };
  const understanding = safeReading(read, { today: day });
  const interaction   = interpret(understanding);

  const decision = decideAction(understanding, {
    session: context.session,
    prompt:  prompt ? { kind: prompt.kind, options: prompt.options.map(o => ({ id: o.id, type: o.action.type, minutes: o.action.type === "start" ? o.action.minutes : null })) } : null,
  });
  const blocked = PAGE_BUTTONS_ONLY.has(decision.action.type);

  const acted = blocked ? null : await act(decision.action, ctx, prompt, understanding.topic, now);
  let reply: TelegramReply | null = acted?.reply ?? null;

  if (decision.proposeExam) {
    const snapshot = await loadStudySnapshot(platformChatId);
    const offer = examToOffer(decision.proposeExam, snapshot.subjects, snapshot.upcomingExams);
    // On its own question: the reply's other buttons belong to the page.
    if (offer) reply = withExamOffer({ text: reply?.text ?? "" }, offer);
  }

  // A question this page can take the answer to in words is opened and its
  // options spelled out. Any other buttons belong to the page and are dropped.
  let plain = reply?.text.trim() ?? "";
  if (reply?.prompt && WEB_PROMPTS.has(reply.prompt.kind)) {
    await openPrompt(profile.id, platformChatId, reply.prompt, now);
    plain = `${plain}\n(${reply.prompt.options.map(o => o.label).join(" / ")})`;
  }

  const explaining = decision.action.type === "explain";
  const happened   = acted === null || acted.operation.ok;
  const generate   = happened && (blocked || decision.generate || plain === "");
  const fallback   = plain || (explaining ? TEXT.explainFallback : TEXT.converseFallback);

  const turn = await runNovaOrchestrator({
    platformChatId, text, timestamp: now, understanding,
    awaitPersistence: input.awaitPersistence,
    sessionCommands:  "surface",
    respond:          input.respond,
    focus:            { needs: interaction.needs, facts: acted?.facts, ...(explaining ? { mode: "explain" as const } : {}) },
    ...(generate
      ? {
          responseFallback: fallback,
          directive: blocked ? SENTENCE_RUNS_NO_SESSION
            : plain ? `Nova's system already did or offered exactly this, and nothing else: "${plain.slice(0, 400)}". Say it in your own words in at most three short sentences. Do not say anything else was started, ended, saved, added or scheduled, and do not state a date, a number of days or any other figure that is not in that sentence or the context above. To start a session the student uses the Start button on this page.`
            : explaining ? NOTHING_WAS_DONE
            : `${NOTHING_WAS_DONE} Reply in at most three short sentences.`,
        }
      : { scriptedReply: fallback }),
  });

  return { reply: turn.reply, intervention: turn.intervention, decision: `${decision.action.type}:${decision.reason}`, kind: interaction.kind };
}

// What a decided action runs here. null: the turn is a conversation.
async function act(
  action: TurnAction,
  ctx:    ActionContext,
  prompt: OpenPrompt | null,
  topic:  string | null,
  now:    Date,
): Promise<ActionResult | null> {
  switch (action.type) {
    case "answer_prompt": {
      if (!prompt) return null;
      const resolved = await resolvePrompt(ctx.profileId, prompt.id, action.optionId, "text", now);
      if (!resolved.ok) return { reply: { text: TEXT.stale }, operation: { name: "answer_prompt", ok: false } };
      // Whatever the stored option says, words typed here run nothing else.
      if (!ANSWERABLE_HERE.has(resolved.option.action.type)) return { reply: { text: TEXT.stale }, operation: { name: "answer_prompt", ok: false } };
      return runOptionAction(resolved.option.action, ctx);
    }
    case "show_today":  return showToday(ctx, action.minutes);
    case "show_status": return showStatus(ctx);
    case "advise":      return advise(ctx, action.topic);
    case "ask_minutes": return askMinutes(action.choices);
    case "offer_setup": return offerSetup(ctx, action.setup);
    case "something_else": {
      const view = await loadNovaToday(ctx.chatId, { now });
      const skip = [topic, view.status === "ready" ? view.recommendation?.topicName : null].filter((t): t is string => Boolean(t));
      return view.status === "ready"
        ? { reply: alternativeReply(view, skip), operation: { name: "show_alternative", ok: true } }
        : { reply: { text: TEXT.finishSetup }, operation: { name: "show_alternative", ok: false } };
    }
    case "acknowledge_report": return { reply: { text: TEXT.selfReport }, operation: { name: "acknowledge_report", ok: true } };
    case "unsupported":        return { reply: { text: TEXT.unsupported }, operation: { name: "unsupported", ok: true } };
    case "clarify":            return { reply: { text: "I didn't catch that. Tell me in a few more words." }, operation: { name: "clarify", ok: true } };
    default:                   return null;
  }
}

// ── Before setup is finished ──────────────────────────────────────────────────
// The chat box on a page that cannot plan yet. The shared setup turn decides
// the reply; this opens its question so "yes" typed here can answer it, and
// logs both sides of the exchange.
export async function runWebSetupSentence(input: {
  platformChatId: string; text: string; timestamp: Date; understand?: typeof runUnderstandingBrain;
}): Promise<{ reply: string }> {
  const ensured = await ensureSetupProfile(input.platformChatId);
  if (!ensured) throw new Error("no Nova learner behind this key");
  const ctx: ActionContext = { chatId: input.platformChatId, profileId: ensured.profileId, timezone: ensured.timezone, name: null, now: input.timestamp };
  const turn = await runSetupTurn({ ctx, text: input.text, history: await loadConversationHistory(ensured.userId), understand: input.understand });
  let reply = turn.reply.text;
  if (turn.reply.prompt && WEB_PROMPTS.has(turn.reply.prompt.kind)) {
    await openPrompt(ensured.profileId, input.platformChatId, turn.reply.prompt, input.timestamp);
    reply = `${reply}\n(${turn.reply.prompt.options.map(o => o.label).join(" / ")})`;
  }
  await saveUserMessage(ensured.userId, input.text, { intent: "general_chat", emotion: "neutral", signals: [], surface: "web" }, input.timestamp)
    .then(() => saveAssistantMessage(ensured.userId, reply, "nova_setup", {}, input.timestamp))
    .catch(err => console.error("[nova:setup] conversation log failed", err));
  return { reply };
}
