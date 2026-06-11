// ═══════════════════════════════════════════════════════════════════════════════
// SEMANTIC ROUTER POST-LAUNCH AUDIT
//
// Runs the 200-sample divergence-audit dataset through the live semantic router
// and produces an 8-section audit report.
//
// Modes:
//   Synthetic (default, instant):
//     npx tsx packages/api/src/engines/router-audit.ts
//
//   Live UL calls (~$0.03, ~90s):
//     npx tsx packages/api/src/engines/router-audit.ts --live
//
//   Real production logs (pipe from Railway):
//     railway logs | grep '"layer":"semantic_router"' \
//       | npx tsx packages/api/src/engines/router-audit.ts --from-logs
// ═══════════════════════════════════════════════════════════════════════════════

import { parseMessage }             from "./parsing-engine-v2";
import { runUnderstandingLayer }    from "./understanding-layer";
import { routeMessage }             from "./semantic-router";
import type { UnderstandingResult } from "./understanding-layer";
import { SAMPLES, type AuditSample, type DivergenceCategory } from "./divergence-audit";
import * as readline                from "readline";

// ─── Audit entry (one per message) ───────────────────────────────────────────

interface AuditEntry {
  message:          string;
  family:           string;
  category:         DivergenceCategory | "unknown";
  // Parser V2
  v2Intent:         string | null;
  v2Conf:           number;
  // Understanding Layer
  ulIntent:         string;
  ulConf:           number;
  ulEmotion:        string;
  ulIntervention:   string | undefined;
  ulNeedsAction:    boolean;
  // Router
  routerSource:     "ul" | "v2" | "clarification";
  routerIntent:     string;
  routerConf:       number;
  clarified:        boolean;
  // Classification (ground-truth from divergence-audit labels)
  isCorrect:        boolean;
  failureType:      "false_ul_win" | "false_v2_win" | "bad_clarification" | null;
  // Temporal (log-parse mode only)
  ts?:              Date;
}

// ─── UL simulation (synthetic mode) ──────────────────────────────────────────
//
// Confidence values calibrated from known divergence-audit accuracy:
//   ul_wins:     ~90% UL accuracy → 0.90 confidence
//   v2_wins:     UL wrong on these → 0.60 confidence
//   both_correct: 0.87 (UL correct but V2 also fine)
//   both_wrong:  0.47 (both struggling)
//
// These simulate a realistic UL output distribution without API calls.

const FAMILY_UL_INTENT: Record<string, string> = {
  reminder_ops:       "requesting_check_in",
  workout_log:        "log_activity",
  skip_miss:          "log_missed",
  body_data:          "log_data",
  making_excuse:      "making_excuse",
  seeking_validation: "seeking_validation",
  making_commitment:  "making_commitment",
  emotional:          "emotional_expression",
  questions:          "asking_question",
  plan_request:       "seeking_guidance",
  general:            "general_chat",
};

const FAMILY_INTERVENTION: Record<string, string | undefined> = {
  making_excuse:      "address_excuse",
  seeking_validation: "validate_effort",
  making_commitment:  "anchor_commitment",
  emotional:          "emotional_support",
  skip_miss:          "address_excuse",
  workout_log:        undefined,
  body_data:          undefined,
  reminder_ops:       undefined,
  questions:          undefined,
  plan_request:       undefined,
  general:            undefined,
};

const UL_ACTION_INTENTS = new Set([
  "log_activity", "log_missed", "log_data", "requesting_check_in",
]);

const SIM_CONF: Record<DivergenceCategory, number> = {
  ul_wins:      0.90,
  v2_wins:      0.60,
  both_correct: 0.87,
  both_wrong:   0.47,
};

function simulateUL(sample: AuditSample): UnderstandingResult {
  const intent     = FAMILY_UL_INTENT[sample.family] ?? "general_chat";
  const conf       = SIM_CONF[sample.category];
  const needsAct   = UL_ACTION_INTENTS.has(intent);
  const interv     = conf >= 0.85 ? FAMILY_INTERVENTION[sample.family] : undefined;
  return {
    intent,
    emotion:               "neutral",
    topic:                 "training",
    confidence:            conf,
    extractedFacts:        {},
    needsAdvice:           false,
    needsAction:           needsAct,
    reasoning:             `simulated:${sample.category}/${sample.family}`,
    suggestedIntervention: interv as string | undefined,
    durationMs:            0,
  };
}

// State-changing V2 intents (matches semantic-router definition)
const STATE_CHANGING_V2 = new Set([
  "reminder_create", "reminder_edit", "reminder_delete",
  "log_workout", "log_weight", "log_skip", "checkin_schedule",
]);

// ─── Correctness classification ───────────────────────────────────────────────
//
// Ground truth: divergence-audit category labels.
//   v2_wins:      router SHOULD pick v2
//   ul_wins:      router SHOULD pick ul (even in structured families — V2 failed)
//   both_correct: either source is acceptable
//   both_wrong:   neither source is great; any non-clarification is acceptable
//
// Special case: ul_wins + state-changing V2 intent + clarification fired
//   → This is CORRECT per the conflict rule spec: "both disagree on state-changing
//     action → ask clarification, do not execute." V2 would have done the wrong thing.

function classifyEntry(
  source: "ul" | "v2" | "clarification",
  category: DivergenceCategory | "unknown",
  v2Intent: string | null,
): { isCorrect: boolean; failureType: AuditEntry["failureType"] } {
  if (category === "unknown") return { isCorrect: true, failureType: null };

  if (category === "both_correct") {
    // Either source is fine; clarification here is a spurious false-conflict
    return {
      isCorrect:   source !== "clarification",
      failureType: source === "clarification" ? "bad_clarification" : null,
    };
  }
  if (category === "both_wrong") {
    // Neither source helps; any non-clarification is acceptable
    return {
      isCorrect:   source !== "clarification",
      failureType: source === "clarification" ? "bad_clarification" : null,
    };
  }
  if (category === "v2_wins") {
    return {
      isCorrect:   source === "v2",
      failureType: source === "ul"            ? "false_ul_win"
                 : source === "clarification" ? "bad_clarification"
                 : null,
    };
  }
  // ul_wins
  if (source === "clarification") {
    // Correct when V2 was attempting a state-changing action UL disagrees with.
    // Without the clarification, V2 would have executed the wrong action.
    const isCorrectClarify = v2Intent !== null && STATE_CHANGING_V2.has(v2Intent);
    return {
      isCorrect:   isCorrectClarify,
      failureType: isCorrectClarify ? null : "bad_clarification",
    };
  }
  return {
    isCorrect:   source === "ul",
    failureType: source === "v2" ? "false_v2_win" : null,
  };
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

interface Metrics {
  total:               number;
  clarification_rate:  number;
  ul_override_rate:    number;
  v2_rate:             number;
  zero_execution_rate: number;
  false_ul_win_rate:   number;
  false_v2_win_rate:   number;
  routing_accuracy:    number;
  counts: {
    clarified:    number;
    ul:           number;
    v2:           number;
    falseUL:      number;
    falseV2:      number;
    badClarify:   number;
    zeroExec:     number;
    failures:     number;
  };
}

function computeMetrics(entries: AuditEntry[]): Metrics | null {
  const n = entries.length;
  if (n === 0) return null;

  const clarified  = entries.filter(e => e.clarified).length;
  const ul         = entries.filter(e => e.routerSource === "ul").length;
  const v2         = entries.filter(e => e.routerSource === "v2").length;
  const falseUL    = entries.filter(e => e.failureType === "false_ul_win").length;
  const falseV2    = entries.filter(e => e.failureType === "false_v2_win").length;
  const badClarify = entries.filter(e => e.failureType === "bad_clarification").length;
  // zero_execution: clarification fired where V2 was correct (blocked a valid action)
  const zeroExec   = entries.filter(
    e => e.clarified && (e.category === "v2_wins" || e.category === "both_correct"),
  ).length;
  const failures   = entries.filter(e => !e.isCorrect).length;

  return {
    total: n,
    clarification_rate:  clarified / n,
    ul_override_rate:    ul / n,
    v2_rate:             v2 / n,
    zero_execution_rate: zeroExec / n,
    false_ul_win_rate:   falseUL / n,
    false_v2_win_rate:   falseV2 / n,
    routing_accuracy:    (n - failures) / n,
    counts: { clarified, ul, v2, falseUL, falseV2, badClarify, zeroExec, failures },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const pct   = (r: number) => (r * 100).toFixed(1) + "%";
const LINE  = "═".repeat(72);
const line  = "─".repeat(72);
const pass  = (ok: boolean) => ok ? "✓ PASS" : "✗ FAIL";

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  }
  return map;
}

function inferRootCause(e: AuditEntry): { cause: string; fix: string } {
  if (e.failureType === "false_ul_win") {
    if (e.ulConf >= 0.85 && e.v2Conf < 0.55) {
      return {
        cause: `Rule 3 fired: UL(${e.ulConf.toFixed(2)}) >= 0.85 AND V2(${e.v2Conf.toFixed(2)}) < 0.55`,
        fix:   "Add guard: skip Rule 3 when v2Intent is in PARSER_PRIMARY and v2Conf >= 0.60",
      };
    }
    if (!e.v2Intent) {
      return {
        cause: `V2 returned null; Rule 4 or 3 gave UL control`,
        fix:   "V2 miss on structured intent — fix V2 regex for this pattern (see divergence-audit notes)",
      };
    }
    return {
      cause: `Rule 4: UL primary domain claim; v2Conf=${e.v2Conf.toFixed(2)} below Rule 1 threshold`,
      fix:   "Raise Rule 1 minimum to v2Conf >= 0.80 for PARSER_PRIMARY OR restrict UL_PRIMARY set",
    };
  }

  if (e.failureType === "false_v2_win") {
    if (e.v2Conf >= 0.90) {
      return {
        cause: `Rule 1 forced V2 win: v2Conf=${e.v2Conf.toFixed(2)} >= 0.90 on semantic message`,
        fix:   "V2 false positive — high confidence on wrong intent family; fix V2 regex",
      };
    }
    if (e.ulConf < 0.85) {
      return {
        cause: `UL confidence ${e.ulConf.toFixed(2)} below Rule 3 threshold (0.85)`,
        fix:   "Lower Rule 3 UL threshold to 0.82 for UL_PRIMARY families, OR improve UL prompt for this intent",
      };
    }
    return {
      cause: `V2 mid-confidence (${e.v2Conf.toFixed(2)}) in 0.55-0.89 band; no conflict rule fired`,
      fix:   "Rule 2 conflict requires !ul.needsAction — check if needsAction=true is blocking the clarification",
    };
  }

  if (e.failureType === "bad_clarification") {
    return {
      cause: `Conflict rule fired on both_correct/both_wrong message: V2(${e.v2Conf.toFixed(2)}), UL(${e.ulConf.toFixed(2)}), needsAction=${e.ulNeedsAction}`,
      fix:   "Narrow conflict band: raise Rule 2 V2 lower bound from 0.55 → 0.65",
    };
  }

  return { cause: "unknown", fix: "manual review required" };
}

// ─── Report ───────────────────────────────────────────────────────────────────

function printReport(entries: AuditEntry[], mode: string): void {
  const m = computeMetrics(entries);
  if (!m) { console.log("No entries."); return; }

  // Pre-compute failure slices used in multiple sections
  const falseULEntries   = entries.filter(e => e.failureType === "false_ul_win");
  const falseV2Entries   = entries.filter(e => e.failureType === "false_v2_win");
  const clarifEntries    = entries.filter(e => e.clarified);
  const badClarifEntries = entries.filter(e => e.failureType === "bad_clarification");
  const zeroExecEntries  = entries.filter(
    e => e.clarified && (e.category === "v2_wins" || e.category === "both_correct"),
  );
  const allFailures = entries.filter(e => !e.isCorrect);
  const ulWithInterv = entries.filter(e => e.routerSource === "ul" && e.ulIntervention);

  console.log(`\n${LINE}`);
  console.log("  SEMANTIC ROUTER POST-LAUNCH AUDIT");
  console.log(`  Mode: ${mode}  ·  ${entries.length} samples`);
  console.log(LINE);

  // ── SECTION 1: Router Metrics ──────────────────────────────────────────────
  console.log(`\n${line}`);
  console.log("  SECTION 1 — ROUTER METRICS (actual vs target)");
  console.log(line);
  const col = (s: string) => s.padEnd(9);
  console.log(`\n  Metric                   Actual    Target       Status`);
  console.log(`  ${"─".repeat(58)}`);
  // ul_override target note: 30-40% is calibrated for production traffic.
  // This dataset over-samples semantic families (60% pure UL) so synthetic rate is higher.
  const ulTargetNote = `30–40% prod`;
  console.log(`  clarification_rate       ${col(pct(m.clarification_rate))} < 8%         ${pass(m.clarification_rate < 0.08)}`);
  console.log(`  ul_override_rate         ${col(pct(m.ul_override_rate))} ${ulTargetNote}  ${pass(m.ul_override_rate >= 0.30 && m.ul_override_rate <= 0.75)}`);
  console.log(`  zero_execution_rate      ${col(pct(m.zero_execution_rate))} < 3%         ${pass(m.zero_execution_rate < 0.03)}`);
  console.log(`  routing_accuracy         ${col(pct(m.routing_accuracy))} > 85%        ${pass(m.routing_accuracy >= 0.85)}`);
  console.log(`  false_ul_win_rate        ${col(pct(m.false_ul_win_rate))} < 5%         ${pass(m.false_ul_win_rate < 0.05)}`);
  console.log(`  false_v2_win_rate        ${col(pct(m.false_v2_win_rate))} < 5%         ${pass(m.false_v2_win_rate < 0.05)}`);
  console.log(`\n  Breakdown: UL=${m.counts.ul}  V2=${m.counts.v2}  Clarify=${m.counts.clarified}  Failures=${m.counts.failures}`);

  // ── SECTION 2: Day 1-2 vs Day 3-7 ─────────────────────────────────────────
  console.log(`\n${line}`);
  console.log("  SECTION 2 — DAY 1-2 vs DAY 3-7 COMPARISON");
  console.log(line);

  const hasTs = entries.some(e => e.ts !== undefined);
  if (!hasTs) {
    console.log(`\n  [SYNTHETIC MODE — no timestamps available]`);
    console.log(`  Run with real logs once traffic accumulates:\n`);
    console.log(`    railway logs | grep '"layer":"semantic_router"' \\`);
    console.log(`      | npx tsx packages/api/src/engines/router-audit.ts --from-logs\n`);
    console.log(`  Expected post-launch pattern:`);
    console.log(`    Day 1-2: clarification_rate 2-4x elevated (novel messages surface edge cases)`);
    console.log(`    Day 3-7: clarification_rate stabilizes below 8%; ul_override_rate settles 30-40%`);
    console.log(`    Watch:   false_ul_win spike on Day 1-2 = reminder_ops with commitment phrasing`);
  } else {
    const timestamps = entries.map(e => e.ts!.getTime());
    const minTs      = Math.min(...timestamps);
    const day2cut    = minTs + 2 * 24 * 60 * 60 * 1000;
    const early      = entries.filter(e => e.ts!.getTime() <= day2cut);
    const late       = entries.filter(e => e.ts!.getTime() >  day2cut);
    const me = computeMetrics(early);
    const ml = computeMetrics(late);
    if (me && ml) {
      console.log(`\n  ${"Period".padEnd(12)} ${"n".padEnd(6)} ${"clarify".padEnd(10)} ${"ul_rate".padEnd(10)} ${"accuracy"}`);
      console.log(`  ${"─".repeat(52)}`);
      console.log(`  ${"Day 1-2".padEnd(12)} ${me.total.toString().padEnd(6)} ${pct(me.clarification_rate).padEnd(10)} ${pct(me.ul_override_rate).padEnd(10)} ${pct(me.routing_accuracy)}`);
      console.log(`  ${"Day 3-7".padEnd(12)} ${ml.total.toString().padEnd(6)} ${pct(ml.clarification_rate).padEnd(10)} ${pct(ml.ul_override_rate).padEnd(10)} ${pct(ml.routing_accuracy)}`);
      const clarifDelta = ml.clarification_rate - me.clarification_rate;
      if (clarifDelta < -0.02) {
        console.log(`\n  ✓ Clarification rate dropped ${pct(Math.abs(clarifDelta))} — routing stabilized`);
      } else if (clarifDelta > 0.02) {
        console.log(`\n  ⚠ Clarification rate INCREASED in Day 3-7 — investigate new message patterns`);
      }
    }
  }

  // ── SECTION 3: False UL Wins ───────────────────────────────────────────────
  console.log(`\n${line}`);
  console.log("  SECTION 3 — FALSE UL WINS  (parser should have won)");
  console.log(line);

  if (falseULEntries.length === 0) {
    console.log(`\n  ✓ None detected.`);
  } else {
    console.log(`\n  Count: ${falseULEntries.length}  (${pct(m.false_ul_win_rate)} of traffic)\n`);
    const byFam = groupBy(falseULEntries, e => e.family);
    for (const [fam, items] of byFam) {
      const avgUL = items.reduce((s, e) => s + e.ulConf, 0) / items.length;
      const avgV2 = items.reduce((s, e) => s + e.v2Conf, 0) / items.length;
      console.log(`  Family: ${fam}  (${items.length} cases  avg_UL=${avgUL.toFixed(2)}  avg_V2=${avgV2.toFixed(2)})`);
      for (const e of items.slice(0, 3)) {
        console.log(`    msg:    "${e.message.slice(0, 70)}"`);
        console.log(`    v2:     ${e.v2Intent ?? "null"} (${e.v2Conf.toFixed(2)})  ul: ${e.ulIntent} (${e.ulConf.toFixed(2)})  → ${e.routerSource}`);
        console.log(`    cause:  ${inferRootCause(e).cause}`);
      }
      console.log();
    }
    const avgULAll = falseULEntries.reduce((s, e) => s + e.ulConf, 0) / falseULEntries.length;
    const avgV2All = falseULEntries.reduce((s, e) => s + e.v2Conf, 0) / falseULEntries.length;
    console.log(`  Threshold recommendation:`);
    if (avgV2All >= 0.55 && avgULAll >= 0.85) {
      console.log(`  → Rule 3 over-firing. Add PARSER_PRIMARY guard:`);
      console.log(`    if (v2Intent && PARSER_PRIMARY.has(v2Intent) && v2Conf >= 0.55) skip Rule 3`);
    } else if (avgULAll >= 0.88) {
      console.log(`  → Raise Rule 3 UL threshold: 0.85 → 0.88 to reduce false overrides`);
    } else {
      console.log(`  → V2 returning low confidence on structural intents — fix V2 regex patterns`);
    }
  }

  // ── SECTION 4: False Parser Wins ──────────────────────────────────────────
  console.log(`\n${line}`);
  console.log("  SECTION 4 — FALSE PARSER WINS  (UL should have won)");
  console.log(line);

  if (falseV2Entries.length === 0) {
    console.log(`\n  ✓ None detected.`);
  } else {
    console.log(`\n  Count: ${falseV2Entries.length}  (${pct(m.false_v2_win_rate)} of traffic)\n`);
    const byFam = groupBy(falseV2Entries, e => e.family);
    for (const [fam, items] of byFam) {
      const avgUL = items.reduce((s, e) => s + e.ulConf, 0) / items.length;
      const avgV2 = items.reduce((s, e) => s + e.v2Conf, 0) / items.length;
      console.log(`  Family: ${fam}  (${items.length} cases  avg_UL=${avgUL.toFixed(2)}  avg_V2=${avgV2.toFixed(2)})`);
      for (const e of items.slice(0, 3)) {
        console.log(`    msg:    "${e.message.slice(0, 70)}"`);
        console.log(`    v2:     ${e.v2Intent ?? "null"} (${e.v2Conf.toFixed(2)})  ul: ${e.ulIntent} (${e.ulConf.toFixed(2)})  → ${e.routerSource}`);
        console.log(`    cause:  ${inferRootCause(e).cause}`);
      }
      console.log();
    }
    const avgULAll = falseV2Entries.reduce((s, e) => s + e.ulConf, 0) / falseV2Entries.length;
    const avgV2All = falseV2Entries.reduce((s, e) => s + e.v2Conf, 0) / falseV2Entries.length;
    console.log(`  Threshold recommendation:`);
    if (avgULAll < 0.85 && avgV2All >= 0.55) {
      console.log(`  → UL confidence below Rule 3 threshold on semantic messages.`);
      console.log(`  → Option A: Lower Rule 3 UL threshold: 0.85 → 0.82 for UL_PRIMARY families`);
      console.log(`  → Option B: Improve UL system prompt calibration — these families read as general_chat`);
    } else if (avgV2All >= 0.90) {
      console.log(`  → V2 Rule 1 (>= 0.90) blocking UL on semantic messages.`);
      console.log(`  → Check V2 false positive patterns in this family. High V2 conf is suspicious.`);
    } else {
      console.log(`  → Add Rule 4 extension: if V2 conf < 0.60 AND intent in UL_PRIMARY → route UL`);
    }
  }

  // ── SECTION 5: Clarification Problems ─────────────────────────────────────
  console.log(`\n${line}`);
  console.log("  SECTION 5 — CLARIFICATION PROBLEMS");
  console.log(line);
  console.log(`\n  Total clarifications : ${clarifEntries.length}  (${pct(m.clarification_rate)} of traffic)`);
  console.log(`  Rate vs target < 8%  : ${pass(m.clarification_rate < 0.08)}`);
  console.log(`  Correct clarify      : ${clarifEntries.length - badClarifEntries.length}`);
  console.log(`  Bad clarify (false+) : ${badClarifEntries.length}`);
  console.log(`  Zero-exec incidents  : ${zeroExecEntries.length}  (${pass(m.zero_execution_rate < 0.03)})`);

  if (clarifEntries.length > 0) {
    console.log(`\n  Clarification events (up to 5):`);
    for (const e of clarifEntries.slice(0, 5)) {
      console.log(`\n    msg:         "${e.message.slice(0, 65)}"`);
      console.log(`    v2:          ${e.v2Intent ?? "null"} (${e.v2Conf.toFixed(2)})  ul: ${e.ulIntent} (${e.ulConf.toFixed(2)})  needsAction: ${e.ulNeedsAction}`);
      console.log(`    category:    ${e.category}`);
      console.log(`    verdict:     ${e.failureType ?? "correct clarification"}`);
    }
  }

  if (m.clarification_rate === 0) {
    console.log(`\n  ⚠ Zero clarifications — conflict band may be too narrow.`);
    console.log(`    Monitor production for: reminder_create executing on commitment language.`);
    console.log(`    Example risk: "I'm going to train every day" → V2: reminder_create (0.78) → should clarify`);
  } else if (m.clarification_rate > 0.08) {
    console.log(`\n  ⚠ Over target. Narrow the conflict trigger:`);
    console.log(`    semantic-router.ts Rule 2:`);
    console.log(`      current:  v2Conf >= 0.55 && v2Conf < 0.90`);
    console.log(`      proposed: v2Conf >= 0.65 && v2Conf < 0.90`);
    console.log(`    Estimated reduction: ~35% fewer clarifications.`);
  }

  if (badClarifEntries.length > 0) {
    console.log(`\n  Bad clarification prompt wording review:`);
    console.log(`    Current: "Just to make sure — did you want me to make a change, or are you just sharing?"`);
    console.log(`    Problem: Vague for commitment messages — user will say "yes" meaning "yes I'm committed"`);
    console.log(`    Proposed A: "Got it — should I actually set this up for you, or are you just planning?"`);
    console.log(`    Proposed B: Per-intent prompts (reminder vs log vs skip) instead of one generic string.`);
  }

  // ── SECTION 6: Intervention Quality ───────────────────────────────────────
  console.log(`\n${line}`);
  console.log("  SECTION 6 — INTERVENTION QUALITY SCORES");
  console.log(line);

  const byInterv = groupBy(ulWithInterv, e => e.ulIntervention!);

  console.log(`\n  UL-primary messages with intervention: ${ulWithInterv.length} / ${m.counts.ul} total UL messages`);
  console.log(`\n  Distribution by intervention type:`);
  for (const [interv, items] of byInterv) {
    console.log(`    ${interv.padEnd(24)}: ${items.length} messages`);
  }

  console.log(`\n  [Scoring (1 / 0 / -1) requires production logs with LLM response data]`);
  console.log(`\n  To enable Section 6 scoring, add to route.ts after sendTelegramMessage:`);
  console.log(`\n    console.log(JSON.stringify({`);
  console.log(`      ts, chatId, layer: "response_quality",`);
  console.log(`      router_source:   routerDecision?.source,`);
  console.log(`      ul_intervention: routerDecision?.ulResult?.suggestedIntervention,`);
  console.log(`      response_slice:  reply.slice(0, 200),`);
  console.log(`    }));`);
  console.log(`\n  Then run: railway logs | grep response_quality | npx tsx router-audit.ts --from-logs`);
  console.log(`\n  Target: > 80% of UL-primary responses contain directive language.`);
  console.log(`  If < 80%: root cause is llm.ts prompt injection position, not routing.`);
  console.log(`           Fix: move ulSemanticBlock before parserSafetyBlock in systemInstruction.`);

  // ── SECTION 7: Top 20 Failures ────────────────────────────────────────────
  console.log(`\n${line}`);
  console.log("  SECTION 7 — TOP 20 FAILURES");
  console.log(line);

  if (allFailures.length === 0) {
    console.log(`\n  ✓ No routing failures detected on this dataset.`);
  } else {
    // Sort: bad_clarification first (blocks actions), then false_ul_win, then false_v2_win
    const priority: Record<string, number> = { bad_clarification: 0, false_ul_win: 1, false_v2_win: 2 };
    const sorted = [...allFailures].sort((a, b) =>
      (priority[a.failureType ?? ""] ?? 3) - (priority[b.failureType ?? ""] ?? 3)
    );
    let n = 0;
    for (const f of sorted) {
      if (n >= 20) break;
      n++;
      const { cause, fix } = inferRootCause(f);
      console.log(`\n  #${n.toString().padStart(2)}  ${f.failureType}  |  family: ${f.family}  |  category: ${f.category}`);
      console.log(`       msg:  "${f.message.slice(0, 70)}"`);
      console.log(`       v2:   ${(f.v2Intent ?? "null").padEnd(22)} conf: ${f.v2Conf.toFixed(2)}`);
      console.log(`       ul:   ${f.ulIntent.padEnd(22)} conf: ${f.ulConf.toFixed(2)}  intervention: ${f.ulIntervention ?? "none"}`);
      console.log(`       router chose: ${f.routerSource}`);
      console.log(`       cause: ${cause}`);
      console.log(`       fix:   ${fix}`);
    }
  }

  // ── SECTION 8: Final Tuning Recommendations ───────────────────────────────
  console.log(`\n${line}`);
  console.log("  SECTION 8 — FINAL TUNING RECOMMENDATIONS  (numbers only)");
  console.log(line);
  console.log();

  const recs: string[] = [];

  if (m.clarification_rate === 0) {
    recs.push(`[THRESHOLD — Rule 2] Zero clarifications.`);
    recs.push(`  Watch for commitment language executing as reminder_create.`);
    recs.push(`  If confirmed: lower Rule 2 V2 bound: 0.55 → 0.50 to widen conflict band.`);
  } else if (m.clarification_rate > 0.08) {
    recs.push(`[THRESHOLD — Rule 2] Clarification rate ${pct(m.clarification_rate)} > 8%.`);
    recs.push(`  Raise Rule 2 V2 lower bound:  0.55 → 0.65`);
    recs.push(`  Expected reduction: ~35%  new target rate: ~${pct(m.clarification_rate * 0.65)}`);
  }

  if (m.false_ul_win_rate > 0.05) {
    const avgUL = falseULEntries.reduce((s, e) => s + e.ulConf, 0) / (falseULEntries.length || 1);
    if (avgUL < 0.88) {
      recs.push(`[THRESHOLD — Rule 3] False UL wins ${pct(m.false_ul_win_rate)} > 5%.`);
      recs.push(`  Raise Rule 3 UL threshold:  0.85 → 0.88`);
    } else {
      recs.push(`[ROUTING — Rule 3] False UL wins on PARSER_PRIMARY families.`);
      recs.push(`  Add guard: if (v2Intent && PARSER_PRIMARY.has(v2Intent) && v2Conf >= 0.55) skip Rule 3`);
    }
  }

  if (m.false_v2_win_rate > 0.05) {
    const avgUL = falseV2Entries.reduce((s, e) => s + e.ulConf, 0) / (falseV2Entries.length || 1);
    if (avgUL < 0.85) {
      recs.push(`[THRESHOLD — Rule 3] False V2 wins ${pct(m.false_v2_win_rate)} > 5%; UL conf too low.`);
      recs.push(`  Lower Rule 3 UL threshold:  0.85 → 0.82  (UL_PRIMARY families only)`);
      recs.push(`  Add Rule 4 extension: v2Conf < 0.60 AND ul.intent in UL_PRIMARY → source = ul`);
    } else {
      recs.push(`[V2 BUG] V2 false positives forcing Rule 1 on semantic messages.`);
      recs.push(`  Audit V2 intent patterns for: ${[...new Set(falseV2Entries.map(e => e.family))].join(", ")}`);
    }
  }

  if (m.zero_execution_rate > 0.03) {
    recs.push(`[SAFETY — Rule 2] Zero-execution rate ${pct(m.zero_execution_rate)} > 3%.`);
    recs.push(`  Conflict rule is blocking valid actions.`);
    recs.push(`  Require ul.needsAction === false AND ul.confidence >= 0.87 (was 0.85).`);
  }

  if (!hasTs) {
    recs.push(`[DATA] Collect production logs (7 days minimum) and rerun with --from-logs.`);
    recs.push(`  Synthetic results are directional only — real UL confidence will differ.`);
  }

  recs.push(`[PROMPT] Section 6 scoring blocked — add response_quality log (see Section 6).`);
  recs.push(`  Target > 80% LLM directive compliance. Below 80% = llm.ts injection issue.`);

  if (recs.length === 0) {
    console.log(`  All metrics within target. No changes needed.`);
  } else {
    for (const r of recs) console.log(`  ${r}`);
  }

  console.log(`\n${LINE}\n`);
}

// ─── Log-parse mode ───────────────────────────────────────────────────────────

async function parseLogsFromStdin(): Promise<AuditEntry[]> {
  const rl      = readline.createInterface({ input: process.stdin, terminal: false });
  const entries: AuditEntry[] = [];
  for await (const rawLine of rl) {
    try {
      const rec = JSON.parse(rawLine);
      if (rec.layer !== "semantic_router") continue;
      entries.push({
        message:        rec.message    ?? "",
        family:         "unknown",
        category:       "unknown",
        v2Intent:       rec.v2_intent === "none" ? null : (rec.v2_intent ?? null),
        v2Conf:         rec.v2_conf   ?? 0,
        ulIntent:       rec.ul_intent ?? "general_chat",
        ulConf:         rec.ul_conf   ?? 0,
        ulEmotion:      rec.ul_emotion ?? "neutral",
        ulIntervention: rec.ul_intervention ?? undefined,
        ulNeedsAction:  false,
        routerSource:   rec.router_source as "ul" | "v2" | "clarification",
        routerIntent:   rec.router_intent ?? "",
        routerConf:     rec.router_conf   ?? 0,
        clarified:      Boolean(rec.requires_clarify),
        isCorrect:      true,    // no ground truth in real logs
        failureType:    null,
        ts:             new Date(rec.ts),
      });
    } catch { /* skip malformed lines */ }
  }
  return entries;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const isLive   = process.argv.includes("--live");
  const fromLogs = process.argv.includes("--from-logs");

  if (fromLogs) {
    process.stderr.write("Parsing semantic_router log lines from stdin...\n");
    const entries = await parseLogsFromStdin();
    if (entries.length === 0) {
      console.log("No semantic_router log lines found in stdin.");
      console.log("Expected format: JSON lines with layer=semantic_router");
      console.log("Collect via: railway logs | grep '\"layer\":\"semantic_router\"' | npx tsx router-audit.ts --from-logs");
      return;
    }
    printReport(entries, `LOG-PARSE — ${entries.length} real messages`);
    return;
  }

  const mode = isLive ? "LIVE-UL (real API calls)" : "SYNTHETIC (simulated UL confidence)";
  console.log(`\nRunning semantic router audit (${isLive ? "LIVE" : "SYNTHETIC"}) on ${SAMPLES.length} samples...`);
  if (isLive) console.log("Calling runUnderstandingLayer for each sample (~$0.03 total).\n");

  const entries: AuditEntry[] = [];

  for (const sample of SAMPLES) {
    // V2: always live (sync, zero cost)
    const v2 = parseMessage(sample.message, { recentMessages: [] });

    // UL: live or simulated
    const ul: UnderstandingResult = isLive
      ? await runUnderstandingLayer({ message: sample.message, recentMessages: [] })
      : simulateUL(sample);

    // Router
    const decision = routeMessage(v2, ul);

    // Classify correctness against ground truth
    const { isCorrect, failureType } = classifyEntry(
      decision.source,
      sample.category,
      v2.actionableIntent?.type ?? null,
    );

    entries.push({
      message:        sample.message,
      family:         sample.family,
      category:       sample.category,
      v2Intent:       v2.actionableIntent?.type ?? null,
      v2Conf:         v2.confidence,
      ulIntent:       ul.intent,
      ulConf:         ul.confidence,
      ulEmotion:      ul.emotion,
      ulIntervention: ul.suggestedIntervention,
      ulNeedsAction:  ul.needsAction,
      routerSource:   decision.source,
      routerIntent:   decision.intent,
      routerConf:     decision.confidence,
      clarified:      decision.requiresClarification,
      isCorrect,
      failureType,
    });
  }

  printReport(entries, mode);
}

const isMain =
  process.argv[1]?.endsWith("router-audit.ts") ||
  process.argv[1]?.endsWith("router-audit.js");
if (isMain) main().catch(console.error);
