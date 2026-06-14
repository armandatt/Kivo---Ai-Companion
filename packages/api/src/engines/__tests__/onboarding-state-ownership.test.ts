import { initState } from "../onboarding-engine-v2";
import { applyV3StateMigration, computeCurrentStep } from "../onboarding-engine-v3";

// Minimal set of answers that satisfies every V3 REQUIRED_FIELD
const FULL_ANSWERS: Record<string, string> = {
  name:                    "Alex",
  gym_goal:                "muscle",
  current_bodyweight_kg:   "80",
  height_cm:               "175",
  training_experience:     "intermediate",
  available_training_days: "4",
  current_split:           "PPL",
  gym_session_time:        "18:00",
  daily_protein_g:         "160",
  injury_notes:            "none",
};

// ──────────────────────────────────────────────────────────────────────────────
// computeCurrentStep
// ──────────────────────────────────────────────────────────────────────────────

describe("computeCurrentStep", () => {
  test("returns 'review' when all required fields are filled", () => {
    expect(computeCurrentStep({ ...FULL_ANSWERS })).toBe("review");
  });

  test("returns first missing field's step when a field is absent", () => {
    const answers = { ...FULL_ANSWERS };
    delete answers.gym_goal;
    expect(computeCurrentStep(answers)).toBe("goal");
  });

  test("returns 'split' step when current_split is missing", () => {
    const answers = { ...FULL_ANSWERS };
    delete answers.current_split;
    expect(computeCurrentStep(answers)).toBe("split");
  });

  test("protein_status='not_tracking' counts as collected (no daily_protein_g needed)", () => {
    const answers = { ...FULL_ANSWERS };
    delete answers.daily_protein_g;
    answers.protein_status = "not_tracking";
    expect(computeCurrentStep(answers)).toBe("review");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Scenario 1 — currentStep ownership
// V2 left currentStep="split" but answers imply all fields done → V3 wins
// ──────────────────────────────────────────────────────────────────────────────

describe("applyV3StateMigration — currentStep ownership", () => {
  test("V3 overwrites V2 currentStep='split' when answers are complete", () => {
    const state = initState("u1");
    state.currentStep = "split";          // V2 left it mid-way
    state.answers = { ...FULL_ANSWERS };  // but answers are complete

    applyV3StateMigration(state);

    expect(state.currentStep).toBe("review");
  });

  test("V3 overwrites V2 currentStep='review' when a field is still missing", () => {
    const state = initState("u1");
    state.currentStep = "review";             // V2 thought it was done
    const incomplete = { ...FULL_ANSWERS };
    delete incomplete.gym_session_time;       // but gym_session_time is absent
    state.answers = incomplete;

    applyV3StateMigration(state);

    // V3 recomputes to "gym_time" (the step for gym_session_time)
    expect(state.currentStep).toBe("gym_time");
  });

  test("V3 sets currentStep='name' when answers are empty", () => {
    const state = initState("u1");
    state.currentStep = "injury";  // any stale value

    applyV3StateMigration(state);

    expect(state.currentStep).toBe("name");
  });

  test("V3 bridges currentStep='review' → _v3_review_shown when all fields present", () => {
    const state = initState("u1");
    state.currentStep = "review";
    state.answers = { ...FULL_ANSWERS };  // all fields present

    applyV3StateMigration(state);

    expect(state.answers._v3_review_shown).toBe("true");
    expect(state.currentStep).toBe("review");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Scenario 2 — repeatCounts cleanup
// V2 left StepId keys; V3 field-name keys must survive; V2 keys must be removed
// ──────────────────────────────────────────────────────────────────────────────

describe("applyV3StateMigration — repeatCounts cleanup", () => {
  test("removes V2 StepId keys (split, goal, gym_time, …)", () => {
    const state = initState("u1");
    state.currentStep = "name";
    state.answers = {};
    // V2 stall history
    state.repeatCounts = {
      split:        4,
      goal:         2,
      gym_time:     1,
      protein:      3,
      injury:       1,
      experience:   0,
      days:         2,
      body_stats:   1,
      name:         1,    // "name" is valid in both V2 and V3
    };

    applyV3StateMigration(state);

    // V2-only StepIds must be gone
    expect(state.repeatCounts).not.toHaveProperty("split");
    expect(state.repeatCounts).not.toHaveProperty("goal");
    expect(state.repeatCounts).not.toHaveProperty("gym_time");
    expect(state.repeatCounts).not.toHaveProperty("protein");
    expect(state.repeatCounts).not.toHaveProperty("injury");
    expect(state.repeatCounts).not.toHaveProperty("experience");
    expect(state.repeatCounts).not.toHaveProperty("days");
    expect(state.repeatCounts).not.toHaveProperty("body_stats");
    // "name" is also a V3 REQUIRED_FIELD key — must be kept
    expect(state.repeatCounts.name).toBe(1);
  });

  test("preserves V3 field-name keys", () => {
    const state = initState("u1");
    state.currentStep = "split";
    state.answers = { ...FULL_ANSWERS };
    delete state.answers.current_split;
    // V2 stale keys mixed with V3 real keys
    state.repeatCounts = {
      split:         4,   // V2 stale
      current_split: 1,   // V3 real
      gym_time:      2,   // V2 stale
      gym_session_time: 0, // V3 real
    };

    applyV3StateMigration(state);

    expect(state.repeatCounts).not.toHaveProperty("split");
    expect(state.repeatCounts).not.toHaveProperty("gym_time");
    expect(state.repeatCounts.current_split).toBe(1);
    expect(state.repeatCounts.gym_session_time).toBe(0);
  });

  test("empty repeatCounts remains empty", () => {
    const state = initState("u1");
    state.answers = {};
    applyV3StateMigration(state);
    expect(state.repeatCounts).toEqual({});
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Scenario 3 — pendingVerification and pendingPartialSplit cleared
// ──────────────────────────────────────────────────────────────────────────────

describe("applyV3StateMigration — V2 artifact cleanup", () => {
  test("clears pendingVerification left by V2", () => {
    const state = initState("u1");
    state.pendingVerification = {
      step:            "goal",
      proposedValue:   "muscle",
      canonicalValue:  "muscle",
      originalInput:   "build muscle",
      storageKey:      "gym_goal",
      confirmQuestion: "Got it — muscle gain?",
    };
    state.answers = {};

    applyV3StateMigration(state);

    expect(state.pendingVerification).toBeNull();
  });

  test("clears pendingPartialSplit left by V2", () => {
    const state = initState("u1");
    state.pendingPartialSplit = { days: ["Push", "Pull"] };
    state.answers = {};

    applyV3StateMigration(state);

    expect(state.pendingPartialSplit).toBeNull();
  });
});
