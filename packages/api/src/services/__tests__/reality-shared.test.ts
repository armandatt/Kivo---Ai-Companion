// ─── Shared Reality interface: Rex and Nova write one vocabulary ──────────────
import { prisma } from "@repo/db/client";
import { writeRealityFact, writeRealityFromV2Signals } from "../realityLayer.service";
import {
  REALITY_CATEGORIES,
  REALITY_SUBTYPES,
  normalizeStoredReality,
  normalizeSubtype,
} from "../../types/reality.types";
import * as novaReality from "../../nova/types/reality.types";
import { consolidate } from "../../nova/consolidation/consolidator";
import type { StoredReality, RealityClaimEvidence } from "../../nova/types/consolidation.types";

type Row = Record<string, any>;
let created: Row[];

beforeEach(() => {
  created = [];
  for (const key of Object.keys(prisma as Row)) delete (prisma as Row)[key];
  Object.assign(prisma as Row, {
    messengerUser: { findUnique: jest.fn(async () => ({ id: "user_1", realities: [] })) },
    userReality: {
      create:     jest.fn(async ({ data }: Row) => { created.push(data); return data; }),
      findMany:   jest.fn(async () => []),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
  });
});

const flush = () => new Promise(resolve => setImmediate(resolve));

describe("one vocabulary", () => {
  it("Nova re-exports the shared vocabulary instead of defining its own", () => {
    expect(novaReality.REALITY_CATEGORIES).toBe(REALITY_CATEGORIES);
    expect(novaReality.normalizeStoredReality).toBe(normalizeStoredReality);
    expect([...REALITY_CATEGORIES]).toEqual([
      "health", "injury", "emotional", "life_constraint", "academic_constraint", "training_context",
    ]);
  });

  it("every category has a closed subtype list and a default inside it", () => {
    for (const category of REALITY_CATEGORIES) {
      expect(REALITY_SUBTYPES[category]).toContain(normalizeSubtype(category, null));
      expect(REALITY_SUBTYPES[category]).toContain(normalizeSubtype(category, "something unlisted"));
    }
  });
});

describe("Rex writes canonical rows", () => {
  it("the parser path writes category, subtype and provenance", async () => {
    writeRealityFromV2Signals("chat_1", ["HEALTH_EVENT", "INJURY_CONTEXT"], "I have a fever and pulled my hamstring");
    await flush(); await flush();

    expect(created.map(r => [r.category, r.subtype])).toEqual([["health", "illness"], ["injury", "injury"]]);
    for (const row of created) {
      expect(REALITY_CATEGORIES).toContain(row.category);
      expect(row.provenance.sources).toEqual([expect.objectContaining({ source: "rex_parser", confidence: 0.9 })]);
    }
  });

  it("the extractor path writes a canonical subtype even when given none", async () => {
    await writeRealityFact("chat_1", "life_constraint", "User is travelling", 0.8, 0.9, 48, "off to Goa");
    await writeRealityFact("chat_1", "training_context", "Deload week", 0.8, 0.9, 24);
    expect(created.map(r => [r.category, r.subtype])).toEqual([["life_constraint", "other"], ["training_context", "other"]]);
    expect(created[0]!.provenance.sources[0]).toMatchObject({ source: "rex_extractor" });
  });

  it("Rex behavior is unchanged: same category, fact, confidence, TTL and dedup read", async () => {
    await writeRealityFact("chat_1", "emotional", "User is burned out", 0.7, 0.6, 48, "so tired of this");
    expect(created[0]).toMatchObject({
      userId: "user_1", category: "emotional", fact: "User is burned out",
      confidence: 0.7, relevanceScore: 0.6, sourceText: "so tired of this",
    });
    const ttlHours = (created[0]!.expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(Math.round(ttlHours)).toBe(48);

    // A category written in the last 4h is still skipped.
    (prisma as Row).messengerUser.findUnique = jest.fn(async () => ({ id: "user_1", realities: [{ id: "r" }] }));
    await writeRealityFact("chat_1", "emotional", "again", 0.7, 0.6, 48);
    expect(created).toHaveLength(1);
  });
});

describe("legacy rows are normalized at the read boundary", () => {
  it.each([
    ["health",            null,     "health",              "illness"],   // old Rex row, no subtype
    ["injury",            null,     "injury",              "injury"],
    ["life_constraint",   null,     "life_constraint",     "other"],
    ["training_context",  null,     "training_context",    "other"],
    ["health_constraint", null,     "health",              "other"],     // old Nova names
    ["time_constraint",   null,     "life_constraint",     "schedule"],
    ["work_constraint",   null,     "life_constraint",     "work"],
    ["other",             null,     "life_constraint",     "other"],
    ["health",            "sleep",  "health",              "sleep"],     // already canonical
    ["made_up",           null,     "life_constraint",     "other"],     // unknown, handled safely
    [null,                null,     "life_constraint",     "other"],
  ])("%s / %s → %s / %s", (category, subtype, expectedCategory, expectedSubtype) => {
    expect(normalizeStoredReality(category, subtype)).toEqual({ category: expectedCategory, subtype: expectedSubtype });
  });
});

describe("no duplicate semantics across companions", () => {
  const NOW = new Date("2026-03-10T10:00:00Z");
  const novaIllness: RealityClaimEvidence = {
    companion: "nova", userId: "user_1", profileId: null, kind: "reality_claim", source: "understanding_brain",
    observedAt: NOW, sourceMessageId: "msg_9", sourceText: "still got that fever",
    confidence: 0.9, category: "health", subtype: "illness",
    description: "Student has a fever", persistence: "temporary", expectedDurationHours: null,
  };

  function rexRow(category: string, subtype: string | null): StoredReality {
    return {
      id: "rex_row", fact: 'User reported illness: "I have a fever"', confidence: 0.9,
      expiresAt: new Date(NOW.getTime() + 48 * 3_600_000), sourceMessageIds: [],
      ...normalizeStoredReality(category, subtype),
    };
  }

  it.each([
    ["a new Rex row (with subtype)", "illness"],
    ["a legacy Rex row (no subtype)", null],
  ])("Nova's illness claim lands on %s instead of creating a second record", (_label, subtype) => {
    const decisions = consolidate({
      evidence: [novaIllness],
      state: { facts: [], realities: [rexRow("health", subtype)], patterns: [], investigation: null, recentSessions: [] },
      now: NOW, patternScanRan: false, hasActiveSession: false,
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ target: "reality", targetId: "rex_row" });
    expect(decisions[0]!.action).toBe("UPDATE");
  });
});
