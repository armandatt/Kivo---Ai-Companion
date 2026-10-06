// ─── One Telegram update, start to finish ─────────────────────────────────────
// The surface adapter. It is deliberately not a chain of gates: an update is
// one of three kinds, and each kind has one path.
//
//   command   → the action it names                      (no model)
//   callback  → the prompt option it references          (no model)
//   text      → Understanding (one call, with context)
//               → decideAction (pure)
//               → the same actions the buttons run
//               → the canonical Nova turn: log, evidence, consolidation,
//                 and the Response Brain only when the reply needs wording
//
// Nothing here reads meaning from text, keeps learner state, or remembers
// anything between updates in process memory. What must survive a restart
// (the open prompt, the turn lease, the limits) is in Postgres.

import { prisma } from "@repo/db/client";
import { checkRateLimit } from "../../services/rateLimit.service";
import { runUnderstandingBrain } from "../brains/understanding-brain";
import { decideAction, type TurnAction } from "../decision/action-decision";
import { dayKey, resolveTimezone } from "../engines/learner-calendar";
import { handleNovaTurn } from "../entry";
import { runNovaOrchestrator } from "../nova-orchestrator";
import { examAlreadyKnown } from "../product/exams";
import { loadNovaSession } from "../product/session";
import { loadStudySnapshot } from "../engines/study-snapshot";
import { loadConversationHistory } from "../adapters/conversation-adapter";
import type { NovaOrchestratorInput } from "../types/context.types";
import type { AcademicUnderstanding, UnderstandingContext } from "../types/understanding.types";
import {
  acquireTurn, allowAction, ensureChannel, markDelivered, markUndeliverable, noteInbound, releaseTurn, spendModelCall,
} from "./channel-store";
import { closeOpenPrompt, loadOpenPrompt, openPrompt, recordPromptMessage, resolvePrompt, type OpenPrompt } from "./prompt-store";
import {
  askOutcome, offerStart, pauseOrResume, runOptionAction, showSettings, showStatus, showToday, startFromRequest,
  type ActionContext, type ActionResult,
} from "./telegram-actions";
import { decodeCallback, encodeCallback } from "./telegram-event";
import { alternativeReply, clarifyReply, TEXT, withExamOffer } from "./telegram-replies";
import { loadNovaToday } from "../product/today";
import type {
  FailureCategory, InlineButton, PromptKind, TelegramClient, TelegramEvent, TelegramReply, TurnTrace,
} from "./telegram.types";

export interface TelegramDeps {
  client:       TelegramClient;
  now?:         () => Date;
  // Public address of the web app, for "Open Nova" buttons. Telegram accepts
  // only https links, so anything else means no link button.
  webUrl?:      string | null;
  // Test seams. Production uses the real brains.
  understand?:  typeof runUnderstandingBrain;
  respond?:     NovaOrchestratorInput["respond"];
}

type Event = Exclude<TelegramEvent, { kind: "ignored" }>;

const PROMPT_QUESTION: Record<PromptKind, string> = {
  start:           "Start a study session now?",
  nudge:           "Start studying now?",
  session:         "Your session: pause, resume or end it?",
  session_outcome: "How did the study session go?",
  confirm_exam:    "Add this exam?",
  clarify:         "What do you need?",
  settings:        "Change a setting?",
};

function newTrace(event: Event): TurnTrace {
  return {
    correlationId: `tg:${event.updateId ?? "x"}:${event.chatId.slice(-4)}`,
    surface: "telegram", type: event.kind,
    command: event.kind === "command" ? event.command : null,
    profileId: null,
    understanding: { attempted: false, ok: false, ms: 0, confidence: null, request: null, intent: null, estInputTokens: 0 },
    decision: null,
    operation: { name: null, ok: null },
    evidence: { kinds: [], consolidationQueued: false },
    response: { generated: false, ok: null, ms: 0, fallback: false },
    send: { status: "skipped", messageId: null, failure: null },
    promptId: null, failure: "none",
    textLength: event.kind === "text" ? event.text.length : 0,
    totalMs: 0,
  };
}

function buttonRows(reply: TelegramReply, prompt: OpenPrompt | null, webUrl: string | null | undefined): InlineButton[][] {
  const rows: InlineButton[][] = [];
  if (prompt) {
    const buttons = prompt.options.map(o => ({ text: o.label, callback_data: encodeCallback(prompt.id, o.id) }));
    for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  }
  if (reply.link && webUrl && webUrl.startsWith("https://")) {
    rows.push([{ text: reply.link.label, url: `${webUrl}${reply.link.path}` }]);
  }
  return rows;
}

const weekdayIn = (now: Date, zone: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: zone }).format(now);

export async function handleNovaTelegramEvent(event: Event, deps: TelegramDeps): Promise<TurnTrace> {
  const started = Date.now();
  const now     = deps.now ? deps.now() : new Date();
  const trace   = newTrace(event);
  const { client } = deps;

  const finish = (failure?: FailureCategory): TurnTrace => {
    if (failure) trace.failure = failure;
    trace.totalMs = Date.now() - started;
    console.log(JSON.stringify({ ts: new Date().toISOString(), layer: "nova_telegram", ...trace }));
    return trace;
  };

  // Sends a reply. A reply with choices opens the prompt first, so every
  // button already has something to refer to when it arrives.
  let ctx: ActionContext | null = null;
  const deliver = async (reply: TelegramReply): Promise<void> => {
    let prompt: OpenPrompt | null = null;
    if (ctx && reply.prompt && reply.prompt.options.length > 0) {
      prompt = await openPrompt(ctx.profileId, event.chatId, reply.prompt, now);
      trace.promptId = prompt.id;
    }
    const sent = await client.sendMessage(event.chatId, reply.text, buttonRows(reply, prompt, deps.webUrl));
    if (sent.ok) {
      trace.send = { status: "sent", messageId: sent.messageId, failure: null };
      if (prompt) await recordPromptMessage(prompt.id, sent.messageId);
      if (ctx) await markDelivered(ctx.profileId, now).catch(() => {});
      return;
    }
    trace.send = { status: "failed", messageId: null, failure: sent.kind };
    if (trace.failure === "none") trace.failure = "send_failed";
    // Nobody saw these buttons, so they are not an open question.
    if (prompt && ctx && sent.kind !== "unknown") await closeOpenPrompt(ctx.profileId, "undelivered", now, prompt.id).catch(() => {});
    if (ctx && sent.kind === "blocked") await markUndeliverable(ctx.profileId, now).catch(() => {});
  };

  try {
    // ── Who is this ──────────────────────────────────────────────────────────
    // The chat id selects the learner. It is trusted because the webhook
    // secret was checked before this function was called.
    const user = await prisma.messengerUser.findUnique({
      where:  { platform_platformChatId: { platform: "telegram", platformChatId: event.chatId } },
      select: { displayName: true, novaAcademicProfile: { select: { id: true, onboardingComplete: true, timezone: true } } },
    });
    const profile = user?.novaAcademicProfile ?? null;

    // In a private chat the sender is the chat. Anything else is not ours.
    if (event.fromId !== null && event.fromId !== event.chatId) {
      if (event.kind === "callback") await client.answerCallback(event.callbackId, TEXT.stale);
      return finish("forged_callback");
    }

    // ── Still setting up ─────────────────────────────────────────────────────
    // Nova's own onboarding conversation, unchanged. Buttons and commands
    // have nothing to act on yet.
    if (!profile?.onboardingComplete) {
      if (event.kind === "callback") { await client.answerCallback(event.callbackId, TEXT.stale); return finish("stale_prompt"); }
      if (event.kind !== "text") { await deliver({ text: event.kind === "command" && event.command === "help" ? TEXT.help : TEXT.finishSetup }); return finish(); }
      const turn = await handleNovaTurn({
        platformChatId: event.chatId, text: event.text, onboardingDone: false, timestamp: now, surface: "telegram", awaitPersistence: true,
      });
      trace.decision = "onboarding";
      await deliver({ text: turn.reply });
      return finish(turn.ok ? "none" : "internal");
    }

    trace.profileId = profile.id;
    ctx = { chatId: event.chatId, profileId: profile.id, timezone: profile.timezone, name: user?.displayName ?? null, now };
    await ensureChannel(profile.id);
    await noteInbound(profile.id);

    // One chat cannot flood the system with taps and commands. Over the
    // limit, the update is dropped without a reply.
    if (!await allowAction(profile.id, now)) {
      if (event.kind === "callback") await client.answerCallback(event.callbackId, TEXT.rateLimited);
      return finish("rate_limited");
    }

    const report = (result: ActionResult) => {
      trace.operation = result.operation;
      if (!result.operation.ok && trace.failure === "none") trace.failure = "operation_failed";
      return result.reply;
    };

    // ── A button ─────────────────────────────────────────────────────────────
    if (event.kind === "callback") {
      const ref = decodeCallback(event.data);
      const resolved = ref ? await resolvePrompt(profile.id, ref.promptId, ref.optionId, "callback", now) : null;
      if (!resolved || !resolved.ok) {
        // Old, already answered, or not this learner's. Nothing happens.
        await client.answerCallback(event.callbackId, TEXT.stale);
        if (event.messageId !== null) await client.clearButtons(event.chatId, event.messageId);
        return finish(!resolved || resolved.reason === "unknown" ? "forged_callback" : "stale_prompt");
      }
      trace.promptId = ref!.promptId;
      trace.decision = `option:${resolved.option.action.type}`;
      await client.answerCallback(event.callbackId);
      if (event.messageId !== null) await client.clearButtons(event.chatId, event.messageId);
      await deliver(report(await runOptionAction(resolved.option.action, ctx)));
      return finish();
    }

    // ── A command ────────────────────────────────────────────────────────────
    if (event.kind === "command") {
      trace.decision = `command:${event.command}`;
      switch (event.command) {
        case "start":    await deliver({ text: `${TEXT.linked}\n\n${TEXT.help}` }); break;
        case "help":     await deliver({ text: TEXT.help }); break;
        case "today":    await deliver(report(await showToday(ctx, null))); break;
        case "focus":
        case "study":    await deliver(report(await offerStart(ctx, event.argument || null))); break;
        case "done":     await deliver(report(await askOutcome(ctx, null))); break;
        case "status":   await deliver(report(await showStatus(ctx))); break;
        case "settings": await deliver(report(await showSettings(ctx))); break;
        default:         await deliver({ text: TEXT.webOnly, link: { label: "Open Nova", path: "/home" } });
      }
      return finish();
    }

    if (event.kind === "unsupported") {
      await deliver({ text: event.reason === "unknown_command" ? TEXT.unknownCommand : TEXT.notText });
      return finish();
    }

    // ── Words ────────────────────────────────────────────────────────────────
    const limit = await checkRateLimit(event.chatId);
    if (!limit.allowed) { await deliver({ text: TEXT.rateLimited }); return finish("rate_limited"); }
    if (!await acquireTurn(profile.id, now)) { await deliver({ text: TEXT.busy }); return finish("busy"); }

    try {
      const zone = resolveTimezone(profile.timezone);
      const day  = dayKey(now, zone);
      if (!await spendModelCall(profile.id, "understanding", day)) {
        await deliver({ text: TEXT.budget });
        return finish("budget_exhausted");
      }

      // Before reading the message: what is true right now.
      const [session, prompt, userRow] = await Promise.all([
        loadNovaSession(event.chatId, now),
        loadOpenPrompt(profile.id, now),
        prisma.messengerUser.findUnique({
          where: { platform_platformChatId: { platform: "telegram", platformChatId: event.chatId } }, select: { id: true },
        }),
      ]);
      const history = userRow ? await loadConversationHistory(userRow.id) : [];
      const context: UnderstandingContext = {
        today:        `${weekdayIn(now, zone)} ${day}`,
        session:      session ? (session.status === "paused" ? "paused" : "running") : "none",
        sessionTopic: session?.topicName ?? null,
        openPrompt:   prompt ? { question: PROMPT_QUESTION[prompt.kind], options: prompt.options.map(o => ({ id: o.id, label: o.label })) } : null,
      };

      // The one reading of this message.
      let understanding: AcademicUnderstanding;
      const readStarted = Date.now();
      trace.understanding.attempted = true;
      trace.understanding.estInputTokens = Math.round((event.text.length + 4200) / 4);
      try {
        understanding = await (deps.understand ?? runUnderstandingBrain)(event.text, history, context);
      } catch (err) {
        trace.understanding.ms = Date.now() - readStarted;
        console.error(`[nova:telegram] ${trace.correlationId} understanding failed:`, (err as Error).message);
        await deliver({ text: TEXT.notUnderstood });
        return finish("understanding_failed");
      }
      trace.understanding.ms = Date.now() - readStarted;
      if (understanding.malformed) {
        // Unreadable output proposes nothing, so nothing is done.
        await deliver({ text: TEXT.notUnderstood });
        return finish("understanding_malformed");
      }
      trace.understanding.ok         = true;
      trace.understanding.intent     = understanding.intent;
      trace.understanding.request    = understanding.request?.action ?? null;
      trace.understanding.confidence = understanding.request?.confidence ?? null;

      const decision = decideAction(understanding, {
        session: context.session,
        prompt:  prompt ? { kind: prompt.kind, optionIds: prompt.options.map(o => o.id) } : null,
      });
      trace.decision = `${decision.action.type}:${decision.reason}`;

      // The action, through the same functions the buttons use.
      const acted = await act(decision.action, ctx, prompt, understanding, now);
      let reply: TelegramReply | null = acted ? report(acted) : null;

      // An exam the student dated, which Nova does not have: offer to add it.
      if (decision.proposeExam) {
        const snapshot = await loadStudySnapshot(event.chatId);
        if (!examAlreadyKnown(snapshot.upcomingExams, decision.proposeExam)) {
          reply = withExamOffer(reply ?? { text: "" }, decision.proposeExam);
        }
      }

      // The canonical Nova turn: the message is logged, evidence is built
      // and consolidated, state is updated. The Response Brain speaks only
      // when the decision calls for wording and today's budget allows it.
      const plain    = reply?.text.trim() ?? "";
      const generate = decision.generate && await spendModelCall(profile.id, "response", day);
      const fallback = plain || TEXT.converseFallback;
      const respondStarted = Date.now();
      try {
        const turn = await runNovaOrchestrator({
          platformChatId:   event.chatId,
          text:             event.text,
          timestamp:        now,
          understanding,
          awaitPersistence: true,
          sessionCommands:  "surface",
          respond:          deps.respond,
          ...(generate
            ? {
                responseFallback: fallback,
                directive: plain
                  ? `Nova's system already did or offered this: "${plain.slice(0, 400)}". Say it in your own words in at most three short sentences. Buttons for the next step are attached, so do not list options.`
                  : undefined,
              }
            : { scriptedReply: fallback }),
        });
        trace.response = {
          generated: turn.trace?.responseGenerated ?? false,
          ok:        turn.trace?.responseGenerated ? turn.trace.responseOk : null,
          ms:        turn.trace?.responseGenerated ? Date.now() - respondStarted : 0,
          fallback:  turn.trace?.responseGenerated === true && turn.trace.responseOk === false,
        };
        if (trace.response.fallback) trace.failure = "response_failed";
        trace.evidence = { kinds: turn.trace?.evidenceKinds ?? [], consolidationQueued: turn.trace?.consolidationQueued ?? false };
        reply = { ...(reply ?? {}), text: turn.reply };
      } catch (err) {
        // The action above already happened and stands. Say what it was.
        console.error(`[nova:telegram] ${trace.correlationId} turn failed after the action:`, (err as Error).message);
        trace.failure = "internal";
        reply = { ...(reply ?? {}), text: fallback };
      }

      await deliver(reply);
      return finish();
    } finally {
      await releaseTurn(profile.id);
    }
  } catch (err) {
    console.error(`[nova:telegram] ${trace.correlationId} failed:`, err);
    trace.failure = "internal";
    // Never claim success. One plain line, best effort.
    if (event.kind === "callback") await client.answerCallback(event.callbackId, TEXT.failed).catch(() => {});
    else await client.sendMessage(event.chatId, TEXT.failed).catch(() => {});
    return finish();
  }
}

// What a decided action runs. null: the turn is a conversation and has no
// product action.
async function act(
  action:        TurnAction,
  ctx:           ActionContext,
  prompt:        OpenPrompt | null,
  understanding: AcademicUnderstanding,
  now:           Date,
): Promise<ActionResult | null> {
  switch (action.type) {
    case "answer_prompt": {
      if (!prompt) return null;
      // The same single-use resolution a tap goes through: if a tap got
      // there first, this answer changes nothing.
      const resolved = await resolvePrompt(ctx.profileId, prompt.id, action.optionId, "text", now);
      if (!resolved.ok) return { reply: { text: TEXT.stale }, operation: { name: "answer_prompt", ok: false } };
      return runOptionAction(resolved.option.action, ctx);
    }
    case "show_today":     return showToday(ctx, action.minutes);
    case "start_session":  return startFromRequest(ctx, action.topic, action.minutes);
    case "pause_session":  return pauseOrResume(ctx, "pause");
    case "resume_session": return pauseOrResume(ctx, "resume");
    case "ask_outcome":    return askOutcome(ctx, action.stated);
    case "show_status":    return showStatus(ctx);
    case "defer":          return runOptionAction({ type: action.until === "tomorrow" ? "not_today" : "later" }, ctx);
    case "something_else": {
      const view = await loadNovaToday(ctx.chatId, { now });
      const skip = [understanding.topic, view.status === "ready" ? view.recommendation?.topicName : null].filter((t): t is string => Boolean(t));
      return view.status === "ready"
        ? { reply: alternativeReply(view, skip), operation: { name: "show_alternative", ok: true } }
        : { reply: { text: TEXT.finishSetup }, operation: { name: "show_alternative", ok: false } };
    }
    case "acknowledge_report": return { reply: { text: TEXT.selfReport }, operation: { name: "acknowledge_report", ok: true } };
    case "clarify":            return { reply: clarifyReply(await loadNovaSession(ctx.chatId, now)), operation: { name: "clarify", ok: true } };
    case "converse":           return null;
  }
}
