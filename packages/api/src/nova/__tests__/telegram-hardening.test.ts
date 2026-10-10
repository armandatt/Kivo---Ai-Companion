// Hardening rules found in real use of Nova on Telegram. No database; the
// end-to-end proof of each is nova-hardening.itest.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLearnerRequest } from "../brains/understanding-parser";
import { UNDERSTANDING_BRAIN_SYSTEM_PROMPT } from "../brains/prompts/understanding-brain.prompt";
import { NOVA_STATIC_LAYER } from "../brains/prompts/nova-static-layer.prompt";
import { decideAction, type ActionContext } from "../decision/action-decision";
import { safeReading } from "../decision/interpretation-safety";
import { registerLine, chooseRegister } from "../decision/register";
import { buildExecutionReport, sessionEvidence, COUNTED_SESSION_MINUTES } from "../engines/study-session-engine";
import { kindOf } from "../interaction/semantics";
import { endedReply, clarifyReply, TEXT } from "../telegram/telegram-replies";
import { slowestStage, SLOW_STAGE_MS, type TurnTimings } from "../telegram/telegram.types";
import { attemptTimeoutMs, mayWait, MIN_ATTEMPT_MS } from "../../services/llmProviders";
import type { AcademicUnderstanding } from "../types/understanding.types";
import type { SessionContext } from "../types/session.types";

const read = (file: string) => readFileSync(join(__dirname, "..", file), "utf8");

const reading = (request: Record<string, unknown>, over: Partial<AcademicUnderstanding> = {}): AcademicUnderstanding => ({
  intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0, disclosureClass: "none",
  ambiguityScore: 0.1, routingSignal: "coaching_only", rawText: "", secondaryIntents: [], realityObservations: [],
  request: parseLearnerRequest({ clarity: "clear", confidence: 0.9, ...request }),
  ...over,
});
const NONE: ActionContext = { session: "none", prompt: null };
const decide = (u: AcademicUnderstanding, ctx: ActionContext = NONE) => decideAction(safeReading(u, { today: "2026-10-08" }), ctx);

// ── No fake side effects ──────────────────────────────────────────────────────

describe("a reminder request", () => {
  it("is part of the closed vocabulary the reading may use", () => {
    expect(parseLearnerRequest({ action: "set_reminder", confidence: 0.9 }).action).toBe("set_reminder");
    expect(UNDERSTANDING_BRAIN_SYSTEM_PROMPT).toContain("set_reminder = asks Nova to remind, alert, ping, wake or message them at a later time or date");
    expect(UNDERSTANDING_BRAIN_SYSTEM_PROMPT).toContain("never not_now");
    expect(UNDERSTANDING_BRAIN_SYSTEM_PROMPT).toContain("never commitment_made or study_report");
  });

  it("decides the one action that creates nothing, and is never worded by the model", () => {
    const d = decide(reading({ action: "set_reminder" }));
    expect(d.action).toEqual({ type: "reminder_unavailable" });
    expect(d.generate).toBe(false);
    expect(d.proposeExam).toBeNull();
  });

  it("stays that, whatever else the model read into the same message", () => {
    const cases = [
      reading({ action: "set_reminder", deferUntil: "tomorrow" }),
      reading({ action: "set_reminder", availableMinutes: 8 }),
      reading({ action: "set_reminder", availableMinutes: 20, availableMinutesMax: 30 }),
      reading({ action: "set_reminder", exam: { title: "OS", date: "2026-10-09" } }),
      reading({ action: "set_reminder", confidence: 0.2 }),
      reading({ action: "set_reminder", changeOfMind: true }),
      reading({ action: "set_reminder" }, { emotion: "overwhelmed" }),
      reading({ action: "set_reminder" }, { intent: "commitment_made", topic: "Deadlocks" }),
    ];
    for (const u of cases) {
      const d = decide(u);
      expect(d.action.type).toBe("reminder_unavailable");
      expect(d.generate).toBe(false);
    }
  });

  it("is not a 'not today': with an offer or a session open it still pauses, starts and ends nothing", () => {
    const offer: ActionContext = { session: "none", prompt: { kind: "start", options: [{ id: "a", type: "start", minutes: 25 }, { id: "b", type: "later", minutes: null }] } };
    expect(decide(reading({ action: "set_reminder", deferUntil: "tomorrow", promptAnswer: "b" }), offer).action.type).toBe("reminder_unavailable");
    expect(decide(reading({ action: "set_reminder" }), { session: "running", prompt: null }).action.type).toBe("reminder_unavailable");
  });

  it("read from noise is still noise", () => {
    expect(decide(reading({ action: "set_reminder", clarity: "unintelligible" })).action.type).toBe("clarify");
  });

  it("is described as something Nova does not do", () => {
    expect(kindOf(reading({ action: "set_reminder" }))).toBe("unsupported");
  });

  it("is answered with what is true: nothing was scheduled", () => {
    for (const text of [TEXT.reminderUnavailable, TEXT.reminderUnavailableWeb]) {
      expect(text).toContain("nothing has been scheduled");
      expect(text).not.toMatch(/I'll remind|I will remind|reminder is set|\bDone\b|\bSure\b/i);
    }
    const turn = read("telegram/telegram-turn.ts");
    expect(turn).toContain('case "reminder_unavailable": return { reply: { text: textFor(ctx.language).reminderUnavailable }');
    expect(read("interaction/web-sentence.ts")).toContain('case "reminder_unavailable": return { reply: { text: TEXT.reminderUnavailableWeb }');
  });

  it("has no writer: Nova creates no reminder anywhere", () => {
    for (const file of ["telegram/telegram-turn.ts", "telegram/telegram-actions.ts", "interaction/web-sentence.ts", "decision/action-decision.ts"]) {
      expect(read(file)).not.toMatch(/customReminder|createCustomReminder|parseAndCreateReminder/);
    }
  });
});

describe("what the Response Brain may claim", () => {
  it("is told, on every reply, never to claim or promise an action the prompt does not state", () => {
    expect(NOVA_STATIC_LAYER).toContain("11. Never say or imply that Nova did something, or will do something later, unless the prompt states that it happened.");
    expect(NOVA_STATIC_LAYER).toContain("Understanding a request is not doing it.");
  });

  it("is told to say nothing about the student that is not on record", () => {
    expect(NOVA_STATIC_LAYER).toContain("12. Say nothing about the student that is not in the context above or in their own message");
    expect(NOVA_STATIC_LAYER).toContain("the first step is always the hardest");
  });

  it("is told, on a turn with no action, that nothing was done and nothing may be promised", () => {
    const turn = read("telegram/telegram-turn.ts");
    expect(turn).toContain("no reminder was set");
    expect(turn).toContain("do not promise to do anything later (remind, check in, message, follow up)");
  });

  it("words a result only when the operation succeeded", () => {
    const turn = read("telegram/telegram-turn.ts");
    expect(turn).toContain("const happened = acted === null || acted.operation.ok;");
    expect(turn).toContain("const generate = decision.generate && happened && await spendModelCall");
  });

  it("is never playful with a learner in distress, ill, or with an exam close, whatever they asked for", () => {
    for (const emotion of ["distressed", "overwhelmed", "anxious_exam", "frustrated", "self_doubt"] as const) {
      expect(chooseRegister({ emotion, daysUntilNextExam: null, activeReality: [], accountability: "hard" })).toBe("serious");
    }
    for (const category of ["health", "injury", "emotional", "life_constraint"]) {
      expect(chooseRegister({ emotion: "neutral", daysUntilNextExam: null, activeReality: [category], accountability: "hard" })).toBe("serious");
    }
    expect(chooseRegister({ emotion: "neutral", daysUntilNextExam: 1, activeReality: [], accountability: "hard" })).toBe("serious");
    expect(registerLine("serious")).toContain("No jokes and no teasing");
    expect(registerLine("playful")).toContain("about a habit the evidence above shows");
    expect(registerLine("playful")).toContain("never about them, their ability or their worth");
  });
});

// ── Unclear input ─────────────────────────────────────────────────────────────

describe("a message that could not be read", () => {
  it("says so in one short line, without sounding stuck", () => {
    expect(TEXT.clarifyOpen).toBe("I didn't catch that. Tell me what you need, or use the buttons above.");
    expect(clarifyReply(null).text).toBe("I didn't catch that. Tell me what you need, or pick one:");
  });

  it("is told apart from a model that did not answer, which names what still works", () => {
    expect(TEXT.notUnderstood).not.toBe(TEXT.clarifyOpen);
    expect(TEXT.notUnderstood).toContain("/today, /focus and /done still work");
    expect(TEXT.notUnderstood).not.toMatch(/couldn't read that/);
  });

  it("gets one reply: a second reply to the same update is dropped", () => {
    const turn = read("telegram/telegram-turn.ts");
    expect(turn).toContain("if (repliedAt !== null) {");
    expect(turn).toContain("a second reply to one update was dropped");
    // The last-resort line is only for an update that has had no reply.
    expect(turn).toMatch(/if \(repliedAt === null\) \{\s+if \(event\.kind === "callback"\) await client\.answerCallback\(event\.callbackId, say\(\)\.failed\)/);
  });
});

// ── A very short session ──────────────────────────────────────────────────────

describe("a session stopped before ten minutes", () => {
  const session = (elapsedMinutes: number): SessionContext => ({
    sessionId: "s1", profileId: "p1", status: "in_progress", topicName: "Deadlocks", subjectId: "sub1", subjectName: "Operating Systems",
    currentFocus: null, startedAt: new Date("2026-10-08T10:00:00Z"), elapsedMinutes, plannedDurationMinutes: 25,
    confusionPoints: [], topicsCompleted: [], pauseCount: 0, totalPausedMinutes: 0, isPaused: false, pausedAt: null,
    energyLevel: null, masteryEstimate: 0.5, sessionGoal: null,
  });
  const report = (minutes: number, outcome: "struggled" | "okay" | "good" | "crushed_it" = "crushed_it") =>
    buildExecutionReport(session(minutes), null, sessionEvidence({ outcome }), new Date("2026-10-08T10:30:00Z"));

  it("is still a finished session, with the answer the learner gave", () => {
    for (const minutes of [0, 1, 2, 9]) {
      const r = report(minutes);
      expect(r.outcome).toBe("crushed_it");
      expect(r.evidenceBasis).toBe("learner_outcome");
      expect(r.topicsCovered.map(t => t.name)).toEqual(["Deadlocks"]);
    }
  });

  it("moves no mastery, whatever the answer", () => {
    for (const minutes of [0, 1, 2, 9]) {
      for (const outcome of ["struggled", "okay", "good", "crushed_it"] as const) {
        const r = report(minutes, outcome);
        expect([minutes, outcome, r.countedAsStudy, r.masteryUpdates]).toEqual([minutes, outcome, false, []]);
      }
    }
  });

  it("from ten minutes on is evidence about the topic, as before", () => {
    const r = report(COUNTED_SESSION_MINUTES, "good");
    expect(r.countedAsStudy).toBe(true);
    expect(r.masteryUpdates).toEqual([{ topicName: "Deadlocks", subjectId: "sub1", confidence: expect.any(Number) }]);
  });

  it("uses the one definition of a counted session", () => {
    expect(COUNTED_SESSION_MINUTES).toBe(10);
    expect(read("engines/study-session-engine.ts")).toContain("const countedAsStudy = session.elapsedMinutes >= COUNTED_SESSION_MINUTES;");
    expect(read("product/session.ts")).toContain("counted:       sessionElapsedSeconds(active, now) >= COUNTED_SESSION_MINUTES * 60,");
  });

  it("is reported for what it is, on Telegram and on the web", () => {
    const short = endedReply({ topicName: "Deadlocks", minutes: 1, outcome: "crushed_it", topicRecorded: true, counted: false });
    expect(short.text).toBe("Logged: 1 min on Deadlocks. Crushed it. Under 10 minutes, so it's kept as a session but nothing changed in Knowledge or Progress.");
    expect(endedReply({ topicName: "Deadlocks", minutes: 14, outcome: "struggled", topicRecorded: true, counted: true }).text)
      .toBe("Logged: 14 min on Deadlocks. Struggled. It comes back for review tomorrow.");
    const page = readFileSync(join(__dirname, "../../../../../apps/web/components/nova/focus-session.tsx"), "utf8");
    expect(page).toContain("ended.counted === false");
    expect(page).toContain("changed nothing in Knowledge or Progress");
  });

  it("never has its outcome inferred: ending asks, and only an answer ends", () => {
    const running: ActionContext = { session: "running", prompt: null };
    for (const u of [reading({ action: "finish_session" }), reading({ action: "finish_session", sessionOutcome: "good" })]) {
      const d = decide(u, running);
      expect(d.action.type).toBe("ask_outcome");
      expect(d.generate).toBe(false);
    }
    // A pause is not an end, and silence is nothing at all.
    expect(decide(reading({ action: "pause_session" }), running).action.type).toBe("pause_session");
  });
});

// ── Latency ───────────────────────────────────────────────────────────────────

describe("waiting on a model", () => {
  it("gives each attempt only the time the caller has left", () => {
    expect(attemptTimeoutMs(undefined, 0, 12_000)).toBe(12_000);
    expect(attemptTimeoutMs(6_000, 0, 12_000)).toBe(6_000);
    expect(attemptTimeoutMs(6_000, 2_500, 12_000)).toBe(3_500);
    expect(attemptTimeoutMs(20_000, 2_000, 12_000)).toBe(12_000);
  });

  it("starts no attempt that cannot finish", () => {
    expect(attemptTimeoutMs(6_000, 6_000 - MIN_ATTEMPT_MS + 1, 12_000)).toBeNull();
    expect(attemptTimeoutMs(6_000, 9_000, 12_000)).toBeNull();
  });

  it("does not sit out a rate limit that outlasts the deadline", () => {
    expect(mayWait(undefined, 0, 30_000)).toBe(true);
    expect(mayWait(6_000, 500, 2_000)).toBe(true);
    expect(mayWait(6_000, 500, 5_000)).toBe(false);
    expect(mayWait(6_000, 5_500, 800)).toBe(false);
  });

  it("is bounded for both of Nova's calls, and unbounded for nobody else by default", () => {
    expect(read("brains/understanding-brain.ts")).toContain("deadlineMs:       UNDERSTANDING_DEADLINE_MS,");
    expect(read("brains/response-brain.ts")).toContain("deadlineMs:        RESPONSE_DEADLINE_MS,");
    // Every other model call a Telegram turn or a proactive message makes.
    expect(read("brains/first-use-wording.ts")).toContain("deadlineMs: RESPONSE_DEADLINE_MS");
    expect(read("brains/language-wording.ts")).toContain("deadlineMs: LANGUAGE_DEADLINE_MS");
    expect(read("proactive/nova-proactive-response.ts")).toContain("deadlineMs: RESPONSE_DEADLINE_MS");
    expect(read("brains/disambiguation-pass.ts").includes("generateOpenAIText")).toBe(true);
    const client = readFileSync(join(__dirname, "../../services/openai.service.ts"), "utf8");
    expect(client).toContain("attemptTimeoutMs(input.deadlineMs, Date.now() - started, GEMINI_TIMEOUT_MS)");
    expect(client).toContain("input.deadlineMs !== undefined ? { signal: AbortSignal.timeout(input.deadlineMs) } : {}");
  });
});

describe("the reply and the record", () => {
  const turn = read("telegram/telegram-turn.ts");

  it("sends a reply code wrote before the canonical turn runs", () => {
    const sendScripted = turn.indexOf("if (!generate) await deliver(shell(fallback), true);");
    const canonical    = turn.indexOf("const turn = await runNovaOrchestrator({");
    expect(sendScripted).toBeGreaterThan(0);
    expect(canonical).toBeGreaterThan(sendScripted);
  });

  it("sends a worded reply the moment it exists, and still awaits the record", () => {
    expect(turn).toContain("reply: (text: string) => deliver(shell(text), true)");
    expect(turn).toContain("awaitPersistence: true");
    const orchestrator = read("nova-orchestrator.ts");
    const hook    = orchestrator.indexOf("if (input.hooks?.reply) await input.hooks.reply(brainOutput.reply);");
    const persist = orchestrator.indexOf("persisted = await persistTurn(persistence)");
    expect(hook).toBeGreaterThan(0);
    expect(persist).toBeGreaterThan(hook);
  });

  it("starts no work it does not wait for", () => {
    expect(turn.split("\n").filter(line => /^\s*void /.test(line))).toEqual([]);
    expect(turn).not.toContain("persistTurnAsync");
  });

  it("stops the webhook's typing indicator when the reply is sent", () => {
    expect(turn).toContain("deps.onReplied?.();");
    const route = readFileSync(join(__dirname, "../../../../../apps/api/app/api/telegram/route.ts"), "utf8");
    expect(route).toContain("novaDeps({ receivedAt, onReplied: stopTyping })");
    // One typing loop, the webhook's: the turn adds no chat actions of its own.
    expect(turn).not.toContain("sendChatAction");
    expect(read("telegram/telegram-client.ts")).not.toContain("sendChatAction");
  });

  it("does not read the learner's row a second time, and reads what is independent together", () => {
    expect(turn.split("prisma.messengerUser.findUnique(").length - 1).toBe(2);   // the learner, and a row this update created
    expect(turn).toContain("const [session, prompt, history] = await Promise.all([");
    expect(turn).toContain("if (!channel || settingUp) await ensureChannel(profile.id);");
    const actions = read("telegram/telegram-actions.ts");
    expect(actions).toContain("const [view, snapshot, session] = await Promise.all([todayView(ctx, null), loadStudySnapshot(ctx.chatId), loadNovaSession(ctx.chatId, ctx.now)]);");
    expect(actions).toContain("offerFrom(ctx, view, session, subjects, topic, null)");
  });

  it("acknowledges a tap while its action runs", () => {
    expect(turn).toContain("const acknowledged = telegram(Promise.all([");
    expect(turn).toContain("await acknowledged;");
  });
});

describe("where an update's time went", () => {
  const timings = (over: Partial<TurnTimings> = {}): TurnTimings =>
    ({ webhookMs: 30, learnerMs: 40, contextMs: 60, understandingMs: 900, decisionMs: 1, actionMs: 120, responseMs: 0, telegramSendMs: 200, replyMs: 1300, persistMs: 300, totalMs: 1600, ...over });

  it("names no stage when none was slow", () => {
    expect(slowestStage(timings())).toBeNull();
  });

  it("names the slowest stage once one is slow", () => {
    expect(slowestStage(timings({ understandingMs: SLOW_STAGE_MS }))).toBe("understandingMs");
    expect(slowestStage(timings({ understandingMs: 2_800, responseMs: 3_100 }))).toBe("responseMs");
    expect(slowestStage(timings({ actionMs: 4_000, telegramSendMs: 1_600 }))).toBe("actionMs");
  });

  it("is on the one log line of every update, with the model calls it made", () => {
    const turn = read("telegram/telegram-turn.ts");
    expect(turn).toContain("timings: { webhookMs: 0, learnerMs: 0, contextMs: 0, understandingMs: 0, decisionMs: 0, actionMs: 0, responseMs: 0, telegramSendMs: 0, replyMs: 0, persistMs: 0, totalMs: 0 },");
    expect(turn).toContain("trace.slowStage = slowestStage(trace.timings);");
    expect(turn).toContain("trace.modelCalls++;");
  });

  it("logs durations and never the message", () => {
    const types = read("telegram/telegram.types.ts");
    const trace = types.slice(types.indexOf("export interface TurnTrace"), types.indexOf("}", types.indexOf("slowStage:")));
    expect(trace).not.toMatch(/\btext:|rawText|message:/);
    expect(trace).toContain("textLength:");
  });
});
