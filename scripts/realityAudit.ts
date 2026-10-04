/**
 * Dynamic Reality Layer — Behavioral Audit
 *
 * Run from repo root:  npx tsx --tsconfig tsconfig.json scripts/realityAudit.ts
 *
 * Uses a disposable test MessengerUser (platform="test", platformChatId="rl_audit").
 * Cleans up at the end.
 */

import { prisma } from "@repo/db/client";
import { parseMessage } from "@repo/api/engines/parsing-engine-v2";
import {
  readActiveReality,
  writeRealityFromV2Signals,
  resolveRealityFromV2Signals,
  buildConflictReply,
  buildRealityBlock,
} from "@repo/api/services/realityLayer.service";

const TEST_CHAT_ID = "rl_audit_test";
const TEST_PLATFORM = "telegram";

// ── ANSI helpers ──────────────────────────────────────────────────────────────
const GRN = (s: string) => `\x1b[32m${s}\x1b[0m`;
const RED = (s: string) => `\x1b[31m${s}\x1b[0m`;
const YLW = (s: string) => `\x1b[33m${s}\x1b[0m`;
const BLD = (s: string) => `\x1b[1m${s}\x1b[0m`;
const DIM = (s: string) => `\x1b[2m${s}\x1b[0m`;

const PASS = GRN("✓ PASS");
const FAIL = RED("✗ FAIL");
const WARN = YLW("⚠ WARN");

interface TestResult {
  name: string;
  passed: boolean;
  warning?: string;
  detail: string;
}

const results: TestResult[] = [];

function record(name: string, passed: boolean, detail: string, warning?: string) {
  results.push({ name, passed, detail, warning });
  const badge = passed ? PASS : (warning ? WARN : FAIL);
  console.log(`  ${badge}  ${name}`);
  console.log(`         ${DIM(detail)}`);
  if (warning) console.log(`         ${YLW(warning)}`);
}

// ── Setup ─────────────────────────────────────────────────────────────────────

async function setup() {
  const existing = await prisma.messengerUser.findUnique({
    where: { platform_platformChatId: { platform: TEST_PLATFORM, platformChatId: TEST_CHAT_ID } },
    select: { id: true },
  });
  if (!existing) {
    await prisma.messengerUser.create({
      data: {
        platform:       TEST_PLATFORM,
        platformChatId: TEST_CHAT_ID,
        displayName:    "Reality Audit Test User",
        activeModules:  [],
        updatedAt:      new Date(),
      },
    });
  }
  // Wipe any leftover realities from a previous run
  const user = await prisma.messengerUser.findUnique({
    where: { platform_platformChatId: { platform: TEST_PLATFORM, platformChatId: TEST_CHAT_ID } },
    select: { id: true },
  });
  if (user) {
    await prisma.userReality.deleteMany({ where: { userId: user.id } });
  }
}

async function cleanup() {
  const user = await prisma.messengerUser.findUnique({
    where: { platform_platformChatId: { platform: TEST_PLATFORM, platformChatId: TEST_CHAT_ID } },
    select: { id: true },
  });
  if (user) {
    await prisma.userReality.deleteMany({ where: { userId: user.id } });
  }
  await prisma.messengerUser.deleteMany({
    where: { platform: TEST_PLATFORM, platformChatId: TEST_CHAT_ID },
  });
}

// ── Parser signal verification ─────────────────────────────────────────────────

function testParserSignals() {
  console.log(BLD("\n════ SIGNAL VERIFICATION (Parser V2) ════\n"));

  const ctx = { recentMessages: [], activePlan: null, userGoal: null, lastBotMessage: null, pendingConfirmation: null };

  const cases: Array<[string, string, string, boolean]> = [
    ["Fever phrase",          "I have a fever and feel terrible",                    "HEALTH_EVENT",   true],
    ["Flu phrase",            "I caught the flu, feeling awful",                     "HEALTH_EVENT",   true],
    ["Food poisoning",        "I have food poisoning, can't move",                   "HEALTH_EVENT",   true],
    ["Shoulder tear",         "I think I tore something in my shoulder",             "INJURY_CONTEXT", true],
    ["Knee fracture",         "I fractured my knee, it's swelling bad",              "INJURY_CONTEXT", true],
    ["General knee pain",     "my knee hurts a bit after squats",                    "PAIN_MENTIONED", true],
    ["Burnout",               "I'm completely burned out, I hate training",          "HEALTH_EVENT",   false],  // NOT a health event
    ["Travel",                "I'm traveling this week, no gym access",              "HEALTH_EVENT",   false],  // NOT a health event
    ["Exam week",             "I have exams all week, barely have time",             "HEALTH_EVENT",   false],  // NOT a health event
    ["Fever is gone (recovery)","Feeling much better today, fever is gone",           "HEALTH_EVENT",   false],  // resolution phrase — must NOT trigger new health event
    ["Normal workout msg",    "I hit chest today, did bench at 100kg",               "HEALTH_EVENT",   false],  // no health signal
  ];

  for (const [label, text, signal, shouldExist] of cases) {
    const r = parseMessage(text, ctx);
    const has = r.signals.includes(signal);
    const passed = has === shouldExist;
    const detail = `signals=[${r.signals.join(",")||"none"}] intent=${r.actionableIntent?.type ?? "none"}`;
    record(label, passed, detail);
  }
}

// ── T1: Fever → /log conflict gate ────────────────────────────────────────────

async function testFeverToLog() {
  console.log(BLD("\n════ T1: FEVER → /log (conflict gate) ════\n"));

  // Clear realities
  await cleanup(); await setup();

  // Step 1: user declares fever
  const ctx = { recentMessages: [], activePlan: null, userGoal: null, lastBotMessage: null, pendingConfirmation: null };
  const r = parseMessage("I have a fever, feeling terrible today", ctx);

  // Write reality (normally fire-and-forget; we await here for test determinism)
  await new Promise<void>((res) => {
    writeRealityFromV2Signals(TEST_CHAT_ID, r.signals, "I have a fever, feeling terrible today");
    // Give the async write 500ms to complete
    setTimeout(res, 500);
  });

  const reality = await readActiveReality(TEST_CHAT_ID);
  const healthFact = reality.find(f => f.category === "health");

  record(
    "Health reality written after HEALTH_EVENT signal",
    !!healthFact,
    healthFact ? `fact="${healthFact.fact.slice(0, 60)}..."` : "no health fact found",
  );

  // Step 2: user tries /log — conflict gate should fire
  const conflict = buildConflictReply(reality);

  record(
    "/log conflict gate fires when health reality active",
    conflict !== null,
    conflict ? `reply="${conflict.slice(0, 80)}..."` : "no conflict returned",
  );

  record(
    "Conflict reply mentions being sick (not generic)",
    conflict !== null && /sick/i.test(conflict),
    conflict ?? "(null)",
  );
}

// ── T2: Fever → plan request (prompt injection) ───────────────────────────────

async function testFeverToPlan() {
  console.log(BLD("\n════ T2: FEVER → plan request (prompt injection) ════\n"));

  const reality = await readActiveReality(TEST_CHAT_ID);
  const block = buildRealityBlock(reality);

  record(
    "Reality block generated when health reality exists",
    block !== null,
    block ? block.slice(0, 100) + "..." : "(null)",
  );

  record(
    "Block contains HEALTH category label",
    block !== null && /HEALTH/i.test(block),
    block ?? "(null)",
  );

  record(
    "Block contains health directive (no training push)",
    block !== null && /Do NOT push training/i.test(block),
    block?.slice(0, 200) ?? "(null)",
  );

  // Verify block does NOT appear for empty reality
  const emptyBlock = buildRealityBlock([]);
  record(
    "No block injected when reality is empty",
    emptyBlock === null,
    `buildRealityBlock([]) = ${emptyBlock}`,
  );
}

// ── T3: Shoulder injury → push day request ────────────────────────────────────

async function testShoulderInjury() {
  console.log(BLD("\n════ T3: SHOULDER INJURY → push day (prompt injection) ════\n"));

  await cleanup(); await setup();

  const ctx = { recentMessages: [], activePlan: null, userGoal: null, lastBotMessage: null, pendingConfirmation: null };
  const r = parseMessage("I think I tore something in my shoulder during bench", ctx);

  await new Promise<void>((res) => {
    writeRealityFromV2Signals(TEST_CHAT_ID, r.signals, "I think I tore something in my shoulder during bench");
    setTimeout(res, 500);
  });

  const reality = await readActiveReality(TEST_CHAT_ID);
  const injuryFact = reality.find(f => f.category === "injury");

  record(
    "Injury reality written after INJURY_CONTEXT signal",
    !!injuryFact,
    injuryFact ? `fact="${injuryFact.fact.slice(0, 60)}..."` : "no injury fact found",
  );

  const block = buildRealityBlock(reality);
  record(
    "Reality block contains injury directive",
    block !== null && /INJURY context active/i.test(block),
    block?.slice(0, 200) ?? "(null)",
  );

  // /log conflict for injury
  const conflict = buildConflictReply(reality);
  record(
    "/log conflict fires for injury reality",
    conflict !== null && /injur/i.test(conflict),
    conflict ?? "(null)",
  );
}

// ── T4/T5/T6: Phase 1 coverage gaps (documented) ─────────────────────────────

async function testPhase1Gaps() {
  console.log(BLD("\n════ T4-6: PHASE 1 COVERAGE GAPS (documented) ════\n"));

  const ctx = { recentMessages: [], activePlan: null, userGoal: null, lastBotMessage: null, pendingConfirmation: null };

  const burnoutParse  = parseMessage("I'm completely burned out, I hate training", ctx);
  const travelParse   = parseMessage("I'm traveling this week, no gym access", ctx);
  const examParse     = parseMessage("I have exams all week, barely any time to train", ctx);

  const burnoutWritten  = burnoutParse.signals.includes("HEALTH_EVENT") || burnoutParse.signals.includes("INJURY_CONTEXT");
  const travelWritten   = travelParse.signals.includes("HEALTH_EVENT")  || travelParse.signals.includes("INJURY_CONTEXT");
  const examWritten     = examParse.signals.includes("HEALTH_EVENT")    || examParse.signals.includes("INJURY_CONTEXT");

  // These are KNOWN Phase 1 gaps — burnout/travel/exam are not extracted by V2 deterministically
  record(
    "T4: Burnout detected by Phase 1 (emotional → reality write)",
    burnoutWritten,
    `signals=[${burnoutParse.signals.join(",")||"none"}]`,
    !burnoutWritten ? "PHASE 1 GAP — requires Phase 2 LLM extractor" : undefined,
  );
  record(
    "T5: Travel detected by Phase 1 (life_constraint → reality write)",
    travelWritten,
    `signals=[${travelParse.signals.join(",")||"none"}]`,
    !travelWritten ? "PHASE 1 GAP — requires Phase 2 LLM extractor" : undefined,
  );
  record(
    "T6: Exam week detected by Phase 1 (life_constraint → reality write)",
    examWritten,
    `signals=[${examParse.signals.join(",")||"none"}]`,
    !examWritten ? "PHASE 1 GAP — requires Phase 2 LLM extractor" : undefined,
  );
}

// ── T7: Multiple realities — combined reasoning ───────────────────────────────

async function testMultipleRealities() {
  console.log(BLD("\n════ T7: MULTIPLE REALITIES (combined reasoning) ════\n"));

  await cleanup(); await setup();

  const user = await prisma.messengerUser.findUnique({
    where: { platform_platformChatId: { platform: TEST_PLATFORM, platformChatId: TEST_CHAT_ID } },
    select: { id: true },
  });
  if (!user) throw new Error("test user missing");

  const now = new Date();

  // Write 3 facts directly (bypassing signal extraction, testing data layer directly)
  await prisma.userReality.createMany({
    data: [
      {
        userId: user.id,
        category: "injury",
        fact: 'User reported injury: "I think I tore something in my shoulder"',
        confidence: 0.9,
        relevanceScore: 1.0,
        expiresAt: new Date(now.getTime() + 336 * 3600 * 1000),
      },
      {
        userId: user.id,
        category: "life_constraint",
        fact: 'User reported constraint: "Exam week — barely any time"',
        confidence: 0.8,
        relevanceScore: 0.9,
        expiresAt: new Date(now.getTime() + 168 * 3600 * 1000),
      },
      {
        userId: user.id,
        category: "training_context",
        fact: 'User reported poor sleep: "slept 3 hours last night"',
        confidence: 0.75,
        relevanceScore: 0.8,
        expiresAt: new Date(now.getTime() + 24 * 3600 * 1000),
      },
    ],
  });

  const reality = await readActiveReality(TEST_CHAT_ID);
  record(
    "All 3 facts returned by readActiveReality",
    reality.length === 3,
    `count=${reality.length}`,
  );

  const block = buildRealityBlock(reality);
  record(
    "Block mentions injury",
    block !== null && /injury/i.test(block),
    block?.slice(0, 300) ?? "(null)",
  );
  record(
    "Block mentions exam/life constraint",
    block !== null && /LIFE CONSTRAINT/i.test(block),
    block?.slice(0, 300) ?? "(null)",
  );
  record(
    "Block mentions training/sleep context",
    block !== null && /TRAINING CONTEXT/i.test(block),
    block?.slice(0, 300) ?? "(null)",
  );

  // Relevance ordering: injury (1.0) > life_constraint (0.9) > training_context (0.8)
  if (reality.length === 3) {
    const [first, second, third] = reality;
    record(
      "Facts returned in relevance order (injury first)",
      first!.category === "injury",
      `order: ${reality.map(r => `${r.category}(${r.relevanceScore})`).join(" → ")}`,
    );
    record(
      "life_constraint returned second",
      second!.category === "life_constraint",
      `second=${second!.category}`,
    );
  }

  // MAX_REALITIES cap: insert 6 more, verify only 8 returned
  const extras = Array.from({ length: 6 }, (_, i) => ({
    userId: user.id,
    category: "emotional" as const,
    fact: `Extra fact ${i}`,
    confidence: 0.5,
    relevanceScore: 0.5 - i * 0.05,
    expiresAt: new Date(now.getTime() + 48 * 3600 * 1000),
  }));
  await prisma.userReality.createMany({ data: extras });
  const big = await readActiveReality(TEST_CHAT_ID);
  record(
    "readActiveReality caps at 8 (MAX_REALITIES)",
    big.length <= 8,
    `returned ${big.length} facts (max=8)`,
  );
}

// ── T8: Reality expiration ─────────────────────────────────────────────────────

async function testExpiration() {
  console.log(BLD("\n════ T8: REALITY EXPIRATION (TTL enforcement) ════\n"));

  await cleanup(); await setup();

  const user = await prisma.messengerUser.findUnique({
    where: { platform_platformChatId: { platform: TEST_PLATFORM, platformChatId: TEST_CHAT_ID } },
    select: { id: true },
  });
  if (!user) throw new Error("test user missing");

  const past = new Date(Date.now() - 1000); // already expired

  await prisma.userReality.create({
    data: {
      userId: user.id,
      category: "health",
      fact: "Expired: User had fever (72h ago)",
      confidence: 0.9,
      relevanceScore: 1.0,
      expiresAt: past, // expired
    },
  });

  // Verify: readActiveReality does NOT return expired facts
  const active = await readActiveReality(TEST_CHAT_ID);
  record(
    "Expired health reality NOT returned by readActiveReality",
    active.length === 0,
    `active facts after expiry: ${active.length}`,
  );

  const conflict = buildConflictReply(active);
  record(
    "No /log conflict for expired health reality",
    conflict === null,
    `buildConflictReply([]) = ${conflict}`,
  );

  const block = buildRealityBlock(active);
  record(
    "No reality block injected for expired reality",
    block === null,
    `buildRealityBlock([]) = ${block}`,
  );

  // Verify active fact with future expiry IS returned
  await prisma.userReality.create({
    data: {
      userId: user.id,
      category: "injury",
      fact: "Active: shoulder injury",
      confidence: 0.9,
      relevanceScore: 1.0,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    },
  });
  const withActive = await readActiveReality(TEST_CHAT_ID);
  record(
    "Active injury fact returned (future expiry)",
    withActive.length === 1 && withActive[0]!.category === "injury",
    `active facts: ${withActive.length}, category=${withActive[0]?.category}`,
  );
}

// ── T9: Reality resolution ────────────────────────────────────────────────────

async function testResolution() {
  console.log(BLD("\n════ T9: REALITY RESOLUTION (\"feeling better\") ════\n"));

  await cleanup(); await setup();

  const ctx = { recentMessages: [], activePlan: null, userGoal: null, lastBotMessage: null, pendingConfirmation: null };

  // Step 1: write health reality via signals
  const illParse = parseMessage("I have a fever and feel terrible", ctx);
  await new Promise<void>((res) => {
    writeRealityFromV2Signals(TEST_CHAT_ID, illParse.signals, "I have a fever and feel terrible");
    setTimeout(res, 600);
  });

  const before = await readActiveReality(TEST_CHAT_ID);
  record(
    "Health reality present before resolution",
    before.some(r => r.category === "health"),
    `facts=[${before.map(r => r.category).join(",")}]`,
  );

  // Step 2: user says they're better
  const recoveryTexts = [
    "Feeling much better today, fever is gone",
    "All better now, back to normal",
    "I'm feeling better today",
  ];

  for (const text of recoveryTexts) {
    await cleanup(); await setup();

    // Write illness first
    await new Promise<void>((res) => {
      writeRealityFromV2Signals(TEST_CHAT_ID, illParse.signals, "I have a fever");
      setTimeout(res, 800);
    });

    // Then resolve — allow 1200ms for 2 Neon round-trips (findUnique + updateMany)
    const recParse = parseMessage(text, ctx);
    await new Promise<void>((res) => {
      resolveRealityFromV2Signals(TEST_CHAT_ID, recParse.signals, text);
      setTimeout(res, 1200);
    });

    const after = await readActiveReality(TEST_CHAT_ID);
    record(
      `Health resolved after: "${text.slice(0, 40)}"`,
      !after.some(r => r.category === "health"),
      `active after=[${after.map(r => r.category).join(",") || "empty"}]`,
    );
  }
}

// ── T10: Prompt injection quality ────────────────────────────────────────────

async function testPromptQuality() {
  console.log(BLD("\n════ T10: PROMPT INJECTION QUALITY ════\n"));

  await cleanup(); await setup();

  const user = await prisma.messengerUser.findUnique({
    where: { platform_platformChatId: { platform: TEST_PLATFORM, platformChatId: TEST_CHAT_ID } },
    select: { id: true },
  });
  if (!user) throw new Error("test user missing");

  const now = new Date();

  // Insert 5 facts with varying relevance
  await prisma.userReality.createMany({
    data: [
      { userId: user.id, category: "health",           fact: "User has fever (high priority)",     confidence: 0.95, relevanceScore: 1.0,  expiresAt: new Date(now.getTime() + 60 * 3600 * 1000) },
      { userId: user.id, category: "injury",           fact: "User has shoulder injury (high)",    confidence: 0.90, relevanceScore: 0.95, expiresAt: new Date(now.getTime() + 200 * 3600 * 1000) },
      { userId: user.id, category: "emotional",        fact: "User reported burnout (medium)",     confidence: 0.80, relevanceScore: 0.80, expiresAt: new Date(now.getTime() + 40 * 3600 * 1000) },
      { userId: user.id, category: "life_constraint",  fact: "User has exam week (medium-low)",    confidence: 0.75, relevanceScore: 0.70, expiresAt: new Date(now.getTime() + 100 * 3600 * 1000) },
      { userId: user.id, category: "training_context", fact: "User had poor sleep (low)",          confidence: 0.65, relevanceScore: 0.60, expiresAt: new Date(now.getTime() + 20 * 3600 * 1000) },
    ],
  });

  const reality = await readActiveReality(TEST_CHAT_ID);
  const block = buildRealityBlock(reality);

  record(
    "All 5 facts returned (within MAX_REALITIES cap)",
    reality.length === 5,
    `count=${reality.length}`,
  );

  record(
    "Facts sorted by relevanceScore descending",
    reality[0]!.relevanceScore >= reality[1]!.relevanceScore &&
    reality[1]!.relevanceScore >= reality[2]!.relevanceScore,
    `scores: ${reality.map(r => `${r.category}(${r.relevanceScore})`).join(" → ")}`,
  );

  record(
    "Block present and non-trivial",
    block !== null && block.length > 50,
    block ? `length=${block.length} chars` : "(null)",
  );

  // Check for prompt bloat — block should not be excessively long
  record(
    "Prompt block is concise (≤ 1000 chars for 5 facts)",
    block !== null && block.length <= 1000,
    block ? `length=${block.length} chars` : "(null)",
  );

  // Show the actual block
  console.log(DIM("\n  ── Actual reality block injected into Rex system prompt ──"));
  if (block) {
    for (const line of block.split("\n")) {
      console.log(DIM(`  │ ${line}`));
    }
  }
  console.log();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(BLD("\n╔══════════════════════════════════════════════╗"));
  console.log(BLD("║  DYNAMIC REALITY LAYER — BEHAVIORAL AUDIT    ║"));
  console.log(BLD("╚══════════════════════════════════════════════╝"));

  try {
    await setup();
    testParserSignals();
    await testFeverToLog();
    await testFeverToPlan();
    await testShoulderInjury();
    await testPhase1Gaps();
    await testMultipleRealities();
    await testExpiration();
    await testResolution();
    await testPromptQuality();
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const passed  = results.filter(r => r.passed).length;
  const warned  = results.filter(r => !r.passed && r.warning).length;
  const failed  = results.filter(r => !r.passed && !r.warning).length;
  const total   = results.length;

  console.log(BLD("\n════ AUDIT SUMMARY ════\n"));
  console.log(`  Total checks : ${total}`);
  console.log(`  ${GRN(`Passed       : ${passed}`)}`);
  console.log(`  ${YLW(`Warnings     : ${warned}  (known gaps, not failures)`)}`);
  console.log(`  ${failed > 0 ? RED(`Failed       : ${failed}`) : GRN("Failed       : 0")}`);

  if (warned > 0) {
    console.log(YLW("\nKnown Phase 1 Gaps (require Phase 2 LLM extractor):"));
    results.filter(r => r.warning).forEach(r => console.log(YLW(`  • ${r.name}`)));
  }

  if (failed > 0) {
    console.log(RED("\nBehavioral Failures:"));
    results.filter(r => !r.passed && !r.warning).forEach(r => {
      console.log(RED(`  ✗ ${r.name}`));
      console.log(RED(`    ${r.detail}`));
    });
  } else {
    console.log(GRN("\nAll behavioral requirements met for Phase 1."));
  }
}

main().catch(err => {
  console.error(RED("Audit script crashed:"), err);
  process.exit(1);
});
