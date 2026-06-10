/**
 * Memory Retrieval V2 — Quality Audit
 * 25 realistic scenarios against a fixed memory store.
 * Produces structured output; all assertions are descriptive (never fail the build).
 */
import { scoreAndRankFacts } from "../memory-retrieval-v2";
import type { RawMemoryInput } from "../memory-retrieval-v2";

const NOW = new Date("2026-06-09T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

// ─── Realistic memory store ───────────────────────────────────────────────────

const STORE: RawMemoryInput[] = [
  // Struggles
  { id:"s1", type:"struggle",     key:"avoidance",    value:"keeps skipping leg day especially on Thursdays and after a long work week",           confidence:0.92, createdAt:ago(45),  updatedAt:ago(45)  },
  { id:"s2", type:"struggle",     key:"consistency",  value:"loses momentum completely when work gets busy disappears for 2 to 3 week stretches",  confidence:0.90, createdAt:ago(90),  updatedAt:ago(90)  },
  { id:"s3", type:"struggle",     key:"burnout",      value:"history of pushing too hard then crashing happened in January and March",             confidence:0.85, createdAt:ago(60),  updatedAt:ago(60)  },
  { id:"s4", type:"struggle",     key:"sleep",        value:"sleep is inconsistent averages 5 to 6 hours work stress is the cause",               confidence:0.80, createdAt:ago(30),  updatedAt:ago(30)  },
  { id:"s5", type:"struggle",     key:"nutrition",    value:"protein intake drops when travelling does not plan meals in advance",                 confidence:0.75, createdAt:ago(14),  updatedAt:ago(14)  },
  // Achievements
  { id:"a1", type:"achievement",  key:"bench_pr",     value:"hit 100kg bench press first time ever took 14 months of consistent training",        confidence:0.98, createdAt:ago(7),   updatedAt:ago(7)   },
  { id:"a2", type:"achievement",  key:"streak",       value:"trained 28 days straight in February longest streak ever recorded",                  confidence:0.95, createdAt:ago(120), updatedAt:ago(120) },
  { id:"a3", type:"achievement",  key:"weight_cut",   value:"dropped 8kg over 12 weeks while maintaining all lifts clean cut",                   confidence:0.93, createdAt:ago(200), updatedAt:ago(200) },
  { id:"a4", type:"achievement",  key:"consistency",  value:"completed every scheduled session in May first full month with zero skips",          confidence:0.97, createdAt:ago(10),  updatedAt:ago(10)  },
  { id:"a5", type:"achievement",  key:"nutrition",    value:"hit 160g protein every day for 3 weeks straight never done that before",             confidence:0.88, createdAt:ago(35),  updatedAt:ago(35)  },
  // Commitments
  { id:"c1", type:"commitment",   key:"weekly",       value:"committed to 4 training sessions per week no matter what",                           confidence:0.90, createdAt:ago(20),  updatedAt:ago(5)   },
  { id:"c2", type:"commitment",   key:"morning",      value:"going to train at 6am before work starting Monday no more evening cancellations",    confidence:0.85, createdAt:ago(3),   updatedAt:ago(3)   },
  { id:"c3", type:"commitment",   key:"sleep",        value:"committed to being in bed by 1030pm said it after burning out in March",             confidence:0.80, createdAt:ago(70),  updatedAt:ago(70)  },
  // Promises
  { id:"p1", type:"promise",      key:"leg_day",      value:"promised no more skipping leg day said I swear this time explicitly",                confidence:0.95, createdAt:ago(15),  updatedAt:ago(15)  },
  { id:"p2", type:"promise",      key:"diet",         value:"promised to prep meals every Sunday accountability matters more than motivation",    confidence:0.88, createdAt:ago(8),   updatedAt:ago(8)   },
  { id:"p3", type:"promise",      key:"no_excuses",   value:"promised to stop making work excuses acknowledged the pattern explicitly",           confidence:0.92, createdAt:ago(40),  updatedAt:ago(40)  },
  // Goals
  { id:"g1", type:"goal",         key:"primary",      value:"build 5kg of lean muscle by end of year",                                           confidence:0.95, createdAt:ago(100), updatedAt:ago(10)  },
  { id:"g2", type:"goal",         key:"strength",     value:"hit 140kg deadlift currently at 120kg",                                             confidence:0.90, createdAt:ago(80),  updatedAt:ago(5)   },
  { id:"g3", type:"goal",         key:"habit",        value:"make training non-negotiable show up even on bad days",                              confidence:0.85, createdAt:ago(50),  updatedAt:ago(50)  },
  // Breakthroughs
  { id:"b1", type:"breakthrough", key:"mindset",      value:"realized the problem is not motivation it is that the identity has not been built",  confidence:0.93, createdAt:ago(55),  updatedAt:ago(55)  },
  { id:"b2", type:"breakthrough", key:"schedule",     value:"figured out that evening training never happens mornings are the only reliable window", confidence:0.90, createdAt:ago(4), updatedAt:ago(4)  },
  { id:"b3", type:"breakthrough", key:"quit_pattern", value:"acknowledged that quitting always happens 3 to 4 weeks in never makes it to week 5", confidence:0.88, createdAt:ago(25), updatedAt:ago(25) },
  // Preferences
  { id:"pr1", type:"preference",  key:"split",        value:"runs PPL split 6 days push pull legs",                                               confidence:0.95, createdAt:ago(60),  updatedAt:ago(7)   },
  { id:"pr2", type:"preference",  key:"time",         value:"gym session time 06:00",                                                             confidence:1.00, createdAt:ago(20),  updatedAt:ago(3)   },
  { id:"pr3", type:"preference",  key:"protein",      value:"protein target 160g per day bodyweight 82kg",                                        confidence:1.00, createdAt:ago(20),  updatedAt:ago(3)   },
  { id:"pr4", type:"preference",  key:"injury",       value:"left knee avoid deep squats and lunges",                                             confidence:1.00, createdAt:ago(90),  updatedAt:ago(90)  },
];

// ─── Result collector ────────────────────────────────────────────────────────

interface AuditRow {
  n:       number;
  query:   string;
  intent:  string;
  emotion: string;
  top5:    ReturnType<typeof scoreAndRankFacts>;
}

const RESULTS: AuditRow[] = [];

function audit(
  n:       number,
  query:   string,
  intent:  string,
  emotion: string,
  goals?:  string[],
): AuditRow {
  const top5 = scoreAndRankFacts(STORE, {
    message:     query,
    intent,
    emotion,
    activeGoals: goals ?? ["build muscle", "hit 140kg deadlift"],
    topK:        5,
  }, NOW);
  const row = { n, query, intent, emotion, top5 };
  RESULTS.push(row);
  return row;
}

// ─── 25 scenarios ────────────────────────────────────────────────────────────

describe("Memory Retrieval V2 — Quality Audit (25 scenarios)", () => {

  // ── Group A: Struggle / failure signals ──────────────────────────────────

  describe("A. Struggle and failure signals", () => {
    let r: AuditRow;

    test("Q1 — I want to quit", () => {
      r = audit(1, "I want to quit. I am done.", "emotional_vent", "discouraged");
      // Expect: struggle (burnout/consistency), breakthrough (quit pattern), commitment
      expect(r.top5[0]!.type).not.toBe("preference");
      // At least one struggle must appear in top 3
      expect(r.top5.slice(0,3).some(m => m.type === "struggle")).toBe(true);
    });

    test("Q2 — Burned out", () => {
      r = audit(2, "I am completely burned out. I cannot do this anymore.", "emotional_vent", "tired");
      // burnout struggle + burnout commitment should surface
      expect(r.top5.slice(0,3).some(m => m.type === "struggle")).toBe(true);
      const ids = r.top5.map(m => m.id);
      expect(ids).toContain("s3");   // burnout struggle
    });

    test("Q5 — Skipped again (leg day)", () => {
      r = audit(5, "I skipped again. Leg day. Third time this month.", "failure_report", "frustrated");
      // p1 (leg day promise), s1 (leg day avoidance) must be top 2
      const ids = r.top5.map(m => m.id);
      expect(ids).toContain("s1");
      expect(ids).toContain("p1");
    });

    test("Q4 — Work getting in the way", () => {
      r = audit(4, "Work is getting in the way again. I keep missing sessions.", "failure_report", "frustrated");
      const ids = r.top5.map(m => m.id);
      // s2 (work/consistency), p3 (work excuses promise) should surface
      expect(ids).toContain("s2");
      expect(ids).toContain("p3");
    });

    test("Q13 — Week 3 crash (always happens)", () => {
      r = audit(13, "Three weeks in and already losing steam. This always happens.", "failure_report", "frustrated");
      const ids = r.top5.map(m => m.id);
      // b3 (quit pattern breakthrough) must surface — this is THE relevant memory
      expect(ids).toContain("b3");
    });

    test("Q14 — Making excuses", () => {
      r = audit(14, "I know I keep making excuses. Work, sleep. I find reasons not to go.", "failure_report", "avoidant");
      const ids = r.top5.map(m => m.id);
      expect(ids).toContain("p3");   // no-excuses promise
    });
  });

  // ── Group B: Achievement / progress signals ───────────────────────────────

  describe("B. Achievement and progress signals", () => {
    let r: AuditRow;

    test("Q3 — Hit 100kg bench", () => {
      r = audit(3, "I finally hit 100kg on bench press today.", "progress_report", "proud");
      const ids = r.top5.map(m => m.id);
      expect(ids).toContain("a1");   // bench PR achievement — must be #1 or #2
      expect(r.top5.findIndex(m => m.id === "a1")).toBeLessThanOrEqual(1);
    });

    test("Q6 — Consistent all month", () => {
      r = audit(6, "I have been consistent all month. Hit every session.", "progress_report", "motivated");
      const ids = r.top5.map(m => m.id);
      expect(ids).toContain("a4");   // May consistency achievement
    });

    test("Q8 — Deadlift progress", () => {
      r = audit(8, "Pulled 125kg today. Getting closer to that 140 goal.", "progress_report", "motivated");
      const ids = r.top5.map(m => m.id);
      expect(ids).toContain("g2");   // 140kg deadlift goal
    });

    test("Q19 — 28-day streak", () => {
      r = audit(19, "28 days in a row. Never done this before.", "progress_report", "proud");
      const ids = r.top5.map(m => m.id);
      expect(ids).toContain("a2");   // 28-day streak achievement
    });
  });

  // ── Group C: Commitment / promise signals ─────────────────────────────────

  describe("C. Commitment and promise signals", () => {
    let r: AuditRow;

    test("Q9 — Committing to morning sessions", () => {
      r = audit(9, "I am committing to morning sessions from now on. No more evening cancellations.", "commitment_made", "determined");
      const ids = r.top5.map(m => m.id);
      // c2 (morning commitment) and b2 (morning breakthrough) must appear
      expect(ids).toContain("c2");
      expect(ids).toContain("b2");
    });

    test("Q22 — Checking leg day promise", () => {
      r = audit(22, "Did I keep my promise about leg day?", "accountability_request", "neutral");
      const ids = r.top5.map(m => m.id);
      expect(ids).toContain("p1");   // leg day promise — must be #1
      expect(r.top5[0]!.id).toBe("p1");
    });
  });

  // ── Group D: Breakthrough / insight signals ───────────────────────────────

  describe("D. Breakthrough signals", () => {
    let r: AuditRow;

    test("Q12 — Identity question", () => {
      r = audit(12, "I do not think I am the kind of person who can stick with this long term.", "reflection", "discouraged");
      const ids = r.top5.map(m => m.id);
      expect(ids).toContain("b1");   // identity breakthrough
    });

    test("Q24 — Self-aware about burnout pattern", () => {
      r = audit(24, "I realize I always burn out. Push hard for 3 weeks then crash.", "reflection", "neutral");
      const ids = r.top5.map(m => m.id);
      expect(ids).toContain("b3");   // quit pattern breakthrough
      expect(ids).toContain("s3");   // burnout struggle
    });

    test("Q21 — Week 4 pullback pattern", () => {
      r = audit(21, "Week 4. I can feel myself pulling back. Same thing every time.", "reflection", "anxious");
      const ids = r.top5.map(m => m.id);
      expect(ids).toContain("b3");   // quit pattern breakthrough — the key memory
    });
  });

  // ── Group E: Preference / specifics ──────────────────────────────────────

  describe("E. Preference and specific queries", () => {
    let r: AuditRow;

    test("Q15 — Split question", () => {
      r = audit(15, "Should I change my training split?", "plan_request", "neutral");
      const ids = r.top5.map(m => m.id);
      // pr1 (PPL split) should surface — but not dominate
      expect(ids).toContain("pr1");
      // Preferences should NOT be #1 — a struggle/commitment should outrank it
      expect(r.top5[0]!.type).not.toBe("preference");
    });

    test("Q18 — Knee hurting", () => {
      r = audit(18, "My left knee has been hurting during squats.", "accountability_request", "anxious");
      const ids = r.top5.map(m => m.id);
      expect(ids).toContain("pr4");  // knee injury preference — specific match
    });

    test("Q25 — Morning vs evening training", () => {
      r = audit(25, "Should I train in the morning or evening?", "plan_request", "neutral");
      const ids = r.top5.map(m => m.id);
      // b2 (morning breakthrough) and c2 (morning commitment) should appear
      expect(ids).toContain("b2");
    });
  });

  // ── Group F: Noise / robustness ───────────────────────────────────────────

  describe("F. Noise robustness and edge cases", () => {
    let r: AuditRow;

    test("Q20 — Generic 'Hey' should not surface preferences only", () => {
      r = audit(20, "Hey", "general_chat", "neutral");
      // With zero overlap, priority ordering should drive results
      // Struggles should rank above preferences
      const struggleIdx  = r.top5.findIndex(m => m.type === "struggle");
      const preferenceIdx = r.top5.findIndex(m => m.type === "preference");
      if (struggleIdx !== -1 && preferenceIdx !== -1) {
        expect(struggleIdx).toBeLessThan(preferenceIdx);
      }
    });

    test("Q7 — Sleep problems — sleep-specific memories surface", () => {
      r = audit(7, "My sleep is terrible lately. Down to 5 hours a night.", "emotional_vent", "tired");
      const ids = r.top5.map(m => m.id);
      expect(ids).toContain("s4");  // sleep struggle
    });

    test("Q10 — Travel worry — nutrition travel struggle surfaces", () => {
      r = audit(10, "Work trip next week. Worried about eating and training.", "plan_request", "anxious");
      const ids = r.top5.map(m => m.id);
      expect(ids).toContain("s5");  // travel nutrition struggle
    });

    test("Q16 — Protein low — protein-specific memories surface", () => {
      r = audit(16, "I think my protein is low. Not hitting my targets.", "accountability_request", "neutral");
      const ids = r.top5.map(m => m.id);
      // pr3 (protein preference) or a5 (protein achievement) should appear
      expect(ids.some(id => id === "pr3" || id === "a5")).toBe(true);
    });

    test("Q17 — Returning after gap — work/consistency struggle surfaces", () => {
      r = audit(17, "I disappeared for a few weeks. Work got crazy. I am back.", "status_update", "neutral");
      const ids = r.top5.map(m => m.id);
      expect(ids).toContain("s2");  // work/consistency struggle
    });

    test("Q11 — Unmotivated — non-preference items lead", () => {
      r = audit(11, "I do not feel like going today. Do not know why.", "emotional_vent", "discouraged");
      expect(r.top5[0]!.type).not.toBe("preference");
    });

    test("Q23 — Fat loss goal — weight-related memories surface", () => {
      r = audit(23, "I want to drop body fat over the next 12 weeks.", "goal_setting", "motivated");
      const ids = r.top5.map(m => m.id);
      // a3 (8kg cut achievement) should surface
      expect(ids).toContain("a3");
    });
  });

  // ── Full output table (always printed, never fails) ───────────────────────

  test("FULL AUDIT TABLE — inspect scores and ranking", () => {
    const cols = 76;
    const line = "─".repeat(cols);
    const dbl  = "═".repeat(cols);

    // Run all 25 if not already in RESULTS
    if (RESULTS.length < 25) {
      audit(1, "I want to quit. I am done.", "emotional_vent", "discouraged");
      audit(2, "I am completely burned out. I cannot do this anymore.", "emotional_vent", "tired");
      audit(3, "I finally hit 100kg on bench press today.", "progress_report", "proud");
      audit(4, "Work is getting in the way again. I keep missing sessions.", "failure_report", "frustrated");
      audit(5, "I skipped again. Leg day. Third time this month.", "failure_report", "frustrated");
      audit(6, "I have been consistent all month. Hit every session.", "progress_report", "motivated");
      audit(7, "My sleep is terrible lately. Down to 5 hours a night.", "emotional_vent", "tired");
      audit(8, "Pulled 125kg today. Getting closer to that 140 goal.", "progress_report", "motivated");
      audit(9, "Committing to morning sessions from now on. No evening cancellations.", "commitment_made", "determined");
      audit(10,"Work trip next week. Worried about eating and training.", "plan_request", "anxious");
      audit(11,"I do not feel like going today. Do not know why.", "emotional_vent", "discouraged");
      audit(12,"I do not think I am the kind of person who can stick with this.", "reflection", "discouraged");
      audit(13,"Three weeks in and already losing steam. This always happens.", "failure_report", "frustrated");
      audit(14,"I know I keep making excuses. Work, sleep. Reasons not to go.", "failure_report", "avoidant");
      audit(15,"Should I change my training split?", "plan_request", "neutral");
      audit(16,"I think my protein is low. Not hitting my targets.", "accountability_request", "neutral");
      audit(17,"I disappeared for a few weeks. Work got crazy. I am back.", "status_update", "neutral");
      audit(18,"My left knee has been hurting during squats.", "accountability_request", "anxious");
      audit(19,"28 days in a row. Never done this before.", "progress_report", "proud");
      audit(20,"Hey", "general_chat", "neutral");
      audit(21,"Week 4. I can feel myself pulling back. Same thing every time.", "reflection", "anxious");
      audit(22,"Did I keep my promise about leg day?", "accountability_request", "neutral");
      audit(23,"I want to drop body fat over the next 12 weeks.", "goal_setting", "motivated");
      audit(24,"I realize I always burn out. Push hard for 3 weeks then crash.", "reflection", "neutral");
      audit(25,"Should I train in the morning or evening?", "plan_request", "neutral");
    }

    let out = "\n\n" + dbl + "\n  MEMORY RETRIEVAL V2 — FULL AUDIT RESULTS\n" + dbl;

    for (const row of RESULTS) {
      out += `\n\n${line}\n`;
      out += `Q${String(row.n).padStart(2,"0")}: "${row.query}"\n`;
      out += `     intent=${row.intent}  emotion=${row.emotion}\n`;
      out += `${line}\n`;
      out += `  #  score   type          reason                   id   value\n`;
      out += `${line}\n`;
      row.top5.forEach((m, i) => {
        const val = m.value.length > 40 ? m.value.slice(0, 37) + "..." : m.value;
        out += `  ${i+1}  ${m.score.toFixed(4)}  ${m.type.padEnd(13)} ${m.reason.padEnd(24)} ${m.id.padEnd(4)} ${val}\n`;
      });
    }

    out += "\n" + dbl;
    console.log(out);

    expect(RESULTS.length).toBeGreaterThanOrEqual(25);
  });
});
