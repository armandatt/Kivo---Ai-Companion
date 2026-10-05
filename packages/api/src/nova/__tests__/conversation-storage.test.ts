// ─── Conversation storage + consolidation wiring (in-memory DB) ───────────────
// Verifies the three behaviors that broke when Nova stored conversation turns
// in MemoryFact: memory retrieval, rate limiting, proactive suppression.
import { prisma } from "@repo/db/client";
import {
  saveUserMessage,
  saveAssistantMessage,
  loadConversationHistory,
  loadSignalHistory,
  userMessagedSince,
} from "../adapters/conversation-adapter.js";
import { getRelevantMemories } from "../adapters/memory-adapter.js";
import {
  consolidateTurn,
  processConsolidationJob,
  retryPendingConsolidations,
} from "../consolidation/run-consolidation.js";
import { LEASE_MS, MAX_ATTEMPTS } from "../consolidation/stores/consolidation-job-store.js";
import { checkRateLimit } from "../../services/rateLimit.service";
import type { AcademicUnderstanding } from "../types/understanding.types.js";
import type { Evidence } from "../types/consolidation.types.js";

// ── Minimal in-memory Prisma ──────────────────────────────────────────────────

type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "OR") return (cond as Row[]).some(c => matches(row, c));
    const value = row[key];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      if ("gte" in cond) return value >= cond.gte;
      if ("lt"  in cond) return value !== null && value !== undefined && value < cond.lt;
      if ("not" in cond) return value !== cond.not;
      if ("in"  in cond) return (cond.in as unknown[]).includes(value);
      // compound unique: { userId_type_key: { userId, type, key } }
      return matches(row, cond);
    }
    return value === cond;
  });
}

function assign(row: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    row[k] = v !== null && typeof v === "object" && "increment" in v ? (row[k] ?? 0) + v.increment : v;
  }
}

function table(defaults: Row = {}) {
  const rows: Row[] = [];
  let seq = 0;
  const sorted = (found: Row[], orderBy?: Row) => {
    if (!orderBy) return found;
    const [field, dir] = Object.entries(orderBy)[0]!;
    return [...found].sort((a, b) => (a[field] > b[field] ? 1 : -1) * (dir === "desc" ? -1 : 1));
  };
  return {
    rows,
    create:     async ({ data }: Row) => { const r = { id: `row_${++seq}`, ...defaults, ...data }; rows.push(r); return r; },
    findMany:   async ({ where, orderBy, take }: Row = {}) => sorted(rows.filter(r => matches(r, where)), orderBy).slice(0, take ?? Infinity),
    findFirst:  async ({ where }: Row = {}) => rows.find(r => matches(r, where)) ?? null,
    findUnique: async ({ where }: Row) => rows.find(r => matches(r, where)) ?? null,
    count:      async ({ where }: Row = {}) => rows.filter(r => matches(r, where)).length,
    deleteMany: async ({ where }: Row = {}) => {
      const keep = rows.filter(r => !matches(r, where));
      const count = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return { count };
    },
    update:     async ({ where, data }: Row) => { const r = rows.find(x => matches(x, where))!; assign(r, data); return r; },
    updateMany: async ({ where, data }: Row) => {
      const found = rows.filter(r => matches(r, where));
      found.forEach(r => assign(r, data));
      return { count: found.length };
    },
    upsert:     async ({ where, update, create }: Row) => {
      const r = rows.find(x => matches(x, where));
      if (r) { assign(r, update); return r; }
      const created = { id: `row_${++seq}`, ...create }; rows.push(created); return created;
    },
  };
}

const USER_ID = "user_1";
const CHAT_ID = "chat_1";
const NOW     = new Date();

let db: Record<string, ReturnType<typeof table>>;

beforeEach(() => {
  db = {
    companionMessage:   table(),
    novaConsolidationJob: table({ attempts: 0, claimedAt: null, completedAt: null, lastError: null, createdAt: new Date() }),
    userFact:           table(),
    userReality:        table({ isActive: true, resolvedAt: null, subtype: null, provenance: null }),
    behavioralPattern:  table(),
    novaCognitiveState: table(),
    messengerUser:      table(),
  };
  db.messengerUser!.rows.push({ id: USER_ID, platform: "telegram", platformChatId: CHAT_ID, tier: "free" });
  // rateLimit.service upserts by the compound key; resolve it to our one user.
  (db.messengerUser as Row).upsert = async () => db.messengerUser!.rows[0];

  // The job table's primary key is messageId: a second job for a turn fails.
  const jobs = db.novaConsolidationJob!;
  const createJob = jobs.create;
  (jobs as Row).create = async (args: Row) => {
    if (jobs.rows.some(r => r.messageId === args.data.messageId)) {
      throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    }
    return createJob(args);
  };

  for (const key of Object.keys(prisma as Row)) delete (prisma as Row)[key];
  Object.assign(prisma as Row, db);

  // Atomic like Postgres: if the callback throws, every table is restored.
  (prisma as Row).$transaction = async (fn: (tx: Row) => Promise<unknown>) => {
    const snapshot = Object.values(db).map(t => t.rows.map(r => ({ ...r })));
    try {
      return await fn(prisma as Row);
    } catch (err) {
      Object.values(db).forEach((t, i) => t.rows.splice(0, t.rows.length, ...snapshot[i]!));
      throw err;
    }
  };
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

const UNDERSTANDING: AcademicUnderstanding = {
  intent: "commitment_made", emotion: "determined", topic: null, topicConfidence: 0,
  disclosureClass: "none", ambiguityScore: 0.1, routingSignal: "coaching_only", rawText: "",
};

async function saveTurn(text: string, reply: string, at = NOW) {
  const id = await saveUserMessage(USER_ID, text, { intent: "commitment_made", emotion: "determined", signals: ["commitment"] }, at);
  await saveAssistantMessage(USER_ID, reply, "nova_reinforce_identity", { intervention: "reinforce_identity" }, at);
  return id;
}

function turnInput(messageId: string, evidence: Evidence[]) {
  return { messageId, userId: USER_ID, profileId: null, evidence, now: NOW, patternScanRan: false, hasActiveSession: false };
}

function commitment(messageId: string): Evidence {
  return {
    companion: "nova", userId: USER_ID, profileId: null, kind: "signal", source: "signal_engine",
    signalType: "commitment", confidence: 0.9, intensity: 0.9, corroborated: true, topic: null,
    observedAt: NOW, sourceMessageId: messageId, sourceText: "I'll study chapter 4 tonight",
  };
}

function achievement(messageId: string, text = "I aced the midterm"): Evidence {
  return {
    companion: "nova", userId: USER_ID, profileId: null, kind: "signal", source: "signal_engine",
    signalType: "achievement", confidence: 0.9, intensity: 0.9, corroborated: true, topic: null,
    observedAt: NOW, sourceMessageId: messageId, sourceText: text,
  };
}

// ── 10. Conversation goes to CompanionMessage ─────────────────────────────────

describe("conversation persistence", () => {
  it("writes both turns to CompanionMessage, tagged as Nova", async () => {
    await saveTurn("I'll study chapter 4 tonight", "Good. What time?");

    expect(db.companionMessage!.rows).toHaveLength(2);
    expect(db.companionMessage!.rows.map(r => r.role)).toEqual(["user", "assistant"]);
    expect(db.companionMessage!.rows.every(r => r.metadata.companion === "nova")).toBe(true);
    // There is no memoryFact table in this DB: touching it would have thrown.
    expect((prisma as Row).memoryFact).toBeUndefined();
  });

  it("loads history in order, and only Nova's turns", async () => {
    // A turn from another companion in the same log.
    db.companionMessage!.rows.push({ id: "rex_1", userId: USER_ID, role: "user", text: "logged bench 80kg", intent: "workout_log", metadata: null, createdAt: new Date(NOW.getTime() - 60_000) });
    await saveTurn("I'll study chapter 4 tonight", "Good. What time?");

    const history = await loadConversationHistory(USER_ID);
    expect(history.map(t => [t.role, t.text])).toEqual([
      ["user", "I'll study chapter 4 tonight"],
      ["nova", "Good. What time?"],
    ]);
  });

  it("gives the pattern detector real per-message history", async () => {
    await saveTurn("I'll study chapter 4 tonight", "Good.");
    const history = await loadSignalHistory(USER_ID);
    expect(history).toHaveLength(1);
    expect(history[0]!.signals).toEqual(expect.arrayContaining(["commitment", "commitment_made", "determined"]));
  });
});

// ── Memory retrieval never returns conversation rows ──────────────────────────

describe("memory retrieval", () => {
  it("returns no memories after many conversation turns and no facts", async () => {
    for (let i = 0; i < 30; i++) await saveTurn(`message ${i}`, `reply ${i}`);
    const { top } = await getRelevantMemories(USER_ID, UNDERSTANDING);
    expect(top).toEqual([]);
  });

  it("returns a consolidated fact even behind many conversation turns", async () => {
    const messageId = await saveTurn("I'll study chapter 4 tonight", "Good.");
    await consolidateTurn(turnInput(messageId, [commitment(messageId)]));
    for (let i = 0; i < 30; i++) await saveTurn(`message ${i}`, `reply ${i}`);

    const { top } = await getRelevantMemories(USER_ID, UNDERSTANDING);
    expect(top).toHaveLength(1);
    expect(top[0]).toMatchObject({ factType: "commitment", value: "I'll study chapter 4 tonight" });

    // Provenance survives the write: source, message and time.
    const stored = db.userFact!.rows[0]!;
    expect(stored.sourceMessageId).toBe(messageId);
    expect(stored.sourceCompanion).toBe("nova");
    expect(stored.provenance.sources[0]).toMatchObject({ source: "signal_engine", sourceMessageId: messageId });
  });

  it("the same statement in a later turn reinforces the one fact", async () => {
    for (const text of ["I aced the midterm", "I aced the midterm!"]) {
      const messageId = await saveTurn(text, "Nice.");
      await consolidateTurn(turnInput(messageId, [achievement(messageId, text)]));
    }
    expect(db.userFact!.rows).toHaveLength(1);
    expect(db.userFact!.rows[0]!.evidenceCount).toBe(2);
    expect(db.userFact!.rows[0]!.provenance.sources).toHaveLength(2);
  });

  it("a disclosed illness is stored once, then resolved, with provenance", async () => {
    const claimId = await saveTurn("I've got the flu", "Rest.");
    const base = { companion: "nova" as const, userId: USER_ID, profileId: null, source: "understanding_brain" as const, observedAt: NOW };

    await consolidateTurn(turnInput(claimId, [{
      ...base, kind: "reality_claim", confidence: 0.9, category: "health", subtype: "illness",
      description: "Student has the flu", persistence: "temporary", expectedDurationHours: null,
      sourceMessageId: claimId, sourceText: "I've got the flu",
    }]));
    expect(db.userReality!.rows).toHaveLength(1);
    expect(db.userReality!.rows[0]).toMatchObject({ category: "health", subtype: "illness", fact: "Student has the flu" });
    expect(db.userReality!.rows[0]!.provenance.sources[0]).toMatchObject({ source: "understanding_brain", sourceMessageId: claimId });

    const fineId = await saveTurn("I'm fine now", "Good.");
    await consolidateTurn(turnInput(fineId, [{
      ...base, kind: "reality_resolution", confidence: 0.9, category: "health", subtype: "illness",
      sourceMessageId: fineId, sourceText: "I'm fine now",
    }]));
    expect(db.userReality!.rows).toHaveLength(1);
    expect(db.userReality!.rows[0]).toMatchObject({ isActive: false, resolvedAt: NOW });
  });
});

// ── Consolidation failure safety ──────────────────────────────────────────────

describe("consolidation jobs", () => {
  it("a turn is consolidated once: pending → processing → completed", async () => {
    const messageId = await saveTurn("I aced the midterm", "Nice.");
    const input = turnInput(messageId, [achievement(messageId)]);

    expect((await consolidateTurn(input))?.map(d => d.action)).toEqual(["CREATE"]);
    const job = db.novaConsolidationJob!.rows[0]!;
    expect(job).toMatchObject({ messageId, status: "completed", attempts: 1, completedAt: NOW, payload: {} });

    // Same turn again (a retried webhook, a duplicate emit): nothing happens.
    expect(await consolidateTurn(input)).toBeNull();
    expect(await processConsolidationJob(messageId, USER_ID, NOW)).toBeNull();
    expect(db.userFact!.rows).toHaveLength(1);
    expect(db.userFact!.rows[0]!.evidenceCount).toBe(1);
    expect(db.userFact!.rows[0]!.provenance.sources).toHaveLength(1);
  });

  it("a failure partway leaves no partial state, and the job stays retryable", async () => {
    const messageId = await saveTurn("I've got the flu and I aced the midterm", "Rest.");
    const evidence: Evidence[] = [
      { companion: "nova", userId: USER_ID, profileId: null, source: "understanding_brain", observedAt: NOW,
        kind: "reality_claim", confidence: 0.9, category: "health", subtype: "illness",
        description: "Student has the flu", persistence: "temporary", expectedDurationHours: null,
        sourceMessageId: messageId, sourceText: "I've got the flu" },
      achievement(messageId),
    ];

    // The reality write succeeds, then the fact write fails.
    const upsert = db.userFact!.upsert;
    (db.userFact as Row).upsert = async () => { throw new Error("connection reset"); };
    (prisma as Row).userFact = db.userFact;

    expect(await consolidateTurn(turnInput(messageId, evidence))).toBeNull();
    expect(db.userReality!.rows).toHaveLength(0);   // rolled back with the failed fact
    expect(db.userFact!.rows).toHaveLength(0);
    expect(db.novaConsolidationJob!.rows[0]).toMatchObject({ status: "failed", attempts: 1, lastError: "connection reset" });
    expect(db.novaConsolidationJob!.rows[0]!.payload.evidence).toHaveLength(2);   // kept for the retry

    // The database recovers; the retry worker finishes the job, exactly once.
    (db.userFact as Row).upsert = upsert;
    expect(await retryPendingConsolidations(NOW)).toMatchObject({ retried: 1, completed: 1 });
    expect(db.userReality!.rows).toHaveLength(1);
    expect(db.userFact!.rows).toHaveLength(1);
    expect(db.userFact!.rows[0]!.evidenceCount).toBe(1);
    expect(db.novaConsolidationJob!.rows[0]).toMatchObject({ status: "completed", attempts: 2 });

    // Another sweep changes nothing.
    expect(await retryPendingConsolidations(NOW)).toMatchObject({ retried: 0, completed: 0 });
    expect(db.userFact!.rows[0]!.evidenceCount).toBe(1);
  });

  it("a job abandoned mid-attempt is reclaimed only after its lease runs out", async () => {
    const messageId = await saveTurn("I aced the midterm", "Nice.");
    db.novaConsolidationJob!.rows.push({
      id: "job_1", messageId, userId: USER_ID, status: "processing", attempts: 1,
      claimedAt: NOW, completedAt: null, lastError: null, createdAt: NOW,
      payload: { profileId: null, patternScanRan: false, hasActiveSession: false, evidence: JSON.parse(JSON.stringify([achievement(messageId)])) },
    });

    // Still inside the lease: another worker must not touch it.
    expect(await processConsolidationJob(messageId, USER_ID, new Date(NOW.getTime() + LEASE_MS - 1000))).toBeNull();
    expect(db.userFact!.rows).toHaveLength(0);

    // Lease expired: the process that held it is gone, so it is retried.
    const later = new Date(NOW.getTime() + LEASE_MS + 1000);
    expect(await retryPendingConsolidations(later)).toMatchObject({ retried: 1, completed: 1 });
    expect(db.userFact!.rows).toHaveLength(1);
    expect(db.novaConsolidationJob!.rows[0]).toMatchObject({ status: "completed", attempts: 2 });
  });

  it("a job out of attempts is left failed and is not retried again", async () => {
    const messageId = await saveTurn("I aced the midterm", "Nice.");
    db.novaConsolidationJob!.rows.push({
      id: "job_1", messageId, userId: USER_ID, status: "failed", attempts: MAX_ATTEMPTS,
      claimedAt: null, completedAt: null, lastError: "still broken", createdAt: NOW,
      payload: { profileId: null, patternScanRan: false, hasActiveSession: false, evidence: [] },
    });
    expect(await retryPendingConsolidations(NOW)).toMatchObject({ retried: 0, completed: 0 });
    expect(db.novaConsolidationJob!.rows[0]).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
  });

  it("completed jobs are purged after retention; unfinished ones never are", async () => {
    const old = new Date(NOW.getTime() - 40 * 86_400_000);
    db.novaConsolidationJob!.rows.push(
      { id: "j1", messageId: "m_old_done",   userId: USER_ID, status: "completed", attempts: 1, completedAt: old, payload: {}, createdAt: old },
      { id: "j2", messageId: "m_new_done",   userId: USER_ID, status: "completed", attempts: 1, completedAt: NOW, payload: {}, createdAt: NOW },
      { id: "j3", messageId: "m_old_failed", userId: USER_ID, status: "failed", attempts: MAX_ATTEMPTS, completedAt: null, payload: {}, createdAt: old },
    );
    expect((await retryPendingConsolidations(NOW)).purged).toBe(1);
    expect(db.novaConsolidationJob!.rows.map(r => r.messageId).sort()).toEqual(["m_new_done", "m_old_failed"]);
  });
});

// ── 11. Rate limiting sees Nova messages ──────────────────────────────────────

describe("rate limiting", () => {
  it("counts Nova user messages", async () => {
    expect((await checkRateLimit(CHAT_ID)).hourlyCount).toBe(0);
    await saveTurn("one", "r1");
    await saveTurn("two", "r2");
    const result = await checkRateLimit(CHAT_ID);
    expect(result.hourlyCount).toBe(2);   // user turns only, not Nova's replies
    expect(result.dailyCount).toBe(2);
  });

  it("blocks once the free hourly limit is reached", async () => {
    for (let i = 0; i < 60; i++) await saveUserMessage(USER_ID, `m${i}`, { intent: "general_chat", emotion: "neutral", signals: [] }, NOW);
    expect((await checkRateLimit(CHAT_ID)).allowed).toBe(false);
  });

  it("does not count onboarding (intake) turns", async () => {
    await saveUserMessage(USER_ID, "second year at MIT", { intent: "intake", emotion: "neutral", signals: [] }, NOW);
    expect((await checkRateLimit(CHAT_ID)).hourlyCount).toBe(0);
  });
});

// ── 12. Proactive suppression sees recent Nova messages ───────────────────────

describe("proactive suppression", () => {
  const fiveMinAgo = () => new Date(Date.now() - 5 * 60_000);

  it("is false with no recent user message", async () => {
    await saveUserMessage(USER_ID, "old", { intent: "general_chat", emotion: "neutral", signals: [] }, new Date(Date.now() - 3_600_000));
    expect(await userMessagedSince(USER_ID, fiveMinAgo())).toBe(false);
  });

  it("is true right after a Nova conversation turn", async () => {
    await saveTurn("I'm studying now", "Go.", new Date());
    expect(await userMessagedSince(USER_ID, fiveMinAgo())).toBe(true);
  });

  it("ignores Nova's own messages", async () => {
    await saveAssistantMessage(USER_ID, "Time to revise", "nova_proactive_review_due", {}, new Date());
    expect(await userMessagedSince(USER_ID, fiveMinAgo())).toBe(false);
  });
});
