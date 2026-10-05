// Session lifecycle against an in-memory session table.
//   - a session ended on the web leaves what /done leaves
//   - paused time is excluded to the second, and survives a reload
//   - repeated and concurrent commands write nothing twice

jest.mock("../consolidation/run-consolidation", () => ({ consolidateTurn: jest.fn(async () => []) }));
jest.mock("../engines/topic-mastery-engine", () => ({
  ...jest.requireActual("../engines/topic-mastery-engine"),
  updateTopicMastery: jest.fn(async () => undefined),
}));

import { prisma } from "@repo/db/client";
import { consolidateTurn } from "../consolidation/run-consolidation";
import { updateTopicMastery } from "../engines/topic-mastery-engine";
import {
  openStudySession,
  pauseStudySession,
  persistSessionEnd,
  persistTurn,
  resumeStudySession,
  type PersistenceInput,
} from "../persistence/nova-persistence";
import { computeAcademicState } from "../engines/academic-state-engine";
import { buildSessionContext, computeSessionAction } from "../engines/study-session-engine";
import { pausedSecondsOf, sessionElapsedSeconds } from "../engines/session-clock";
import { resolveTurnSignals } from "../engines/turn-signals";
import { translateNovaCommand } from "../commands";
import { toSessionView } from "../product/session-view";
import type { ActiveSessionInfo } from "../engines/study-snapshot";
import type { SessionOutcome } from "../types/session.types";
import type { AcademicUnderstanding } from "../types/understanding.types";
import type { Evidence } from "../types/consolidation.types";

// ── In-memory tables ──────────────────────────────────────────────────────────

type Row = Record<string, any>;
let sessions: Row[];
let messages: Row[];

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object" && !(v instanceof Date) && "in" in v) return (v.in as unknown[]).includes(row[k]);
    if (v instanceof Date) return row[k] instanceof Date && row[k].getTime() === v.getTime();
    return row[k] === v;
  });
}
function assign(row: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    row[k] = v && typeof v === "object" && "increment" in v ? row[k] + v.increment : v;
  }
}

// Stands in for `SELECT … FOR UPDATE` on the profile row: one transaction at
// a time per profile. The real lock is exercised against Postgres in
// __integration__/nova-session-start.itest.ts.
let rowLocks: Map<string, Promise<void>>;

beforeEach(() => {
  sessions = [];
  messages = [];
  rowLocks = new Map();
  jest.clearAllMocks();
  Object.assign(prisma as Row, {
    $transaction: async (fn: (tx: Row) => Promise<unknown>) => {
      let release: (() => void) | undefined;
      const tx = Object.create(prisma as Row) as Row;
      tx.$queryRaw = async (_sql: TemplateStringsArray, profileId: string) => {
        const held = rowLocks.get(profileId) ?? Promise.resolve();
        rowLocks.set(profileId, held.then(() => new Promise<void>(resolve => { release = resolve; })));
        await held;
      };
      try { return await fn(tx); } finally { release?.(); }
    },
    novaStudySession: {
      create: async ({ data }: Row) => {
        const row = {
          id: `sess${sessions.length + 1}`, pausedAt: null, pauseCount: 0, totalPausedMinutes: 0, totalPausedSeconds: 0,
          confusionPoints: [], topicsCompleted: [], currentFocus: null, energyLevel: null, executionReport: null, ...data,
        };
        sessions.push(row);
        return row;
      },
      findUnique: async ({ where }: Row) => sessions.find(r => r.id === where.id) ?? null,
      findFirst: async ({ where }: Row) => sessions.find(r => matches(r, where)) ?? null,
      update: async ({ where, data }: Row) => { const r = sessions.find(x => x.id === where.id)!; assign(r, data); return r; },
      updateMany: async ({ where, data }: Row) => {
        const hit = sessions.filter(r => matches(r, where));
        hit.forEach(r => assign(r, data));
        return { count: hit.length };
      },
    },
    companionMessage: {
      create: async ({ data }: Row) => { const row = { id: `msg${messages.length + 1}`, ...data }; messages.push(row); return row; },
    },
    novaTopicMastery:   { findMany: async () => [] },
    novaLearningDNA:    { findUnique: async () => null, upsert: async () => ({}) },
    novaCognitiveState: { findUnique: async () => null, upsert: async () => ({}) },
  });
});

// What loadStudySnapshot hands to every reader: the row, as an active session.
// Called fresh each time, it is what a page reload sees.
function load(id = "sess1"): ActiveSessionInfo {
  const r = sessions.find(x => x.id === id)!;
  return {
    id: r.id, startedAt: r.sessionDate, topicName: r.topicName, subjectId: r.subjectId, subjectName: "Operating Systems",
    status: r.status, currentFocus: r.currentFocus, plannedDurationMinutes: r.plannedDurationMinutes ?? 0,
    confusionPoints: r.confusionPoints, topicsCompleted: r.topicsCompleted, pauseCount: r.pauseCount,
    totalPausedMinutes: r.totalPausedMinutes, totalPausedSeconds: pausedSecondsOf(r as { totalPausedSeconds: number; totalPausedMinutes: number }), pausedAt: r.pausedAt,
    energyLevel: r.energyLevel,
  };
}

const T0 = new Date("2026-10-05T18:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const SUBJECTS = [{ id: "s1", name: "Operating Systems" }];
const start = () => openStudySession("p1", "Deadlocks", SUBJECTS, T0, { subjectId: "s1", durationMinutes: 45 });
const endOnWeb = (now: Date, active = load(), outcome: SessionOutcome | null = null) =>
  persistSessionEnd({ userId: "u1", profileId: "p1", activeSession: active, subjects: SUBJECTS, surface: "web", outcome, now });

const consolidations = () => (consolidateTurn as jest.Mock).mock.calls.map(c => c[0]);
const studyReports = (evidence: Evidence[]) =>
  evidence.filter(e => e.kind === "signal" && e.signalType === "study_report");

// ── /done, as the orchestrator runs it ────────────────────────────────────────

async function endWithDone(now: Date, active = load()) {
  const { command, text } = translateNovaCommand("/done");
  const understanding: AcademicUnderstanding = {
    intent: "study_report", emotion: "neutral", topic: active.topicName, topicConfidence: 0.9,
    disclosureClass: "none", ambiguityScore: 0, routingSignal: "coaching_only", rawText: text,
  };
  const academicState = computeAcademicState({
    semesterStartDate: null, semesterEndDate: null, daysSinceJoined: 30, studySessions: [], upcomingExams: [],
    stateHistory: [], signals: { detectedSignals: [], stateUpdates: [] }, mentionedTopicMastery: null, understanding,
    storedScores: null, storedStreakDays: 0, storedConsecutiveMisses: 0,
  }, now);
  const signals        = resolveTurnSignals({ text, command, understanding, state: academicState });
  const sessionContext = buildSessionContext(active, 0.5, now, "p1");
  const sessionAction  = computeSessionAction(understanding, signals, sessionContext);

  await persistTurn({
    userId: "u1", profileId: "p1", platformChatId: "c1", userText: text,
    brainOutput: { reply: "Nice work.", reasoningMode: "direct", confidence: 0.8 } as PersistenceInput["brainOutput"],
    academicState, signals, graphNode: "session_end", intervention: "celebrate",
    understanding, activeSession: active, subjects: SUBJECTS, sessionContext, sessionAction,
    patterns: { detectedPatterns: [], dominantPattern: null, analysisRunAt: now, messagesSinceLastRun: 0 },
    patternScanRan: false, now,
  });
}

// Everything a session end leaves behind, with the ids and wall-clock stamps
// that necessarily differ between two runs removed.
function footprint() {
  const row = sessions[0]!;
  const userMessage = messages.find(m => m.role === "user")!;
  const job = consolidations()[0]!;
  return {
    session: {
      status: row.status, durationMinutes: row.durationMinutes, focusQuality: row.focusQuality,
      topicsCompleted: row.topicsCompleted, report: row.executionReport,
    },
    mastery: (updateTopicMastery as jest.Mock).mock.calls.map(c => [c[0], c[1], c[2], c[4]]),
    message: { text: userMessage.text, intent: userMessage.intent, signals: userMessage.metadata.signals },
    evidence: studyReports(job.evidence).map(({ sourceMessageId, ...rest }) => ({ ...rest, linked: sourceMessageId === userMessage.id })),
    job: { messageId: job.messageId === userMessage.id, hasActiveSession: job.hasActiveSession, profileId: job.profileId },
  };
}

// ── A. Web end produces the canonical session evidence ────────────────────────

describe("ending a session from the web", () => {
  it("closes the session with an execution report and feeds mastery from it", async () => {
    await start();
    expect(await endOnWeb(at(40 * 60))).toBe(true);

    const row = sessions[0]!;
    expect(row).toMatchObject({ status: "completed", durationMinutes: 40, focusQuality: "deep", topicsCompleted: ["Deadlocks"] });
    expect(row.executionReport).toMatchObject({
      sessionId: "sess1", actualDurationMinutes: 40, plannedDurationMinutes: 45, completionStatus: "natural",
      masteryUpdates: [{ topicName: "Deadlocks", subjectId: "s1", confidence: 0.6 }],
      // Nobody said how it went: the 0.6 is a placeholder and is marked as one.
      outcome: null, evidenceBasis: "unreported",
    });
    expect(updateTopicMastery).toHaveBeenCalledTimes(1);
    expect(updateTopicMastery).toHaveBeenCalledWith("s1", "Deadlocks", 0.6, at(40 * 60), "session_report", "sess1");
  });

  it("records the command in the conversation log and hands a study report to consolidation", async () => {
    await start();
    await endOnWeb(at(40 * 60));

    expect(messages).toHaveLength(1);   // the command; no reply was generated, so none is stored
    expect(messages[0]).toMatchObject({
      role: "user", userId: "u1", text: translateNovaCommand("/done").text, intent: "study_report",
      metadata: { companion: "nova", signals: ["study_report"], surface: "web" },
    });

    const [job] = consolidations();
    expect(job).toMatchObject({ messageId: "msg1", userId: "u1", profileId: "p1", hasActiveSession: true });
    expect(studyReports(job.evidence)).toEqual([expect.objectContaining({
      kind: "signal", source: "signal_engine", signalType: "study_report",
      corroborated: true, confidence: 1, topic: "Deadlocks", sourceMessageId: "msg1",
    })]);
    expect(job.evidence).toHaveLength(1);   // nothing inferred: no reality, pattern or investigation evidence
  });
});

// ── B. /done and the web End button converge ──────────────────────────────────

describe("/done and the web End button", () => {
  it("leave the same session row, report, mastery update, log entry and evidence", async () => {
    await start();
    await pauseStudySession("sess1", at(600));
    await resumeStudySession("sess1", at(690));
    await endWithDone(at(40 * 60));
    const viaDone = footprint();

    sessions = []; messages = []; jest.clearAllMocks();

    await start();
    await pauseStudySession("sess1", at(600));
    await resumeStudySession("sess1", at(690));
    await endOnWeb(at(40 * 60));
    const viaWeb = footprint();

    expect(viaWeb).toEqual(viaDone);
    expect(viaWeb.session.report).toMatchObject({ actualDurationMinutes: 38, pauseCount: 1 });
    expect(viaWeb.evidence).toHaveLength(1);
    expect(viaWeb.evidence[0]).toMatchObject({ linked: true, corroborated: true });
  });
});

// ── C. Paused time is not study time ──────────────────────────────────────────

describe("the session clock", () => {
  it("runs, freezes on pause, and excludes the pause to the second on resume", async () => {
    await start();
    expect(sessionElapsedSeconds(load(), at(125))).toBe(125);

    await pauseStudySession("sess1", at(125));
    expect(sessionElapsedSeconds(load(), at(125))).toBe(125);
    expect(sessionElapsedSeconds(load(), at(160))).toBe(125);   // waiting does not move it

    await resumeStudySession("sess1", at(172));                 // a 47-second pause
    expect(sessions[0]).toMatchObject({ status: "in_progress", pausedAt: null, totalPausedSeconds: 47, totalPausedMinutes: 0 });
    expect(sessionElapsedSeconds(load(), at(172))).toBe(125);   // no jump on resume
    expect(sessionElapsedSeconds(load(), at(180))).toBe(133);
  });

  it("adds up several pauses exactly", async () => {
    await start();
    await pauseStudySession("sess1", at(100)); await resumeStudySession("sess1", at(147));   // 47 s
    await pauseStudySession("sess1", at(300)); await resumeStudySession("sess1", at(338));   // 38 s
    expect(sessions[0]).toMatchObject({ totalPausedSeconds: 85, totalPausedMinutes: 1, pauseCount: 2 });
    expect(sessionElapsedSeconds(load(), at(400))).toBe(315);
  });

  it("does not count an open pause when the session is ended while paused", async () => {
    await start();
    await pauseStudySession("sess1", at(20 * 60));
    await endOnWeb(at(50 * 60));
    expect(sessions[0]).toMatchObject({ status: "completed", durationMinutes: 20 });
    expect(sessions[0]!.executionReport).toMatchObject({ actualDurationMinutes: 20 });
  });

  it("reads a session paused before seconds were stored", () => {
    expect(pausedSecondsOf({ totalPausedSeconds: 0, totalPausedMinutes: 3 })).toBe(180);
    expect(pausedSecondsOf({ totalPausedSeconds: 200, totalPausedMinutes: 3 })).toBe(200);
  });
});

// ── D. A reload sees the same clock ───────────────────────────────────────────

describe("reloading the page", () => {
  it("gets the same elapsed time, because the clock is the stored row", async () => {
    await start();
    await pauseStudySession("sess1", at(125));
    await resumeStudySession("sess1", at(172));

    const before = toSessionView(load(), at(200));
    const after  = toSessionView(load(), at(200));   // a fresh read of the row
    expect(after).toEqual(before);
    expect(after).toMatchObject({ status: "in_progress", elapsedSeconds: 153, pauseCount: 1 });

    // …and a reload five seconds later is five seconds further on, no more.
    expect(toSessionView(load(), at(205)).elapsedSeconds).toBe(158);
  });

  it("keeps a paused clock still across reloads", async () => {
    await start();
    await pauseStudySession("sess1", at(125));
    expect(toSessionView(load(), at(130))).toMatchObject({ status: "paused", elapsedSeconds: 125 });
    expect(toSessionView(load(), at(900))).toMatchObject({ status: "paused", elapsedSeconds: 125 });
  });
});

// ── E. Repeated and concurrent commands ───────────────────────────────────────

describe("repeated commands", () => {
  it("a second end writes nothing", async () => {
    await start();
    const stale = load();                       // what a second tab still believes
    expect(await endOnWeb(at(1800))).toBe(true);
    const report = sessions[0]!.executionReport;

    expect(await endOnWeb(at(2400), stale)).toBe(false);
    expect(sessions[0]!.executionReport).toBe(report);
    expect(sessions[0]!.durationMinutes).toBe(30);
    expect(updateTopicMastery).toHaveBeenCalledTimes(1);
    expect(messages).toHaveLength(1);
    expect(consolidateTurn).toHaveBeenCalledTimes(1);
  });

  it("two ends at once consume the report once", async () => {
    await start();
    const active = load();
    const results = await Promise.all([endOnWeb(at(1800), active), endOnWeb(at(1800), active)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(updateTopicMastery).toHaveBeenCalledTimes(1);
    expect(consolidateTurn).toHaveBeenCalledTimes(1);
  });

  it("/done arriving just after a web end does not consume a second report", async () => {
    await start();
    const stale = load();                       // the chat turn loaded the session before it closed
    await endOnWeb(at(1800));
    const report = sessions[0]!.executionReport;

    await endWithDone(at(1805), stale);
    expect(sessions[0]!.executionReport).toBe(report);
    expect(updateTopicMastery).toHaveBeenCalledTimes(1);
  });

  it("a second resume adds no paused time", async () => {
    await start();
    await pauseStudySession("sess1", at(100));
    await resumeStudySession("sess1", at(147));
    await resumeStudySession("sess1", at(500));
    expect(sessions[0]).toMatchObject({ status: "in_progress", totalPausedSeconds: 47 });
  });

  it("two resumes at once count the pause once", async () => {
    await start();
    await pauseStudySession("sess1", at(100));
    await Promise.all([resumeStudySession("sess1", at(147)), resumeStudySession("sess1", at(147))]);
    expect(sessions[0]).toMatchObject({ status: "in_progress", totalPausedSeconds: 47 });
  });

  it("a second pause does not restart the pause or count another break", async () => {
    await start();
    await pauseStudySession("sess1", at(100));
    await pauseStudySession("sess1", at(140));
    expect(sessions[0]).toMatchObject({ status: "paused", pauseCount: 1 });
    expect(sessions[0]!.pausedAt).toEqual(at(100));
  });
});

// ── Starting ──────────────────────────────────────────────────────────────────

describe("starting a session", () => {
  const open = () => sessions.filter(s => s.status === "in_progress" || s.status === "paused");

  it("a second start while one is open creates nothing", async () => {
    await start();
    await openStudySession("p1", "Paging", SUBJECTS, at(60));
    expect(open()).toHaveLength(1);
    expect(open()[0]).toMatchObject({ topicName: "Deadlocks", plannedDurationMinutes: 45 });
  });

  it("a paused session still counts as open", async () => {
    await start();
    await pauseStudySession("sess1", at(30));
    await openStudySession("p1", "Paging", SUBJECTS, at(60));
    expect(sessions).toHaveLength(1);
  });

  it("starts at the same moment open one session", async () => {
    await Promise.all([start(), start(), openStudySession("p1", "Paging", SUBJECTS, T0)]);
    expect(open()).toHaveLength(1);
  });

  it("a new session can start once the last one ended", async () => {
    await start();
    await endOnWeb(at(1800));
    await openStudySession("p1", "Paging", SUBJECTS, at(2000));
    expect(sessions.map(s => s.status)).toEqual(["completed", "in_progress"]);
  });

  it("different learners start independently", async () => {
    await Promise.all([start(), openStudySession("p2", "Graphs", [], T0)]);
    expect(open().map(s => s.profileId).sort()).toEqual(["p1", "p2"]);
  });
});
