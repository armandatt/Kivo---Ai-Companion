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
import { wordFirstUse } from "../brains/first-use-wording";
import { chooseRegister } from "../decision/register";
import { loadAccountabilityStyle, loadOperatingStyle } from "../adapters/operating-style-adapter";
import { decideAction, type ActionContext as DecisionContext, type TurnAction } from "../decision/action-decision";
import { safeReading } from "../decision/interpretation-safety";
import { dayKey, resolveTimezone } from "../engines/learner-calendar";
import { runSetupTurn, setupAsk, SETUP_INTRO } from "../interaction/setup-turn";
import { ensureSetupProfile, loadSetup } from "../product/setup";
import { runNovaOrchestrator } from "../nova-orchestrator";
import { examToOffer } from "../product/exams";
import { loadNovaSession } from "../product/session";
import { loadStudySnapshot } from "../engines/study-snapshot";
import { loadConversationHistory, saveAssistantMessage, saveUserMessage } from "../adapters/conversation-adapter";
import type { NovaOrchestratorInput } from "../types/context.types";
import type { AcademicUnderstanding, UnderstandingContext } from "../types/understanding.types";
import {
  acquireTurn, allowAction, claimFirstUse, ensureChannel, markDelivered, releaseFirstUse, markUndeliverable, noteInbound, releaseTurn, spendModelCall,
} from "./channel-store";
import { closeOpenPrompt, loadOpenPrompt, openPrompt, recordPromptMessage, resolvePrompt, type OpenPrompt } from "./prompt-store";
import {
  advise, askMinutes, askOutcome, firstUse, offerSetup, offerStart, pauseOrResume, runOptionAction, showSettings, showStatus, showToday, startFromRequest,
  type ActionContext, type ActionResult,
} from "./telegram-actions";
import { decodeCallback, encodeCallback } from "./telegram-event";
import { alternativeReply, clarifyReply, TEXT, withExamOffer } from "./telegram-replies";
import { loadNovaToday } from "../product/today";
import { interpret } from "../interaction/semantics";
import type {
  FailureCategory, InlineButton, PromptKind, TelegramClient, TelegramEvent, TelegramReply, TurnTrace,
} from "./telegram.types";
import { slowestStage } from "./telegram.types";

export interface TelegramDeps {
  client:       TelegramClient;
  now?:         () => Date;
  // Public address of the web app, for "Open Nova" buttons. Telegram accepts
  // only https links, so anything else means no link button.
  webUrl?:      string | null;
  // Test seams. Production uses the real brains.
  // When the webhook received this update, so the time it spent before this
  // handler ran is counted in what the learner waited.
  receivedAt?:  number;
  // Called once the reply has been sent. The webhook shows "typing" while a
  // message is handled; it stops here, not when the turn has been recorded.
  onReplied?:   () => void;
  generate?:    Parameters<typeof wordFirstUse>[1];
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
  confirm_setup:   "Save what you told me about your term?",
  pick_minutes:    "How many minutes do you have?",
  clarify:         "What do you need?",
  settings:        "Change a setting?",
};

function newTrace(event: Event): TurnTrace {
  return {
    correlationId: `tg:${event.updateId ?? "x"}:${event.chatId.slice(-4)}`,
    surface: "telegram", type: event.kind,
    command: event.kind === "command" ? event.command : null,
    profileId: null,
    understanding: { attempted: false, ok: false, ms: 0, confidence: null, kind: null, request: null, clarity: null, changeOfMind: false, intent: null, estInputTokens: 0 },
    decision: null,
    operation: { name: null, ok: null },
    evidence: { kinds: [], consolidationQueued: false },
    response: { generated: false, ok: null, ms: 0, fallback: false },
    send: { status: "skipped", messageId: null, failure: null },
    promptId: null, failure: "none",
    textLength: event.kind === "text" ? event.text.length : 0,
    totalMs: 0,
    timings: { webhookMs: 0, learnerMs: 0, contextMs: 0, understandingMs: 0, decisionMs: 0, actionMs: 0, responseMs: 0, telegramSendMs: 0, replyMs: 0, persistMs: 0, totalMs: 0 },
    modelCalls: 0,
    slowStage: null,
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
  const started  = Date.now();
  const received = deps.receivedAt ?? started;
  const now      = deps.now ? deps.now() : new Date();
  const trace   = newTrace(event);
  const { client } = deps;

  // When the reply went out. null: nothing has been sent for this update.
  let repliedAt: number | null = null;
  const finish = (failure?: FailureCategory): TurnTrace => {
    if (failure) trace.failure = failure;
    const ended = Date.now();
    trace.totalMs = ended - started;
    trace.timings.webhookMs = Math.max(0, started - received);
    trace.timings.totalMs   = ended - received;
    trace.timings.replyMs   = (repliedAt ?? ended) - received;
    trace.timings.persistMs = repliedAt === null ? 0 : ended - repliedAt;
    trace.understanding.ms  = trace.timings.understandingMs;
    trace.slowStage = slowestStage(trace.timings);
    console.log(JSON.stringify({ ts: new Date().toISOString(), layer: "nova_telegram", ...trace }));
    return trace;
  };
  // A stage's duration, added to its total. `since` is when it began.
  const spent = (stage: "learnerMs" | "contextMs" | "understandingMs" | "decisionMs" | "actionMs" | "responseMs" | "telegramSendMs", since: number) => {
    trace.timings[stage] += Date.now() - since;
  };
  // Every Telegram API call this update makes, timed together.
  const telegram = async <T>(call: Promise<T>): Promise<T> => {
    const since = Date.now();
    try { return await call; } finally { spent("telegramSendMs", since); }
  };

  // Sends a reply. A reply with choices opens the prompt first, so every
  // button already has something to refer to when it arrives.
  //
  // One update, one reply: whatever path the turn took, the first reply is
  // the only one. A second is a bug in the turn, and is dropped and logged
  // here so the learner never sees two answers to one message.
  let ctx: ActionContext | null = null;
  // When the product action now running began. Its time is counted up to
  // the moment its reply is handed over for sending.
  let actingSince: number | null = null;
  const deliver = async (reply: TelegramReply): Promise<void> => {
    if (repliedAt !== null) {
      console.error(`[nova:telegram] ${trace.correlationId} a second reply to one update was dropped`);
      return;
    }
    repliedAt = Date.now();
    if (actingSince !== null) { spent("actionMs", actingSince); actingSince = null; }
    let prompt: OpenPrompt | null = null;
    if (ctx && reply.prompt && reply.prompt.options.length > 0) {
      prompt = await openPrompt(ctx.profileId, event.chatId, reply.prompt, now);
      trace.promptId = prompt.id;
    }
    const sent = await telegram(client.sendMessage(event.chatId, reply.text, buttonRows(reply, prompt, deps.webUrl)));
    repliedAt = Date.now();
    deps.onReplied?.();
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
      select: {
        id: true, displayName: true,
        novaAcademicProfile: {
          select: { id: true, onboardingComplete: true, timezone: true, telegramChannel: { select: { undeliverableSince: true } } },
        },
      },
    });
    let profile: { id: string; onboardingComplete: boolean; timezone: string | null } | null = user?.novaAcademicProfile ?? null;
    // The channel row, read with the learner: null when there is none yet.
    const channel = user?.novaAcademicProfile?.telegramChannel ?? null;

    // In a private chat the sender is the chat. Anything else is not ours.
    if (event.fromId !== null && event.fromId !== event.chatId) {
      if (event.kind === "callback") await telegram(client.answerCallback(event.callbackId, TEXT.stale));
      return finish("forged_callback");
    }

    // ── Still setting up ─────────────────────────────────────────────────────
    // There is nothing to plan from yet. A message can add to the setup
    // (interaction/setup-turn.ts) and a button can confirm what was shown
    // back; everything else is answered with the one thing Nova still needs.
    const settingUp = !profile?.onboardingComplete;
    if (settingUp) {
      const ensured = await ensureSetupProfile(event.chatId);
      if (!ensured) { await deliver({ text: TEXT.finishSetup }); return finish(); }
      profile = { id: ensured.profileId, onboardingComplete: false, timezone: ensured.timezone };
    }
    if (!profile) return finish("internal");

    trace.profileId = profile.id;
    ctx = { chatId: event.chatId, profileId: profile.id, timezone: profile.timezone, name: user?.displayName ?? null, now };
    // The row is made once, and "reachable again" is written only when the
    // chat had been marked unreachable: most updates need neither.
    if (!channel || settingUp) await ensureChannel(profile.id);
    if (!channel || channel.undeliverableSince !== null) await noteInbound(profile.id);

    // One chat cannot flood the system with taps and commands. Over the
    // limit, the update is dropped without a reply.
    if (!await allowAction(profile.id, now)) {
      if (event.kind === "callback") await telegram(client.answerCallback(event.callbackId, TEXT.rateLimited));
      return finish("rate_limited");
    }
    spent("learnerMs", started);

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
        await telegram(Promise.all([
          client.answerCallback(event.callbackId, TEXT.stale),
          event.messageId !== null ? client.clearButtons(event.chatId, event.messageId) : null,
        ]));
        return finish(!resolved || resolved.reason === "unknown" ? "forged_callback" : "stale_prompt");
      }
      trace.promptId = ref!.promptId;
      trace.decision = `option:${resolved.option.action.type}`;
      // The tap is acknowledged and its buttons cleared while the action
      // runs: neither depends on the other, and the tap is already resolved.
      const acknowledged = telegram(Promise.all([
        client.answerCallback(event.callbackId),
        event.messageId !== null ? client.clearButtons(event.chatId, event.messageId) : null,
      ])).catch(() => {});
      const acting = Date.now();
      const result = await runOptionAction(resolved.option.action, ctx);
      spent("actionMs", acting);
      await acknowledged;
      await deliver(report(result));
      return finish();
    }

    // ── A command ────────────────────────────────────────────────────────────
    if (event.kind === "command" && settingUp) {
      trace.decision = `command:${event.command}:setup`;
      const view = await loadSetup(event.chatId, now);
      await deliver(setupAsk(view, event.command === "start" || (view?.subjects.length ?? 0) === 0 ? SETUP_INTRO : "I can't plan for you yet. "));
      return finish();
    }
    if (event.kind === "command") {
      trace.decision = `command:${event.command}`;
      actingSince = Date.now();
      switch (event.command) {
        case "start": {
          // The first message in this chat is the mentor's, from the record.
          // After that, /start is simply "what now".
          const first = await claimFirstUse(profile.id, now);
          if (!first) { await deliver(report(await showToday(ctx, null))); break; }
          trace.decision = "command:start:first_use";
          const zone = resolveTimezone(profile.timezone);
          const reply = report(await firstUse(ctx, async (decision, hasButtons, activeReality, daysUntilNextExam) => {
            // Wording is optional: within today's budget, and never required.
            if (!await spendModelCall(profile!.id, "response", dayKey(now, zone))) return decision.fallback;
            if (actingSince !== null) { spent("actionMs", actingSince); actingSince = null; }
            trace.modelCalls++;
            const wording = Date.now();
            const worded = await wordFirstUse({
              decision, hasButtons, studentName: ctx!.name,
              register:       chooseRegister({ emotion: "neutral", daysUntilNextExam, activeReality, accountability: await loadAccountabilityStyle(event.chatId) }),
              operatingStyle: await loadOperatingStyle(event.chatId),
            }, deps.generate);
            spent("responseMs", wording);
            trace.response = { generated: true, ok: worded.generated, ms: Date.now() - wording, fallback: !worded.generated };
            return worded.text;
          }));
          await deliver(reply);
          // Nobody saw it: the chat has still not had its first message.
          if (trace.send.status !== "sent") await releaseFirstUse(profile.id, now);
          break;
        }
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
    const limited = Date.now();
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
      spent("learnerMs", limited);
      const gathering = Date.now();

      // Setup is not finished: the message can only add to it.
      if (settingUp) {
        // The row read at the top, unless this update is what created it.
        const row = user ?? await prisma.messengerUser.findUnique({
          where: { platform_platformChatId: { platform: "telegram", platformChatId: event.chatId } }, select: { id: true },
        });
        trace.understanding.attempted = true;
        trace.modelCalls++;
        const history = row ? await loadConversationHistory(row.id) : [];
        spent("contextMs", gathering);
        const reading = Date.now();
        const turn = await runSetupTurn({ ctx, text: event.text, history, understand: deps.understand });
        spent("understandingMs", reading);
        trace.understanding.ok   = turn.decision !== "unreadable";
        trace.understanding.kind = turn.kind;
        trace.decision           = turn.decision;
        if (!turn.ok && turn.decision === "unreadable") trace.failure = "understanding_malformed";
        if (row) {
          await saveUserMessage(row.id, event.text, { intent: "general_chat", emotion: "neutral", signals: [], surface: "telegram" }, now)
            .then(() => saveAssistantMessage(row.id, turn.reply.text, "nova_setup", {}, now))
            .catch(err => console.error(`[nova:telegram] ${trace.correlationId} conversation log failed`, err));
        }
        await deliver(turn.reply);
        return finish();
      }

      // Before reading the message: what is true right now.
      // Three independent reads, together. The learner's row was read at the
      // top of the turn and is not read again.
      const userRow = user ? { id: user.id } : null;
      const [session, prompt, history] = await Promise.all([
        loadNovaSession(event.chatId, now),
        loadOpenPrompt(profile.id, now),
        userRow ? loadConversationHistory(userRow.id) : Promise.resolve([]),
      ]);
      spent("contextMs", gathering);
      const context: UnderstandingContext = {
        today:        `${weekdayIn(now, zone)} ${day}`,
        session:      session ? (session.status === "paused" ? "paused" : "running") : "none",
        sessionTopic: session?.topicName ?? null,
        openPrompt:   prompt ? { question: PROMPT_QUESTION[prompt.kind], options: prompt.options.map(o => ({ id: o.id, label: o.label })) } : null,
      };

      // The one reading of this message.
      let read: AcademicUnderstanding;
      const readStarted = Date.now();
      trace.understanding.attempted = true;
      trace.modelCalls++;
      trace.understanding.estInputTokens = Math.round((event.text.length + 6200) / 4);
      try {
        read = await (deps.understand ?? runUnderstandingBrain)(event.text, history, context);
      } catch (err) {
        spent("understandingMs", readStarted);
        console.error(`[nova:telegram] ${trace.correlationId} understanding failed:`, (err as Error).message);
        await deliver({ text: TEXT.notUnderstood });
        return finish("understanding_failed");
      }
      spent("understandingMs", readStarted);
      const deciding = Date.now();
      if (read.malformed) {
        // Unreadable output proposes nothing, so nothing is done.
        await deliver({ text: TEXT.notUnderstood });
        return finish("understanding_malformed");
      }
      // What of that reading may be used at all. Everything below, the
      // decision and the evidence alike, sees only this.
      const understanding = safeReading(read, { today: day });
      trace.understanding.ok           = true;
      trace.understanding.intent       = understanding.intent;
      trace.understanding.request      = understanding.request?.action ?? null;
      trace.understanding.confidence   = understanding.request?.confidence ?? null;
      trace.understanding.clarity      = understanding.request?.clarity ?? null;
      trace.understanding.changeOfMind = understanding.request?.changeOfMind ?? false;

      // What kind of message it is, and which parts of the record a reply
      // to it can use. It describes; the decision below is what acts.
      const interaction = interpret(understanding);
      trace.understanding.kind = interaction.kind;

      const decision = decideAction(understanding, { session: context.session, prompt: promptFacts(prompt) });
      trace.decision = `${decision.action.type}:${decision.reason}`;
      spent("decisionMs", deciding);

      // The action, through the same functions the buttons use.
      const acting = Date.now();
      const acted = await act(decision.action, ctx, prompt, understanding, now);
      spent("actionMs", acting);
      let reply: TelegramReply | null = acted ? report(acted) : null;

      // Noise: answered, and nothing else. It does not enter the canonical
      // turn, so no signal, evidence or state can come of it. Only the
      // conversation log records that it was said.
      if (understanding.request?.clarity === "unintelligible") {
        const text = reply?.text ?? TEXT.clarifyOpen;
        if (userRow) {
          await saveUserMessage(userRow.id, event.text, { intent: "general_chat", emotion: "neutral", signals: [], surface: "telegram" }, now)
            .then(() => saveAssistantMessage(userRow.id, text, "nova_clarify", {}, now))
            .catch(err => console.error(`[nova:telegram] ${trace.correlationId} conversation log failed`, err));
        }
        await deliver(reply ?? { text });
        return finish();
      }

      // An exam the student dated, for a subject of theirs that has none on
      // that day: offer to add it.
      if (decision.proposeExam) {
        const snapshot = await loadStudySnapshot(event.chatId);
        const offer = examToOffer(decision.proposeExam, snapshot.subjects, snapshot.upcomingExams);
        if (offer) reply = withExamOffer(reply ?? { text: "" }, offer);
      }

      // The canonical Nova turn: the message is logged, evidence is built
      // and consolidated, state is updated. The Response Brain speaks only
      // when the decision calls for wording, the action it would describe
      // actually happened, and today's budget allows it.
      const plain    = reply?.text.trim() ?? "";
      const happened = acted === null || acted.operation.ok;
      const generate = decision.generate && happened && await spendModelCall(profile.id, "response", day);
      const explaining = decision.action.type === "explain";
      const fallback = plain || (explaining ? TEXT.explainFallback : TEXT.converseFallback);
      // The reply, whoever words it: these buttons, this link.
      const shell = (text: string): TelegramReply => ({ ...(reply ?? {}), text });

      // A reply that code already wrote is sent now. The canonical turn
      // below records the message (log, evidence, consolidation) and cannot
      // change what was said or done, so the learner is not kept waiting for
      // it. It still runs, and is still awaited, before this update ends.
      if (!generate) await deliver(shell(fallback));

      try {
        const turn = await runNovaOrchestrator({
          platformChatId:   event.chatId,
          text:             event.text,
          timestamp:        now,
          understanding,
          awaitPersistence: true,
          sessionCommands:  "surface",
          respond:          deps.respond,
          focus:            { needs: interaction.needs, facts: acted?.facts, ...(explaining ? { mode: "explain" as const } : {}) },
          ...(generate
            ? {
                responseFallback: fallback,
                directive: plain
                  ? `Nova's system already did or offered exactly this, and nothing else: "${plain.slice(0, 400)}". Say it in your own words in at most three short sentences. Buttons for the next step are attached, so do not list options. Do not say anything else was started, ended, saved, added or scheduled, and do not state a date, a number of days or any other figure that is not in that sentence or the context above.`
                  : explaining ? EXPLAINED_ONLY : NOTHING_WAS_DONE,
                // Worded: sent the moment the wording exists, before the
                // turn is recorded.
                hooks: { beforeResponse: () => { trace.modelCalls++; }, reply: (text: string) => deliver(shell(text)) },
              }
            : { scriptedReply: fallback }),
        });
        trace.response = {
          generated: turn.trace?.responseGenerated ?? false,
          ok:        turn.trace?.responseGenerated ? turn.trace.responseOk : null,
          ms:        turn.trace?.responseGenerated ? turn.trace.responseMs ?? 0 : 0,
          fallback:  turn.trace?.responseGenerated === true && turn.trace.responseOk === false,
        };
        if (generate) {
          trace.timings.contextMs  += turn.trace?.contextMs ?? 0;
          trace.timings.responseMs += turn.trace?.responseMs ?? 0;
        }
        if (trace.response.fallback) trace.failure = "response_failed";
        trace.evidence = { kinds: turn.trace?.evidenceKinds ?? [], consolidationQueued: turn.trace?.consolidationQueued ?? false };
      } catch (err) {
        // The action above already happened and stands.
        console.error(`[nova:telegram] ${trace.correlationId} turn failed after the action:`, (err as Error).message);
        trace.failure = "internal";
      }

      // The turn failed before it had a reply: say what the action was.
      if (repliedAt === null) await deliver(shell(fallback));
      return finish();
    } finally {
      await releaseTurn(profile.id);
    }
  } catch (err) {
    console.error(`[nova:telegram] ${trace.correlationId} failed:`, err);
    trace.failure = "internal";
    // Never claim success. One plain line, best effort, and only when this
    // update has not been answered already.
    if (repliedAt === null) {
      if (event.kind === "callback") await client.answerCallback(event.callbackId, TEXT.failed).catch(() => {});
      else await client.sendMessage(event.chatId, TEXT.failed).catch(() => {});
    }
    return finish();
  }
}

// Said to the Response Brain on a turn with no product action, so that a
// reply cannot claim one.
const NOTHING_WAS_DONE =
  "Nova's system took no action this turn: nothing was started, paused, ended, saved, added or scheduled, and no reminder was set. Do not say or imply otherwise, do not promise to do anything later (remind, check in, message, follow up), and do not offer to do something this chat has no button for. Say nothing about how the student feels or what they usually do unless they said it in this message or it is in the context above. Do not state a date, a number of days or any other figure that is not written in the context above. Reply in at most three short sentences.";

const EXPLAINED_ONLY =
  "Nova's system took no action this turn: nothing was started, saved, added or scheduled. Do not say or imply otherwise.";

// The open prompt as the decision sees it: which options exist and what each
// one is. Read from Nova's own record, never from the message.
function promptFacts(prompt: OpenPrompt | null): DecisionContext["prompt"] {
  if (!prompt) return null;
  return {
    kind: prompt.kind,
    options: prompt.options.map(o => ({ id: o.id, type: o.action.type, minutes: o.action.type === "start" ? o.action.minutes : null })),
  };
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
    case "offer_start":    return offerStart(ctx, action.topic, action.minutes);
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
    case "advise":      return advise(ctx, action.topic);
    case "ask_minutes": return askMinutes(action.choices);
    case "offer_setup": return offerSetup(ctx, action.setup);
    // A question about the subject matter: no product action, and the
    // Response Brain answers it.
    case "explain":     return null;
    case "acknowledge_report": return { reply: { text: TEXT.selfReport }, operation: { name: "acknowledge_report", ok: true } };
    case "unsupported":        return { reply: { text: TEXT.unsupported }, operation: { name: "unsupported", ok: true } };
    // Nothing is created: there is no reminder to create.
    case "reminder_unavailable": return { reply: { text: TEXT.reminderUnavailable }, operation: { name: "reminder_unavailable", ok: true } };
    // With a question still open, its buttons are the options: the prompt
    // stays as it is. Otherwise, the fixed choices.
    case "clarify":
      return prompt
        ? { reply: { text: TEXT.clarifyOpen }, operation: { name: "clarify", ok: true } }
        : { reply: clarifyReply(await loadNovaSession(ctx.chatId, now)), operation: { name: "clarify", ok: true } };
    case "converse":           return null;
  }
}
