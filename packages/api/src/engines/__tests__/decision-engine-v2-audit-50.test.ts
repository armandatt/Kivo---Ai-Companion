/**
 * Decision Engine V2 — 50-Scenario Coaching Quality Audit
 * READ ONLY — do not modify the engine. Evaluate coaching quality.
 */
import { runDecisionV2, CoachIntervention } from "../decision-engine-v2";
import type { DecisionV2Input } from "../decision-engine-v2";
import type { MentorState } from "../user-state-engine";
import type { MemoryFact } from "../../types/memory.types";
import type { ConversationAnalysis } from "../../types/mentor.types";

// ─── Builders ─────────────────────────────────────────────────────────────────

const NOW = new Date("2026-06-10T18:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

function st(o: Partial<MentorState> = {}): MentorState {
  return {
    motivation: 60, confidence: 60, stress: 30, burnoutRisk: 15,
    consistency: 60, momentum: 55, capacity: 70, discipline: 60,
    streakDays: 0, longestStreak: 0, consecutiveMisses: 0,
    completionRate30d: 0.70, completionRate7d: 0.70,
    totalCommitmentsMade: 0, totalCommitmentsKept: 0,
    daysSinceFirstSession: 14, version: 1,
    lastUpdatedAt: NOW, lastActivityAt: null,
    flags: [], momentum7dTrend: [],
    ...o,
  };
}

function mem(type: string, value: string, updatedDaysAgo = 7): MemoryFact {
  return {
    id: `m-${Math.random().toString(36).slice(2)}`, type, key: type, value,
    confidence: 0.88, ageHours: updatedDaysAgo * 24,
    sourceMessageId: null,
    createdAt: ago(updatedDaysAgo + 3),
    updatedAt: ago(updatedDaysAgo),
  };
}

function ana(o: {
  intent?: string; emotion?: string; intensity?: number;
  valence?: "positive" | "negative" | "neutral";
  hasFailureReport?: boolean; hasExcuse?: boolean; domain?: string;
}): ConversationAnalysis {
  return {
    intent: (o.intent ?? "general_chat") as any, secondaryIntents: [], goal: null,
    domain: (o.domain ?? "fitness") as any,
    emotion: { primary: (o.emotion ?? "neutral") as any, secondary: null, intensity: o.intensity ?? 0.55, valence: o.valence ?? "neutral", confidence: 0.80 },
    constraints: [], commitmentLevel: "low" as any, commitmentScore: 0, urgency: 0.5,
    requestedOutcome: "none" as any,
    hasFailureReport: o.hasFailureReport ?? false,
    hasExcuse:        o.hasExcuse        ?? false,
    hasCommitment: false, isQuestion: false, isRepeat: false, wordCount: 12,
    confidence: 0.80, rawText: "", normalizedText: "", entities: {},
  };
}

function inp(
  message: string, a: ConversationAnalysis, s: MentorState,
  mems: MemoryFact[] = [], goals: string[] = ["get consistent", "hit 100kg bench"],
  firstSession = false,
): DecisionV2Input {
  return {
    message, analysis: a, state: s, relevantMemories: mems,
    goals, gymContext: null, patternReport: null, behaviorPatterns: null,
    isFirstSession: firstSession, personaType: "rex",
  };
}

// ─── Shared memory fixtures ────────────────────────────────────────────────────

const P_quit      = mem("promise",      "Promised I'd never quit again after the last restart");
const P_bench     = mem("promise",      "Swore I'd hit 100kg bench by September no matter what");
const C_3pw       = mem("commitment",   "Committed to 3 sessions per week, no exceptions");
const C_prot      = mem("commitment",   "Said I'd fix protein: 160g every day starting this week");
const A_bench85   = mem("achievement",  "Hit 85kg bench — first time past 80 after 12 weeks");
const A_28streak  = mem("achievement",  "28-day training streak in March — never missed once");
const A_goal      = mem("achievement",  "Finished the 8-week program — every session completed");
const BT_consist  = mem("breakthrough", "Realised consistency over intensity is the only way forward");
const BT_why      = mem("breakthrough", "Figured out why I keep skipping: I schedule too late");
const CB_3wk      = mem("comeback",     "Came back after 3-week gap and didn't restart from zero");
const ANC_hard    = mem("anchor",       "Sees himself as someone who does hard things");
const ANC_id      = mem("identity_shift","Started calling himself a lifter, not just gym-goer");
const STR_quit    = mem("struggle",     "Has said 'I'll try one more time' and quit 4 times before");
const STR_morn    = mem("struggle",     "Repeatedly misses morning sessions — mentioned 6 times");
const PREF_ppl    = mem("preference",   "Push/pull/legs, 6 days a week, prefers morning sessions");
const PREF_prot   = mem("preference",   "High protein: 160g/day. Struggles to hit it when travelling");
const PREF_prog   = mem("preference",   "Runs 5/3/1 strength program — 4-day cycle");

// ─── Scenario runner ──────────────────────────────────────────────────────────

interface AuditResult {
  id:          number;
  label:       string;
  message:     string;
  primary:     CoachIntervention;
  secondary:   CoachIntervention | null;
  confidence:  number;
  tone:        string;
  urgency:     string;
  gate:        string | null;
  topScores:   string;
  signals:     string;
  memories:    string;
  reasoning:   string;
}

const RESULTS: AuditResult[] = [];

function run(
  id: number, label: string, i: DecisionV2Input,
): AuditResult {
  const r = runDecisionV2(i);
  const topScores = r.candidateScores
    .slice(0, 5)
    .map(c => `${c.intervention}=${c.score.toFixed(3)}`)
    .join("  ");
  const signals = r.supportingSignals
    .filter(s => !s.startsWith("intent:general") && s !== "state:motivation_below_avg")
    .slice(0, 6)
    .join(", ");
  const memories = r.supportingMemories.map(m => `[${m.type}] ${m.value.slice(0, 50)}`).join(" | ") || "none";
  const result: AuditResult = {
    id, label, message: i.message,
    primary:    r.primaryIntervention,
    secondary:  r.secondaryIntervention,
    confidence: r.confidence,
    tone:       r.tone,
    urgency:    r.urgency,
    gate:       r.recommendationGate ? `${r.recommendationGate.level}(${r.recommendationGate.score})` : null,
    topScores,
    signals,
    memories,
    reasoning:  r.reasoning,
  };
  RESULTS.push(result);
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 50 SCENARIOS
// ═══════════════════════════════════════════════════════════════════════════════

describe("Decision Engine V2 — 50-Scenario Coaching Audit", () => {

  afterAll(() => {
    console.log("\n\n════════════════════════════════════════════════════════════════");
    console.log("DECISION ENGINE V2 — COACHING AUDIT RESULTS");
    console.log("════════════════════════════════════════════════════════════════\n");
    for (const r of RESULTS) {
      console.log(`[${String(r.id).padStart(2,"0")}] ${r.label}`);
      console.log(`     Msg:       "${r.message}"`);
      console.log(`     Signals:   ${r.signals || "none"}`);
      console.log(`     Memories:  ${r.memories}`);
      console.log(`     Top-5:     ${r.topScores}`);
      console.log(`     → CHOSEN:  ${r.primary}  | tone=${r.tone}  urgency=${r.urgency}${r.secondary ? `  secondary=${r.secondary}` : ""}${r.gate ? `  gate=${r.gate}` : ""}`);
      console.log(`     Score:     ${r.confidence.toFixed(3)}`);
      console.log("");
    }
  });

  // ── QUIT / GIVING UP (1–8) ─────────────────────────────────────────────────

  test("01 quit + promise (strongest quit scenario)", () => {
    run(1, "quit + promise", inp(
      "I want to quit.",
      ana({ intent:"emotional_vent", emotion:"discouraged", valence:"negative", intensity:0.80 }),
      st({ motivation:32, confidence:38, consistency:40 }),
      [P_quit, STR_quit, A_bench85],
    ));
  });

  test("02 quit + achievement only (no promise)", () => {
    run(2, "quit + achievement, no promise", inp(
      "I want to quit. Nothing is working.",
      ana({ intent:"emotional_vent", emotion:"discouraged", valence:"negative" }),
      st({ motivation:30, confidence:35 }),
      [A_bench85, A_28streak, BT_consist],
    ));
  });

  test("03 quit + burnout critical", () => {
    run(3, "quit + burnout_critical", inp(
      "I want to quit. I'm done.",
      ana({ intent:"emotional_vent", emotion:"overwhelmed", valence:"negative", intensity:0.90 }),
      st({ motivation:20, burnoutRisk:82, stress:78 }),
      [STR_quit],
    ));
  });

  test("04 quit + no memories, low state", () => {
    run(4, "quit + no memory", inp(
      "I want to quit.",
      ana({ intent:"emotional_vent", emotion:"overwhelmed", valence:"negative", intensity:0.75 }),
      st({ motivation:28, stress:65, burnoutRisk:40 }),
      [],
    ));
  });

  test("05 thinking of stopping + anchor in memory", () => {
    run(5, "stopping + anchor", inp(
      "Thinking about stopping entirely. What's the point.",
      ana({ intent:"emotional_vent", emotion:"discouraged", valence:"negative" }),
      st({ motivation:35, confidence:38 }),
      [ANC_hard, ANC_id, BT_consist],
    ));
  });

  test("06 giving up framing + spiral", () => {
    run(6, "spiral framing", inp(
      "I give up. Nothing works. Everything is pointless.",
      ana({ intent:"emotional_vent", emotion:"discouraged", valence:"negative", intensity:0.88 }),
      st({ motivation:25, consistency:28, momentum:20 }),
      [STR_quit, STR_morn],
    ));
  });

  test("07 quit + comeback memory (returning user)", () => {
    run(7, "quit + comeback memory", inp(
      "Haven't been in 3 weeks. Thinking of just stopping.",
      ana({ intent:"status_update", emotion:"avoidant", valence:"negative" }),
      st({ motivation:38, consistency:35 }),
      [CB_3wk, A_28streak, P_quit],
    ));
  });

  test("08 passive quit ('not sure this is for me')", () => {
    run(8, "passive quit — goal doubt", inp(
      "I'm not sure this is really for me anymore.",
      ana({ intent:"reflection", emotion:"discouraged", valence:"negative" }),
      st({ motivation:40, confidence:38 }),
      [A_bench85, BT_consist],
    ));
  });

  // ── FAILURE / MISSED SESSIONS (9–16) ──────────────────────────────────────

  test("09 skipped + promise in memory", () => {
    run(9, "skipped + promise", inp(
      "Skipped again.",
      ana({ intent:"failure_report", hasFailureReport:true, emotion:"avoidant", valence:"negative" }),
      st({ consistency:42, consecutiveMisses:2 }),
      [P_bench, C_3pw, STR_morn],
    ));
  });

  test("10 skipped 4x in a row (multi-miss)", () => {
    run(10, "multi-miss (4 sessions)", inp(
      "Missed again. Fourth session in a row.",
      ana({ intent:"failure_report", hasFailureReport:true, emotion:"avoidant", valence:"negative" }),
      st({ consistency:30, consecutiveMisses:4, momentum:28 }),
      [C_3pw, STR_quit],
    ));
  });

  test("11 missed + burnout (burnout causes missing)", () => {
    run(11, "missed + burnout risk", inp(
      "Missed the session. Too burned out to care.",
      ana({ intent:"failure_report", hasFailureReport:true, emotion:"overwhelmed" }),
      st({ burnoutRisk:75, stress:72 }),
      [],
    ));
  });

  test("12 missed goal deadline", () => {
    run(12, "deadline miss + guilty", inp(
      "I missed my goal for the month.",
      ana({ intent:"failure_report", hasFailureReport:true, emotion:"guilty", valence:"negative" }),
      st({ confidence:42, motivation:45 }),
      [STR_quit, STR_morn],
    ));
  });

  test("13 missed + achievement in memory (reframe opportunity)", () => {
    run(13, "missed + achievement in memory", inp(
      "I missed again. I've been failing for 3 weeks.",
      ana({ intent:"failure_report", hasFailureReport:true, emotion:"discouraged", valence:"negative" }),
      st({ confidence:38, motivation:40 }),
      [A_bench85, A_28streak, BT_consist],
    ));
  });

  test("14 missed once, first time this month", () => {
    run(14, "single miss, good track record", inp(
      "Missed yesterday. Work ran late.",
      ana({ intent:"failure_report", hasFailureReport:true, hasExcuse:true }),
      st({ consistency:72, consecutiveMisses:1 }),
      [C_3pw],
    ));
  });

  test("15 missed + spiral mood", () => {
    run(15, "missed + spiral mood", inp(
      "Missed again. Everything I try fails. What's even the point.",
      ana({ intent:"failure_report", hasFailureReport:true, emotion:"discouraged", valence:"negative", intensity:0.85 }),
      st({ motivation:28, consistency:30, momentum:22 }),
      [STR_quit, STR_morn],
    ));
  });

  test("16 missed but 'I'm fine' framing", () => {
    run(16, "missed with dismissive framing", inp(
      "Skipped the session but I'll make up for it tomorrow.",
      ana({ intent:"status_update", hasExcuse:true }),
      st({ consistency:60 }),
      [C_3pw],
    ));
  });

  // ── EXCUSES (17–21) ───────────────────────────────────────────────────────

  test("17 work excuse + promise in memory", () => {
    run(17, "work excuse + promise", inp(
      "Work got in the way again this week.",
      ana({ intent:"failure_report", hasFailureReport:true, hasExcuse:true, valence:"negative" }),
      st({ consistency:42 }),
      [P_bench, C_3pw],
    ));
  });

  test("18 travel excuse + commitment in memory", () => {
    run(18, "travel + commitment", inp(
      "Traveling next week so I'll probably miss sessions.",
      ana({ intent:"status_update" }),
      st({ consistency:58 }),
      [C_3pw, P_bench],
    ));
  });

  test("19 generic excuse, no memory", () => {
    run(19, "generic excuse, no memory", inp(
      "I keep making excuses. I know it.",
      ana({ intent:"failure_report", hasFailureReport:true, hasExcuse:true }),
      st({ motivation:52, burnoutRisk:18 }),
      [],
    ));
  });

  test("20 excuse + avoidant emotion", () => {
    run(20, "excuse + avoidant", inp(
      "Life just keeps getting in the way.",
      ana({ intent:"failure_report", hasFailureReport:true, hasExcuse:true, emotion:"avoidant" }),
      st({ consistency:40 }),
      [STR_quit],
    ));
  });

  test("21 excuse loop (repeated pattern)", () => {
    run(21, "excuse loop with struggle memory", inp(
      "Work again. Always work.",
      ana({ intent:"failure_report", hasFailureReport:true, hasExcuse:true, emotion:"avoidant" }),
      st({ consistency:35, consecutiveMisses:3 }),
      [STR_quit, C_3pw],
    ));
  });

  // ── WINS / PROGRESS (22–27) ───────────────────────────────────────────────

  test("22 PR hit + proud emotion", () => {
    run(22, "PR hit + proud", inp(
      "Hit 100kg on bench today. Personal record.",
      ana({ intent:"progress_report", emotion:"proud", valence:"positive", intensity:0.90 }),
      st({ motivation:82, momentum:78 }),
      [A_bench85, A_28streak],
    ));
  });

  test("23 strong session + motivated", () => {
    run(23, "strong session + motivated", inp(
      "Hit all my sets. Best session this month.",
      ana({ intent:"progress_report", emotion:"motivated", valence:"positive" }),
      st({ motivation:75, momentum:70, streakDays:8 }),
      [A_bench85],
    ));
  });

  test("24 goal completed", () => {
    run(24, "goal completed", inp(
      "Finished the 8-week program. Every session done.",
      ana({ intent:"progress_report", emotion:"proud", valence:"positive", intensity:0.88 }),
      st({ motivation:80, momentum:75, consistency:85 }),
      [A_goal],
    ));
  });

  test("25 long streak check-in", () => {
    run(25, "long streak check-in", inp(
      "Day 21 of not missing. Still here.",
      ana({ intent:"status_update", emotion:"motivated", valence:"positive" }),
      st({ motivation:72, consistency:82, streakDays:21, momentum:70 }),
      [A_28streak],
    ));
  });

  test("26 first PR after plateau", () => {
    run(26, "first PR after plateau", inp(
      "Finally hit a new bench PR after 8 weeks stuck.",
      ana({ intent:"progress_report", emotion:"proud", valence:"positive", intensity:0.85 }),
      st({ motivation:76, momentum:68 }),
      [A_bench85, PREF_prog],
    ));
  });

  test("27 comeback + first session done", () => {
    run(27, "comeback session", inp(
      "Back. Did the session. 2-week gap but I'm back.",
      ana({ intent:"progress_report", emotion:"determined", valence:"positive" }),
      st({ motivation:58, consistency:45 }),
      [CB_3wk, P_quit],
    ));
  });

  // ── BURNOUT / STRESS (28–33) ──────────────────────────────────────────────

  test("28 burnout critical + overwhelmed", () => {
    run(28, "burnout critical", inp(
      "I'm completely burned out. I have nothing left.",
      ana({ intent:"emotional_vent", emotion:"overwhelmed", valence:"negative", intensity:0.92 }),
      st({ burnoutRisk:85, stress:80, motivation:18 }),
      [STR_quit],
    ));
  });

  test("29 burnout risk (moderate)", () => {
    run(29, "burnout risk (moderate)", inp(
      "I'm exhausted. Everything feels heavy.",
      ana({ intent:"emotional_vent", emotion:"stressed", valence:"negative", intensity:0.72 }),
      st({ burnoutRisk:48, stress:65 }),
      [],
    ));
  });

  test("30 stressed from work, not fitness", () => {
    run(30, "work stress spillover", inp(
      "Work has been brutal. I'm running on empty.",
      ana({ intent:"emotional_vent", emotion:"stressed", valence:"negative" }),
      st({ stress:70, burnoutRisk:35 }),
      [],
    ));
  });

  test("31 overwhelmed + needs to reset priorities", () => {
    run(31, "overwhelmed + too many commitments", inp(
      "I need to reset. Too much going on. I can't handle all of this.",
      ana({ intent:"emotional_vent", emotion:"overwhelmed", valence:"negative", intensity:0.80 }),
      st({ burnoutRisk:60, stress:72 }),
      [],
    ));
  });

  test("32 burnout creeping in (user doesn't name it)", () => {
    run(32, "creeping burnout (unnamed)", inp(
      "I've been dragging myself to sessions for 3 weeks. Not feeling it.",
      ana({ intent:"status_update", emotion:"stressed" }),
      st({ burnoutRisk:45, stress:55, motivation:42 }),
      [STR_morn],
    ));
  });

  test("33 over-committed, can't sustain load", () => {
    run(33, "over-committed", inp(
      "I'm training 6 days a week, working 60 hours, and I have no time left.",
      ana({ intent:"status_update", emotion:"overwhelmed" }),
      st({ burnoutRisk:55, stress:68, capacity:30 }),
      [PREF_ppl],
    ));
  });

  // ── IDENTITY / CONFIDENCE (34–37) ─────────────────────────────────────────

  test("34 identity doubt + anchor in memory", () => {
    run(34, "identity doubt + anchor", inp(
      "I'm not the kind of person who sticks to things long-term.",
      ana({ intent:"reflection", emotion:"discouraged", valence:"negative" }),
      st({ confidence:32, motivation:40 }),
      [ANC_hard, ANC_id, CB_3wk],
    ));
  });

  test("35 comparison trap", () => {
    run(35, "comparison trap", inp(
      "Everyone around me is progressing so much faster. I feel behind.",
      ana({ intent:"reflection", emotion:"discouraged", valence:"negative" }),
      st({ confidence:38, motivation:42 }),
      [A_bench85, BT_consist],
    ));
  });

  test("36 low confidence without specific reason", () => {
    run(36, "low confidence, vague", inp(
      "I just don't believe I can do this.",
      ana({ intent:"reflection", emotion:"discouraged", valence:"negative" }),
      st({ confidence:30, motivation:38 }),
      [A_28streak, A_bench85],
    ));
  });

  test("37 defensive pushback", () => {
    run(37, "defensive", inp(
      "I train when I can. Not everyone has unlimited time.",
      ana({ intent:"general_chat", emotion:"defensive" }),
      st({ motivation:55, stress:45 }),
      [C_3pw],
    ));
  });

  // ── GOAL / PLANNING (38–43) ───────────────────────────────────────────────

  test("38 goal doubt + multiple goals", () => {
    run(38, "goal doubt", inp(
      "I'm not sure the 100kg goal is realistic for me anymore.",
      ana({ intent:"reflection", emotion:"discouraged", valence:"negative" }),
      st({ motivation:44 }),
      [],
      ["hit 100kg bench", "lose 5kg", "improve sleep"],
    ));
  });

  test("39 plan request + good context", () => {
    run(39, "plan request + good context", inp(
      "I need a new training plan.",
      ana({ intent:"plan_request", domain:"fitness" }),
      st({ motivation:60 }),
      [PREF_ppl, PREF_prog, ANC_hard],
      ["hit 100kg bench"],
      false,
    ));
  });

  test("40 plan request + no context (first session)", () => {
    run(40, "plan request — first session, no context", inp(
      "What training plan should I run?",
      ana({ intent:"plan_request", domain:"fitness" }),
      st(),
      [], [], true,
    ));
  });

  test("41 vague goal: 'I want to get better'", () => {
    run(41, "vague goal", inp(
      "I want to get better.",
      ana({ intent:"goal_setting", domain:"unknown" }),
      st(),
      [], [],
    ));
  });

  test("42 nutrition question with context", () => {
    run(42, "protein question + preference data", inp(
      "My protein has been bad this week.",
      ana({ intent:"plan_request", domain:"fitness" }),
      st(),
      [PREF_prot, PREF_ppl],
    ));
  });

  test("43 nutrition question without context", () => {
    run(43, "protein question — no data", inp(
      "Should I change my diet?",
      ana({ intent:"plan_request", domain:"fitness" }),
      st(),
      [], [], true,
    ));
  });

  // ── CONSISTENCY / MOMENTUM (44–47) ────────────────────────────────────────

  test("44 consistent, streak active", () => {
    run(44, "consistent + streak active", inp(
      "I've been consistent this week. Haven't missed a session.",
      ana({ intent:"status_update", emotion:"motivated", valence:"positive" }),
      st({ consistency:75, streakDays:10, momentum:65 }),
      [A_28streak],
    ));
  });

  test("45 momentum high, push harder", () => {
    run(45, "momentum push opportunity", inp(
      "Been showing up every day for 3 weeks. Training is clicking.",
      ana({ intent:"progress_report", emotion:"determined", valence:"positive" }),
      st({ motivation:75, momentum:72, streakDays:21, consistency:82 }),
      [A_28streak, A_bench85],
    ));
  });

  test("46 bench stalled (training block)", () => {
    run(46, "bench stalled + training history", inp(
      "My bench has been completely stalled for 6 weeks.",
      ana({ intent:"status_update", domain:"fitness" }),
      st(),
      [PREF_prog, PREF_ppl],
    ));
  });

  test("47 bench stalled, no history", () => {
    run(47, "bench stalled — no data", inp(
      "My bench is stuck. What should I do?",
      ana({ intent:"plan_request", domain:"fitness" }),
      st(),
      [], [], true,
    ));
  });

  // ── AMBIGUOUS / COMPLEX (48–50) ────────────────────────────────────────────

  test("48 short message: 'tired'", () => {
    run(48, "one word: tired (burnout high)", inp(
      "Tired.",
      ana({ intent:"general_chat", emotion:"stressed" }),
      st({ burnoutRisk:72, stress:68 }),
      [],
    ));
  });

  test("49 'fine' — neutral check-in, no context", () => {
    run(49, "neutral check-in: fine", inp(
      "I'm fine.",
      ana({ intent:"check_in_response" }),
      st(),
      [],
    ));
  });

  test("50 comeback after long absence + breakthrough exists", () => {
    run(50, "long absence comeback + breakthrough", inp(
      "Haven't trained in 6 weeks. Starting again.",
      ana({ intent:"status_update", emotion:"determined", valence:"positive" }),
      st({ consistency:35, motivation:60 }),
      [CB_3wk, BT_consist, P_quit],
    ));
  });

  // Ensure all 50 ran
  test("AUDIT COMPLETE — all 50 results captured", () => {
    expect(RESULTS).toHaveLength(50);
  });
});
