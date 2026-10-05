// ─── Session start: protocol vs. meaning ──────────────────────────────────────
// Explicit commands are deterministic. What a sentence means is decided by the
// Understanding Brain. No regex over message text decides a session starts.
import { translateNovaCommand } from "../commands.js";
import { extractSignals } from "../engines/signal-engine.js";
import { isCorroborated } from "../engines/signal-corroboration.js";
import { resolveTurnSignals } from "../engines/turn-signals.js";
import { parseUnderstandingResponse } from "../brains/understanding-parser.js";
import { computeAcademicState } from "../engines/academic-state-engine.js";
import { buildTurnEvidence } from "../consolidation/evidence-builder.js";
import { STATE_BASELINES } from "../types/academic-state.types.js";
import type { AcademicState } from "../types/academic-state.types.js";
import type { AcademicUnderstanding } from "../types/understanding.types.js";

const STATE: AcademicState = {
  semesterPhase: "beginning", activeMode: "standard", momentaryState: "neutral",
  scores: { ...STATE_BASELINES },
  hardDirectives: {
    noStudyPressure: false, examCrisisMode: false, planFreezeMode: false,
    calibrationAlert: false, noChallenging: false, recoveryMode: false, beginnerMode: false,
  },
  daysSinceJoined: 30, daysSinceLastSession: 0, consecutiveMisses: 0, studyStreakDays: 3,
  daysUntilNextExam: null, momentum7dTrend: [0, 0, 0, 0, 0, 0, 0], stateHistory: [],
};

function ub(fields: Record<string, unknown>, text = ""): AcademicUnderstanding {
  return parseUnderstandingResponse(JSON.stringify({
    intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0,
    disclosureClass: "none", ambiguityScore: 0.1, routingSignal: "coaching_only", ...fields,
  }), text);
}

// The orchestrator's own wiring (engines/turn-signals.ts).
function turnSignals(rawMessage: string, understandingFields: Record<string, unknown>) {
  const { command, text } = translateNovaCommand(rawMessage);
  const understanding = ub(understandingFields, text);
  return { command, understanding, signals: resolveTurnSignals({ text, command, understanding, state: STATE }) };
}

const types = (s: { detectedSignals: Array<{ type: string }> }) => s.detectedSignals.map(x => x.type);

describe("explicit commands (protocol, deterministic)", () => {
  it("parses slash commands and nothing else", () => {
    expect(translateNovaCommand("/study operating systems")).toEqual({
      command: "study", text: "I want to study operating systems. What should I do today?",
    });
    expect(translateNovaCommand("/STUDY").command).toBe("study");
    expect(translateNovaCommand("/done").command).toBe("done");
    expect(translateNovaCommand("/quiz graphs")).toMatchObject({ command: "quiz", text: "Quiz me on graphs." });

    // Natural language is never treated as a command.
    for (const text of ["study with me", "let's start studying", "I'm done", "/unknown thing", "can we /study later"]) {
      expect(translateNovaCommand(text)).toEqual({ command: null, text });
    }
  });

  it("/study starts a session without consulting the model's sessionIntent", () => {
    const { signals } = turnSignals("/study DBMS", { intent: "plan_request", sessionIntent: "none" });
    expect(signals.detectedSignals).toContainEqual(expect.objectContaining({
      type: "session_start", evidence: "command", confidence: 1,
    }));
  });

  it("/done reports a finished session deterministically", () => {
    const { signals } = turnSignals("/done", { intent: "general_chat" });
    expect(signals.detectedSignals).toContainEqual(expect.objectContaining({ type: "study_report", evidence: "command" }));
  });
});

describe("natural language (meaning, Understanding Brain)", () => {
  it.each([
    "I have 30 minutes, let's do OS",
    "Let's study DBMS now",
    "I'm ready to study",
    "ok starting my session",
    "back, let's continue",
  ])("'%s' starts a session only because the Understanding Brain says so", message => {
    const start = turnSignals(message, { sessionIntent: "start" });
    expect(start.signals.detectedSignals).toContainEqual(expect.objectContaining({
      type: "session_start", evidence: "understanding",
    }));

    // Same words, but the Understanding Brain reads no start: no session.
    const none = turnSignals(message, { sessionIntent: "none" });
    expect(types(none.signals)).not.toContain("session_start");
  });

  it("the signal engine alone never detects a session start", () => {
    for (const message of [
      "starting to study now", "ok starting", "let's start studying", "about to start studying",
      "just started studying", "beginning to study", "starting my session",
    ]) {
      expect(types(extractSignals(message, STATE))).not.toContain("session_start");
    }
  });

  it("a plan to study later is not a start", () => {
    const { signals } = turnSignals("I'll study chapter 4 tonight", { intent: "commitment_made", sessionIntent: "none" });
    expect(types(signals)).not.toContain("session_start");
  });

  it("sessionIntent is 'none' unless the model says exactly 'start' or 'break'", () => {
    expect(ub({}).sessionIntent).toBe("none");
    expect(ub({ sessionIntent: "maybe" }).sessionIntent).toBe("none");
    expect(ub({ sessionIntent: "start" }).sessionIntent).toBe("start");
    expect(ub({ sessionIntent: "break" }).sessionIntent).toBe("break");
  });
});

describe("academic-state scores move only on established signals", () => {
  const scoresAfter = (rawMessage: string, understandingFields: Record<string, unknown>) => {
    const { signals, understanding } = turnSignals(rawMessage, understandingFields);
    return computeAcademicState({
      semesterStartDate: null, semesterEndDate: null, daysSinceJoined: 30,
      studySessions: [{ sessionDate: new Date(), durationMinutes: 60, status: "completed" }],
      upcomingExams: [], stateHistory: [], signals, mentionedTopicMastery: null, understanding,
      storedScores: { ...STATE_BASELINES }, storedStreakDays: 0, storedConsecutiveMisses: 0,
    }, new Date()).scores;
  };

  it("a regex match the Understanding Brain agrees with moves the score", () => {
    const message = "I finished chapter 3 of the lecture notes";
    const agreed  = scoresAfter(message, { intent: "study_report" });
    const neutral = scoresAfter("hello", { intent: "general_chat" });
    expect(agreed.engagement).toBeGreaterThan(neutral.engagement);
  });

  it("the same regex match without that agreement does not exist downstream", () => {
    // "finished ... chapter" matches, but the student is asking a question.
    const message  = "has anyone finished chapter 3? asking for a friend";
    expect(types(extractSignals(message, STATE))).toContain("study_report");   // the regex proposes
    const { signals } = turnSignals(message, { intent: "general_chat" });
    expect(types(signals)).not.toContain("study_report");                      // the Understanding Brain disposes
    expect(signals.stateUpdates).toEqual([]);
    expect(scoresAfter(message, { intent: "general_chat" }))
      .toEqual(scoresAfter("hello", { intent: "general_chat" }));
  });

  it("a break is established by the Understanding Brain's sessionIntent, not by wording or mood", () => {
    const message = "I need a break";
    expect(types(turnSignals(message, { sessionIntent: "break" }).signals)).toContain("break_request");
    expect(types(turnSignals(message, { sessionIntent: "none", emotion: "overwhelmed" }).signals)).not.toContain("break_request");
  });

  it("burnout wording moves burnoutRisk only when the Understanding Brain reads distress", () => {
    const message = "honestly what's the point";
    expect(turnSignals(message, { emotion: "neutral" }).signals.stateUpdates).toEqual([]);
    const read = turnSignals(message, { intent: "emotional_vent", emotion: "discouraged" }).signals.stateUpdates;
    expect(read.find(u => u.field === "burnoutRisk")?.delta).toBeGreaterThan(0);
  });

  it("an excuse is only an excuse if the Understanding Brain says so", () => {
    expect(isCorroborated("excuse", ub({ intent: "excuse" }))).toBe(true);
    expect(isCorroborated("excuse", ub({ intent: "life_disclosure" }))).toBe(false);
  });

  it("a command-established session start moves scores without any regex or model agreement", () => {
    const { signals } = turnSignals("/study", { intent: "plan_request" });
    expect(signals.stateUpdates.filter(u => u.triggerSignal === "session_start").length).toBeGreaterThan(0);
  });

  it("established signals count as corroborated evidence for consolidation", () => {
    const { signals, understanding } = turnSignals("/done", { intent: "general_chat" });
    const evidence = buildTurnEvidence({
      userId: "u", profileId: "p", sourceMessageId: "m", userText: "I just finished studying.",
      observedAt: new Date(), signals: signals.detectedSignals, understanding,
      patterns: { detectedPatterns: [], dominantPattern: null, analysisRunAt: new Date(), messagesSinceLastRun: 1 },
      brainOutput: { reply: "ok", reasoningMode: "direct", confidence: 0.8 },
    });
    expect(evidence).toContainEqual(expect.objectContaining({ kind: "signal", signalType: "study_report", corroborated: true }));
  });
});
