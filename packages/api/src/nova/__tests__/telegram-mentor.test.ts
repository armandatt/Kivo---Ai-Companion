// Nova on Telegram: everything that can be shown without a database.
// The paths that need one (prompts answered once, sessions shared with the
// web app, the outbox, linking) are in __integration__/nova-telegram.itest.ts.

// The real client reads import.meta, which this Jest setup cannot load. No
// test here reaches a model: wording is given a stand-in.
jest.mock("../../services/openai.service", () => ({ generateOpenAIText: jest.fn(async () => { throw new Error("no model in unit tests"); }) }));

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { decodeCallback, encodeCallback, normalizeTelegramUpdate, parseCommand, MAX_TEXT_LENGTH } from "../telegram/telegram-event";
import { parseUnderstandingResponse, parseLearnerRequest, isIsoDay } from "../brains/understanding-parser";
import { contextBlock } from "../brains/understanding-brain";
import { UNDERSTANDING_BRAIN_SYSTEM_PROMPT } from "../brains/prompts/understanding-brain.prompt";
import { decideAction, EXECUTE_CONFIDENCE, type ActionContext } from "../decision/action-decision";
import { chooseRegister, registerLine } from "../decision/register";
import {
  decideProactive, generateCandidates, studyWindow, isQuietHour, MAX_PER_DAY,
  type ProactiveFacts, type ProactiveGates,
} from "../decision/proactive-decision";
import { consolidate, STRUGGLE_REPORTED_MASTERY } from "../consolidation/consolidator";
import { resolveTurnSignals } from "../engines/turn-signals";
import { endedReply, outcomeReply, startLengths, withExamOffer, recommendationReply } from "../telegram/telegram-replies";
import { nextLocalMidnight, pickStart } from "../telegram/telegram-actions";
import { classifySendFailure } from "../telegram/telegram-client";
import { proactiveFallback, wordProactiveMessage } from "../proactive/nova-proactive-response";
import { examToOffer } from "../product/exams";
import { safeReading } from "../decision/interpretation-safety";
import { PROMPT_TTL_MINUTES } from "../telegram/telegram.types";
import type { AcademicUnderstanding, LearnerRequest } from "../types/understanding.types";
import type { NovaTodayReady, TodayAction } from "../product/today.types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const request = (over: Partial<LearnerRequest> = {}): LearnerRequest => ({
  clarity: "clear", changeOfMind: false,
  action: "none", confidence: 0.9, promptAnswer: null, availableMinutes: null,
  sessionOutcome: null, deferUntil: null, struggleTopic: null, exam: null, ...over,
});
const reading = (req: Partial<LearnerRequest> = {}, over: Partial<AcademicUnderstanding> = {}): AcademicUnderstanding => ({
  intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0, disclosureClass: "none",
  ambiguityScore: 0.1, routingSignal: "coaching_only", rawText: "", request: request(req), ...over,
});
const NO_CONTEXT: ActionContext = { session: "none", prompt: null };
// The offer /today makes: Start 15, Start 25, Something else, Later.
const START_OPTIONS = [
  { id: "a", type: "start", minutes: 15 }, { id: "b", type: "start", minutes: 25 },
  { id: "c", type: "something_else", minutes: null }, { id: "d", type: "later", minutes: null },
];
const START_PROMPT: ActionContext = { session: "none", prompt: { kind: "start", options: START_OPTIONS } };
const PAUSED: ActionContext = { session: "paused", prompt: null };

const message = (text: string, chat: Record<string, unknown> = { id: 42, type: "private" }) =>
  ({ update_id: 7, message: { message_id: 1, chat, from: { id: 42 }, text } });

// ── Transport: what kind of input is this ─────────────────────────────────────

describe("normalising a Telegram update", () => {
  it("reads a command, with or without the bot's name, and keeps its argument", () => {
    expect(normalizeTelegramUpdate(message("/today"))).toMatchObject({ kind: "command", command: "today", argument: "", chatId: "42" });
    expect(normalizeTelegramUpdate(message("/focus@nova_bot deadlocks"))).toMatchObject({ kind: "command", command: "focus", argument: "deadlocks" });
    expect(normalizeTelegramUpdate(message("/DONE"))).toMatchObject({ kind: "command", command: "done" });
    expect(parseCommand("not a command")).toBeNull();
  });

  it("reports an unknown command instead of treating it as a sentence", () => {
    expect(normalizeTelegramUpdate(message("/log bench 80x5"))).toMatchObject({ kind: "unsupported", reason: "unknown_command" });
  });

  it("everything else is text, bounded in length", () => {
    const event = normalizeTelegramUpdate(message(`bro I have 30 mins ${"x".repeat(5000)}`));
    expect(event.kind).toBe("text");
    if (event.kind === "text") expect(event.text.length).toBe(MAX_TEXT_LENGTH);
  });

  it("refuses anything that is not a private chat", () => {
    for (const type of ["group", "supergroup", "channel", undefined]) {
      expect(normalizeTelegramUpdate(message("/today", { id: -100, type }))).toMatchObject({ kind: "ignored", reason: "not_private" });
    }
    expect(normalizeTelegramUpdate({ update_id: 1, callback_query: { id: "c", data: "p:x:a", from: { id: 42 }, message: { message_id: 3, chat: { id: -5, type: "group" } } } }))
      .toMatchObject({ kind: "ignored", reason: "not_private" });
  });

  it("reads a button tap as a reference and nothing more", () => {
    const tap = { update_id: 9, callback_query: { id: "cb1", data: "p:prompt123:b", from: { id: 42 }, message: { message_id: 55, chat: { id: 42, type: "private" } } } };
    expect(normalizeTelegramUpdate(tap)).toEqual({ kind: "callback", updateId: 9, chatId: "42", fromId: "42", callbackId: "cb1", data: "p:prompt123:b", messageId: 55 });
  });

  it("drops malformed updates and oversized callback data", () => {
    for (const body of [null, 5, "x", {}, { message: 5 }, { message: { chat: {} } }, { callback_query: { id: "c", message: { chat: { id: 1, type: "private" } } } }]) {
      expect(normalizeTelegramUpdate(body).kind).toBe("ignored");
    }
    const big = { callback_query: { id: "c", data: "p:".padEnd(80, "x"), message: { chat: { id: 1, type: "private" } } } };
    expect(normalizeTelegramUpdate(big)).toMatchObject({ kind: "ignored", reason: "malformed" });
    expect(normalizeTelegramUpdate(message("   "))).toMatchObject({ kind: "unsupported", reason: "not_text" });
  });

  it("callback data round-trips and rejects anything else", () => {
    expect(decodeCallback(encodeCallback("cmabc123", "c"))).toEqual({ promptId: "cmabc123", optionId: "c" });
    for (const bad of ["", "p:only", "x:a:b", "p::a", "p:a:", "p:a:b:c", `p:${"x".repeat(50)}:a`, "start:Deadlocks:25"]) {
      expect(decodeCallback(bad)).toBeNull();
    }
    // Telegram allows 64 bytes; a prompt id is a 25-character cuid.
    expect(encodeCallback("c".repeat(25), "a").length).toBeLessThanOrEqual(64);
  });
});

// ── Understanding: the envelope is validated, never trusted ───────────────────

describe("the request envelope", () => {
  const parse = (request: unknown) => parseUnderstandingResponse(JSON.stringify({ intent: "plan_request", emotion: "neutral", request }), "x");

  it("keeps a well-formed request", () => {
    const u = parse({ clarity: "clear", action: "what_now", confidence: 0.92, availableMinutes: 30, promptAnswer: null, exam: { title: "OS", date: "2026-10-09" } });
    expect(u.request).toEqual(request({ action: "what_now", confidence: 0.92, availableMinutes: 30, exam: { title: "OS", date: "2026-10-09" } }));
    expect(u.malformed).toBeUndefined();
  });

  it("an action outside the vocabulary is no action, with no confidence", () => {
    expect(parse({ action: "delete_account", confidence: 1 }).request).toMatchObject({ action: "none", confidence: 0 });
    expect(parse({ action: "end_session", confidence: 1 }).request?.action).toBe("none");
  });

  it("drops values that are the wrong shape or out of range", () => {
    const r = parseLearnerRequest({
      action: "start_session", confidence: 7, availableMinutes: 100000, sessionOutcome: "amazing",
      deferUntil: "next year", struggleTopic: "x".repeat(500), promptAnswer: { id: "a" }, exam: { title: "OS", date: "Friday" },
    });
    // A reading that does not say it is clear is not treated as clear.
    expect(r).toEqual(request({ action: "start_session", confidence: 1, clarity: "ambiguous" }));
    expect(parseLearnerRequest({ availableMinutes: -5 }).availableMinutes).toBeNull();
    expect(parseLearnerRequest("start the session")).toEqual(request({ confidence: 0, clarity: "ambiguous" }));
    expect(parseLearnerRequest([{ action: "start_session" }])).toEqual(request({ confidence: 0, clarity: "ambiguous" }));
    expect(parseLearnerRequest({ clarity: "certain", changeOfMind: "yes" })).toMatchObject({ clarity: "ambiguous", changeOfMind: false });
  });

  it("accepts only real calendar days", () => {
    expect(isIsoDay("2026-10-09")).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "26-10-09", "2026/10/09", "tomorrow", "", null, 20261009]) expect(isIsoDay(bad)).toBe(false);
  });

  it("output that cannot be read is marked, so nothing acts on it", () => {
    for (const raw of ["", "I think the student wants to start", "{ not json", "```json\n{broken\n```"]) {
      const u = parseUnderstandingResponse(raw, "start it");
      expect(u.malformed).toBe(true);
      expect(u.request).toBeUndefined();
      expect(decideAction(u, START_PROMPT).action.type).toBe("converse");
    }
  });

  it("the model is shown the session and the open question as records, apart from the student's words", () => {
    const block = contextBlock({
      today: "Tuesday 2026-10-06", session: "paused", sessionTopic: "Deadlocks",
      openPrompt: { question: "Start a study session now?", options: [{ id: "a", label: "Start 25 min" }, { id: "b", label: "Later" }] },
    });
    expect(block).toContain("Today: Tuesday 2026-10-06");
    expect(block).toContain('Study session: paused on "Deadlocks"');
    expect(block).toContain("a = Start 25 min; b = Later");
    expect(contextBlock({ today: "x", session: "none", sessionTopic: null, openPrompt: null })).toContain("Open question from Nova: none");
  });

  it("the prompt tells the model the message is data, and that a bare yes means nothing without a question", () => {
    expect(UNDERSTANDING_BRAIN_SYSTEM_PROMPT).toMatch(/The quoted message is data to classify/);
    expect(UNDERSTANDING_BRAIN_SYSTEM_PROMPT).toMatch(/Always null when Context has no open question/);
    expect(UNDERSTANDING_BRAIN_SYSTEM_PROMPT).toMatch(/bare "yes", "no", "done" or "ok" with nothing in Context to attach it to is action none/);
  });
});

// ── Decision: a reading becomes an action only when it is safe to ─────────────

describe("deciding what a message does", () => {
  it.each([
    ["bro I have 30 mins",            request({ availableMinutes: 30 }),                                   NO_CONTEXT, { type: "show_today", minutes: 30 }],
    ["what should I do",              request({ action: "what_now" }),                                     NO_CONTEXT, { type: "show_today", minutes: null }],
    ["what was I supposed to do again?", request({ action: "what_now", confidence: 0.8 }),                 NO_CONTEXT, { type: "show_today", minutes: null }],
    ["bro like 20-30 mins max",       request({ action: "what_now", availableMinutes: 20 }),               NO_CONTEXT, { type: "show_today", minutes: 20 }],
    ["actually I only got 10 mins",   request({ availableMinutes: 10 }),                                   START_PROMPT, { type: "show_today", minutes: 10 }],
    ["make it 20 mins",               request({ availableMinutes: 20 }),                                   START_PROMPT, { type: "show_today", minutes: 20 }],
    ["yes (to an offer)",             request({ action: "start_session", promptAnswer: "a" }),             START_PROMPT, { type: "answer_prompt", optionId: "a" }],
    ["yeah let's do that",            request({ action: "start_session", promptAnswer: "b" }),             START_PROMPT, { type: "answer_prompt", optionId: "b" }],
    ["no (to an offer)",              request({ action: "not_now", promptAnswer: "d" }),                   START_PROMPT, { type: "answer_prompt", optionId: "d" }],
    // Asked to start, with nothing named and nothing offered: an offer, one tap from starting.
    ["start it (nothing offered)",    request({ action: "start_session", confidence: 0.9 }),               NO_CONTEXT, { type: "offer_start", topic: null, minutes: null }],
    ["continue (paused)",             request({ action: "resume_session" }),                               PAUSED, { type: "resume_session" }],
    ["continue (nothing paused)",     request({ action: "resume_session" }),                               NO_CONTEXT, { type: "show_today", minutes: null }],
    ["nah not today",                 request({ action: "not_now", deferUntil: "tomorrow" }),              NO_CONTEXT, { type: "defer", until: "tomorrow" }],
    ["remind me later",               request({ action: "not_now", deferUntil: "later" }),                 NO_CONTEXT, { type: "defer", until: "later" }],
    ["actually tomorrow",             request({ action: "not_now", deferUntil: "tomorrow" }),              START_PROMPT, { type: "defer", until: "tomorrow" }],
    ["tomorrow morning instead",      request({ action: "not_now", deferUntil: "tomorrow" }),              NO_CONTEXT, { type: "defer", until: "tomorrow" }],
    ["can we do something else",      request({ action: "something_else" }),                               NO_CONTEXT, { type: "something_else" }],
    ["can we skip this",              request({ action: "something_else", confidence: 0.7 }),              START_PROMPT, { type: "something_else" }],
    ["same thing?",                   request({ action: "what_now", confidence: 0.6 }),                    NO_CONTEXT, { type: "show_today", minutes: null }],
  ] as Array<[string, LearnerRequest, ActionContext, unknown]>)("%s", (_text, req, ctx, expected) => {
    expect(decideAction(reading(req), ctx).action).toEqual(expected);
  });

  it("a bare yes, no or done with nothing to attach it to does nothing but ask", () => {
    for (const word of ["yes", "no", "yeah", "done", "ok"]) {
      const decision = decideAction(reading({ action: "none", confidence: 0.2 }, { ambiguityScore: 0.9, rawText: word }), NO_CONTEXT);
      expect(decision.action).toEqual({ type: "clarify" });
      expect(decision.generate).toBe(false);
    }
  });

  it("a model that invents an answer to a question nobody asked is ignored", () => {
    expect(decideAction(reading({ promptAnswer: "a", confidence: 0.2 }, { ambiguityScore: 0.9 }), NO_CONTEXT).action.type).toBe("clarify");
    // An option id that is not on the open prompt is not an answer either.
    expect(decideAction(reading({ promptAnswer: "z", action: "none", confidence: 0.3 }, { ambiguityScore: 0.9 }), START_PROMPT).action.type).toBe("clarify");
  });

  it("'wait' is not an action", () => {
    expect(decideAction(reading({ action: "none", confidence: 0.9 }, { ambiguityScore: 0.3 }), START_PROMPT).action.type).toBe("converse");
  });

  describe("finishing a session never happens on a sentence", () => {
    const running: ActionContext = { session: "running", prompt: null };
    it.each([
      ["done",                 request({ action: "finish_session" }),                              null],
      ["I finished deadlocks", request({ action: "finish_session", confidence: 0.95 }),            null],
      ["finished but sucked",  request({ action: "finish_session", sessionOutcome: "struggled" }), "struggled"],
    ])("%s asks how it went", (_t, req, stated) => {
      expect(decideAction(reading(req), running).action).toEqual({ type: "ask_outcome", stated });
    });

    it("the answer to 'How did it go?' is what ends it", () => {
      const asked: ActionContext = { session: "running", prompt: { kind: "session_outcome", options: ["a", "b", "c", "d"].map(id => ({ id, type: "end", minutes: null })) } };
      expect(decideAction(reading({ promptAnswer: "a", sessionOutcome: "struggled" }), asked).action).toEqual({ type: "answer_prompt", optionId: "a" });
    });

    it("with no timer running, 'I did it yesterday already' is a report, not an end", () => {
      expect(decideAction(reading({ action: "finish_session" }), NO_CONTEXT).action).toEqual({ type: "acknowledge_report" });
      expect(decideAction(reading({ action: "none", sessionOutcome: "good" }), NO_CONTEXT).action.type).not.toBe("ask_outcome");
    });
  });

  describe("confidence and risk", () => {
    it("a start that is only plausible is offered, not run", () => {
      const unsure = decideAction(reading({ action: "start_session", confidence: EXECUTE_CONFIDENCE - 0.1 }, { topic: "Deadlocks" }), NO_CONTEXT);
      expect(unsure.action).toEqual({ type: "offer_start", topic: "Deadlocks", minutes: null });
      const sure = decideAction(reading({ action: "start_session", confidence: EXECUTE_CONFIDENCE, availableMinutes: 25 }, { topic: "Deadlocks" }), NO_CONTEXT);
      expect(sure.action).toEqual({ type: "start_session", topic: "Deadlocks", minutes: 25 });
    });

    it("pause needs a running session and a confident reading", () => {
      expect(decideAction(reading({ action: "pause_session" }), { session: "running", prompt: null }).action).toEqual({ type: "pause_session" });
      expect(decideAction(reading({ action: "pause_session", confidence: 0.6 }), { session: "running", prompt: null }).action).toEqual({ type: "show_status" });
      expect(decideAction(reading({ action: "pause_session" }), NO_CONTEXT).action).toEqual({ type: "show_status" });
    });

    it("starting while a session runs shows that session instead", () => {
      expect(decideAction(reading({ action: "start_session" }), { session: "running", prompt: null }).action).toEqual({ type: "show_status" });
    });

    it("an exam is proposed for confirmation, never added by the reading", () => {
      const d = decideAction(reading({ action: "what_now", availableMinutes: 30, exam: { title: "OS", date: "2026-10-07" } }, { emotion: "anxious_exam" }), NO_CONTEXT);
      expect(d.action).toEqual({ type: "show_today", minutes: 30 });
      expect(d.proposeExam).toEqual({ title: "OS", date: "2026-10-07" });
      const only = decideAction(reading({ exam: { title: "OS", date: "2026-10-09" } }), NO_CONTEXT);
      expect(only.action.type).toBe("converse");
      expect(only.proposeExam).not.toBeNull();
    });
  });

  describe("when the reply is worded by the Response Brain", () => {
    it("a plain product result is stated plainly", () => {
      expect(decideAction(reading({ action: "what_now" }), NO_CONTEXT).generate).toBe(false);
      expect(decideAction(reading({ action: "start_session" }), NO_CONTEXT).generate).toBe(false);
    });
    it("feelings and circumstances are answered by Nova, with the same action underneath", () => {
      const fucked = decideAction(reading({ action: "what_now", availableMinutes: 30 }, { emotion: "anxious_exam" }), NO_CONTEXT);
      expect(fucked.action).toEqual({ type: "show_today", minutes: 30 });
      expect(fucked.generate).toBe(true);
      const family = decideAction(reading({ action: "not_now", deferUntil: "tomorrow" }, {
        realityObservations: [{ category: "life_constraint", subtype: "family", claim: "Student has a family matter tonight", status: "active", persistence: "temporary", expectedDurationHours: 12, confidence: 0.9 }],
      }), NO_CONTEXT);
      expect(family.action).toEqual({ type: "defer", until: "tomorrow" });
      expect(family.generate).toBe(true);
    });
    it("a struggle with a topic is a conversation, and is not treated as ambiguous", () => {
      const d = decideAction(reading({ struggleTopic: "deadlocks", confidence: 0.3 }, { ambiguityScore: 0.8, emotion: "frustrated" }), NO_CONTEXT);
      expect(d.action.type).toBe("converse");
      expect(d.generate).toBe(true);
    });
  });
});

// ── Hardening: the model can be wrong, and the state stays right ──────────────
// The readings below are what the real model returned in the evaluation run
// of 2026-10-06, including the wrong ones.

describe("a wrong reading cannot change state", () => {
  const RUNNING: ActionContext = { session: "running", prompt: null };
  const STATE_CHANGING = new Set(["start_session", "pause_session", "resume_session", "answer_prompt"]);

  describe("finishing statements while a session is open", () => {
    it("'I finished deadlocks', read as a study report with no request, asks how it went", () => {
      const real = reading({ action: "none", confidence: 1 }, { intent: "study_report", emotion: "proud", topic: "Deadlocks" });
      expect(decideAction(real, RUNNING)).toMatchObject({ action: { type: "ask_outcome", stated: null }, generate: false });
      expect(decideAction(real, PAUSED).action.type).toBe("ask_outcome");
    });

    it("a report carried as a second intent asks too", () => {
      const real = reading({ action: "none" }, { intent: "emotional_vent", secondaryIntents: ["study_report"], emotion: "frustrated" });
      expect(decideAction(real, RUNNING).action.type).toBe("ask_outcome");
    });

    it("no reading of any kind ends a session: the most it does is ask", () => {
      for (const action of ["finish_session", "none", "not_now", "something_else", "status", "what_now"] as const) {
        for (const sessionOutcome of [null, "struggled", "crushed_it"] as const) {
          const d = decideAction(reading({ action, confidence: 1, sessionOutcome }, { intent: "study_report" }), RUNNING);
          expect(d.action).toEqual({ type: "ask_outcome", stated: sessionOutcome });
        }
      }
    });

    it("a struggle voiced mid-session is not a finish, even when the model attaches an outcome to it", () => {
      // "i keep fucking up deadlocks" while studying: the model returned sessionOutcome "struggled".
      const real = reading({ action: "none", confidence: 1, sessionOutcome: "struggled", struggleTopic: "Deadlocks" }, { intent: "emotional_vent", emotion: "frustrated", topic: "Deadlocks" });
      expect(decideAction(real, RUNNING).action).toEqual({ type: "converse" });
    });

    it("an explicit pause is a pause, not an end", () => {
      expect(decideAction(reading({ action: "pause_session" }, { intent: "study_report" }), RUNNING).action).toEqual({ type: "pause_session" });
    });

    it("with no session open, the same report is a conversation and ends nothing", () => {
      expect(decideAction(reading({ action: "none" }, { intent: "study_report" }), NO_CONTEXT).action.type).toBe("converse");
    });
  });

  describe("time is not a request to start", () => {
    it("'bro I have 30 mins', misread as a confident start, is offered at 30 and not started", () => {
      const real = reading({ action: "start_session", confidence: 0.9, availableMinutes: 30 }, { intent: "accountability_request", sessionIntent: "start" });
      expect(decideAction(real, NO_CONTEXT).action).toEqual({ type: "offer_start", topic: null, minutes: 30 });
    });

    it("no confidence is enough without a named topic", () => {
      for (const confidence of [0.75, 0.9, 0.99, 1]) {
        expect(decideAction(reading({ action: "start_session", confidence }), NO_CONTEXT).action.type).toBe("offer_start");
      }
    });

    it("a topic alone, or time and a topic with no start asked, starts nothing", () => {
      expect(decideAction(reading({ action: "none" }, { topic: "Deadlocks" }), NO_CONTEXT).action.type).toBe("converse");
      expect(decideAction(reading({ action: "what_now", availableMinutes: 30 }, { topic: "Deadlocks" }), NO_CONTEXT).action).toEqual({ type: "show_today", minutes: 30 });
    });

    it("a named topic with an explicit start is the one start words can make", () => {
      const real = reading({ action: "start_session", confidence: 1, availableMinutes: 25 }, { topic: "deadlocks" });
      expect(decideAction(real, NO_CONTEXT).action).toEqual({ type: "start_session", topic: "deadlocks", minutes: 25 });
    });
  });

  describe("changing an open offer is not accepting it", () => {
    it.each([
      ["make it 20 mins",             request({ action: "start_session", confidence: 0.95, availableMinutes: 20 }), 20],
      ["actually I only got 10 mins", request({ action: "something_else", confidence: 0.9, availableMinutes: 10 }), 10],
      ["actually I only got 10 mins (option c)", request({ action: "something_else", confidence: 0.9, availableMinutes: 10, promptAnswer: "c" }), 10],
      ["nah actually make it 20",     request({ action: "start_session", confidence: 0.95, availableMinutes: 20, promptAnswer: "c" }), 20],
      ["wait make that 25 (wrong option)", request({ action: "start_session", confidence: 0.9, availableMinutes: 25, promptAnswer: "a" }), 25],
      ["no wait make it 40 and start", request({ action: "start_session", confidence: 0.95, availableMinutes: 40 }), 40],
    ] as Array<[string, LearnerRequest, number]>)("%s re-offers at that length", (_t, req, minutes) => {
      expect(decideAction(reading(req), START_PROMPT).action).toEqual({ type: "show_today", minutes });
    });

    it("accepting an option at its own length is still an answer", () => {
      const real = reading({ action: "start_session", confidence: 1, availableMinutes: 15, promptAnswer: "a" });
      expect(decideAction(real, START_PROMPT).action).toEqual({ type: "answer_prompt", optionId: "a" });
    });

    it("a start that names its topic is its own request, whatever is on offer", () => {
      const real = reading({ action: "start_session", confidence: 1, availableMinutes: 25 }, { topic: "deadlocks" });
      expect(decideAction(real, START_PROMPT).action.type).toBe("start_session");
    });
  });

  describe("'not today' quiets Nova for the day", () => {
    it("typed against an offer whose only decline is Later, it is still 'not today'", () => {
      const real = reading({ action: "not_now", confidence: 1, deferUntil: "tomorrow", promptAnswer: "d" });
      expect(decideAction(real, START_PROMPT).action).toEqual({ type: "defer", until: "tomorrow" });
    });
    it("'later' against the same offer is the Later option", () => {
      const real = reading({ action: "not_now", confidence: 1, deferUntil: "later", promptAnswer: "d" });
      expect(decideAction(real, START_PROMPT).action).toEqual({ type: "answer_prompt", optionId: "d" });
    });
  });

  describe("noise, ambiguity and unsupported requests", () => {
    it("an unintelligible reading does nothing but ask, whatever else the model filled in", () => {
      const noise = reading(
        { clarity: "unintelligible", action: "start_session", confidence: 1, availableMinutes: 92837 % 600, promptAnswer: "a",
          struggleTopic: "asdf", exam: { title: "OS", date: "2026-10-09" }, sessionOutcome: "crushed_it" },
        { topic: "deadlocks", intent: "study_report" },
      );
      for (const ctx of [NO_CONTEXT, START_PROMPT, RUNNING, PAUSED]) {
        expect(decideAction(noise, ctx)).toEqual({ action: { type: "clarify" }, proposeExam: null, generate: false, reason: "unintelligible" });
      }
    });

    it("safeReading leaves nothing of an unintelligible reading for evidence to be built from", () => {
      const noise = reading(
        { clarity: "unintelligible", action: "start_session", struggleTopic: "asdf", exam: { title: "OS", date: "2026-10-09" }, sessionOutcome: "good", availableMinutes: 30 },
        { topic: "deadlocks", intent: "study_report", emotion: "distressed", sessionIntent: "start", secondaryIntents: ["mastery_claim"],
          realityObservations: [{ category: "health", subtype: "illness", claim: "x", status: "active", persistence: "temporary", expectedDurationHours: null, confidence: 1 }] },
      );
      const safe = safeReading(noise, { today: "2026-10-06" });
      expect(safe).toMatchObject({ intent: "general_chat", emotion: "neutral", topic: null, sessionIntent: "none", secondaryIntents: [], realityObservations: [] });
      expect(safe.request).toMatchObject({ clarity: "unintelligible", action: "none", struggleTopic: null, exam: null, sessionOutcome: null, availableMinutes: null, promptAnswer: null });
      // …and so no topic_struggle signal either.
      const signals = resolveTurnSignals({ text: "asdfghjkl deadlocks", command: null, understanding: safe, state: {} as never });
      expect(signals.detectedSignals).toEqual([]);
    });

    it("an ambiguous or unsupported reading keeps the feeling and drops everything it could act or record on", () => {
      for (const clarity of ["ambiguous", "unsupported"] as const) {
        const safe = safeReading(reading(
          { clarity, action: "start_session", availableMinutes: 30, struggleTopic: "deadlocks", exam: { title: "OS", date: "2026-10-09" }, sessionOutcome: "good" },
          { emotion: "overwhelmed", topic: "deadlocks", sessionIntent: "start" },
        ), { today: "2026-10-06" });
        expect(safe.emotion).toBe("overwhelmed");
        expect(safe.sessionIntent).toBe("none");
        expect(safe.request).toMatchObject({ clarity, action: "none", availableMinutes: null, struggleTopic: null, exam: null, sessionOutcome: null });
      }
    });

    it("an ambiguous reading never runs anything, even with an option picked", () => {
      const vague = reading({ clarity: "ambiguous", action: "start_session", confidence: 1, promptAnswer: "a", availableMinutes: 25 }, { topic: "deadlocks" });
      for (const ctx of [NO_CONTEXT, START_PROMPT, RUNNING, PAUSED]) {
        expect(STATE_CHANGING.has(decideAction(vague, ctx).action.type)).toBe(false);
      }
      expect(decideAction(vague, START_PROMPT).action).toEqual({ type: "clarify" });
    });

    it("an unsupported request is told so, and nothing runs", () => {
      const weather = reading({ clarity: "unsupported", action: "something_else", confidence: 0.8 });
      expect(decideAction(weather, START_PROMPT)).toMatchObject({ action: { type: "unsupported" }, generate: false, proposeExam: null });
    });

    it("an exam in the past or more than a year out is dropped before anything sees it", () => {
      const at = (date: string) => safeReading(reading({ exam: { title: "OS", date } }), { today: "2026-10-06" }).request?.exam;
      expect(at("2026-10-05")).toBeNull();
      expect(at("2028-01-01")).toBeNull();
      expect(at("2026-10-06")).toEqual({ title: "OS", date: "2026-10-06" });
    });
  });

  describe("a message that takes itself back", () => {
    it("'start deadlocks for 30 but don't start yet' starts nothing", () => {
      const held = reading({ action: "start_session", confidence: 0.95, availableMinutes: 30, changeOfMind: true }, { topic: "deadlocks" });
      expect(decideAction(held, NO_CONTEXT).action).toEqual({ type: "offer_start", topic: null, minutes: 30 });
    });

    it("no state-changing action survives a change of mind, in any context, with any option picked", () => {
      for (const action of ["start_session", "pause_session", "resume_session", "finish_session", "not_now", "none"] as const) {
        for (const ctx of [NO_CONTEXT, START_PROMPT, RUNNING, PAUSED]) {
          const d = decideAction(reading({ action, confidence: 1, changeOfMind: true, promptAnswer: "a", sessionOutcome: "good" }, { topic: "deadlocks", intent: "study_report" }), ctx);
          expect(STATE_CHANGING.has(d.action.type)).toBe(false);
          expect(d.action).not.toEqual({ type: "defer", until: "tomorrow" });
        }
      }
    });
  });

  it("several things in one message are each handled by their own rule", () => {
    // "I've got 30 mins, start deadlocks, I'm exhausted and my OS exam is Friday"
    const d = decideAction(reading(
      { action: "start_session", confidence: 0.95, availableMinutes: 30, exam: { title: "OS", date: "2026-10-09" } },
      { topic: "deadlocks", emotion: "overwhelmed" },
    ), NO_CONTEXT);
    expect(d.action).toEqual({ type: "start_session", topic: "deadlocks", minutes: 30 });   // explicit, named
    expect(d.proposeExam).toEqual({ title: "OS", date: "2026-10-09" });                     // offered, never added
    expect(d.generate).toBe(true);                                                          // the feeling is answered
  });

  it("the decision is made of preconditions, with confidence only as a floor", () => {
    const source = readFileSync(join(resolve(__dirname, ".."), "decision/action-decision.ts"), "utf8");
    // Confidence is read in two places only: the floor under an explicit request, and the floor under a read-only one.
    expect(source.split("req.confidence").length - 1).toBe(2);
    expect(source).not.toMatch(/import .*prisma|generateOpenAIText|rawText/);
  });
});

// ── Evidence: a stated struggle is an observation, not a fact ─────────────────

describe("'I keep messing up deadlocks'", () => {
  const now = new Date("2026-10-06T10:00:00Z");
  const struggle = (over: Record<string, unknown> = {}) => ({
    companion: "nova" as const, userId: "u1", profileId: "p1", observedAt: now, sourceMessageId: "m1", sourceText: "I keep messing up deadlocks",
    kind: "signal" as const, source: "signal_engine" as const, confidence: 0.85, signalType: "topic_struggle" as const,
    intensity: 0.75, corroborated: true, topic: "deadlocks", ...over,
  });
  const run = (evidence: unknown[], over: Record<string, unknown> = {}) => consolidate({
    evidence: evidence as never, now, patternScanRan: false, hasActiveSession: false,
    state: { facts: [], realities: [], patterns: [], investigation: null, recentSessions: [], ...over },
    ...("hasActiveSession" in over ? { hasActiveSession: over["hasActiveSession"] as boolean } : {}),
  });

  it("the Understanding Brain's reading establishes the signal; there is no wording pattern for it", () => {
    const signals = resolveTurnSignals({
      text: "bro deadlocks again", command: null,
      understanding: reading({ struggleTopic: "deadlocks" }),
      state: {} as never,
    });
    expect(signals.detectedSignals.map(s => s.type)).toContain("topic_struggle");
    const none = resolveTurnSignals({ text: "I keep fucking up deadlocks", command: null, understanding: reading(), state: {} as never });
    expect(none.detectedSignals.map(s => s.type)).not.toContain("topic_struggle");
  });

  it("becomes one soft mastery observation and nothing else", () => {
    const decisions = run([struggle()]);
    expect(decisions).toEqual([expect.objectContaining({
      action: "UPDATE", target: "academic_observation", reason: "struggle_observation",
      write: { target: "academic_observation", op: "mastery_observation", topic: "deadlocks", confidence: STRUGGLE_REPORTED_MASTERY },
    })]);
    // No permanent "this student is bad at deadlocks", no behavioural pattern.
    expect(decisions.some(d => d.target === "user_fact" || d.target === "behavioral_pattern")).toBe(false);
  });

  it.each([
    ["no topic was named",                struggle({ topic: null }),        {},                                        "no_topic_named"],
    ["the reading was weak",              struggle({ confidence: 0.3 }),    {},                                        "insufficient_confidence"],
    ["a session is running (it owns it)", struggle(),                       { hasActiveSession: true },                "owned_by_active_session"],
    ["it was already said today",         struggle(),                       { recentlyObservedTopics: ["deadlocks"] }, "topic_already_observed_today"],
  ])("is ignored when %s", (_name, e, over, reason) => {
    expect(run([e], over)).toEqual([expect.objectContaining({ action: "IGNORE", reason })]);
  });
});

// ── Replies: plain statements of what the engines decided ─────────────────────

describe("replies", () => {
  const action: TodayAction = { topicName: "Deadlocks", subjectName: "Operating Systems", activityType: "review", durationMinutes: 25, urgency: "high", reasons: ["exam in 1 day", "mastery 32%", "third"], rationale: "" };
  const view = { availableMinutes: 30, recommendation: action, alternatives: [{ ...action, topicName: "Paging" }], nextDeadline: { title: "OS final", daysUntil: 1 }, constraints: [] } as unknown as NovaTodayReady;

  it("offers only the session lengths that fit the time the learner has", () => {
    expect(startLengths(null)).toEqual([15, 25, 45]);
    expect(startLengths(30)).toEqual([15, 25]);
    expect(startLengths(12)).toEqual([12]);
    expect(startLengths(5)).toEqual([]);
  });

  it("a recommendation shows at most two reasons and carries its buttons' actions on the server side", () => {
    const reply = recommendationReply(view, action);
    expect(reply.text).toContain("Deadlocks (Operating Systems)");
    expect(reply.text).toContain("Why: exam in 1 day, mastery 32%.");
    expect(reply.text).not.toContain("third");
    expect(reply.text).toContain("OS final: tomorrow.");
    expect(reply.prompt?.options.map(o => o.label)).toEqual(["Start 15 min", "Start 25 min", "Something else", "Later"]);
    expect(reply.prompt?.options[1]?.action).toEqual({ type: "start", topicName: "Deadlocks", subjectName: "Operating Systems", minutes: 25 });
    expect(new Set(reply.prompt?.options.map(o => o.id)).size).toBe(4);
  });

  it("what to start comes from the plan; a topic the plan lacks has no subject", () => {
    expect(pickStart(view, null)).toBe(action);
    expect(pickStart(view, "paging")).toMatchObject({ topicName: "Paging" });
    expect(pickStart(view, "operating systems")).toBe(action);
    expect(pickStart(view, "Graph theory")).toEqual({ topicName: "Graph theory", subjectName: null, durationMinutes: null });
  });

  it("asks how it went with the four answers, the stated one first", () => {
    const reply = outcomeReply("Deadlocks", "struggled");
    expect(reply.prompt?.kind).toBe("session_outcome");
    expect(reply.prompt?.options.map(o => o.action)).toEqual([
      { type: "end", outcome: "struggled" }, { type: "end", outcome: "okay" }, { type: "end", outcome: "good" }, { type: "end", outcome: "crushed_it" },
    ]);
  });

  it("says what was logged and claims nothing about Knowledge when nothing changed there", () => {
    expect(endedReply({ topicName: "Deadlocks", minutes: 27, outcome: "struggled", topicRecorded: true }).text)
      .toBe("Logged: 27 min on Deadlocks. Struggled. It comes back for review tomorrow.");
    expect(endedReply({ topicName: "Stuff", minutes: 12, outcome: "good", topicRecorded: false }).text).toContain("nothing changed in Knowledge");
  });

  it("an exam offer joins the existing buttons instead of replacing them", () => {
    const offer  = { title: "OS", subjectName: "Operating Systems", date: "2026-10-07" };
    const merged = withExamOffer(recommendationReply(view, action), offer);
    expect(merged.prompt?.options.at(-1)?.action).toEqual({ type: "add_exam", ...offer });
    expect(merged.prompt?.options.length).toBe(5);
    expect(withExamOffer({ text: "ok" }, offer).prompt?.kind).toBe("confirm_exam");
  });

  describe("which exam may be offered", () => {
    const subjects = [{ id: "s-os", name: "Operating Systems", code: "CS301" }, { id: "s-db", name: "Databases", code: null }];
    const upcoming = [{ subjectId: "s-os", scheduledAt: new Date("2026-10-07T09:00:00Z") }];

    it("does not offer to add an exam Nova already has, however the learner names it", () => {
      for (const title of ["operating systems", "OS", "OS exam", "my os final", "CS301"]) {
        expect(examToOffer({ title, date: "2026-10-07" }, subjects, upcoming)).toBeNull();
      }
    });

    it("'exam is tomorrow' names no subject, so nothing is offered and no second exam can be made", () => {
      for (const title of ["exam", "Exam", "my exam", "the test", "final"]) {
        expect(examToOffer({ title, date: "2026-10-07" }, subjects, upcoming)).toBeNull();
        expect(examToOffer({ title, date: "2026-10-20" }, subjects, [])).toBeNull();
      }
    });

    it("offers an exam for a subject of theirs that has none on that day, filed under that subject", () => {
      expect(examToOffer({ title: "Databases", date: "2026-10-07" }, subjects, upcoming))
        .toEqual({ title: "Databases", subjectName: "Databases", date: "2026-10-07" });
      expect(examToOffer({ title: "OS exam", date: "2026-10-20" }, subjects, upcoming))
        .toEqual({ title: "OS exam", subjectName: "Operating Systems", date: "2026-10-20" });
    });

    it("a title that names two subjects, or a subject they do not take, is not offered", () => {
      expect(examToOffer({ title: "OS and Databases", date: "2026-10-20" }, subjects, [])).toBeNull();
      expect(examToOffer({ title: "Chemistry", date: "2026-10-20" }, subjects, [])).toBeNull();
      expect(examToOffer({ title: "OS", date: "next friday" }, subjects, [])).toBeNull();
    });
  });

  it("every prompt kind expires", () => {
    for (const minutes of Object.values(PROMPT_TTL_MINUTES)) expect(minutes).toBeGreaterThan(0);
    expect(PROMPT_TTL_MINUTES.clarify).toBeLessThanOrEqual(15);
  });
});

// ── Time ──────────────────────────────────────────────────────────────────────

describe("'Not today' lasts until the learner's own midnight", () => {
  it("uses the learner's timezone", () => {
    // 21:30 in Kolkata is 16:00 UTC; midnight there is 18:30 UTC.
    expect(nextLocalMidnight(new Date("2026-10-06T16:00:00Z"), "Asia/Kolkata").toISOString()).toBe("2026-10-06T18:30:00.000Z");
  });
  it("is right across a daylight-saving change", () => {
    // Europe/Berlin leaves summer time on 2026-10-25: that day is 25 hours long.
    expect(nextLocalMidnight(new Date("2026-10-25T10:00:00Z"), "Europe/Berlin").toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(nextLocalMidnight(new Date("2026-10-24T10:00:00Z"), "Europe/Berlin").toISOString()).toBe("2026-10-24T22:00:00.000Z");
  });
});

// ── Proactive: silence is the default ─────────────────────────────────────────

describe("the proactive decision", () => {
  const now = new Date("2026-10-06T13:00:00Z");
  const facts = (over: Partial<ProactiveFacts> = {}): ProactiveFacts => ({
    localDay: "2026-10-06", localHour: 18, window: { from: 18, to: 21, basis: "stated" },
    studiedToday: false, daysSinceLastSession: 1, lastSessionDay: "2026-10-05",
    exams: [], reviewDueCount: 0, hasPlan: true, ...over,
  });
  const gates = (over: Partial<ProactiveGates> = {}): ProactiveGates => ({
    proactiveEnabled: true, paused: false, undeliverable: false, hasTimezone: true, activeSession: false,
    messagedRecently: false, sentToday: [], lastSentAt: null, realityCategories: [], now, ...over,
  });

  it("produces every reason that holds, each with a stable occurrence", () => {
    const all = generateCandidates(facts({ exams: [{ id: "e1", title: "OS final", daysUntil: 1 }, { id: "e2", title: "DB", daysUntil: 9 }], reviewDueCount: 3, daysSinceLastSession: 3, lastSessionDay: "2026-10-03" }));
    expect(all.map(c => [c.type, c.occurrenceKey])).toEqual([
      ["exam_countdown", "exam:e1:2026-10-06"],
      ["missed_plan_recovery", "recovery:2026-10-03"],
      ["review_due", "review:2026-10-06"],
      ["daily_nudge", "nudge:2026-10-06"],
    ]);
  });

  it("with nothing on record to speak about, says nothing", () => {
    expect(decideProactive(facts({ hasPlan: false }), gates())).toEqual({ chosen: null, suppressed: [] });
    expect(generateCandidates(facts({ studiedToday: true }))).toEqual([]);
    // An exam four days out is not yet a countdown; a lapse of eight days is past recovery.
    expect(generateCandidates(facts({ hasPlan: false, exams: [{ id: "e", title: "x", daysUntil: 4 }], daysSinceLastSession: 8 }))).toEqual([]);
  });

  it("picks the most important eligible reason", () => {
    const f = facts({ exams: [{ id: "e1", title: "OS final", daysUntil: 1 }], reviewDueCount: 2 });
    expect(decideProactive(f, gates()).chosen?.type).toBe("exam_countdown");
    expect(decideProactive(facts({ reviewDueCount: 2 }), gates()).chosen?.type).toBe("review_due");
    expect(decideProactive(facts(), gates()).chosen?.type).toBe("daily_nudge");
  });

  it("a blocked reason does not hide a valid one", () => {
    // The exam countdown already went out today; the review is still worth one message.
    const f = facts({ exams: [{ id: "e1", title: "OS final", daysUntil: 1 }], reviewDueCount: 2 });
    const d = decideProactive(f, gates({ sentToday: [{ type: "exam_countdown", at: new Date("2026-10-06T04:00:00Z") }], lastSentAt: new Date("2026-10-06T04:00:00Z") }));
    expect(d.chosen?.type).toBe("review_due");
    expect(d.suppressed).toContainEqual({ type: "exam_countdown", reason: "already_sent_today" });
  });

  it.each([
    ["nudges are off",               { proactiveEnabled: false }, "proactive_disabled"],
    ["the chat cannot be reached",   { undeliverable: true },     "chat_undeliverable"],
    ["there is no timezone",         { hasTimezone: false },      "timezone_unknown"],
    ["the learner said not today",   { paused: true },            "paused_by_learner"],
    ["a session is running",         { activeSession: true },     "session_running"],
    ["they are talking to Nova now", { messagedRecently: true },  "learner_active_in_chat"],
    ["they are ill",                 { realityCategories: ["health"] }, "health_constraint"],
    ["the last one was an hour ago", { lastSentAt: new Date("2026-10-06T12:00:00Z"), sentToday: [{ type: "review_due", at: new Date("2026-10-06T12:00:00Z") }] }, "too_soon_after_last"],
  ])("says nothing when %s", (_name, over, reason) => {
    const f = facts({ exams: [{ id: "e1", title: "OS final", daysUntil: 0 }], reviewDueCount: 5 });
    expect(decideProactive(f, gates(over))).toEqual({ chosen: null, suppressed: [{ type: "all", reason }] });
  });

  it("never more than two a day", () => {
    const sentToday = Array.from({ length: MAX_PER_DAY }, (_, i) => ({ type: i ? "review_due" : "exam_countdown", at: new Date("2026-10-06T03:00:00Z") }));
    const f = facts({ exams: [{ id: "e9", title: "Another", daysUntil: 1 }] });
    expect(decideProactive(f, gates({ sentToday, lastSentAt: new Date("2026-10-06T03:00:00Z") })).suppressed).toEqual([{ type: "all", reason: "daily_cap" }]);
  });

  it("quiet hours hold whatever is due", () => {
    for (const hour of [23, 0, 3, 6]) {
      expect(isQuietHour(hour)).toBe(true);
      expect(decideProactive(facts({ localHour: hour, exams: [{ id: "e", title: "x", daysUntil: 0 }] }), gates()).suppressed[0]?.reason).toBe("quiet_hours");
    }
    expect(isQuietHour(7)).toBe(false);
    expect(isQuietHour(22)).toBe(false);
  });

  it("study pressure waits for the learner's window, and is a window, not a minute", () => {
    for (const hour of [18, 19, 20]) expect(decideProactive(facts({ localHour: hour }), gates()).chosen?.type).toBe("daily_nudge");
    for (const hour of [9, 17, 21]) expect(decideProactive(facts({ localHour: hour }), gates()).chosen).toBeNull();
  });

  it("a family matter stops study pressure but not an exam countdown", () => {
    const g = gates({ realityCategories: ["life_constraint"] });
    expect(decideProactive(facts({ reviewDueCount: 4 }), g).chosen).toBeNull();
    expect(decideProactive(facts({ reviewDueCount: 4, exams: [{ id: "e", title: "OS", daysUntil: 2 }] }), g).chosen?.type).toBe("exam_countdown");
  });

  it("one push to study a day, and none once they have studied", () => {
    const nudged = gates({ sentToday: [{ type: "daily_nudge", at: new Date("2026-10-06T05:00:00Z") }], lastSentAt: new Date("2026-10-06T05:00:00Z") });
    expect(decideProactive(facts({ reviewDueCount: 3 }), nudged).chosen).toBeNull();
    expect(decideProactive(facts({ studiedToday: true, reviewDueCount: 3 }), gates()).chosen).toBeNull();
  });

  it("a lapse is mentioned once, keyed by the last day studied", () => {
    const day3 = generateCandidates(facts({ localDay: "2026-10-06", daysSinceLastSession: 3, lastSessionDay: "2026-10-03" }));
    const day4 = generateCandidates(facts({ localDay: "2026-10-07", daysSinceLastSession: 4, lastSessionDay: "2026-10-03" }));
    const key = (cs: typeof day3) => cs.find(c => c.type === "missed_plan_recovery")?.occurrenceKey;
    expect(key(day3)).toBe("recovery:2026-10-03");
    expect(key(day4)).toBe(key(day3));
  });

  it("the study window comes from their sessions, then their word, then a default that claims nothing", () => {
    expect(studyWindow({ dnaWindow: { from: 17, to: 21 }, statedPreference: "morning" })).toEqual({ from: 17, to: 20, basis: "learning_dna" });
    expect(studyWindow({ dnaWindow: null, statedPreference: "Morning" })).toEqual({ from: 9, to: 12, basis: "stated" });
    expect(studyWindow({ dnaWindow: null, statedPreference: "whenever" })).toEqual({ from: 17, to: 20, basis: "default" });
  });
});

describe("proactive wording", () => {
  const input = { type: "exam_countdown" as const, studentName: "Asha", facts: ["OS final is tomorrow", "Recommended now: Deadlocks (Operating Systems), 25 min"], register: "serious" as const, operatingStyle: [], hasStartButton: true };

  it("sends the facts as a plain line when the model is down", async () => {
    const out = await wordProactiveMessage(input, async () => { throw new Error("503"); });
    expect(out).toEqual({ text: proactiveFallback(input), generated: false });
    expect(out.text).toBe("Exam check. OS final is tomorrow. Recommended now: Deadlocks (Operating Systems), 25 min.");
  });

  it("gives the model only the facts, the register and the instruction", async () => {
    let seen = { system: "", prompt: "" };
    const out = await wordProactiveMessage(input, async req => { seen = { system: req.systemInstruction ?? "", prompt: req.prompt }; return "  OS final is tomorrow. 25 minutes on deadlocks is the move.  "; });
    expect(out).toEqual({ text: "OS final is tomorrow. 25 minutes on deadlocks is the move.", generated: true });
    expect(seen.system).toContain("- OS final is tomorrow");
    expect(seen.prompt).toContain(registerLine("serious"));
    expect(seen.prompt).toContain("A Start button is attached");
  });

  it("takes the reply out of JSON if the model answers in its conversation format, and falls back on junk", async () => {
    expect((await wordProactiveMessage(input, async () => '{"reply":"Exam tomorrow.","confidence":0.9}')).text).toBe("Exam tomorrow.");
    expect((await wordProactiveMessage(input, async () => "{broken")).generated).toBe(false);
    expect((await wordProactiveMessage(input, async () => "   ")).generated).toBe(false);
  });
});

// ── Register: how, never what ─────────────────────────────────────────────────

describe("register", () => {
  const base = { emotion: "neutral" as const, daysUntilNextExam: null, activeReality: [], accountability: "hard" as const };
  it("is playful only for a student who asked to be pushed, when nothing serious is going on", () => {
    expect(chooseRegister(base)).toBe("playful");
    expect(chooseRegister({ ...base, accountability: null })).toBe("steady");
    expect(chooseRegister({ ...base, accountability: "soft" })).toBe("steady");
  });
  it.each([
    ["distress",        { emotion: "distressed" as const }],
    ["self-doubt",      { emotion: "self_doubt" as const }],
    ["exam anxiety",    { emotion: "anxious_exam" as const }],
    ["a family matter", { activeReality: ["life_constraint"] }],
    ["illness",         { activeReality: ["health"] }],
    ["an exam in two days", { daysUntilNextExam: 2 }],
  ])("%s makes it serious whatever the student asked for", (_name, over) => {
    expect(chooseRegister({ ...base, ...over })).toBe("serious");
  });
  it("the line for the model never licenses teasing the person", () => {
    expect(registerLine("serious")).toMatch(/No jokes/);
    expect(registerLine("playful")).toMatch(/never about them, their ability or their worth/);
  });
});

// ── Delivery: what Telegram's answer means ────────────────────────────────────

describe("classifying a failed send", () => {
  it("knows a blocked bot from a rate limit from an outage", () => {
    expect(classifySendFailure(403, { description: "Forbidden: bot was blocked by the user" }).kind).toBe("blocked");
    expect(classifySendFailure(400, { description: "Bad Request: chat not found" }).kind).toBe("blocked");
    expect(classifySendFailure(429, { parameters: { retry_after: 17 } })).toMatchObject({ kind: "rate_limited", retryAfterSeconds: 17 });
    expect(classifySendFailure(502, {}).kind).toBe("server");
    expect(classifySendFailure(400, { description: "Bad Request: message is too long" }).kind).toBe("bad_request");
  });
});

// ── Architecture: held by reading the source ──────────────────────────────────

describe("Telegram is a surface, not a second Nova", () => {
  const NOVA = resolve(__dirname, "..");
  const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name.startsWith("__") ? [] : walk(full);
    return name.endsWith(".ts") ? [full] : [];
  });
  const FILES = walk(NOVA).map(full => ({ path: relative(NOVA, full).split(sep).join("/"), src: readFileSync(full, "utf8") }));
  const telegram = FILES.filter(f => f.path.startsWith("telegram/"));
  const code = (src: string) => src.replace(/\/\/.*$/gm, "");
  const writers = (model: string) => FILES
    .filter(f => new RegExp(`\\b(prisma|tx|db)\\.${model}\\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\\b`).test(f.src))
    .map(f => f.path).sort();

  it("finds the Telegram modules", () => {
    expect(telegram.map(f => f.path).sort()).toEqual([
      "telegram/channel-store.ts", "telegram/prompt-store.ts", "telegram/telegram-actions.ts", "telegram/telegram-client.ts",
      "telegram/telegram-event.ts", "telegram/telegram-link.ts", "telegram/telegram-replies.ts", "telegram/telegram-turn.ts",
      "telegram/telegram.types.ts",
    ]);
  });

  it("no Telegram module reads meaning with a pattern, and none calls a model itself", () => {
    for (const f of [...telegram, ...FILES.filter(f => f.path === "decision/action-decision.ts" || f.path === "decision/proactive-decision.ts" || f.path === "decision/register.ts")]) {
      expect([f.path, /\.test\(|\.match\(|\.search\(|new RegExp|=\s*\/[^/\n*][^\n]*\/[gimsu]*[;,)]/.test(f.src)]).toEqual([f.path, false]);
      expect([f.path, /generateOpenAIText|openai\.service/.test(f.src)]).toEqual([f.path, false]);
    }
  });

  it("free text has one reader: the Understanding Brain, called once per turn", () => {
    const turn = code(FILES.find(f => f.path === "telegram/telegram-turn.ts")!.src);
    expect(turn.match(/runUnderstandingBrain\)\(/g)).toHaveLength(1);
    expect(turn).not.toMatch(/runDisambiguationPass|translateNovaCommand/);
    // The orchestrator does not read the message again when it is handed a reading.
    const orch = code(FILES.find(f => f.path === "nova-orchestrator.ts")!.src);
    expect(orch).toMatch(/input\.understanding \?\? await runUnderstandingBrain\(/);
    expect(orch).toMatch(/if \(!input\.understanding && understanding\.ambiguityScore/);
  });

  it("keeps nothing between updates in process memory", () => {
    for (const f of telegram) expect([f.path, /new Map\(|new Set<string>\(\)|setTimeout\(|setInterval\(/.test(code(f.src))]).toEqual([f.path, false]);
  });

  it("writes no learner state: sessions, mastery, facts, reality and patterns keep their one owner", () => {
    const owned = /\b(prisma|tx|db)\.(novaStudySession|novaTopicMastery|novaTopicMasterySnapshot|novaLearningDNA|userFact|userReality|behavioralPattern|novaCognitiveState|companionMessage|novaNote)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/;
    for (const f of telegram) expect([f.path, owned.test(f.src)]).toEqual([f.path, false]);
    const actions = FILES.find(f => f.path === "telegram/telegram-actions.ts")!.src;
    expect(actions).toMatch(/runNovaSessionCommand\(/);
    expect(actions).not.toMatch(/@repo\/db\/client/);
  });

  it("each Telegram table has one writer", () => {
    expect(writers("novaTelegramPrompt")).toEqual(["telegram/prompt-store.ts"]);
    expect(writers("novaTelegramChannel")).toEqual(["telegram/channel-store.ts"]);
    expect(writers("novaProactiveMessage")).toEqual(["proactive/proactive-outbox.ts"]);
    expect(writers("novaExam")).toEqual(["onboarding/nova-onboarding-persistence.ts", "product/exams.ts"]);
  });

  it("a turn that hands session commands to the surface starts and ends nothing itself", () => {
    const persistence = FILES.find(f => f.path === "persistence/nova-persistence.ts")!.src;
    const lifecycle = persistence.slice(persistence.indexOf("function sessionLifecycle"), persistence.indexOf("// ── Session end from a command surface"));
    const handled = lifecycle.slice(lifecycle.indexOf("if (input.commandsHandled)"), lifecycle.indexOf("const hasStudyReport"));
    expect(handled).toMatch(/return \{ tasks, ended \};/);
    expect(handled).not.toMatch(/openStudySession|endStudySession|pauseStudySession|resumeStudySession|closeStudySession/);
  });

  it("the proactive tick claims before it words or sends, and logs a message only once it is sent", () => {
    const cron = code(FILES.find(f => f.path === "proactive/nova-proactive-cron.ts")!.src);
    expect(cron.indexOf("claimOccurrence(")).toBeLessThan(cron.indexOf("return deliver(row"));
    const deliver = cron.slice(cron.indexOf("async function deliver("));
    expect(deliver.indexOf("markReady(")).toBeLessThan(deliver.indexOf("beginSend("));
    expect(deliver.indexOf("beginSend(")).toBeLessThan(deliver.indexOf("client.sendMessage("));
    expect(deliver.indexOf("markSent(")).toBeLessThan(deliver.indexOf("saveAssistantMessage("));
    expect(cron).not.toMatch(/"UTC"|Asia\/Kolkata|getHours\(\)|getDay\(\)/);
  });
});
