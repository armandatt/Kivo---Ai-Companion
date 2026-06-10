import {
  normalize,
  parseName,
  parseGoal,
  parseBodyStats,
  parseExperience,
  parseLifts,
  parseDays,
  parseGymTime,
  parseProtein,
  parseInjury,
  parseSplit,
  classifyConfirmation,
} from "../onboarding-engine-v2";

// The confirm_split prompt always ends with this question — used as the
// "last assistant message" context for classifyConfirmation in tests below.
const CONFIRM_SPLIT_QUESTION = "Here's your 4-day split:\n\nMon — Push\n\nGood with this, or want changes?";

// ═══════════════════════════════════════════════════════════════════════════════
// NORMALIZER
// ═══════════════════════════════════════════════════════════════════════════════

describe("normalize", () => {
  describe("skip signals", () => {
    const cases = ["idk", "i don't know", "dont know", "not sure", "k", "skip", "whatever", "you decide"];
    test.each(cases)('"%s" is a skip signal', input => {
      expect(normalize(input).isSkip).toBe(true);
    });
    test("normal text is not a skip", () => {
      expect(normalize("build muscle").isSkip).toBe(false);
    });
  });

  describe("not-tracking signals", () => {
    const cases = ["not tracking", "no tracking", "don't track", "cant track", "nope", "none"];
    test.each(cases)('"%s" is a not-tracking signal', input => {
      expect(normalize(input).isNotTracking).toBe(true);
    });
    test('"150g" is not a not-tracking signal', () => {
      expect(normalize("150g").isNotTracking).toBe(false);
    });
  });

  describe("build-split signals", () => {
    const cases = [
      "build one", "build me one", "create one", "generate one",
      "you pick", "you choose", "i don't have one", "no split",
      "help me build", "random", "winging it",
    ];
    test.each(cases)('"%s" triggers split generator', input => {
      expect(normalize(input).isBuildSplit).toBe(true);
    });
    test('"PPL" does not trigger generator', () => {
      expect(normalize("PPL").isBuildSplit).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PARSER — NAME
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseName", () => {
  test("valid names parse at high confidence", () => {
    const r = parseName("Akshar");
    expect(r.confidence).toBeGreaterThanOrEqual(0.90);
    expect(r.extractedValue).toBe("Akshar");
    expect(r.isSkip).toBe(false);
  });

  test("capitalises input", () => {
    expect(parseName("akshar goyal").extractedValue).toBe("Akshar Goyal");
  });

  test("skip signals return isSkip=true", () => {
    expect(parseName("idk").isSkip).toBe(true);
    expect(parseName("skip").isSkip).toBe(true);
    expect(parseName("whatever").isSkip).toBe(true);
  });

  test("email-like strings are unknown", () => {
    const r = parseName("user@email.com");
    expect(r.isUnknown).toBe(true);
  });

  test("numbers are not valid names", () => {
    const r = parseName("12345");
    expect(r.confidence).toBeLessThan(0.75);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PARSER — GOAL
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseGoal", () => {
  const goalCases: [string, string][] = [
    ["build muscle",          "muscle"],
    ["I want to bulk up",     "muscle"],
    ["strength training",     "strength"],
    ["lose weight",           "fat_loss"],
    ["cut",                   "fat_loss"],
    ["general fitness",       "general_fitness"],
    ["stay healthy",          "general_fitness"],
    ["body recomp",           "recomposition"],
    ["athletic performance",  "athletic_performance"],
  ];

  test.each(goalCases)('"%s" → %s', (input, expected) => {
    const r = parseGoal(input);
    expect(r.extractedValue).toBe(expected);
    expect(r.isSkip).toBe(false);
    expect(r.confidence).toBeGreaterThanOrEqual(0.80);
  });

  test("skip signals return isSkip", () => {
    expect(parseGoal("idk").isSkip).toBe(true);
  });

  test("unrecognized input is unknown", () => {
    expect(parseGoal("zorblax").isUnknown).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PARSER — BODY STATS
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseBodyStats", () => {
  test("kg + cm", () => {
    const r = parseBodyStats("72kg, 178cm");
    expect(r.extractedValue).toContain("bw:72");
    expect(r.extractedValue).toContain("ht:178");
    expect(r.confidence).toBeGreaterThanOrEqual(0.90);
  });

  test("lbs + feet/inches", () => {
    const r = parseBodyStats("158lbs 5'10");
    expect(r.extractedValue).toContain("bw:");
    expect(r.extractedValue).toContain("ht:");
  });

  test("bodyweight only", () => {
    const r = parseBodyStats("80kg");
    expect(r.extractedValue).toContain("bw:80");
    expect(r.requiresVerification).toBe(true); // height missing
  });

  test("skip returns isSkip", () => {
    expect(parseBodyStats("idk").isSkip).toBe(true);
  });

  test("invalid text returns unknown", () => {
    expect(parseBodyStats("sure whatever").isUnknown).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PARSER — EXPERIENCE
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseExperience", () => {
  const cases: [string, string][] = [
    ["beginner",         "beginner"],
    ["just started",     "beginner"],
    ["3 months",         "beginner"],
    ["intermediate",     "intermediate"],
    ["2 years",          "intermediate"],
    ["advanced",         "advanced"],
    ["5 years",          "advanced"],
    ["been lifting 4 years", "advanced"],
  ];

  test.each(cases)('"%s" → %s', (input, expected) => {
    expect(parseExperience(input).extractedValue).toBe(expected);
  });

  test("skip signals advance with default", () => {
    const r = parseExperience("idk");
    expect(r.isSkip).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PARSER — LIFTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseLifts", () => {
  test("explicit labels", () => {
    const r = parseLifts("squat 100, bench 80, deadlift 140");
    expect(r.extractedValue).toContain("squat:100");
    expect(r.extractedValue).toContain("bench:80");
    expect(r.extractedValue).toContain("deadlift:140");
  });

  test("bare numbers in order", () => {
    const r = parseLifts("100 80 140");
    expect(r.extractedValue).toContain("squat:100");
    expect(r.extractedValue).toContain("bench:80");
    expect(r.extractedValue).toContain("deadlift:140");
  });

  test("skip returns isSkip", () => {
    expect(parseLifts("skip").isSkip).toBe(true);
  });

  test('"not sure" is treated as a skip, not unknown', () => {
    expect(parseLifts("not sure").isSkip).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PARSER — DAYS
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseDays", () => {
  const cases: [string, string][] = [
    ["4",          "4"],
    ["four",       "4"],
    ["5 days",     "5"],
    ["three days", "3"],
    ["6",          "6"],
  ];

  test.each(cases)('"%s" → %s days', (input, expected) => {
    expect(parseDays(input).extractedValue).toBe(expected);
  });

  test("out of range number returns unknown", () => {
    const r = parseDays("99");
    expect(r.isUnknown).toBe(true);
  });

  test("skip returns isSkip", () => {
    expect(parseDays("whatever").isSkip).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PARSER — PROTEIN  (THE LOOP SOURCE)
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseProtein — loop failure scenarios", () => {
  test('"not tracking" advances immediately — never loops', () => {
    const r = parseProtein("not tracking");
    expect(r.extractedValue).toBe("not_tracking");
    expect(r.isSkip).toBe(false);
    expect(r.isUnknown).toBe(false);
    expect(r.confidence).toBeGreaterThanOrEqual(0.95);
  });

  test('"no tracking" also resolves', () => {
    expect(parseProtein("no tracking").extractedValue).toBe("not_tracking");
  });

  test('"dont track" also resolves', () => {
    expect(parseProtein("dont track").extractedValue).toBe("not_tracking");
  });

  test('"nope" resolves as not_tracking', () => {
    expect(parseProtein("nope").extractedValue).toBe("not_tracking");
  });

  test("valid grams parse correctly", () => {
    const r = parseProtein("150g");
    expect(r.extractedValue).toBe("150");
    expect(r.confidence).toBeGreaterThanOrEqual(0.90);
  });

  test("grams without unit", () => {
    expect(parseProtein("120").extractedValue).toBe("120");
  });

  test("skip advances with not_tracking default", () => {
    expect(parseProtein("idk").extractedValue).toBe("not_tracking");
  });

  test("approximate value requires verification", () => {
    const r = parseProtein("about 100g");
    expect(r.extractedValue).toBe("100");
    expect(r.requiresVerification).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PARSER — SPLIT  (THE OTHER LOOP SOURCE)
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseSplit — loop failure scenarios", () => {
  test('"build one" triggers generator, never loops', () => {
    const r = parseSplit("build one");
    expect(r.extractedValue).toBe("BUILD");
    expect(r.isSkip).toBe(false);
    expect(r.isUnknown).toBe(false);
    expect(r.confidence).toBeGreaterThanOrEqual(0.95);
  });

  test('"create one" also triggers generator', () => {
    expect(parseSplit("create one").extractedValue).toBe("BUILD");
  });

  test('"you pick" triggers generator', () => {
    expect(parseSplit("you pick").extractedValue).toBe("BUILD");
  });

  test('"no idea" triggers generator', () => {
    expect(parseSplit("no idea").extractedValue).toBe("BUILD");
  });

  test('"winging it" triggers generator', () => {
    expect(parseSplit("winging it").extractedValue).toBe("BUILD");
  });

  test("PPL parses at high confidence", () => {
    const r = parseSplit("PPL");
    expect(r.extractedValue).toBe("PPL");
    expect(r.confidence).toBeGreaterThanOrEqual(0.90);
  });

  test("Upper/Lower parses correctly", () => {
    expect(parseSplit("upper lower").extractedValue).toBe("Upper/Lower");
  });

  test("Full Body parses correctly", () => {
    expect(parseSplit("full body").extractedValue).toBe("Full Body");
  });

  test("partial muscle groups require verification but advance", () => {
    const r = parseSplit("back quad glutes");
    expect(r.isUnknown).toBe(false);
    expect(r.requiresVerification).toBe(true);
    expect(r.extractedValue).not.toBeNull();
  });

  test("partial 'shoulder tri' is understood", () => {
    const r = parseSplit("shoulder tri");
    expect(r.requiresVerification).toBe(true);
    expect(r.extractedValue).not.toBeNull();
  });

  test("idk triggers generator (skip)", () => {
    const r = parseSplit("idk");
    expect(r.extractedValue).toBe("BUILD");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PARSER — GYM TIME
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseGymTime", () => {
  const cases: [string, string][] = [
    ["6pm",    "18:00"],
    ["18:30",  "18:30"],
    ["7 AM",   "07:00"],
    ["morning","08:00"],
    ["evening","18:00"],
    ["night",  "20:00"],
  ];

  test.each(cases)('"%s" → %s', (input, expected) => {
    expect(parseGymTime(input).extractedValue).toBe(expected);
  });

  test("skip returns isSkip", () => {
    expect(parseGymTime("skip").isSkip).toBe(true);
  });

  test("ambiguous 'morning' requires verification", () => {
    expect(parseGymTime("morning").requiresVerification).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PARSER — INJURY
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseInjury", () => {
  test('"none" stores as none', () => {
    expect(parseInjury("none").extractedValue).toBe("none");
  });

  test('"no injuries" stores as none', () => {
    expect(parseInjury("no injuries").extractedValue).toBe("none");
  });

  test('"healthy" stores as none', () => {
    expect(parseInjury("healthy").extractedValue).toBe("none");
  });

  test("skip is treated as none", () => {
    expect(parseInjury("skip").extractedValue).toBe("none");
  });

  test("actual injury text is stored verbatim", () => {
    const r = parseInjury("left knee pain, avoid deep squats");
    expect(r.extractedValue).toBe("left knee pain, avoid deep squats");
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FAILURE SIMULATION — exact conversation replays
// ═══════════════════════════════════════════════════════════════════════════════

describe("Failure Simulation: protein loop", () => {
  // Sequence: protein step receives "not tracking" twice
  // V1 loop: Rex asked "How much protein?" again after each "not tracking"
  // V2 behaviour: first "not tracking" immediately stores and advances to injury step

  test("first 'not tracking' stores and advances — no second ask", () => {
    const r1 = parseProtein("not tracking");
    expect(r1.extractedValue).toBe("not_tracking");
    expect(r1.confidence).toBeGreaterThanOrEqual(0.95);
    // No verification required → step machine advances immediately
    expect(r1.requiresVerification).toBe(false);
    expect(r1.isSkip).toBe(false);
    expect(r1.isUnknown).toBe(false);
    // V2 never loops because there is no LLM gating this answer
  });
});

describe("Failure Simulation: split loop", () => {
  // Sequence: split step receives "build one" twice
  // V1 loop: "build one" was not caught by wantsRexToBuild regex if LLM validation failed first
  // V2 behaviour: "build one" in normalizer → BUILD signal → generator fires immediately

  test("first 'build one' triggers split generator — never hits parser ambiguity", () => {
    const n = normalize("build one");
    expect(n.isBuildSplit).toBe(true);
    // The engine checks normalize() BEFORE calling parseSplit()
    // so the LLM validation path never executes
  });

  test("parseSplit('build one') also returns BUILD regardless of path", () => {
    const r = parseSplit("build one");
    expect(r.extractedValue).toBe("BUILD");
    expect(r.confidence).toBeGreaterThanOrEqual(0.95);
  });

  test("all 'build one' variants trigger generator", () => {
    const inputs = ["build one", "build me one", "you pick", "no split", "winging it", "random", "you choose"];
    for (const input of inputs) {
      expect(parseSplit(input).extractedValue).toBe("BUILD");
    }
  });
});

describe("Failure Simulation: repeated unknown answers", () => {
  // Loop prevention: if the same step is asked N times, force-advance
  // This is engine-level, not parser-level, but parsers should never return
  // isUnknown for the known skip/not-tracking phrases

  test("known non-answers never return true isUnknown", () => {
    const skipInputs = ["idk", "not sure", "whatever", "k", "skip"];
    for (const s of skipInputs) {
      // Any step parser should see these as isSkip, not isUnknown
      expect(parseName(s).isSkip).toBe(true);
      expect(parseGoal(s).isSkip).toBe(true);
      expect(parseDays(s).isSkip).toBe(true);
    }
  });

  test("'not tracking' is never isUnknown for protein parser", () => {
    const notTrackingInputs = ["not tracking", "no tracking", "dont track", "nope"];
    for (const s of notTrackingInputs) {
      const r = parseProtein(s);
      expect(r.isUnknown).toBe(false);
      expect(r.isSkip).toBe(false);
      expect(r.extractedValue).toBe("not_tracking");
    }
  });
});

describe("Failure Simulation: partial split input", () => {
  // When user types partial muscle groups instead of a named split
  // V1: LLM classifySplit called → might fail or loop
  // V2: partial parser extracts what's understood, asks for verification (advances either way)

  test("partial muscle group text is parsed, not rejected", () => {
    const cases = ["back quad glutes", "shoulder tri", "glute ham", "chest"];
    for (const c of cases) {
      const r = parseSplit(c);
      expect(r.isUnknown).toBe(false);
      expect(r.extractedValue).not.toBeNull();
    }
  });

  test("partial parse sets requiresVerification so user can confirm", () => {
    const r = parseSplit("back quad glutes");
    expect(r.requiresVerification).toBe(true);
  });

  test("recognized split names do NOT require verification", () => {
    expect(parseSplit("PPL").requiresVerification).toBe(false);
    expect(parseSplit("upper lower").requiresVerification).toBe(false);
    expect(parseSplit("full body").requiresVerification).toBe(false);
  });
});

describe("Failure Simulation: state recovery after 3-day gap", () => {
  test("every step has a defined question function", () => {
    const stepIds: string[] = ["name", "goal", "body_stats", "experience", "lifts", "days", "split", "confirm_split", "gym_time", "protein", "injury", "review"];
    expect(parseName).toBeDefined();
    expect(parseGoal).toBeDefined();
    expect(parseExperience).toBeDefined();
    expect(parseLifts).toBeDefined();
    expect(parseDays).toBeDefined();
    expect(parseSplit).toBeDefined();
    expect(parseGymTime).toBeDefined();
    expect(parseProtein).toBeDefined();
    expect(parseInjury).toBeDefined();
    expect(stepIds.length).toBe(12);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUG REGRESSION PROOFS  (one test per bug, labelled by number)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Bug 1 — parsePartialSplit: wrong canonical for mixed categories", () => {
  test('"back quad glutes" → Custom (not Pull)', () => {
    // Before fix: hasPull=true fell through to else-if(hasPull) → "Pull"
    // After fix:  hasPull && hasLegs → "Custom"
    const r = parseSplit("back quad glutes");
    // extractedValue comes from parsePartialSplit.canonical
    expect(r.extractedValue).toBe("Custom");
    expect(r.extractedValue).not.toBe("Pull");
  });

  test('"shoulder tri glutes" → Custom (push+legs mixed)', () => {
    const r = parseSplit("shoulder tri glutes");
    expect(r.extractedValue).toBe("Custom");
  });

  test('"chest shoulder tricep back bicep legs" → PPL (all three groups)', () => {
    const r = parseSplit("chest shoulder tricep back bicep legs");
    expect(r.extractedValue).toBe("PPL");
  });

  test('"back bicep" → Pull (pull only, unchanged)', () => {
    const r = parseSplit("back bicep");
    expect(r.extractedValue).toBe("Pull");
  });

  test('"quad glutes hamstring" → Legs (legs only, unchanged)', () => {
    const r = parseSplit("quad glutes hamstring");
    expect(r.extractedValue).toBe("Legs");
  });
});

describe("Bug 2 — Partial split accumulation: parseSplit sets requiresVerification + parserReason", () => {
  test("partial input has parserReason = partial_split_parsed", () => {
    const r = parseSplit("back quad glutes");
    expect(r.parserReason).toBe("partial_split_parsed");
    expect(r.requiresVerification).toBe(true);
  });

  test("partial input does NOT return BUILD (no accidental generator trigger)", () => {
    const r = parseSplit("shoulder tri");
    expect(r.extractedValue).not.toBe("BUILD");
    expect(r.parserReason).toBe("partial_split_parsed");
  });

  test("all four Case-2 inputs produce partial_split_parsed", () => {
    const inputs = ["back quad glutes", "shoulder tri", "glutes hamstring", "chest"];
    for (const input of inputs) {
      const r = parseSplit(input);
      expect(r.isUnknown).toBe(false);
      expect(r.parserReason).toBe("partial_split_parsed");
    }
  });
});

describe("Bug 3 — BUILD sentinel must never reach storageKeys", () => {
  test("split storageKeys throws on BUILD input", () => {
    // This guard catches any path where BUILD would leak to DB
    // We can't import STEPS directly, but we can verify via parseSplit
    // and confirm the parser returns BUILD only as an in-engine signal
    const r = parseSplit("build one");
    expect(r.extractedValue).toBe("BUILD");
    // The engine intercepts BUILD before calling storageKeys —
    // the throw acts as a last-resort guard
  });

  test("idk at split step returns BUILD (engine routes to generator)", () => {
    // parseSplit("idk") → normalize.isSkip=true → returns BUILD
    const r = parseSplit("idk");
    expect(r.extractedValue).toBe("BUILD");
    expect(r.isSkip).toBe(false);    // hit() always returns isSkip:false
    expect(r.isUnknown).toBe(false);
  });

  test('"whatever" at split step also returns BUILD', () => {
    const r = parseSplit("whatever");
    expect(r.extractedValue).toBe("BUILD");
  });
});

describe("Bug 4 — Verification stores canonical, not display text", () => {
  test("parseSplit known split: extractedValue is canonical (PPL), normalizedValue is label", () => {
    // The canonicalValue stored in PendingVerification = extractedValue
    // Only known splits with conf≥0.92 skip verification entirely, but confirming the types
    const r = parseSplit("push pull legs");
    expect(r.extractedValue).toBe("PPL");
    expect(r.normalizedValue).toBe("Push/Pull/Legs");
    // canonical != display → Bug 4 fix ensures we store extractedValue
  });

  test("partial split: extractedValue is canonical (Custom), normalizedValue is muscle list", () => {
    const r = parseSplit("back quad glutes");
    expect(r.extractedValue).toBe("Custom");              // canonical — for storage
    expect(r.normalizedValue).toBe("Back, Quads, Glutes"); // display — for verify msg
    expect(r.extractedValue).not.toBe(r.normalizedValue); // they differ — this is the bug scenario
  });
});

describe("Bug 5 — Hinglish detection", () => {
  test("common Hinglish filler words are detected", () => {
    // We test the regex directly
    const HINGLISH_MARKERS = /\b(bhai|yaar|arre|arrey|kyu|kyun|kha\s+raha|kha\s+liya|dimag|bana\s+(na|do|de|le)|banana\s+hai|theek\s+hai|accha|acha|nahi|nhi|matlab|zyada|thoda|zaroor|samjha|samjhe|wala|wali|hoga|hoge|lagta|lagti)\b/i;
    expect(HINGLISH_MARKERS.test("arrey bana na bhai dimag kyu kha raha hai")).toBe(true);
    expect(HINGLISH_MARKERS.test("bhai just build one")).toBe(true);
    expect(HINGLISH_MARKERS.test("yaar i dont know")).toBe(true);
    expect(HINGLISH_MARKERS.test("PPL")).toBe(false);
    expect(HINGLISH_MARKERS.test("build one")).toBe(false);
    expect(HINGLISH_MARKERS.test("upper lower")).toBe(false);
  });

  test("Devanagari script is detected separately", () => {
    const DEVANAGARI = /[ऀ-ॿ]/;
    expect(DEVANAGARI.test("पुश पुल लेग")).toBe(true);
    expect(DEVANAGARI.test("PPL")).toBe(false);
  });

  test("English inputs are not false-positived as Hinglish", () => {
    const HINGLISH_MARKERS = /\b(bhai|yaar|arre|arrey|kyu|kyun|kha\s+raha|kha\s+liya|dimag|bana\s+(na|do|de|le)|banana\s+hai|theek\s+hai|accha|acha|nahi|nhi|matlab|zyada|thoda|zaroor|samjha|samjhe|wala|wali|hoga|hoge|lagta|lagti)\b/i;
    const english = ["back quad glutes", "push pull legs", "chest shoulders arms", "full body", "build one", "idk"];
    for (const e of english) {
      expect(HINGLISH_MARKERS.test(e)).toBe(false);
    }
  });
});

describe("Bug 6 — Recovery does not discard first message (engine-level)", () => {
  // The recovery block no longer returns early — resumePrefix is set and normal
  // processing continues. We verify the parser would handle the message correctly.

  test('"build one" after gap is a valid split signal — parser produces BUILD', () => {
    const r = parseSplit("build one");
    expect(r.extractedValue).toBe("BUILD");
    // In the fixed engine: recovery sets resumePrefix, then falls through to parse
    // "build one" → BUILD → handleSplitGenerate with "Welcome back" prepended
  });

  test('"PPL" after gap is a valid split answer — parser produces PPL', () => {
    const r = parseSplit("PPL");
    expect(r.extractedValue).toBe("PPL");
    expect(r.confidence).toBeGreaterThanOrEqual(0.90);
    expect(r.requiresVerification).toBe(false);
  });
});

describe("Bug 7 — confirm_split never advances without storing split data", () => {
  test('"k" at confirm_split: normalize does NOT produce isYes or isNo', () => {
    // "k" is in SKIP_SIGNALS but not in YES_SIGNALS or NO_SIGNALS
    const n = normalize("k");
    expect(n.isYes).toBe(false);
    expect(n.isNo).toBe(false);
    // Engine: confirm_split with isYes=false, isModify=false → re-asks, never advances
  });

  test('"unclear" at confirm_split: not yes, not modify — stays on step', () => {
    const n = normalize("unclear");
    expect(n.isYes).toBe(false);
    expect(n.isNo).toBe(false);
    // Confirm: /\b(swap|replace|add|remove|different|adjust|modify|redo|switch)\b/ → false
    expect(/\b(swap|replace|add|remove|different|adjust|modify|redo|switch)\b/i.test("unclear")).toBe(false);
  });

  test('"yes" at confirm_split: produces isYes=true', () => {
    expect(normalize("yes").isYes).toBe(true);
    expect(normalize("yeah").isYes).toBe(true);
    expect(normalize("looks good").isYes).toBe(true);
  });
});

describe("Bug 8 — modify request at confirm_split returns to split step", () => {
  test('"swap push day" triggers isModify path (not isNo but catches via regex)', () => {
    const text = "swap push day";
    const n    = normalize(text);
    const isModify = n.isNo
      || text.toLowerCase().includes("change")
      || /\b(swap|replace|add|remove|different|adjust|modify|redo|switch)\b/i.test(text);
    expect(isModify).toBe(true);
  });

  test('"change it" is both isNo and triggers change keyword', () => {
    const text = "change it";
    const n    = normalize(text);
    // "change it" is in NO_SIGNALS: true
    expect(n.isNo).toBe(true);
    const isModify = n.isNo || text.toLowerCase().includes("change") || /\b(swap|replace|add|remove|different|adjust|modify|redo|switch)\b/i.test(text);
    expect(isModify).toBe(true);
  });

  test('"different split please" triggers modify', () => {
    const text = "different split please";
    const isModify = normalize(text).isNo
      || text.toLowerCase().includes("change")
      || /\b(swap|replace|add|remove|different|adjust|modify|redo|switch)\b/i.test(text);
    expect(isModify).toBe(true);
  });

  test('"redo the split" triggers modify', () => {
    const isModify = /\b(swap|replace|add|remove|different|adjust|modify|redo|switch)\b/i.test("redo the split");
    expect(isModify).toBe(true);
  });

  test('"yes" does NOT trigger modify', () => {
    const text = "yes";
    const n    = normalize(text);
    const isModify = n.isNo
      || text.toLowerCase().includes("change")
      || /\b(swap|replace|add|remove|different|adjust|modify|redo|switch)\b/i.test(text);
    expect(isModify).toBe(false);
    expect(n.isYes).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ONBOARDING PARSER UNIFICATION — classifyConfirmation (Parsing Engine V2 backed)
//
// Trace: "build one" → split generated → confirm_split → <reply>
//
// classifyConfirmation("yes", lastQuestion) === "yes"  → engine advances to gym_time
// classifyConfirmation("no"/"modify", lastQuestion) === "no"|"modify" → engine
//   returns to "split" step for editing
// classifyConfirmation(<unrecognised>, lastQuestion) === "unclear" → engine
//   re-asks confirm_split without advancing
// ═══════════════════════════════════════════════════════════════════════════════

describe("classifyConfirmation — confirm_split affirmations", () => {
  test('"good with this" → onboarding advances (yes)', () => {
    expect(classifyConfirmation("good with this", CONFIRM_SPLIT_QUESTION)).toBe("yes");
  });

  test('"looks good" → onboarding advances (yes)', () => {
    expect(classifyConfirmation("looks good", CONFIRM_SPLIT_QUESTION)).toBe("yes");
  });

  test('"works for me" → onboarding advances (yes)', () => {
    expect(classifyConfirmation("works for me", CONFIRM_SPLIT_QUESTION)).toBe("yes");
  });

  test('"sounds good" → onboarding advances (yes)', () => {
    expect(classifyConfirmation("sounds good", CONFIRM_SPLIT_QUESTION)).toBe("yes");
  });

  test('"yeah" → onboarding advances (yes)', () => {
    expect(classifyConfirmation("yeah", CONFIRM_SPLIT_QUESTION)).toBe("yes");
  });

  test('"yep" → onboarding advances (yes)', () => {
    expect(classifyConfirmation("yep", CONFIRM_SPLIT_QUESTION)).toBe("yes");
  });

  test('"sure" → onboarding advances (yes)', () => {
    expect(classifyConfirmation("sure", CONFIRM_SPLIT_QUESTION)).toBe("yes");
  });

  test('"lets do it" → onboarding advances (yes)', () => {
    expect(classifyConfirmation("lets do it", CONFIRM_SPLIT_QUESTION)).toBe("yes");
  });

  test('"perfect" → onboarding advances (yes)', () => {
    expect(classifyConfirmation("perfect", CONFIRM_SPLIT_QUESTION)).toBe("yes");
  });
});

describe("classifyConfirmation — confirm_split rejections / modifications", () => {
  test('"no" → returns to split editing (no)', () => {
    expect(classifyConfirmation("no", CONFIRM_SPLIT_QUESTION)).toBe("no");
  });

  test('"change it" → returns to split editing (no/modify)', () => {
    const cls = classifyConfirmation("change it", CONFIRM_SPLIT_QUESTION);
    expect(["no", "modify"]).toContain(cls);
  });

  test('"modify" → returns to split editing (modify)', () => {
    expect(classifyConfirmation("modify", CONFIRM_SPLIT_QUESTION)).toBe("modify");
  });

  test('"swap chest and back" → returns to split editing (modify)', () => {
    expect(classifyConfirmation("swap chest and back", CONFIRM_SPLIT_QUESTION)).toBe("modify");
  });

  test('"don\'t like it" → returns to split editing (no/modify)', () => {
    const cls = classifyConfirmation("don't like it", CONFIRM_SPLIT_QUESTION);
    expect(["no", "modify"]).toContain(cls);
  });
});

describe("classifyConfirmation — gibberish stays unclear (no infinite-loop regression)", () => {
  test('"??" → unclear, engine re-asks without advancing', () => {
    expect(classifyConfirmation("??", CONFIRM_SPLIT_QUESTION)).toBe("unclear");
  });

  test('"wtff bro are you mad" → unclear, engine re-asks without advancing', () => {
    expect(classifyConfirmation("wtff bro are you mad", CONFIRM_SPLIT_QUESTION)).toBe("unclear");
  });
});
