// ─── Conversational reality: Understanding Brain → evidence → consolidation ───
// The Understanding Brain is the only semantic reader of the message. These
// tests feed its JSON output (as the model returns it) through the parser,
// the evidence builder and the consolidator, with no regex classification
// of the message text anywhere in between.
import { parseUnderstandingResponse, parseRealityObservations } from "../brains/understanding-parser.js";
import { buildTurnEvidence } from "../consolidation/evidence-builder.js";
import { consolidate } from "../consolidation/consolidator.js";
import type { ConsolidationState, StoredReality } from "../types/consolidation.types.js";

const NOW = new Date("2026-03-10T10:00:00Z");
const NO_PATTERNS = { detectedPatterns: [], dominantPattern: null, analysisRunAt: NOW, messagesSinceLastRun: 1 };

function ubJson(fields: Record<string, unknown>): string {
  return JSON.stringify({
    intent: "life_disclosure", emotion: "neutral", topic: null, topicConfidence: 0,
    disclosureClass: "life_event", ambiguityScore: 0.1, routingSignal: "reality_extraction",
    reality: [],
    ...fields,
  });
}

function turn(message: string, json: string, realities: StoredReality[] = []) {
  const understanding = parseUnderstandingResponse(json, message);
  const evidence = buildTurnEvidence({
    userId: "user_1", profileId: "profile_1", sourceMessageId: "msg_1",
    userText: message, observedAt: NOW, signals: [], understanding,
    patterns: NO_PATTERNS,
    brainOutput: { reply: "ok", reasoningMode: "empathetic", confidence: 0.8 },
  });
  const state: ConsolidationState = { facts: [], realities, patterns: [], investigation: null, recentSessions: [] };
  const decisions = consolidate({ evidence, state, now: NOW, patternScanRan: false, hasActiveSession: false });
  return { understanding, evidence, decisions, reality: decisions.filter(d => d.target === "reality") };
}

const hoursUntilExpiry = (d: { write: unknown }) => {
  const w = d.write as { expiresAt: Date };
  return (w.expiresAt.getTime() - NOW.getTime()) / 3_600_000;
};

// ── Disclosures that should become reality ────────────────────────────────────

describe("disclosed circumstances become reality evidence, then reality", () => {
  it("illness", () => {
    const { evidence, reality } = turn("I've had the flu since Monday, can't focus at all", ubJson({
      emotion: "discouraged",
      reality: [{ category: "health", subtype: "illness", claim: "Student has the flu", status: "active", persistence: "temporary", expectedDurationHours: null, confidence: 0.9 }],
    }));

    // The Understanding Brain produces evidence: it does not create the row.
    expect(evidence).toEqual([expect.objectContaining({
      kind: "reality_claim", source: "understanding_brain", category: "health", subtype: "illness",
      description: "Student has the flu", sourceMessageId: "msg_1", confidence: 0.9,
    })]);
    expect(reality).toEqual([expect.objectContaining({ action: "CREATE", reason: "new_constraint" })]);
    expect(hoursUntilExpiry(reality[0]!)).toBe(72);
  });

  it("injury", () => {
    const { reality } = turn("broke my wrist playing football, typing is slow", ubJson({
      reality: [{ category: "injury", subtype: "injury", claim: "Student has a broken wrist", status: "active", persistence: "temporary", expectedDurationHours: 24 * 21, confidence: 0.9 }],
    }));
    expect(reality[0]).toMatchObject({ action: "CREATE" });
    expect(reality[0]!.write).toMatchObject({ category: "injury", subtype: "injury" });
    expect(hoursUntilExpiry(reality[0]!)).toBe(336);   // 3 weeks stated, capped at the injury ceiling
  });

  it("travel, with a stated duration", () => {
    const { reality } = turn("I'm away at my cousin's wedding until Sunday", ubJson({
      reality: [{ category: "life_constraint", subtype: "travel", claim: "Student is travelling for a family wedding", status: "active", persistence: "temporary", expectedDurationHours: 96, confidence: 0.85 }],
    }));
    expect(reality[0]!.write).toMatchObject({ category: "life_constraint", subtype: "travel" });
    expect(hoursUntilExpiry(reality[0]!)).toBe(96);
  });

  it("exams", () => {
    const { reality } = turn("finals week starts tomorrow, three exams in five days", ubJson({
      intent: "exam_anxiety", emotion: "anxious_exam", disclosureClass: "study_context",
      reality: [{ category: "academic_constraint", subtype: "exam", claim: "Student has three final exams this week", status: "active", persistence: "temporary", expectedDurationHours: 120, confidence: 0.9 }],
    }));
    expect(reality[0]!.write).toMatchObject({ category: "academic_constraint", subtype: "exam" });
    expect(hoursUntilExpiry(reality[0]!)).toBe(120);
  });

  it("work pressure that is a standing constraint", () => {
    const { reality } = turn("I work night shifts at the warehouse four days a week", ubJson({
      reality: [{ category: "life_constraint", subtype: "work", claim: "Student works night shifts four days a week", status: "active", persistence: "standing", expectedDurationHours: null, confidence: 0.9 }],
    }));
    expect(reality[0]!.write).toMatchObject({ category: "life_constraint", subtype: "work" });
    expect(hoursUntilExpiry(reality[0]!)).toBe(180 * 24);   // not cut off by the 10-day life_constraint ceiling
  });

  it("emotional strain", () => {
    const { reality } = turn("my grandfather died on Friday. I can't think about revision", ubJson({
      emotion: "distressed", disclosureClass: "emotional_disclosure",
      reality: [{ category: "emotional", subtype: "grief", claim: "Student is grieving the death of their grandfather", status: "active", persistence: "temporary", expectedDurationHours: null, confidence: 0.95 }],
    }));
    expect(reality[0]!.write).toMatchObject({ category: "emotional", subtype: "grief" });
  });

  it("a temporary schedule constraint", () => {
    const { reality } = turn("my sister's staying this week so evenings are gone", ubJson({
      reality: [{ category: "life_constraint", subtype: "schedule", claim: "Student has no free evenings this week", status: "active", persistence: "temporary", expectedDurationHours: 168, confidence: 0.8 }],
    }));
    expect(reality[0]!.write).toMatchObject({ category: "life_constraint", subtype: "schedule" });
    expect(hoursUntilExpiry(reality[0]!)).toBe(168);
  });

  it("two circumstances in one message produce two records", () => {
    const { reality } = turn("I'm sick and my exam is Thursday", ubJson({
      reality: [
        { category: "health", subtype: "illness", claim: "Student is sick", status: "active", persistence: "temporary", expectedDurationHours: null, confidence: 0.85 },
        { category: "academic_constraint", subtype: "exam", claim: "Student has an exam on Thursday", status: "active", persistence: "temporary", expectedDurationHours: 72, confidence: 0.9 },
      ],
    }));
    expect(reality.map(d => d.action)).toEqual(["CREATE", "CREATE"]);
  });
});

// ── Explicit resolution ───────────────────────────────────────────────────────

describe("explicit resolution", () => {
  const flu: StoredReality = {
    id: "r_flu", category: "health", subtype: "illness", fact: "Student has the flu",
    confidence: 0.9, expiresAt: new Date(NOW.getTime() + 24 * 3_600_000), sourceMessageIds: ["msg_0"],
  };

  it("'I was sick last week, I'm fine now' resolves the illness", () => {
    const { evidence, reality } = turn("I was sick last week, I'm fine now", ubJson({
      intent: "general_chat", disclosureClass: "none", routingSignal: "coaching_only",
      reality: [{ category: "health", subtype: "illness", claim: "Student has recovered from illness", status: "resolved", persistence: "temporary", expectedDurationHours: null, confidence: 0.9 }],
    }), [flu]);

    expect(evidence).toEqual([expect.objectContaining({ kind: "reality_resolution", category: "health", subtype: "illness" })]);
    expect(reality).toEqual([expect.objectContaining({ action: "RESOLVE", targetId: "r_flu" })]);
  });

  it("a recovery with nothing on record changes nothing", () => {
    const { reality } = turn("I'm feeling fine now", ubJson({
      intent: "general_chat", disclosureClass: "none",
      reality: [{ category: "health", subtype: "illness", claim: "Student has recovered", status: "resolved", persistence: "temporary", expectedDurationHours: null, confidence: 0.9 }],
    }));
    expect(reality).toEqual([expect.objectContaining({ action: "IGNORE", reason: "nothing_to_resolve" })]);
  });
});

// ── Messages that must NOT create reality ─────────────────────────────────────

describe("no reality is created when none was disclosed", () => {
  const plain = { intent: "study_report", emotion: "motivated", disclosureClass: "none", routingSignal: "coaching_only" };

  it.each([
    ["a study report",      "I finished chapter 3 and did the exercises"],
    ["a topic question",    "can you explain eigenvalues again?"],
    ["an uncaused excuse",  "I was busy, didn't get to it"],
    ["a passing mood",      "ugh, tired today"],
    ["a plan request",      "what should I revise this week?"],
  ])("%s", (_label, message) => {
    const { evidence, reality } = turn(message, ubJson({ ...plain, reality: [] }));
    expect(evidence.filter(e => e.kind.startsWith("reality"))).toEqual([]);
    expect(reality).toEqual([]);
  });

  it("a reality field missing from the model output is treated as none", () => {
    const json = JSON.stringify({ intent: "general_chat", emotion: "neutral", disclosureClass: "none", routingSignal: "coaching_only" });
    expect(turn("hey", json).understanding.realityObservations).toEqual([]);
  });

  it("a low-confidence guess is not written", () => {
    const { reality } = turn("might be coming down with something idk", ubJson({
      reality: [{ category: "health", subtype: "illness", claim: "Student may be getting ill", status: "active", persistence: "temporary", expectedDurationHours: null, confidence: 0.4 }],
    }));
    expect(reality).toEqual([expect.objectContaining({ action: "IGNORE", reason: "insufficient_confidence" })]);
  });

  it("a claim on a message the model classed as no disclosure is trusted less", () => {
    const { evidence, reality } = turn("did some reading", ubJson({
      ...plain,
      reality: [{ category: "emotional", subtype: "stress", claim: "Student is stressed", status: "active", persistence: "temporary", expectedDurationHours: null, confidence: 0.7 }],
    }));
    expect(evidence[0]).toMatchObject({ kind: "reality_claim", confidence: 0.7 * 0.8 });
    expect(reality).toEqual([expect.objectContaining({ action: "IGNORE", reason: "insufficient_confidence" })]);
  });
});

// ── Malformed model output ────────────────────────────────────────────────────

describe("reality output validation", () => {
  it("drops items with an unknown category, no claim, or no confidence", () => {
    expect(parseRealityObservations([
      { category: "training_context", subtype: "deload", claim: "Rest day", status: "active", confidence: 0.9 },
      { category: "weather", claim: "It is raining", confidence: 0.9 },
      { category: "health", claim: "", confidence: 0.9 },
      { category: "health", claim: "Student is ill" },
      "not an object",
    ])).toEqual([]);
  });

  it("maps an unknown subtype to the category's 'other', and clamps confidence", () => {
    expect(parseRealityObservations([
      { category: "life_constraint", subtype: "moving house", claim: "Student is moving house", status: "active", persistence: "temporary", confidence: 1.7 },
    ])).toEqual([expect.objectContaining({ subtype: "other", confidence: 1, expectedDurationHours: null })]);
  });

  it("a malformed reality field does not break the rest of the classification", () => {
    const u = parseUnderstandingResponse(ubJson({ intent: "exam_anxiety", reality: "sick" }), "x");
    expect(u.intent).toBe("exam_anxiety");
    expect(u.realityObservations).toEqual([]);
  });

  it("keeps at most three observations", () => {
    const item = { category: "health", subtype: "illness", claim: "Student is ill", status: "active", confidence: 0.9 };
    expect(parseRealityObservations([item, item, item, item, item])).toHaveLength(3);
  });
});
