/**
 * Reality Extractor Phase 2 — 100-Example Audit
 *
 * Run from repo root:  npx tsx --tsconfig tsconfig.json scripts/realityExtractorAudit.ts
 *
 * Measures: extraction precision, recall, hallucination rate, TTL accuracy,
 *           duplicate fact rate, false positive rate on gym/trivial messages.
 *
 * Does NOT write to DB — calls extractRealityFacts() only (pure LLM audit).
 */

import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
// Load OpenAI key from packages/api/.env (OPEN_API_KEY)
loadEnv({ path: resolve(process.cwd(), "packages/api/.env"), override: false });

import { extractRealityFacts, shouldRunExtractor } from "@repo/api/services/realityExtractor.service";

// ── ANSI ──────────────────────────────────────────────────────────────────────
const GRN = (s: string) => `\x1b[32m${s}\x1b[0m`;
const RED = (s: string) => `\x1b[31m${s}\x1b[0m`;
const YLW = (s: string) => `\x1b[33m${s}\x1b[0m`;
const DIM = (s: string) => `\x1b[2m${s}\x1b[0m`;
const BLD = (s: string) => `\x1b[1m${s}\x1b[0m`;

// ── Test case types ───────────────────────────────────────────────────────────

interface TestCase {
  id:   string;
  text: string;
  // Expected outcome
  shouldExtract: boolean;
  expectedCategory?: string;    // if shouldExtract=true
  minTTL?: number;              // inclusive lower bound
  maxTTL?: number;              // inclusive upper bound
  forbiddenCategories?: string[]; // categories that must NOT appear
  label: string;                // human description for reporting
  group: string;                // group for aggregate stats
}

interface TestResult {
  id:    string;
  label: string;
  group: string;
  passed:           boolean;
  extracted:        Awaited<ReturnType<typeof extractRealityFacts>>;
  failureReason?:   string;
  hallucination:    boolean; // extracted something when shouldExtract=false
  misfire?:         string;  // wrong category or TTL
  durationMs:       number;
}

// ── 100 test cases ────────────────────────────────────────────────────────────

const CASES: TestCase[] = [
  // ── GROUP A: Burnout / Fatigue (should extract: emotional) ──────────────────
  { id:"A01", group:"burnout", shouldExtract:true,  expectedCategory:"emotional", minTTL:48, maxTTL:120,
    label:"Classic burnout declaration",
    text:"I'm completely burned out. I haven't wanted to train in weeks. I'm going through the motions at best." },
  { id:"A02", group:"burnout", shouldExtract:true,  expectedCategory:"emotional", minTTL:48, maxTTL:120,
    label:"Burnout + work stress",
    text:"Work has been destroying me for the past month. I'm too exhausted to train after work. I hate this." },
  { id:"A03", group:"burnout", shouldExtract:true,  expectedCategory:"emotional", minTTL:24, maxTTL:120,
    label:"Mental exhaustion",
    text:"I'm mentally drained. Everything feels like too much effort. I dread going to the gym right now." },
  { id:"A04", group:"burnout", shouldExtract:true,  expectedCategory:"emotional", minTTL:24, maxTTL:96,
    label:"Loss of motivation",
    text:"Haven't trained in 2 weeks. Lost all motivation. Don't know why I bother." },
  { id:"A05", group:"burnout", shouldExtract:true,  expectedCategory:"emotional", minTTL:48, maxTTL:120,
    label:"Burnout + sleep disruption",
    text:"I'm burning out badly. Sleeping 4 hours a night, exhausted all day, can't make myself train." },

  // ── GROUP B: Emotional distress / grief (should extract: emotional) ─────────
  { id:"B01", group:"grief", shouldExtract:true,  expectedCategory:"emotional", minTTL:72, maxTTL:120,
    label:"Grandmother passed away",
    text:"My grandmother passed away last week. I haven't been able to do anything. Training is the last thing on my mind." },
  { id:"B02", group:"grief", shouldExtract:true,  expectedCategory:"emotional", minTTL:72, maxTTL:120,
    label:"Family bereavement",
    text:"Lost my dad suddenly two days ago. Can't think straight. Training feels completely irrelevant." },
  { id:"B03", group:"grief", shouldExtract:true,  expectedCategory:"emotional", minTTL:48, maxTTL:96,
    label:"Relationship breakup",
    text:"Just went through a breakup after 4 years. It's hit me hard. I can barely get out of bed right now." },
  { id:"B04", group:"grief", shouldExtract:true,  expectedCategory:"emotional", minTTL:48, maxTTL:96,
    label:"Anxiety disorder mention",
    text:"My anxiety has been really bad this week. Panic attacks at work. I'm not in a good headspace at all." },
  { id:"B05", group:"grief", shouldExtract:true,  expectedCategory:"emotional", minTTL:48, maxTTL:96,
    label:"Depression state",
    text:"I've been depressed for a few weeks now. Getting out of bed is hard. Training has completely stopped." },

  // ── GROUP C: Travel (should extract: life_constraint) ──────────────────────
  { id:"C01", group:"travel", shouldExtract:true,  expectedCategory:"life_constraint", minTTL:48, maxTTL:240,
    label:"10-day travel",
    text:"I'm travelling for work for the next 10 days. No gym access, living out of hotels." },
  { id:"C02", group:"travel", shouldExtract:true,  expectedCategory:"life_constraint", minTTL:24, maxTTL:168,
    label:"Weekend trip",
    text:"Going away this weekend for a family thing, won't have gym access." },
  { id:"C03", group:"travel", shouldExtract:true,  expectedCategory:"life_constraint", minTTL:48, maxTTL:240,
    label:"2-week vacation",
    text:"On vacation for 2 weeks. Hotel has no gym, eating out every meal." },
  { id:"C04", group:"travel", shouldExtract:true,  expectedCategory:"life_constraint", minTTL:48, maxTTL:168,
    label:"Business trip",
    text:"I'm on a business trip in NYC for the week. No proper gym nearby, schedule is packed." },
  { id:"C05", group:"travel", shouldExtract:true,  expectedCategory:"life_constraint", minTTL:48, maxTTL:240,
    label:"Long-haul trip",
    text:"Flying to Thailand tomorrow for 3 weeks. Will try to find gyms but it's uncertain." },

  // ── GROUP D: Exam / Academic pressure (should extract: life_constraint) ─────
  { id:"D01", group:"exams", shouldExtract:true,  expectedCategory:"life_constraint", minTTL:48, maxTTL:168,
    label:"Exam week",
    text:"Exam week is killing me. Studying 12 hours a day, barely sleeping, no time to train." },
  { id:"D02", group:"exams", shouldExtract:true,  expectedCategory:"life_constraint", minTTL:48, maxTTL:168,
    label:"Finals period",
    text:"It's finals right now. Have 4 exams in 5 days. I can't train this week at all." },
  { id:"D03", group:"exams", shouldExtract:true,  expectedCategory:"life_constraint", minTTL:48, maxTTL:96,
    label:"Big exam tomorrow",
    text:"My medical board exam is tomorrow. I'm a complete wreck. Going to rest and study." },
  { id:"D04", group:"exams", shouldExtract:true,  expectedCategory:"life_constraint", minTTL:72, maxTTL:168,
    label:"Dissertation submission",
    text:"Dissertation is due at the end of the week. I'm working literally every hour. Training is out." },
  { id:"D05", group:"exams", shouldExtract:true,  expectedCategory:"life_constraint", minTTL:48, maxTTL:168,
    label:"Intense study period",
    text:"Got bar exam prep going on. Studying 8+ hours a day for the next 2 weeks. Barely sleeping." },

  // ── GROUP E: Work stress / life crisis (should extract: life_constraint or emotional) ─
  { id:"E01", group:"work_stress", shouldExtract:true, minTTL:24, maxTTL:96,
    label:"Layoff stress",
    text:"I might be getting laid off. Company announced cuts. I'm stressed out of my mind this week." },
  { id:"E02", group:"work_stress", shouldExtract:true, minTTL:48, maxTTL:120,
    label:"Work deadline crunch",
    text:"Product launch is in 3 days. I'm working until 2am every night. Everything else is on pause." },
  { id:"E03", group:"work_stress", shouldExtract:true, minTTL:48, maxTTL:96,
    label:"Hospital with family member",
    text:"My mum is in hospital. I've been there every day this week. Not thinking about training at all." },
  { id:"E04", group:"work_stress", shouldExtract:true, minTTL:48, maxTTL:96,
    label:"Newborn baby sleep deprivation",
    text:"Just had a baby 3 days ago. Running on 2 hours of sleep. Training is absolutely not happening." },
  { id:"E05", group:"work_stress", shouldExtract:true, minTTL:48, maxTTL:120,
    label:"Divorce proceedings",
    text:"Going through a divorce right now. Emotionally completely drained, can barely function." },

  // ── GROUP F: Schedule / No gym access (should extract: life_constraint) ─────
  { id:"F01", group:"schedule", shouldExtract:true,  expectedCategory:"life_constraint", minTTL:24, maxTTL:96,
    label:"Moving house — no gym",
    text:"Moving house this week. No gym access, boxes everywhere, complete chaos." },
  { id:"F02", group:"schedule", shouldExtract:true,  expectedCategory:"life_constraint", minTTL:24, maxTTL:96,
    label:"Gym closed",
    text:"My gym is closed for refurbishment for the next 2 weeks. No backup gym nearby." },
  { id:"F03", group:"schedule", shouldExtract:true,  expectedCategory:"life_constraint", minTTL:24, maxTTL:72,
    label:"Childcare collapse",
    text:"Babysitter cancelled this week. I'm stuck at home with the kids full time. No gym possible." },
  { id:"F04", group:"schedule", shouldExtract:true,  expectedCategory:"life_constraint", minTTL:48, maxTTL:120,
    label:"Injury + no car",
    text:"Car broke down. No way to get to the gym for the next week until it's fixed." },
  { id:"F05", group:"schedule", shouldExtract:true,  expectedCategory:"life_constraint", minTTL:24, maxTTL:72,
    label:"Sick kid — no gym",
    text:"Kids are sick so I'm stuck at home this week. Can't get to the gym at all." },

  // ── GROUP G: Training context (should extract: training_context) ─────────────
  { id:"G01", group:"training_ctx", shouldExtract:true, expectedCategory:"training_context", minTTL:4, maxTTL:48,
    label:"Planned deload week",
    text:"Starting my deload week today. Going to drop weights and volume significantly." },
  { id:"G02", group:"training_ctx", shouldExtract:true, expectedCategory:"training_context", minTTL:4, maxTTL:48,
    label:"Returning from break",
    text:"Haven't trained in 3 weeks due to moving. Starting fresh today — everything will feel heavy." },
  { id:"G03", group:"training_ctx", shouldExtract:true, expectedCategory:"training_context", minTTL:12, maxTTL:48,
    label:"Active recovery week",
    text:"Coach has me on active recovery this week. Just walks, no lifting." },

  // ── GROUP H: Normal gym messages — MUST NOT extract ────────────────────────
  { id:"H01", group:"no_extract", shouldExtract:false,
    label:"Normal workout log",
    text:"Hit chest today. Bench 4x8 at 100kg, incline 3x10 at 80kg. Good session." },
  { id:"H02", group:"no_extract", shouldExtract:false,
    label:"PR announcement",
    text:"New squat PR today — 160kg! Super happy with how training is going." },
  { id:"H03", group:"no_extract", shouldExtract:false,
    label:"Asking for a plan",
    text:"Can you give me a push day workout for today? I've got about 1.5 hours." },
  { id:"H04", group:"no_extract", shouldExtract:false,
    label:"Nutrition question",
    text:"Should I eat more protein on rest days or keep it the same as training days?" },
  { id:"H05", group:"no_extract", shouldExtract:false,
    label:"Progress check-in",
    text:"Weight is down 2kg since last month. Lifts are still going up. Feeling good about the cut." },
  { id:"H06", group:"no_extract", shouldExtract:false,
    label:"Scheduling question",
    text:"Can I move my rest day from Wednesday to Thursday this week?" },
  { id:"H07", group:"no_extract", shouldExtract:false,
    label:"Supplement question",
    text:"Should I take creatine before or after training?" },
  { id:"H08", group:"no_extract", shouldExtract:false,
    label:"Muscle group question",
    text:"My left lat feels weaker than my right. What exercises help with that?" },
  { id:"H09", group:"no_extract", shouldExtract:false,
    label:"Split structure question",
    text:"Is an upper/lower split better than push/pull/legs for someone training 4x per week?" },
  { id:"H10", group:"no_extract", shouldExtract:false,
    label:"Missed session report",
    text:"Missed today's session. Slept in and couldn't fit it in. Will do it tomorrow." },
  { id:"H11", group:"no_extract", shouldExtract:false,
    label:"Gym complaint (temporary)",
    text:"That bench session was brutal today. Legs are shaking after squats. Good session though." },
  { id:"H12", group:"no_extract", shouldExtract:false,
    label:"One-off tiredness",
    text:"A bit tired today but still trained. Hit all my sets." },
  { id:"H13", group:"no_extract", shouldExtract:false,
    label:"Brief frustration",
    text:"I'm a bit annoyed. Missed my bench PR by 2.5kg. Going to get it next week." },
  { id:"H14", group:"no_extract", shouldExtract:false,
    label:"Food log",
    text:"Had chicken, rice and broccoli for lunch. About 450 calories and 40g protein." },
  { id:"H15", group:"no_extract", shouldExtract:false,
    label:"Body weight log",
    text:"Weighed in at 83.5kg this morning. Down 0.5kg from last week." },

  // ── GROUP I: Jokes / hypotheticals — MUST NOT extract ─────────────────────
  { id:"I01", group:"no_extract", shouldExtract:false,
    label:"Joke about being destroyed",
    text:"Legs day tomorrow. I'm already dead just thinking about it. Rip me." },
  { id:"I02", group:"no_extract", shouldExtract:false,
    label:"Hypothetical travel",
    text:"What would you recommend if I had to train while travelling for a month?" },
  { id:"I03", group:"no_extract", shouldExtract:false,
    label:"Sarcastic burnout",
    text:"Gym is so hard lol I'm burning out every Monday morning. Send help." },
  { id:"I04", group:"no_extract", shouldExtract:false,
    label:"Past event",
    text:"Last year when my dad was in hospital I lost all motivation. It was tough." },
  { id:"I05", group:"no_extract", shouldExtract:false,
    label:"Future plan",
    text:"I might be travelling in a few months. Should I adjust my training then?" },
  { id:"I06", group:"no_extract", shouldExtract:false,
    label:"Vague stress (minor)",
    text:"A bit stressed with work stuff but nothing major. Still training fine." },
  { id:"I07", group:"no_extract", shouldExtract:false,
    label:"Generic complaint",
    text:"Life is hard sometimes. Anyway, what should I eat after training?" },

  // ── GROUP J: Ambiguous messages — test boundary precision ──────────────────
  { id:"J01", group:"ambiguous", shouldExtract:true, minTTL:48, maxTTL:96,
    label:"Vague emotional + skipping pattern",
    text:"I've been skipping a lot lately. Not sure why. Just don't feel like training. Everything feels heavy." },
  { id:"J02", group:"ambiguous", shouldExtract:true, expectedCategory:"life_constraint", minTTL:24, maxTTL:72,
    label:"Clear constraint but brief",
    text:"Travelling this week. Back Sunday." },
  { id:"J03", group:"ambiguous", shouldExtract:false,
    label:"Minor life stress with workaround",
    text:"Work is a bit busy this week but I've moved my training to mornings so it's fine." },
  { id:"J04", group:"ambiguous", shouldExtract:true, expectedCategory:"emotional", minTTL:48, maxTTL:120,
    label:"Long-term emotional pattern",
    text:"I've been struggling mentally for months. Anxiety is through the roof. Training keeps me sane but even that's getting hard." },
  { id:"J05", group:"ambiguous", shouldExtract:false,
    label:"Future event, not current",
    text:"I have a conference next month that might disrupt training. Planning ahead." },
  { id:"J06", group:"ambiguous", shouldExtract:true, expectedCategory:"emotional", minTTL:48, maxTTL:96,
    label:"Relationship crisis + impact",
    text:"My partner and I are separating. I can barely concentrate on anything. Haven't been to the gym in a week." },
  { id:"J07", group:"ambiguous", shouldExtract:false,
    label:"Single rough day",
    text:"Had a rough day at work today. Just stressed about a presentation. Training helped." },
  { id:"J08", group:"ambiguous", shouldExtract:true, expectedCategory:"life_constraint", minTTL:48, maxTTL:120,
    label:"Work crisis, multi-day",
    text:"Product demo is this Thursday and we're nowhere near ready. I'm working 14-hour days this week." },
  { id:"J09", group:"ambiguous", shouldExtract:false,
    label:"Normal life mention",
    text:"Had a busy weekend — birthday party and a wedding. Back on track today." },
  { id:"J10", group:"ambiguous", shouldExtract:true, expectedCategory:"emotional", minTTL:72, maxTTL:120,
    label:"Grief with impact + duration",
    text:"My best friend died a few days ago. Everything has been a blur. I know I should train but I just can't right now." },

  // ── GROUP K: Multi-reality messages ────────────────────────────────────────
  { id:"K01", group:"multi_reality", shouldExtract:true,
    label:"Travel + burnout combined",
    text:"I've been travelling for 3 weeks, jet-lagged, completely exhausted. No gym access and mentally I'm hitting a wall." },
  { id:"K02", group:"multi_reality", shouldExtract:true,
    label:"Exam + sick combined",
    text:"I've got finals starting Monday and I'm also coming down with something. Feel awful." },
  { id:"K03", group:"multi_reality", shouldExtract:true,
    label:"Grief + no sleep + impact",
    text:"My dad passed away recently. I'm handling the funeral arrangements. Not sleeping. Training is on hold." },
  { id:"K04", group:"multi_reality", shouldExtract:true,
    label:"Family emergency + work deadline",
    text:"Mum is in ICU and I have a work presentation tomorrow I can't postpone. I'm running on empty." },

  // ── GROUP L: Edge cases that must NOT extract ───────────────────────────────
  { id:"L01", group:"no_extract", shouldExtract:false,
    label:"Acknowledging soreness",
    text:"Legs are still sore from yesterday. Going to do upper body instead." },
  { id:"L02", group:"no_extract", shouldExtract:false,
    label:"Generic Monday feeling",
    text:"Feeling a bit sluggish today. Monday blues. Still got the gym in." },
  { id:"L03", group:"no_extract", shouldExtract:false,
    label:"Positive energy mention",
    text:"Feeling motivated today! Let's go." },
  { id:"L04", group:"no_extract", shouldExtract:false,
    label:"Dietary slip",
    text:"Had a bad eating day yesterday. Pizza and beer. Getting back on track today." },
  { id:"L05", group:"no_extract", shouldExtract:false,
    label:"Asking about returning from holiday",
    text:"Just got back from holiday. What's the best way to ease back into training?" },
  { id:"L06", group:"no_extract", shouldExtract:false,
    label:"Upcoming event (future, not current)",
    text:"I've got a stag do in 2 weeks. Going to be a boozy one. Should I adjust training around it?" },
];

// ── Run the audit ─────────────────────────────────────────────────────────────

async function runCase(tc: TestCase): Promise<TestResult> {
  const start = Date.now();
  const extracted = await extractRealityFacts(tc.text);
  const durationMs = Date.now() - start;

  let passed = true;
  let failureReason: string | undefined;
  let hallucination = false;
  let misfire: string | undefined;

  if (!tc.shouldExtract) {
    if (extracted.length > 0) {
      passed = false;
      hallucination = true;
      failureReason = `Expected no extraction, got: ${extracted.map(f => `${f.category}(${f.confidence.toFixed(2)})`).join(", ")}`;
    }
  } else {
    if (extracted.length === 0) {
      passed = false;
      failureReason = "Expected extraction but got none";
    } else {
      if (tc.expectedCategory) {
        const matchCat = extracted.find(f => f.category === tc.expectedCategory);
        if (!matchCat) {
          passed = false;
          misfire = `expected category="${tc.expectedCategory}", got=[${extracted.map(f => f.category).join(",")}]`;
          failureReason = misfire;
        } else {
          if (tc.minTTL !== undefined && matchCat.ttlHours < tc.minTTL) {
            passed = false;
            misfire = `TTL too short: ${matchCat.ttlHours}h (min ${tc.minTTL}h)`;
            failureReason = misfire;
          }
          if (tc.maxTTL !== undefined && matchCat.ttlHours > tc.maxTTL) {
            passed = false;
            misfire = `TTL too long: ${matchCat.ttlHours}h (max ${tc.maxTTL}h)`;
            failureReason = misfire;
          }
        }
      }
      if (tc.forbiddenCategories) {
        for (const cat of tc.forbiddenCategories) {
          if (extracted.some(f => f.category === cat)) {
            passed = false;
            failureReason = `Forbidden category "${cat}" was extracted`;
          }
        }
      }
      // Check TTL bounds even when no expected category specified
      if (!tc.expectedCategory) {
        for (const f of extracted) {
          if (tc.minTTL !== undefined && f.ttlHours < tc.minTTL) {
            passed = false;
            misfire = `TTL too short: ${f.ttlHours}h (min ${tc.minTTL}h) for ${f.category}`;
            failureReason = misfire;
          }
          if (tc.maxTTL !== undefined && f.ttlHours > tc.maxTTL) {
            passed = false;
            misfire = `TTL too long: ${f.ttlHours}h (max ${tc.maxTTL}h) for ${f.category}`;
            failureReason = misfire;
          }
        }
      }
    }
  }

  return { id: tc.id, label: tc.label, group: tc.group, passed, extracted, failureReason, hallucination, misfire, durationMs };
}

async function main() {
  console.log(BLD("\n╔═══════════════════════════════════════════════╗"));
  console.log(BLD("║  REALITY EXTRACTOR PHASE 2 — 100-EXAMPLE AUDIT ║"));
  console.log(BLD("╚═══════════════════════════════════════════════╝\n"));

  // ── Trigger gate audit (synchronous) ──────────────────────────────────────
  console.log(BLD("═══ TRIGGER GATE (shouldRunExtractor) ═══\n"));

  const triggerCases: Array<[string, string, string, string, string, boolean]> = [
    ["emotional_expression", "life_stress",  "emotional_support",  "overwhelmed", "Burnout/grief",     true],
    ["emotional_expression", "other",        "coach_engagement",   "frustrated",  "Emotional + other", true],
    ["general_chat",         "life_stress",  null as any,          "neutral",     "Life stress topic",  true],
    ["general_chat",         "schedule",     null as any,          "neutral",     "Schedule non-log",   true],
    ["making_excuse",        "life_stress",  null as any,          "defeated",    "Excuse + life",      true],
    ["log_activity",         "training",     null as any,          "motivated",   "Workout log",        false],
    ["log_data",             "training",     null as any,          "neutral",     "Data log",           false],
    ["log_missed",           "training",     "address_excuse",     "defeated",    "Missed session",     false],
    ["general_chat",         "training",     null as any,          "neutral",     "Normal chat",        false],
    ["asking_question",      "training",     null as any,          "neutral",     "Training question",  false],
    ["general_chat",         "schedule",     null as any,          "motivated",   "Schedule + motivated", false],
  ];

  let triggerPassed = 0;
  for (const [intent, topic, intervention, emotion, label, expected] of triggerCases) {
    const actual = shouldRunExtractor(intent, topic, intervention, emotion);
    const ok = actual === expected;
    if (ok) triggerPassed++;
    console.log(`  ${ok ? GRN("✓") : RED("✗")}  ${label}: shouldRun=${actual} ${ok ? "" : RED(`(expected ${expected})`)}`);
  }
  console.log(`\n  ${triggerPassed}/${triggerCases.length} trigger gate checks passed\n`);

  // ── LLM extraction audit ───────────────────────────────────────────────────
  console.log(BLD("═══ LLM EXTRACTION AUDIT (100 cases) ═══\n"));
  console.log(DIM("  Running in batches of 10 with concurrency 5...\n"));

  const results: TestResult[] = [];
  const BATCH = 5;

  for (let i = 0; i < CASES.length; i += BATCH) {
    const batch = CASES.slice(i, i + BATCH);
    const batchResults = await Promise.all(batch.map(tc => runCase(tc)));
    results.push(...batchResults);
    process.stdout.write(`  ${GRN(String(Math.min(i + BATCH, CASES.length)).padStart(3))}/${CASES.length} `);
    for (const r of batchResults) {
      process.stdout.write(r.passed ? GRN("●") : (r.hallucination ? RED("○") : RED("✗")));
    }
    process.stdout.write("\n");
  }

  // ── Failures detail ────────────────────────────────────────────────────────
  const failures = results.filter(r => !r.passed);
  if (failures.length > 0) {
    console.log(BLD(RED(`\n═══ FAILURES (${failures.length}) ═══\n`)));
    for (const f of failures) {
      console.log(RED(`  ✗ [${f.id}] ${f.label}`));
      console.log(DIM(`       reason: ${f.failureReason}`));
      if (f.extracted.length > 0) {
        console.log(DIM(`       got:    ${f.extracted.map(e => `${e.category}(ttl=${e.ttlHours}h, conf=${e.confidence.toFixed(2)}): "${e.fact.slice(0,60)}..."`).join("; ")}`));
      }
    }
  }

  // ── Aggregate stats ────────────────────────────────────────────────────────
  const shouldExtractCases = results.filter(r => CASES.find(c => c.id === r.id)!.shouldExtract);
  const shouldNotCases     = results.filter(r => !CASES.find(c => c.id === r.id)!.shouldExtract);

  const truePositives  = shouldExtractCases.filter(r => r.extracted.length > 0 && r.passed).length;
  const falseNegatives = shouldExtractCases.filter(r => r.extracted.length === 0).length;
  const trueNegatives  = shouldNotCases.filter(r => r.extracted.length === 0).length;
  const falsePositives = shouldNotCases.filter(r => r.extracted.length > 0).length;

  const precision = truePositives / (truePositives + falsePositives || 1);
  const recall    = truePositives / (truePositives + falseNegatives || 1);
  const f1        = 2 * precision * recall / (precision + recall || 1);

  // Duplicate fact rate: cases with >1 fact in same category
  const duplicateFacts = results
    .filter(r => r.extracted.length > 1)
    .filter(r => {
      const cats = r.extracted.map(f => f.category);
      return new Set(cats).size < cats.length;
    }).length;

  // TTL accuracy: among correct extractions, how many have sensible TTLs
  const correctExtractions   = results.filter(r => r.passed && r.extracted.length > 0);
  const ttlMisfires          = results.filter(r => r.misfire?.includes("TTL")).length;
  const categoryMisfires     = results.filter(r => r.misfire && !r.misfire.includes("TTL")).length;

  const avgDuration  = results.reduce((a, r) => a + r.durationMs, 0) / results.length;
  const maxDuration  = Math.max(...results.map(r => r.durationMs));

  // Per-group stats
  const groups = [...new Set(CASES.map(c => c.group))];

  console.log(BLD("\n═══ AUDIT SUMMARY ═══\n"));
  console.log(`  Total test cases        : ${CASES.length}`);
  console.log(`  Should extract          : ${shouldExtractCases.length}`);
  console.log(`  Should NOT extract      : ${shouldNotCases.length}`);
  console.log("");
  console.log(BLD("  Classification Metrics:"));
  console.log(`    True positives        : ${GRN(String(truePositives))}`);
  console.log(`    False negatives       : ${falseNegatives > 0 ? RED(String(falseNegatives)) : GRN("0")}`);
  console.log(`    True negatives        : ${GRN(String(trueNegatives))}`);
  console.log(`    False positives (hall): ${falsePositives > 0 ? RED(String(falsePositives)) : GRN("0")}`);
  console.log("");
  console.log(`    Precision             : ${(precision * 100).toFixed(1)}%  (of what was extracted, % correct)`);
  console.log(`    Recall                : ${(recall * 100).toFixed(1)}%  (of real disclosures, % caught)`);
  console.log(`    F1 Score              : ${(f1 * 100).toFixed(1)}%`);
  console.log(`    Hallucination rate    : ${falsePositives > 0 ? RED(`${(falsePositives / shouldNotCases.length * 100).toFixed(1)}%`) : GRN("0.0%")} (${falsePositives}/${shouldNotCases.length} non-disclosure msgs)`);
  console.log("");
  console.log(BLD("  Quality Metrics:"));
  console.log(`    Duplicate fact rate   : ${duplicateFacts > 0 ? YLW(`${duplicateFacts} cases`) : GRN("0")}`);
  console.log(`    Incorrect TTL         : ${ttlMisfires > 0 ? YLW(`${ttlMisfires} cases`) : GRN("0")}`);
  console.log(`    Wrong category        : ${categoryMisfires > 0 ? YLW(`${categoryMisfires} cases`) : GRN("0")}`);
  console.log(`    Overall pass rate     : ${results.filter(r => r.passed).length}/${results.length} (${(results.filter(r => r.passed).length / results.length * 100).toFixed(1)}%)`);
  console.log("");
  console.log(BLD("  Performance:"));
  console.log(`    Avg extraction time   : ${avgDuration.toFixed(0)}ms`);
  console.log(`    Max extraction time   : ${maxDuration}ms`);
  console.log("");
  console.log(BLD("  Per-group breakdown:"));
  for (const g of groups) {
    const groupResults = results.filter(r => r.group === g);
    const groupPassed  = groupResults.filter(r => r.passed).length;
    const pct          = (groupPassed / groupResults.length * 100).toFixed(0);
    const badge        = groupPassed === groupResults.length ? GRN("✓") : groupPassed >= groupResults.length * 0.7 ? YLW("~") : RED("✗");
    console.log(`    ${badge}  ${g.padEnd(16)}: ${groupPassed}/${groupResults.length} (${pct}%)`);
  }

  // Verdict
  console.log("");
  if (falsePositives === 0 && falseNegatives <= 3 && precision >= 0.9) {
    console.log(GRN(BLD("  VERDICT: PRODUCTION READY")));
  } else if (falsePositives <= 2 && precision >= 0.85) {
    console.log(YLW(BLD("  VERDICT: ACCEPTABLE — minor prompt tuning recommended")));
  } else {
    console.log(RED(BLD("  VERDICT: NOT READY — prompt or trigger gate needs refinement")));
  }
}

main().catch(err => {
  console.error(RED("Audit crashed:"), err);
  process.exit(1);
});
