/**
 * failure-replay.ts
 *
 * Replays a single message through the full V2 pipeline and reports
 * where the expected outcome was or wasn't produced.
 *
 * Usage (from repo root):
 *   npx ts-node -e "
 *     import {replay} from './packages/api/src/engines/failure-replay';
 *     replay({message:'I can\'t train today', expected:{intent:'log_skip'}}).then(r=>console.log(r));
 *   "
 *
 * Or import and call from a test file.
 */

import { parseMessage }    from "./parsing-engine-v2";
import { extractSignals }  from "./signal-engine-v2";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReplayInput {
  message:  string;
  expected: {
    intent?:  string;
    signals?: string[];
    routed?:  string;
  };
  /** Optional context passed to the parser (e.g. onboardingStep, recentMessages) */
  parseContext?: Parameters<typeof parseMessage>[1];
}

export interface StageResult {
  stage:   string;
  pass:    boolean;
  actual:  unknown;
  expected?: unknown;
  note?:   string;
}

export interface ReplayReport {
  message:   string;
  pass:      boolean;
  stages:    StageResult[];
  summary:   string;
}

// ── Replay runner ─────────────────────────────────────────────────────────────

export function replay(input: ReplayInput): ReplayReport {
  const { message, expected, parseContext = { recentMessages: [] } } = input;
  const stages: StageResult[] = [];

  // ── Stage 1: Parsing Engine V2 ────────────────────────────────────────────
  const parseResult = parseMessage(message, parseContext);
  const actualIntent = parseResult.actionableIntent?.type ?? "none";

  stages.push({
    stage:    "parsing_engine_v2",
    pass:     expected.intent ? actualIntent === expected.intent : true,
    actual:   {
      actionableIntent: actualIntent,
      confidence:       parseResult.confidence,
      allIntents:       parseResult.intents.map(i => `${i.type}(${i.confidence.toFixed(2)})`),
      signals:          parseResult.signals,
      reasoning:        parseResult.reasoning,
    },
    expected: expected.intent ? { intent: expected.intent } : undefined,
    note: expected.intent && actualIntent !== expected.intent
      ? `Got "${actualIntent}", want "${expected.intent}". Top intents: ${parseResult.intents.slice(0,3).map(i=>`${i.type}(${i.confidence.toFixed(2)})`).join(", ")}`
      : undefined,
  });

  // ── Stage 2: Signal Engine V2 ─────────────────────────────────────────────
  const signalOutput = extractSignals({ text: message, now: new Date() });
  const actualSignalTypes = signalOutput.detected.map(s => s.type);

  stages.push({
    stage:    "signal_engine_v2",
    pass:     expected.signals
      ? expected.signals.every(s => actualSignalTypes.includes(s as any))
      : true,
    actual:   {
      detected:    signalOutput.detected.map(s => `${s.type}(${s.tier}/${s.intensity.toFixed(2)})`),
      stateDeltas: signalOutput.stateDeltas,
      memoryWrites: signalOutput.memoryWrites.map(w => w.key),
    },
    expected: expected.signals ? { signals: expected.signals } : undefined,
    note: expected.signals
      ? (() => {
          const missing = expected.signals.filter(s => !actualSignalTypes.includes(s as any));
          return missing.length ? `Missing signals: ${missing.join(", ")}` : undefined;
        })()
      : undefined,
  });

  // ── Stage 3: Routing simulation ───────────────────────────────────────────
  const routeMap: Record<string, string> = {
    log_workout:       "gym",
    log_skip:          "gym",
    log_weight:        "gym",
    log_soreness:      "gym",
    log_pain:          "gym",
    progress_query:    "gym",
    recovery_context:  "gym",
    nutrition_context: "gym",
    nutrition_query:   "gym",
    reminder_create:   "reminder",
    reminder_delete:   "reminder",
    reminder_edit:     "reminder",
  };
  const actualRoute = routeMap[actualIntent] ?? "orchestrator";

  stages.push({
    stage:    "routing",
    pass:     expected.routed ? actualRoute === expected.routed : true,
    actual:   { route: actualRoute, intent: actualIntent },
    expected: expected.routed ? { route: expected.routed } : undefined,
    note: expected.routed && actualRoute !== expected.routed
      ? `Routed to "${actualRoute}", want "${expected.routed}"`
      : undefined,
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  const failedStages = stages.filter(s => !s.pass).map(s => s.stage);
  const pass = failedStages.length === 0;

  const summary = pass
    ? `PASS — "${message}" → intent=${actualIntent}, route=${actualRoute}`
    : `FAIL [${failedStages.join(", ")}] — "${message}"\n` +
      stages
        .filter(s => !s.pass && s.note)
        .map(s => `  ${s.stage}: ${s.note}`)
        .join("\n");

  return { message, pass, stages, summary };
}

// ── Batch runner ──────────────────────────────────────────────────────────────

export function replayBatch(cases: ReplayInput[]): void {
  let passed = 0;
  let failed = 0;
  for (const c of cases) {
    const r = replay(c);
    console.log(r.summary);
    if (r.pass) passed++; else failed++;
  }
  console.log(`\n${passed} passed / ${failed} failed / ${cases.length} total`);
}
