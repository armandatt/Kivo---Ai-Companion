// The evidence pipeline behind Knowledge, against in-memory tables with the
// real engines:
//   - a session's subject is the authority for where its topic belongs
//   - the learner's "How did it go?" answer is what reaches topic mastery
//   - web End and /done go through one lifecycle

jest.mock("../consolidation/run-consolidation", () => ({ consolidateTurn: jest.fn(async () => []) }));
jest.mock("../services/openai.service", () => ({ generateOpenAIText: jest.fn(() => { throw new Error("no LLM call is allowed here"); }) }), { virtual: true });

import { prisma } from "@repo/db/client";
import { openStudySession, persistSessionEnd, persistTurn, type PersistenceInput } from "../persistence/nova-persistence";
import { matchTopicToSubject, normalizeTopicName, resolveTopicSubject, updateTopicMastery } from "../engines/topic-mastery-engine";
import {
  SESSION_OUTCOME_CONFIDENCE, UNREPORTED_SESSION_CONFIDENCE,
  buildSessionContext, computeSessionAction, sessionEvidence,
} from "../engines/study-session-engine";
import { computeAcademicState } from "../engines/academic-state-engine";
import { resolveTurnSignals } from "../engines/turn-signals";
import { translateNovaCommand } from "../commands";
import { pausedSecondsOf } from "../engines/session-clock";
import { RETENTION_TARGET, daysSinceStudied, estimateRetention, getOverdueTopics, isDueForReview } from "../engines/retention-engine";
import type { TopicMasteryState } from "../types/engine.types";
import type { ActiveSessionInfo } from "../engines/study-snapshot";
import type { SessionOutcome } from "../types/session.types";
import type { AcademicUnderstanding } from "../types/understanding.types";

type Row = Record<string, any>;
let sessions: Row[];
let topics: Row[];
let messages: Row[];
let snapshots: Row[];

const SUBJECTS = [
  { id: "os",  name: "Operating Systems", code: null },
  { id: "daa", name: "Design and Analysis of Algorithms", code: "CS301" },
  { id: "db",  name: "DBMS", code: null },
];
const subjectName = (id: string | null) => SUBJECTS.find(s => s.id === id)?.name ?? null;

const ci = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function topicMatches(row: Row, where: Row): boolean {
  if (where.subjectId !== undefined) {
    const ok = typeof where.subjectId === "string" ? row.subjectId === where.subjectId : where.subjectId.in.includes(row.subjectId);
    if (!ok) return false;
  }
  if (where.name !== undefined) {
    const ok = typeof where.name === "string" ? row.name === where.name
      : where.name.mode === "insensitive" ? ci(row.name, where.name.equals) : row.name === where.name.equals;
    if (!ok) return false;
  }
  return true;
}
function assign(row: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    row[k] = v && typeof v === "object" && !(v instanceof Date) && "increment" in v ? row[k] + v.increment : v;
  }
}

beforeEach(() => {
  sessions = []; topics = []; messages = []; snapshots = [];
  jest.clearAllMocks();
  Object.assign(prisma as Row, {
    $transaction: async (fn: (tx: Row) => Promise<unknown>) => {
      const tx = Object.create(prisma as Row) as Row;
      tx.$queryRaw = async () => [];
      return fn(tx);
    },
    novaStudySession: {
      create: async ({ data }: Row) => {
        const row = { id: `sess${sessions.length + 1}`, pausedAt: null, pauseCount: 0, totalPausedMinutes: 0, totalPausedSeconds: 0,
          confusionPoints: [], topicsCompleted: [], currentFocus: null, energyLevel: null, executionReport: null, ...data };
        sessions.push(row); return row;
      },
      findFirst:  async ({ where }: Row) => sessions.find(r => r.profileId === where.profileId && where.status.in.includes(r.status)) ?? null,
      findUnique: async ({ where }: Row) => sessions.find(r => r.id === where.id) ?? null,
      update:     async ({ where, data }: Row) => { const r = sessions.find(x => x.id === where.id)!; assign(r, data); return r; },
      updateMany: async ({ where, data }: Row) => {
        const hit = sessions.filter(r => r.id === where.id && (!where.status?.in || where.status.in.includes(r.status)));
        hit.forEach(r => assign(r, data)); return { count: hit.length };
      },
    },
    novaTopicMastery: {
      findFirst: async ({ where }: Row) => topics.find(r => topicMatches(r, where)) ?? null,
      findMany:  async ({ where }: Row) => topics.filter(r => topicMatches(r, where)),
      upsert: async ({ where, update, create }: Row) => {
        const k = where.subjectId_name;
        const existing = topics.find(r => r.subjectId === k.subjectId && r.name === k.name);
        if (existing) { assign(existing, update); return existing; }
        const row = { id: `topic${topics.length + 1}`, ...create }; topics.push(row); return row;
      },
    },
    novaSubject: { findUnique: async ({ where }: Row) => (SUBJECTS.some(x => x.id === where.id) ? { profileId: "p1" } : null) },
    // The engine's record of each change. One per (topic, session), as the table enforces.
    novaTopicMasterySnapshot: {
      create: async ({ data }: Row) => {
        if (data.sessionId && snapshots.some(r => r.topicId === data.topicId && r.sessionId === data.sessionId)) {
          throw Object.assign(new Error("unique"), { code: "P2002" });
        }
        const row = { id: `snap${snapshots.length + 1}`, ...data }; snapshots.push(row); return row;
      },
    },
    companionMessage:   { create: async ({ data }: Row) => { const row = { id: `msg${messages.length + 1}`, ...data }; messages.push(row); return row; } },
    novaLearningDNA:    { findUnique: async () => null, upsert: async () => ({}) },
    novaCognitiveState: { findUnique: async () => null, upsert: async () => ({}) },
  });
});

const T0 = new Date("2026-10-05T18:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

function active(id: string): ActiveSessionInfo {
  const r = sessions.find(x => x.id === id)!;
  return {
    id: r.id, startedAt: r.sessionDate, topicName: r.topicName, subjectId: r.subjectId, subjectName: subjectName(r.subjectId),
    status: r.status, currentFocus: null, plannedDurationMinutes: r.plannedDurationMinutes ?? 0,
    confusionPoints: r.confusionPoints, topicsCompleted: r.topicsCompleted, pauseCount: r.pauseCount,
    totalPausedMinutes: r.totalPausedMinutes, totalPausedSeconds: pausedSecondsOf(r as { totalPausedSeconds: number; totalPausedMinutes: number }),
    pausedAt: r.pausedAt, energyLevel: null,
  };
}
const lastSession = () => sessions[sessions.length - 1]!;

// A session started from the web: the page knows the subject.
async function webSession(subjectId: string, topic: string, start: Date, outcome: SessionOutcome | null, minutes = 30) {
  await openStudySession("p1", topic, SUBJECTS, start, { subjectId, durationMinutes: 25 });
  const id = lastSession().id;
  await persistSessionEnd({
    userId: "u1", profileId: "p1", activeSession: active(id), subjects: SUBJECTS, surface: "web", outcome,
    now: new Date(start.getTime() + minutes * 60_000),
  });
  return sessions.find(s => s.id === id)!;
}

// A session started and ended in chat: /study <topic> … /done.
async function chatSession(topic: string, start: Date, minutes = 30) {
  await openStudySession("p1", topic, SUBJECTS, start);          // no subject: resolved from the topic
  const id  = lastSession().id;
  const now = new Date(start.getTime() + minutes * 60_000);
  const { command, text } = translateNovaCommand("/done");
  const understanding: AcademicUnderstanding = {
    intent: "study_report", emotion: "neutral", topic, topicConfidence: 0.9,
    disclosureClass: "none", ambiguityScore: 0, routingSignal: "coaching_only", rawText: text,
  };
  const academicState = computeAcademicState({
    semesterStartDate: null, semesterEndDate: null, daysSinceJoined: 30, studySessions: [], upcomingExams: [],
    stateHistory: [], signals: { detectedSignals: [], stateUpdates: [] }, mentionedTopicMastery: null, understanding,
    storedScores: null, storedStreakDays: 0, storedConsecutiveMisses: 0,
  }, now);
  const signals        = resolveTurnSignals({ text, command, understanding, state: academicState });
  const session        = active(id);
  const sessionContext = buildSessionContext(session, 0.5, now, "p1");
  await persistTurn({
    userId: "u1", profileId: "p1", platformChatId: "c1", userText: text,
    brainOutput: { reply: "Nice.", reasoningMode: "direct", confidence: 0.8 } as PersistenceInput["brainOutput"],
    academicState, signals, graphNode: "session_end", intervention: "celebrate",
    understanding, activeSession: session, subjects: SUBJECTS, sessionContext,
    sessionAction: computeSessionAction(understanding, signals, sessionContext),
    patterns: { detectedPatterns: [], dominantPattern: null, analysisRunAt: now, messagesSinceLastRun: 0 },
    patternScanRan: false, now,
  });
  return sessions.find(s => s.id === id)!;
}

const topicRow = (subjectId: string, name: string) => topics.find(t => t.subjectId === subjectId && ci(t.name, name));

// ── 1–5. Topic attachment ─────────────────────────────────────────────────────

describe("topic attachment: the session's subject is the authority", () => {
  it.each([
    ["os",  "Deadlocks"],
    ["daa", "Dynamic Programming"],
    ["db",  "Normalization"],
  ])("%s + %s creates that topic under that subject", async (subjectId, topic) => {
    const session = await webSession(subjectId, topic, T0, "good");
    expect(session).toMatchObject({ status: "completed", subjectId, topicName: topic });
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({ subjectId, name: topic, reviewCount: 1 });
    // Nothing about the topic's wording was needed, and none of it names the subject.
    expect(matchTopicToSubject(topic, SUBJECTS)).toBeNull();
  });

  it("a second session on the same subject and topic updates the same row", async () => {
    await webSession("os", "Deadlocks", T0, "okay");
    await webSession("os", "Deadlocks", at(24 * 60), "good");
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({ subjectId: "os", name: "Deadlocks", reviewCount: 2 });
  });

  it("casing and spacing do not make a second topic", async () => {
    await webSession("os", "Deadlocks", T0, "okay");
    await webSession("os", "  deadlocks ", at(24 * 60), "good");
    await webSession("os", "DEADLOCKS", at(48 * 60), "good");
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({ name: "Deadlocks", reviewCount: 3 });   // the first spelling is kept
    expect(normalizeTopicName("  dynamic   programming ")).toBe("dynamic programming");
  });

  it("the same topic name under two subjects is two topics", async () => {
    await webSession("os", "Scheduling", T0, "good");
    await webSession("daa", "Scheduling", at(24 * 60), "struggled");
    expect(topics.map(t => [t.subjectId, t.name]).sort()).toEqual([["daa", "Scheduling"], ["os", "Scheduling"]]);
  });

  it("the session's subject wins even when the topic's wording names another subject", async () => {
    await webSession("daa", "DBMS query optimisation", T0, "good");
    expect(topics).toHaveLength(1);
    expect(topics[0]!.subjectId).toBe("daa");
  });
});

describe("the subject matcher, for a topic that arrives with no subject", () => {
  it("matches a subject named outright: name, code, acronym, or name inside the text", () => {
    expect(matchTopicToSubject("Operating Systems", SUBJECTS)?.subjectId).toBe("os");
    expect(matchTopicToSubject("operating  systems", SUBJECTS)?.subjectId).toBe("os");
    expect(matchTopicToSubject("OS", SUBJECTS)?.subjectId).toBe("os");
    expect(matchTopicToSubject("DAA", SUBJECTS)?.subjectId).toBe("daa");
    expect(matchTopicToSubject("cs301", SUBJECTS)?.subjectId).toBe("daa");
    expect(matchTopicToSubject("DBMS", SUBJECTS)?.subjectId).toBe("db");
    expect(matchTopicToSubject("operating systems deadlocks", SUBJECTS)).toEqual({ subjectId: "os", resolvedName: "operating systems deadlocks" });
    expect(matchTopicToSubject("DBMS normalization", SUBJECTS)?.subjectId).toBe("db");
  });

  it("does not match on a fragment", () => {
    for (const text of ["a", "A", "s", "Systems", "Operating", "Algorithms", "Design", "o", "ms", "DBM", ""]) {
      expect(matchTopicToSubject(text, SUBJECTS)).toBeNull();
    }
  });

  it("does not guess a subject for a topic that names none", () => {
    for (const text of ["Deadlocks", "Dynamic Programming", "Normalization", "Paging"]) {
      expect(matchTopicToSubject(text, SUBJECTS)).toBeNull();
    }
  });

  it("prefers the longest subject name contained in the text", () => {
    const subjects = [{ id: "alg", name: "Algorithms" }, { id: "adv", name: "Advanced Algorithms" }];
    expect(matchTopicToSubject("advanced algorithms flows", subjects)?.subjectId).toBe("adv");
    expect(matchTopicToSubject("algorithms sorting", subjects)?.subjectId).toBe("alg");
  });

  it("an existing topic keeps the subject it was first studied in", async () => {
    expect(await resolveTopicSubject("Deadlocks", SUBJECTS)).toBeNull();        // nothing known yet: nothing invented
    await webSession("os", "Deadlocks", T0, "good");
    expect(await resolveTopicSubject("deadlocks", SUBJECTS)).toEqual({ subjectId: "os", resolvedName: "Deadlocks" });
  });

  it("stays unresolved when the topic exists under two subjects", async () => {
    await webSession("os", "Scheduling", T0, "good");
    await webSession("daa", "Scheduling", at(24 * 60), "good");
    expect(await resolveTopicSubject("Scheduling", SUBJECTS)).toBeNull();
  });
});

describe("chat and web attach topics the same way", () => {
  it("/study on a topic the student already has goes to its subject, and /done updates that same row", async () => {
    await webSession("os", "Deadlocks", T0, "okay");
    const session = await chatSession("deadlocks", at(24 * 60));
    expect(session).toMatchObject({ status: "completed", subjectId: "os" });
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({ subjectId: "os", name: "Deadlocks", reviewCount: 2 });
  });

  it("/study naming the subject attaches to it", async () => {
    const session = await chatSession("DBMS normalization", T0);
    expect(session.subjectId).toBe("db");
    expect(topicRow("db", "DBMS normalization")).toMatchObject({ reviewCount: 1 });
  });

  it("/study on an unknown topic with no subject writes no mastery, as before: nothing is invented", async () => {
    const session = await chatSession("Deadlocks", T0);
    expect(session).toMatchObject({ status: "completed", subjectId: null, topicName: "Deadlocks" });
    expect(session.executionReport.masteryUpdates).toEqual([]);
    expect(topics).toEqual([]);
  });

  it("both ends produce a report of the same shape through the same lifecycle", async () => {
    const web  = await webSession("os", "Deadlocks", T0, null);
    const chat = await chatSession("deadlocks", at(24 * 60));
    const shape = (r: Row) => Object.keys(r).sort();
    expect(shape(chat.executionReport)).toEqual(shape(web.executionReport));
    expect(web.executionReport).toMatchObject({ evidenceBasis: "unreported", outcome: null });
    expect(chat.executionReport).toMatchObject({ evidenceBasis: "unreported", outcome: null });
    expect(chat.executionReport.masteryUpdates).toEqual([{ topicName: "Deadlocks", subjectId: "os", confidence: UNREPORTED_SESSION_CONFIDENCE }]);
  });
});

// ── 6–11. The outcome signal ──────────────────────────────────────────────────

describe("the learner's answer to 'How did it go?'", () => {
  it("maps to four ordered steps, one per grade band of the mastery engine", () => {
    expect(SESSION_OUTCOME_CONFIDENCE).toEqual({ struggled: 0.30, okay: 0.60, good: 0.75, crushed_it: 0.90 });
    const values = Object.values(SESSION_OUTCOME_CONFIDENCE);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
  });

  it("an explicit answer wins over a claim read from chat, and no answer is marked as none", () => {
    expect(sessionEvidence({ outcome: "struggled", masteryClaimIntensity: 0.95 }))
      .toEqual({ confidence: 0.30, basis: "learner_outcome", outcome: "struggled" });
    expect(sessionEvidence({ masteryClaimIntensity: 0.8 })).toEqual({ confidence: 0.8, basis: "mastery_claim", outcome: null });
    expect(sessionEvidence({})).toEqual({ confidence: UNREPORTED_SESSION_CONFIDENCE, basis: "unreported", outcome: null });
    expect(sessionEvidence({ outcome: null })).toMatchObject({ basis: "unreported" });
  });

  it.each([
    ["struggled",  0.30, 1],
    ["okay",       0.60, 2],
    ["good",       0.75, 3],
    ["crushed_it", 0.90, 3],
  ] as Array<[SessionOutcome, number, number]>)("%s: the report carries it and the new topic starts at %p, next review in %p day(s)", async (outcome, mastery, interval) => {
    const session = await webSession("os", "Deadlocks", T0, outcome);
    expect(session.executionReport).toMatchObject({
      outcome, evidenceBasis: "learner_outcome",
      masteryUpdates: [{ topicName: "Deadlocks", subjectId: "os", confidence: mastery }],
    });
    expect(topics[0]).toMatchObject({ masteryProbability: mastery, confidenceReported: mastery, intervalDays: interval, reviewCount: 1 });
  });

  it("the answer moves an existing topic in its own direction", async () => {
    const seed = async () => { topics = []; sessions = []; await webSession("os", "Deadlocks", T0, "okay"); };
    const after = async (outcome: SessionOutcome) => {
      await seed();
      await webSession("os", "Deadlocks", at(48 * 60), outcome);
      return { ...topics[0]! };
    };
    const struggled = await after("struggled");
    const okay      = await after("okay");
    const good      = await after("good");
    const crushed   = await after("crushed_it");

    expect(struggled.masteryProbability).toBeLessThan(0.6);
    expect(okay.masteryProbability).toBe(0.6);
    expect(good.masteryProbability).toBeGreaterThan(0.6);
    expect(crushed.masteryProbability).toBeGreaterThan(good.masteryProbability);
    // Struggling brings the topic back tomorrow; doing well pushes it out.
    expect(struggled.intervalDays).toBe(1);
    expect(good.intervalDays).toBeGreaterThan(struggled.intervalDays);
    expect(crushed.intervalDays).toBeGreaterThanOrEqual(good.intervalDays);
  });

  it("a session that went well no longer pulls a strong topic down toward 0.6", async () => {
    await webSession("os", "Deadlocks", T0, "crushed_it");
    await webSession("os", "Deadlocks", at(72 * 60), "crushed_it");
    expect(topics[0]!.masteryProbability).toBe(0.9);
  });

  it("ending with no answer falls back to the neutral value and says so in the report", async () => {
    const session = await webSession("os", "Deadlocks", T0, null);
    expect(session.executionReport).toMatchObject({ outcome: null, evidenceBasis: "unreported" });
    expect(session.executionReport.masteryUpdates[0].confidence).toBe(UNREPORTED_SESSION_CONFIDENCE);
    expect(topics[0]).toMatchObject({ masteryProbability: 0.6, reviewCount: 1 });
  });

  it("writes the same evidence trail whatever the answer: one log entry, one consolidation job", async () => {
    const { consolidateTurn } = jest.requireMock("../consolidation/run-consolidation");
    await webSession("os", "Deadlocks", T0, "good");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: "user", metadata: { signals: ["study_report"], surface: "web" } });
    expect(consolidateTurn).toHaveBeenCalledTimes(1);
  });
});

// The conversation path (a casual "I studied X") stays weaker than a session.
describe("conversation stays weaker than a session", () => {
  it("nudges an existing topic without touching its schedule or its evidence count", async () => {
    await webSession("os", "Deadlocks", T0, "struggled");
    const before = { ...topics[0]! };
    await updateTopicMastery("os", "deadlocks", 0.9, at(60), "conversation_signal");
    expect(topics).toHaveLength(1);
    expect(topics[0]!.reviewCount).toBe(before.reviewCount);
    expect(topics[0]!.intervalDays).toBe(before.intervalDays);
    expect(topics[0]!.nextReviewAt).toEqual(before.nextReviewAt);
    expect(topics[0]!.masteryProbability).toBeCloseTo(0.85 * before.masteryProbability + 0.15 * 0.9, 2);
  });
});

// ── The engine records each change it makes ───────────────────────────────────
describe("mastery history", () => {
  it("records the value before and after every change, with what caused it", async () => {
    await webSession("os", "Deadlocks", T0, "struggled");
    await updateTopicMastery("os", "deadlocks", 0.9, at(60), "conversation_signal");
    await webSession("os", "Deadlocks", at(24 * 60), "good");

    expect(snapshots.map(r => [r.source, r.masteryBefore, r.masteryAfter, r.reviewCount, r.sessionId])).toEqual([
      ["session_report",      null, 0.3,  1, "sess1"],
      ["conversation_signal", 0.3,  0.39, 1, null],
      ["session_report",      0.39, 0.53, 2, "sess2"],
    ]);
    expect(snapshots.every(r => r.topicId === topics[0]!.id && r.profileId === "p1")).toBe(true);
    // The record is the topic's own value, not a second calculation.
    expect(snapshots[2]!.masteryAfter).toBe(topics[0]!.masteryProbability);
  });

  it("refuses a second record for the same topic and session", async () => {
    await updateTopicMastery("os", "Deadlocks", 0.75, T0, "session_report", "sessX");
    await expect(updateTopicMastery("os", "Deadlocks", 0.75, at(1), "session_report", "sessX")).resolves.toBeUndefined();
    expect(snapshots).toHaveLength(1);
  });
});

// ── The outcome sets the schedule, and the schedule sets "due" ────────────────

// A stored topic row read the way the Knowledge Engine reads it.
function state(row: Row, now: Date): TopicMasteryState {
  return {
    topicId: row.id, topicName: row.name, subjectName: subjectName(row.subjectId)!,
    masteryProbability: row.masteryProbability, confidenceReported: row.confidenceReported, calibrationGap: 0,
    masteryTrend: "stable", reviewCount: row.reviewCount, lastStudied: row.lastStudiedAt,
    retentionEstimate: estimateRetention(row.efFactor, daysSinceStudied(row.lastStudiedAt, now)),
    reviewDueAt: row.nextReviewAt,
  };
}
const DAY_MIN = 24 * 60;
const END     = 30;   // sessions here run 30 minutes from T0
const afterEnd = (days: number, minutes = 0) => at(END + days * DAY_MIN + minutes);
const dueAt = (now: Date) => isDueForReview(state(topics[0]!, now), now);

describe("an answer schedules the next review, and the topic is due on that date", () => {
  it("Struggled: next review tomorrow, due tomorrow, while it is still fresh", async () => {
    await webSession("os", "Deadlocks", T0, "struggled");
    expect(topics[0]).toMatchObject({ intervalDays: 1 });
    expect(topics[0]!.nextReviewAt).toEqual(afterEnd(1));

    expect(dueAt(afterEnd(0, 1))).toBe(false);          // just after the session
    expect(dueAt(afterEnd(1, -1))).toBe(false);         // a minute before the date
    expect(dueAt(afterEnd(1))).toBe(true);              // tomorrow
    expect(state(topics[0]!, afterEnd(1)).retentionEstimate).toBeGreaterThanOrEqual(RETENTION_TARGET);
  });

  it("Good: not due before its scheduled date, due on it", async () => {
    await webSession("os", "Deadlocks", T0, "good");
    expect(topics[0]!.nextReviewAt).toEqual(afterEnd(3));
    expect(dueAt(afterEnd(1))).toBe(false);
    expect(dueAt(afterEnd(2, DAY_MIN - 1))).toBe(false);
    expect(dueAt(afterEnd(3))).toBe(true);
  });

  it("Crushed it: stays not due until its scheduled date, however long that is", async () => {
    await webSession("os", "Deadlocks", T0, "crushed_it");
    await webSession("os", "Deadlocks", at(3 * DAY_MIN), "crushed_it");
    const row = topics[0]!;
    const due = row.nextReviewAt as Date;
    expect(row.intervalDays).toBeGreaterThan(3);
    // Retention fades below the target well before a long interval ends;
    // the topic is still not due until the date.
    const dayBefore = new Date(due.getTime() - 24 * 3_600_000);
    expect(state(row, dayBefore).retentionEstimate).toBeLessThan(RETENTION_TARGET);
    expect(isDueForReview(state(row, dayBefore), dayBefore)).toBe(false);
    expect(isDueForReview(state(row, due), due)).toBe(true);
  });

  it("the better the answer, the later the topic comes due", async () => {
    const dueAfter = async (first: SessionOutcome, second: SessionOutcome) => {
      topics = []; sessions = [];
      await webSession("os", "Deadlocks", T0, first);
      await webSession("os", "Deadlocks", at(3 * DAY_MIN), second);
      return (topics[0]!.nextReviewAt as Date).getTime();
    };
    const struggled = await dueAfter("good", "struggled");
    const okay      = await dueAfter("good", "okay");
    const good      = await dueAfter("good", "good");
    const crushed   = await dueAfter("good", "crushed_it");
    expect(struggled).toBeLessThan(okay);
    expect(okay).toBeLessThanOrEqual(good);
    expect(good).toBeLessThanOrEqual(crushed);
    expect(struggled).toBeLessThan(crushed);
  });

  it("the interval arithmetic is the mastery engine's own, unchanged", async () => {
    // First session: 1 / 2 / 3 / 3 days by answer.
    const first: Array<[SessionOutcome, number]> = [["struggled", 1], ["okay", 2], ["good", 3], ["crushed_it", 3]];
    for (const [outcome, interval] of first) {
      topics = []; sessions = [];
      await webSession("os", "Deadlocks", T0, outcome);
      expect(topics[0]).toMatchObject({ intervalDays: interval, efFactor: 2.5, reviewCount: 1 });
      expect(topics[0]!.nextReviewAt).toEqual(afterEnd(interval));
    }
    // Second session on a topic at interval 3, ease 2.5:
    //   okay (grade 3)        ease 2.5 − 0.14 = 2.36 → round(3 × 2.36) = 7
    //   good (grade 4)        ease 2.5        = 2.5  → round(3 × 2.5)  = 8
    //   crushed it (grade 5)  ease 2.5 + 0.1  = 2.6  → round(3 × 2.6)  = 8
    //   struggled (grade 1)   ease 2.5 − 0.2  = 2.3  → reset to 1
    const second: Array<[SessionOutcome, number, number]> = [["okay", 2.36, 7], ["good", 2.5, 8], ["crushed_it", 2.6, 8], ["struggled", 2.3, 1]];
    for (const [outcome, ef, interval] of second) {
      topics = []; sessions = [];
      await webSession("os", "Deadlocks", T0, "good");
      await webSession("os", "Deadlocks", at(3 * DAY_MIN), outcome);
      expect(topics[0]).toMatchObject({ efFactor: ef, intervalDays: interval, reviewCount: 2 });
      expect(topics[0]!.nextReviewAt).toEqual(at(3 * DAY_MIN + END + interval * DAY_MIN));
    }
  });

  it("the due list is the topics whose date has arrived, whatever their retention", async () => {
    await webSession("os", "Deadlocks", T0, "struggled");   // due in 1 day
    await webSession("os", "Paging", T0, "good");           // due in 3 days
    const list = (now: Date) => getOverdueTopics(topics.map(t => state(t, now)), now).map(t => t.topicName);
    expect(list(afterEnd(0, 5))).toEqual([]);
    expect(list(afterEnd(1))).toEqual(["Deadlocks"]);
    expect(list(afterEnd(2))).toEqual(["Deadlocks"]);
    expect(list(afterEnd(3)).sort()).toEqual(["Deadlocks", "Paging"]);
  });
});
