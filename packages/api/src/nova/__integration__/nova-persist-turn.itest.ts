/**
 * Nova persistence — real Postgres integration test.
 *
 * Runs the real persistence path against a real database, with no stand-ins:
 *
 *   Nova turn → persistTurn → CompanionMessage → evidence → consolidation
 *            → UserFact / UserReality / BehavioralPattern → read back
 *
 * The two LLM calls are the only things not exercised: the Understanding
 * Brain's JSON and the Response Brain's reply are supplied as fixtures and go
 * through the real parser.
 *
 * Run from packages/api:
 *   NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration
 *
 * The database must already have the schema. From packages/db (the Prisma
 * config there is what supplies the connection URL):
 *   DATABASE_URL=$NOVA_TEST_DATABASE_URL DIRECT_URL=$NOVA_TEST_DATABASE_URL \
 *     npx prisma db push
 *
 * It refuses to run without NOVA_TEST_DATABASE_URL, and refuses a URL that is
 * the one in packages/db/.env. It creates one disposable user with a
 * made-up chat id and deletes it afterwards.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── Safety: pick the database BEFORE anything imports the Prisma client ───────

const here = dirname(fileURLToPath(import.meta.url));

function configuredAppDatabaseUrls(): string[] {
  try {
    const env = readFileSync(resolve(here, "../../../../db/.env"), "utf8");
    return env.split(/\r?\n/).flatMap(line => {
      const m = line.match(/^\s*(?:DATABASE_URL|DIRECT_URL)\s*=\s*["']?([^"'\s]+)/);
      return m ? [m[1]!] : [];
    });
  } catch {
    return [];
  }
}

const TEST_URL = process.env.NOVA_TEST_DATABASE_URL;
if (!TEST_URL) {
  console.error(
    "Refusing to run: NOVA_TEST_DATABASE_URL is not set.\n" +
    "This test writes to a real database and must never use the app's DATABASE_URL.\n" +
    "Point it at a disposable Postgres (a local instance or a throwaway Neon branch).",
  );
  process.exit(1);
}
const hostOf = (u: string) => { try { return new URL(u).host; } catch { return u; } };
if (configuredAppDatabaseUrls().some(u => u === TEST_URL || hostOf(u) === hostOf(TEST_URL))) {
  console.error("Refusing to run: NOVA_TEST_DATABASE_URL points at the same host as packages/db/.env.");
  process.exit(1);
}
process.env.DATABASE_URL = TEST_URL;
process.env.DIRECT_URL   = TEST_URL;

// Imported only now, so the client binds to the test database.
const { prisma }               = await import("@repo/db/client");
const { persistTurn }          = await import("../persistence/nova-persistence.js");
const { consolidateTurn, processConsolidationJob, retryPendingConsolidations } =
  await import("../consolidation/run-consolidation.js");
const { enqueueJob }           = await import("../consolidation/stores/consolidation-job-store.js");
const { saveUserMessage }      = await import("../adapters/conversation-adapter.js");
const { buildTurnEvidence }    = await import("../consolidation/evidence-builder.js");
const { extractSignals }       = await import("../engines/signal-engine.js");
const { runPatternDetector }   = await import("../engines/pattern-detector.js");
const { parseUnderstandingResponse } = await import("../brains/understanding-parser.js");
const { loadSignalHistory, loadConversationHistory, annotationTags, userMessagedSince } =
  await import("../adapters/conversation-adapter.js");
const { loadPriorPatterns }    = await import("../consolidation/stores/behavioral-pattern-store.js");
const { getRelevantMemories }  = await import("../adapters/memory-adapter.js");
const { loadActiveRealityFacts } = await import("../adapters/reality-adapter.js");
const { checkRateLimit }       = await import("../../services/rateLimit.service.js");
const { claimTelegramUpdate }  = await import("../../services/telegramTransport.service.js");
const { STATE_BASELINES }      = await import("../types/academic-state.types.js");

// ── Fixture ───────────────────────────────────────────────────────────────────

const CHAT_ID   = `nova_itest_${Date.now()}`;
const UPDATE_ID = Math.floor(Date.now() / 1000) * 1000 + Math.floor(Math.random() * 1000);
const DAY_MS    = 86_400_000;
const T0        = Date.now() - 4 * DAY_MS;

let userId = "";
let profileId = "";

const ACADEMIC_STATE = {
  semesterPhase: "midterm" as const, activeMode: "standard" as const, momentaryState: "neutral" as const,
  scores: { ...STATE_BASELINES },
  hardDirectives: {
    noStudyPressure: false, examCrisisMode: false, planFreezeMode: false,
    calibrationAlert: false, noChallenging: false, recoveryMode: false, beginnerMode: false,
  },
  daysSinceJoined: 30, daysSinceLastSession: 1, consecutiveMisses: 0, studyStreakDays: 0,
  daysUntilNextExam: null, momentum7dTrend: [0, 0, 0, 0, 0, 0, 0], stateHistory: [],
};

function ubJson(fields: Record<string, unknown>): string {
  return JSON.stringify({
    intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0,
    disclosureClass: "none", ambiguityScore: 0.1, routingSignal: "coaching_only", reality: [],
    ...fields,
  });
}

// One Nova turn, the way the orchestrator runs it, minus the two LLM calls.
async function novaTurn(text: string, understandingJson: string, now: Date) {
  const [signalHistory, priorPatterns, sessions] = await Promise.all([
    loadSignalHistory(userId),
    loadPriorPatterns(userId),
    prisma.novaStudySession.findMany({
      where:  { profileId },
      select: { sessionDate: true, status: true, durationMinutes: true },
    }),
  ]);

  const understanding = parseUnderstandingResponse(understandingJson, text);
  const signals       = extractSignals(text, ACADEMIC_STATE);
  const tags          = annotationTags({
    intent: understanding.intent, emotion: understanding.emotion,
    signals: signals.detectedSignals.map(s => s.type),
  });

  const patterns = runPatternDetector({
    studySessions:  sessions,
    signalHistory:  [...signalHistory, { timestamp: now, signals: tags }],
    topicMasteries: [], priorPatterns, messagesSinceLastRun: 1,
  }, now);

  await persistTurn({
    userId, profileId, platformChatId: CHAT_ID, userText: text,
    brainOutput:   { reply: `reply to: ${text}`, reasoningMode: "direct", confidence: 0.8 },
    academicState: ACADEMIC_STATE, signals,
    graphNode: "N3", intervention: "acknowledge",
    understanding, activeSession: null, subjects: [],
    sessionContext: null, sessionAction: null,
    patterns, patternScanRan: true, now,
  });

  return { signalHistoryLength: signalHistory.length, patterns };
}

before(async () => {
  const user = await prisma.messengerUser.create({
    data: {
      platform: "telegram", platformChatId: CHAT_ID, persona: "nova",
      novaAcademicProfile: { create: { onboardingComplete: true } },
    },
    select: { id: true, novaAcademicProfile: { select: { id: true } } },
  });
  userId    = user.id;
  profileId = user.novaAcademicProfile!.id;
});

after(async () => {
  // Cascades to every row this test created for the user.
  if (userId) await prisma.messengerUser.delete({ where: { id: userId } });
  await prisma.processedTelegramUpdate.deleteMany({ where: { updateId: BigInt(UPDATE_ID) } });
  await prisma.$disconnect();
});

// ── The path ──────────────────────────────────────────────────────────────────

test("a turn persists the conversation, a fact and a reality record", async () => {
  const now = new Date(T0);
  await novaTurn(
    "I've got the flu, but I'll study chapter 4 tonight",
    ubJson({
      intent: "commitment_made", emotion: "determined", disclosureClass: "life_event",
      reality: [{ category: "health", subtype: "illness", claim: "Student has the flu", status: "active", persistence: "temporary", expectedDurationHours: null, confidence: 0.9 }],
    }),
    now,
  );

  const messages = await prisma.companionMessage.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(messages.map(m => m.role), ["user", "assistant"]);
  const userMessage = messages[0]!;
  assert.equal(userMessage.intent, "commitment_made");
  assert.equal((userMessage.metadata as { companion: string }).companion, "nova");
  assert.ok((userMessage.metadata as { signals: string[] }).signals.includes("commitment"));
  const job = await prisma.novaConsolidationJob.findUniqueOrThrow({ where: { messageId: userMessage.id } });
  assert.equal(job.status, "completed", "the turn's consolidation job completed");
  assert.equal(job.attempts, 1);
  assert.deepEqual(job.payload, {}, "evidence is not kept once consolidated");

  const facts = await prisma.userFact.findMany({ where: { userId } });
  assert.equal(facts.length, 1);
  assert.equal(facts[0]!.type, "commitment");
  assert.equal(facts[0]!.sourceMessageId, userMessage.id);
  assert.equal(facts[0]!.sourceCompanion, "nova");

  const realities = await prisma.userReality.findMany({ where: { userId } });
  assert.equal(realities.length, 1);
  assert.equal(realities[0]!.category, "health");
  assert.equal(realities[0]!.subtype, "illness");
  assert.equal(realities[0]!.isActive, true);
  assert.equal(
    (realities[0]!.provenance as { sources: Array<{ sourceMessageId: string }> }).sources[0]!.sourceMessageId,
    userMessage.id,
  );

  // Nothing was written to the legacy table.
  assert.equal(await prisma.memoryFact.count({ where: { userId } }), 0);
});

test("re-consolidating the same turn changes nothing", async () => {
  const userMessage = await prisma.companionMessage.findFirstOrThrow({ where: { userId, role: "user" } });
  const understanding = parseUnderstandingResponse(ubJson({
    intent: "commitment_made", disclosureClass: "life_event",
    reality: [{ category: "health", subtype: "illness", claim: "Student has the flu", status: "active", persistence: "temporary", expectedDurationHours: null, confidence: 0.9 }],
  }), userMessage.text);

  const again = await consolidateTurn({
    messageId: userMessage.id, userId, profileId, now: new Date(T0 + 1000),
    evidence: buildTurnEvidence({
      userId, profileId, sourceMessageId: userMessage.id, userText: userMessage.text,
      observedAt: new Date(T0 + 1000),
      signals: extractSignals(userMessage.text, ACADEMIC_STATE).detectedSignals,
      understanding,
      patterns: { detectedPatterns: [], dominantPattern: null, analysisRunAt: new Date(T0), messagesSinceLastRun: 1 },
      brainOutput: { reply: "x", reasoningMode: "direct", confidence: 0.8 },
    }),
    patternScanRan: false, hasActiveSession: false,
  });

  assert.equal(again, null, "the turn already has a job");
  assert.equal(await processConsolidationJob(userMessage.id, userId, new Date(T0 + 2000)), null, "a completed job cannot be claimed");
  assert.equal(await prisma.userFact.count({ where: { userId } }), 1);
  assert.equal(await prisma.userReality.count({ where: { userId } }), 1);
  assert.equal((await prisma.userFact.findFirstOrThrow({ where: { userId } })).evidenceCount, 1);
});

test("a failed consolidation is retried from Postgres and applied exactly once", async () => {
  const at = new Date(T0 + 60_000);
  const text = "I aced the calculus midterm";
  const messageId = await saveUserMessage(userId, text, { intent: "study_report", emotion: "proud", signals: ["achievement"] }, at);

  // A job that was enqueued and whose first attempt failed.
  await enqueueJob(messageId, userId, {
    profileId, patternScanRan: false, hasActiveSession: false,
    evidence: [{
      companion: "nova", userId, profileId, kind: "signal", source: "signal_engine",
      signalType: "achievement", confidence: 0.9, intensity: 0.9, corroborated: true, topic: null,
      observedAt: at, sourceMessageId: messageId, sourceText: text,
    }],
  });
  await prisma.novaConsolidationJob.update({
    where: { messageId }, data: { status: "failed", attempts: 1, lastError: "simulated" },
  });
  assert.equal(await prisma.userFact.count({ where: { userId, type: "achievement" } }), 0);

  const first = await retryPendingConsolidations(new Date());
  assert.ok(first.completed >= 1);
  const job = await prisma.novaConsolidationJob.findUniqueOrThrow({ where: { messageId } });
  assert.equal(job.status, "completed");
  assert.equal(job.attempts, 2);

  // A second sweep finds nothing to do and changes nothing.
  await retryPendingConsolidations(new Date());
  const facts = await prisma.userFact.findMany({ where: { userId, type: "achievement" } });
  assert.equal(facts.length, 1);
  assert.equal(facts[0]!.evidenceCount, 1);
  assert.equal(facts[0]!.sourceMessageId, messageId);

  // Leave the fixture as the following tests expect it.
  await prisma.userFact.deleteMany({ where: { userId, type: "achievement" } });
  await prisma.companionMessage.delete({ where: { id: messageId } });
});

test("the next turn reads the fact and the reality back", async () => {
  const understanding = parseUnderstandingResponse(ubJson({ intent: "plan_request" }), "what should I do today?");
  const { top } = await getRelevantMemories(userId, understanding);
  assert.deepEqual(top.map(f => f.factType), ["commitment"]);

  const reality = await loadActiveRealityFacts(userId, understanding);
  assert.deepEqual(reality.map(r => [r.category, r.subtype]), [["health", "illness"]]);

  const history = await loadConversationHistory(userId);
  assert.deepEqual(history.map(t => t.role), ["user", "nova"]);
});

test("repeated excuses across days become a behavioral pattern, with real history", async () => {
  const excuse = ubJson({ intent: "excuse", emotion: "avoidant" });

  const first  = await novaTurn("I was too busy today", excuse, new Date(T0 + 1 * DAY_MS));
  assert.equal(first.signalHistoryLength, 1, "the detector saw the earlier turn");
  await novaTurn("no time again, things came up", excuse, new Date(T0 + 2 * DAY_MS));
  assert.equal(await prisma.behavioralPattern.count({ where: { userId, patternType: "excuse_loop" } }), 0,
    "two excuses are not a pattern");

  const third = await novaTurn("I was too busy, I'll start fresh next week", excuse, new Date(T0 + 3 * DAY_MS));
  assert.equal(third.signalHistoryLength, 3);
  assert.ok(third.patterns.detectedPatterns.some(p => p.type === "excuse_loop"));

  const emerging = await prisma.behavioralPattern.findFirstOrThrow({ where: { userId, patternType: "excuse_loop" } });
  assert.equal(emerging.status, "emerging");
  assert.equal(emerging.evidenceCount, 1);

  await novaTurn("too busy again honestly", excuse, new Date(T0 + 4 * DAY_MS - 60_000));
  const active = await prisma.behavioralPattern.findFirstOrThrow({ where: { userId, patternType: "excuse_loop" } });
  assert.equal(active.status, "active");
  assert.equal(active.evidenceCount, 2);
  assert.ok(active.confidence > emerging.confidence);
  assert.equal(
    (active.evidence as { sources: unknown[] }).sources.length, 2,
    "each counted observation is traceable to its message",
  );

  // An excuse is never stored as a fact.
  assert.deepEqual((await prisma.userFact.findMany({ where: { userId } })).map(f => f.type), ["commitment"]);
});

test("'I'm fine now' resolves the illness", async () => {
  await novaTurn(
    "I was sick earlier this week, I'm fine now",
    ubJson({ reality: [{ category: "health", subtype: "illness", claim: "Student has recovered", status: "resolved", persistence: "temporary", expectedDurationHours: null, confidence: 0.9 }] }),
    new Date(T0 + 4 * DAY_MS - 30_000),
  );
  const realities = await prisma.userReality.findMany({ where: { userId } });
  assert.equal(realities.length, 1);
  assert.equal(realities[0]!.isActive, false);
  assert.ok(realities[0]!.resolvedAt);
});

test("rate limiting and proactive suppression see Nova's messages", async () => {
  const limit = await checkRateLimit(CHAT_ID);
  assert.equal(limit.hourlyCount, 2, "the two turns in the last hour are counted");
  assert.equal(limit.dailyCount, 2);
  assert.equal(await userMessagedSince(userId, new Date(Date.now() - 5 * 60_000)), true);
});

test("a Telegram update_id can be claimed once", async () => {
  assert.equal(await claimTelegramUpdate(UPDATE_ID), "claimed");
  assert.equal(await claimTelegramUpdate(UPDATE_ID), "duplicate");
});
