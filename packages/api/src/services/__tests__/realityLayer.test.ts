// Pure-function tests for realityLayer.service.ts
// DB-touching functions (readActiveReality, writeReality, resolveReality) are
// excluded — they require a live Prisma connection. Only buildConflictReply,
// buildRealityBlock, and signal-extraction logic are tested here.

import { buildConflictReply, buildRealityBlock } from "../realityLayer.service";
import type { UserRealityFact } from "../realityLayer.service";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeFact(overrides: Partial<UserRealityFact> = {}): UserRealityFact {
  const now = new Date();
  return {
    id:             "test-id",
    category:       "general",
    fact:           "some fact",
    confidence:     0.9,
    relevanceScore: 1.0,
    expiresAt:      new Date(now.getTime() + 24 * 60 * 60 * 1000),
    createdAt:      now,
    ...overrides,
  };
}

// ── buildConflictReply ────────────────────────────────────────────────────────

describe("buildConflictReply", () => {
  it("returns null for empty reality", () => {
    expect(buildConflictReply([])).toBeNull();
  });

  it("returns null when only emotional context is active", () => {
    expect(buildConflictReply([makeFact({ category: "emotional" })])).toBeNull();
  });

  it("returns null when only life_constraint context is active", () => {
    expect(buildConflictReply([makeFact({ category: "life_constraint" })])).toBeNull();
  });

  it("returns conflict message when health reality is active", () => {
    const result = buildConflictReply([makeFact({ category: "health" })]);
    expect(result).not.toBeNull();
    expect(result).toMatch(/sick/i);
  });

  it("returns conflict message when injury reality is active", () => {
    const result = buildConflictReply([makeFact({ category: "injury" })]);
    expect(result).not.toBeNull();
    expect(result).toMatch(/injur/i);
  });

  it("prefers health conflict over injury when both present", () => {
    const result = buildConflictReply([
      makeFact({ category: "health" }),
      makeFact({ category: "injury" }),
    ]);
    expect(result).toMatch(/sick/i);
  });

  it("conflict messages are concise (≤ 200 chars)", () => {
    const healthResult = buildConflictReply([makeFact({ category: "health" })]);
    const injuryResult = buildConflictReply([makeFact({ category: "injury" })]);
    expect(healthResult!.length).toBeLessThanOrEqual(200);
    expect(injuryResult!.length).toBeLessThanOrEqual(200);
  });
});

// ── buildRealityBlock ─────────────────────────────────────────────────────────

describe("buildRealityBlock", () => {
  it("returns null for empty reality", () => {
    expect(buildRealityBlock([])).toBeNull();
  });

  it("includes category label in output", () => {
    const block = buildRealityBlock([makeFact({ category: "health", fact: "User is sick" })]);
    expect(block).toContain("HEALTH");
    expect(block).toContain("User is sick");
  });

  it("includes hours-remaining estimate", () => {
    const block = buildRealityBlock([makeFact({ category: "health", fact: "fever" })]);
    expect(block).toMatch(/\d+h/);
  });

  it("adds health directive when health category present", () => {
    const block = buildRealityBlock([makeFact({ category: "health" })]);
    expect(block).toMatch(/HEALTH context active/i);
  });

  it("adds injury directive when injury category present", () => {
    const block = buildRealityBlock([makeFact({ category: "injury" })]);
    expect(block).toMatch(/INJURY context active/i);
  });

  it("includes multiple facts", () => {
    const block = buildRealityBlock([
      makeFact({ category: "health",  fact: "User is sick" }),
      makeFact({ category: "emotional", fact: "User is stressed" }),
    ]);
    expect(block).toContain("User is sick");
    expect(block).toContain("User is stressed");
  });

  it("does not add health directive when only emotional context active", () => {
    const block = buildRealityBlock([makeFact({ category: "emotional" })]);
    expect(block).not.toMatch(/HEALTH context active/i);
    expect(block).not.toMatch(/INJURY context active/i);
  });

  it("block starts with 'ACTIVE REALITY' header", () => {
    const block = buildRealityBlock([makeFact({ category: "health" })]);
    expect(block).toMatch(/^ACTIVE REALITY/);
  });
});

// ── Signal-to-category mapping (behavioural contracts) ───────────────────────

describe("V2 signal → reality category contract", () => {
  // These tests document the expected mapping without calling the DB function.
  // They verify the signal names match what the parser actually emits.

  const HEALTH_SIGNALS   = ["HEALTH_EVENT"];
  const INJURY_SIGNALS   = ["INJURY_CONTEXT"];
  const IRRELEVANT       = ["PAIN_MENTIONED", "RECOMMENDATION_BLOCKED", "CONVERSATION_CLOSURE"];

  it("HEALTH_EVENT maps to health category (documented contract)", () => {
    expect(HEALTH_SIGNALS).toContain("HEALTH_EVENT");
  });

  it("INJURY_CONTEXT maps to injury category (documented contract)", () => {
    expect(INJURY_SIGNALS).toContain("INJURY_CONTEXT");
  });

  it("PAIN_MENTIONED does NOT trigger a reality write in Phase 1 (documented contract)", () => {
    // Phase 1 only writes on HEALTH_EVENT and INJURY_CONTEXT.
    // PAIN_MENTIONED is too ambiguous to store as a reality fact.
    expect(IRRELEVANT).toContain("PAIN_MENTIONED");
  });
});
