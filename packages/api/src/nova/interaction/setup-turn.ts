// ─── A message from a learner who has not finished setup ──────────────────────
// Before there is anything to plan from, a message can do one useful thing:
// add to the setup. It takes the path every other message takes (one reading
// with context, the safety check, the decision) and ends at the same setup
// writer the setup page uses, on the learner's confirmation. Telegram and the
// web chat both call it; neither keeps a setup of its own.
//
// It asks for one thing at a time, the most blocking first, and never for
// what is already on record. There is no questionnaire: year, goals and the
// rest are not asked. One model call, no Response Brain.

import { runUnderstandingBrain } from "../brains/understanding-brain";
import { decideAction } from "../decision/action-decision";
import { safeReading } from "../decision/interpretation-safety";
import { dayKey, resolveTimezone } from "../engines/learner-calendar";
import { examToOffer } from "../product/exams";
import { loadSetup, proposeSetup, type SetupView } from "../product/setup";
import { loadOpenPrompt, resolvePrompt } from "../telegram/prompt-store";
import { runOptionAction, type ActionContext } from "../telegram/telegram-actions";
import { setupOfferReply, TEXT, withExamOffer } from "../telegram/telegram-replies";
import type { PromptKind, TelegramReply } from "../telegram/telegram.types";
import type { UnderstandingContext } from "../types/understanding.types";
import { interpret } from "./semantics";

const SETUP_PROMPTS: ReadonlySet<PromptKind> = new Set<PromptKind>(["confirm_setup", "confirm_exam"]);
const QUESTION: Partial<Record<PromptKind, string>> = { confirm_setup: "Save what you told me about your term?", confirm_exam: "Add this exam?" };

export const SETUP_LINK = { label: "Set it up on the web", path: "/home" };

// What Nova says to someone it cannot plan for yet: the one thing it needs.
export function setupAsk(view: SetupView | null, lead = ""): TelegramReply {
  const question = view?.nextQuestion ?? "Which subjects are you taking this term?";
  return { text: `${lead}${question}`, link: SETUP_LINK };
}

export const SETUP_INTRO = "I'm Nova. Before I can plan anything I need to know what you're studying. ";

export interface SetupTurnResult { reply: TelegramReply; decision: string; kind: string; ok: boolean }

export async function runSetupTurn(input: {
  ctx:         ActionContext;
  text:        string;
  history:     Array<{ role: "user" | "nova"; text: string }>;
  understand?: typeof runUnderstandingBrain;
}): Promise<SetupTurnResult> {
  const { ctx, text } = input;
  const zone = resolveTimezone(ctx.timezone);
  const day  = dayKey(ctx.now, zone);
  const open = await loadOpenPrompt(ctx.profileId, ctx.now);
  const prompt = open && SETUP_PROMPTS.has(open.kind) ? open : null;
  const context: UnderstandingContext = {
    today:        `${new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: zone }).format(ctx.now)} ${day}`,
    session:      "none", sessionTopic: null,
    openPrompt:   prompt ? { question: QUESTION[prompt.kind] ?? "", options: prompt.options.map(o => ({ id: o.id, label: o.label })) } : null,
  };

  const read = await (input.understand ?? runUnderstandingBrain)(text, input.history, context);
  if (read.malformed) return { reply: { text: TEXT.notUnderstood }, decision: "unreadable", kind: "unclear", ok: false };
  const understanding = safeReading(read, { today: day });
  const kind = interpret(understanding).kind;
  const decision = decideAction(understanding, {
    session: "none",
    prompt:  prompt ? { kind: prompt.kind, options: prompt.options.map(o => ({ id: o.id, type: o.action.type, minutes: null })) } : null,
  });
  const done = (reply: TelegramReply, ok = true): SetupTurnResult => ({ reply, decision: `setup:${decision.action.type}`, kind, ok });

  // Yes or no to what Nova showed back.
  if (decision.action.type === "answer_prompt" && prompt) {
    const resolved = await resolvePrompt(ctx.profileId, prompt.id, decision.action.optionId, "text", ctx.now);
    if (!resolved.ok) return done({ text: TEXT.stale }, false);
    const acted = await runOptionAction(resolved.option.action, ctx);
    return done(acted.reply, acted.operation.ok);
  }

  const view = await loadSetup(ctx.chatId, ctx.now);
  const subjects = view?.subjects ?? [];

  // Something about their term: shown back, with the way to save it.
  if (decision.action.type === "offer_setup") {
    const proposal = proposeSetup(decision.action.setup, subjects);
    if (proposal) return done(setupOfferReply(proposal));
  }
  // An exam and its day, once there is a subject to put it under.
  if (decision.proposeExam && view) {
    const offer = examToOffer(decision.proposeExam, subjects.map(s => ({ id: s.name, name: s.name, code: null })), []);
    if (offer) return done(withExamOffer({ text: "" }, offer));
  }
  // Anything else: Nova cannot plan, start or advise yet, and says what it needs.
  return done(setupAsk(view, subjects.length === 0 ? SETUP_INTRO : "I can't plan for you yet. "));
}
