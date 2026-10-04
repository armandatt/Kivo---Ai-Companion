// ─── Nova Onboarding Decision Engine ──────────────────────────────────────────
// SKILL.md: deterministic reasoning only. No LLM. No DB. Pure function.
// Responsibilities:
//   - Determine what was just learned (justCaptured) vs. already known
//   - Detect conflicts between extraction and stored state
//   - Compute projected state after this turn's write
//   - Decide completion status
//   - Prioritize the single next field to ask about
//   - Flag anything that needs clarification
//
// Returns structured OnboardingDecision. No text. No reply.
// The Response Brain translates this decision into conversational language.
// Owner: Decision Engine layer.

import type { AcademicExtractionResult, OnboardingCurrentState } from "./nova-onboarding-extractor.js";
import type { ValidatedExtraction }                               from "./nova-onboarding-validator.js";

// ── Output types ──────────────────────────────────────────────────────────────

export interface JustCapturedFact {
  field:     string;   // "yearOfStudy" | "institution" | "subjects" | "goals" | ...
  label:     string;   // Human-readable value: "Year 2", "Bennett University", "placements", ...
  isNew:     boolean;  // true = first time learning this
  isUpdated: boolean;  // true = replacing a previously stored value
}

export interface ConflictInfo {
  field:         string;
  previousValue: string;
  newValue:      string;
}

export interface ProjectedState {
  yearOfStudy:  number | null;
  subjectCount: number;
  goalsCount:   number;
  institution:  string | null;
}

export interface OnboardingDecision {
  // What to ask next (null = ask what they want to work on)
  nextFocus:           string | null;

  // Can the full orchestrator take over?
  isCompleteEnough:    boolean;

  // Facts just learned this turn — for silent confirmation
  justCaptured:        JustCapturedFact[];

  // Field conflicts (student said X but we had Y)
  conflictsDetected:   ConflictInfo[];

  // Does the response brain need to surface a clarification?
  needsClarification:  boolean;
  clarificationTarget: string | null;

  // What the projected DB state will look like after this write
  projectedState:      ProjectedState;
}

// ── Goal display labels ───────────────────────────────────────────────────────

const GOAL_LABELS: Record<string, string> = {
  placement:        "placement prep",
  higher_studies:   "higher studies",
  competitive_exam: "competitive exams",
  internship:       "internship",
  skill_building:   "skill building",
  gpa_improvement:  "GPA improvement",
  personal_projects: "personal projects",
};

function goalLabel(g: string): string {
  return GOAL_LABELS[g] ?? g;
}

// ── Next focus priority (deterministic, no LLM) ───────────────────────────────

function resolveNextFocus(
  projected: ProjectedState,
  current:   OnboardingCurrentState,
  validated: ValidatedExtraction,
): string | null {
  // Critical fields (must have to call isCompleteEnough = true)
  if (!projected.yearOfStudy)  return "year";
  if (projected.subjectCount === 0) return "subjects";
  if (projected.goalsCount === 0)   return "goals";

  // Soft fields — useful but not blocking
  const targetGpa   = validated.targetGpa   ?? current.targetGpa;
  const studyHours  = validated.preferredStudyHoursPerDay ?? current.preferredStudyHoursPerDay;
  const struggle    = validated.biggestStruggle ?? current.biggestStruggle;
  const studyTime   = validated.preferredStudyTime ?? current.preferredStudyTime;

  if (!targetGpa)  return "target_gpa";
  if (!studyHours) return "study_hours";
  if (!struggle)   return "biggest_struggle";
  if (!studyTime)  return "study_time";

  // All soft fields captured — open floor to student
  return null;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function makeOnboardingDecision(
  extraction:   AcademicExtractionResult,
  validated:    ValidatedExtraction,
  currentState: OnboardingCurrentState,
): OnboardingDecision {

  // ── 1. Build justCaptured ─────────────────────────────────────────────────

  const justCaptured: JustCapturedFact[] = [];

  if (validated.institution) {
    if (!currentState.institution) {
      justCaptured.push({ field: "institution", label: validated.institution, isNew: true, isUpdated: false });
    } else if (validated.institution.toLowerCase() !== currentState.institution.toLowerCase()) {
      justCaptured.push({ field: "institution", label: validated.institution, isNew: false, isUpdated: true });
    }
  }

  if (validated.degree) {
    if (!currentState.degree) {
      justCaptured.push({ field: "degree", label: validated.degree, isNew: true, isUpdated: false });
    } else if (validated.degree !== currentState.degree) {
      justCaptured.push({ field: "degree", label: validated.degree, isNew: false, isUpdated: true });
    }
  }

  if (validated.major) {
    if (!currentState.major) {
      justCaptured.push({ field: "major", label: validated.major, isNew: true, isUpdated: false });
    } else if (validated.major !== currentState.major) {
      justCaptured.push({ field: "major", label: validated.major, isNew: false, isUpdated: true });
    }
  }

  if (validated.yearOfStudy) {
    if (!currentState.yearOfStudy) {
      justCaptured.push({
        field: "yearOfStudy",
        label: `Year ${validated.yearOfStudy}`,
        isNew: true, isUpdated: false,
      });
    } else if (validated.yearOfStudy !== currentState.yearOfStudy) {
      justCaptured.push({
        field: "yearOfStudy",
        label: `Year ${validated.yearOfStudy}`,
        isNew: false, isUpdated: true,
      });
    }
  }

  if (validated.goals.length > 0) {
    const newGoals = validated.goals.filter(g => !currentState.goals.includes(g));
    if (newGoals.length > 0) {
      justCaptured.push({
        field:     "goals",
        label:     newGoals.map(goalLabel).join(", "),
        isNew:     currentState.goals.length === 0,
        isUpdated: currentState.goals.length > 0,
      });
    }
  }

  if (validated.subjects.length > 0) {
    const newSubjectNames = validated.subjects
      .map(s => s.name)
      .filter(n => !currentState.subjectNames.includes(n));
    if (newSubjectNames.length > 0) {
      justCaptured.push({
        field:     "subjects",
        label:     `${newSubjectNames.length} subject${newSubjectNames.length > 1 ? "s" : ""} (${newSubjectNames.slice(0, 2).join(", ")}${newSubjectNames.length > 2 ? "…" : ""})`,
        isNew:     currentState.subjectCount === 0,
        isUpdated: currentState.subjectCount > 0,
      });
    }

    // Weak/strong signals
    const weakAdded   = validated.subjects.filter(s => s.isWeak).map(s => s.name);
    const strongAdded = validated.subjects.filter(s => s.isStrong).map(s => s.name);
    if (weakAdded.length > 0) {
      justCaptured.push({
        field: "weakSubjects", label: `weak in ${weakAdded.join(", ")}`, isNew: true, isUpdated: false,
      });
    }
    if (strongAdded.length > 0) {
      justCaptured.push({
        field: "strongSubjects", label: `strong in ${strongAdded.join(", ")}`, isNew: true, isUpdated: false,
      });
    }
  }

  if (validated.targetGpa && !currentState.targetGpa) {
    justCaptured.push({ field: "targetGpa", label: `target ${validated.targetGpa} CGPA`, isNew: true, isUpdated: false });
  }

  if (validated.preferredStudyHoursPerDay && !currentState.preferredStudyHoursPerDay) {
    justCaptured.push({ field: "studyHours", label: `${validated.preferredStudyHoursPerDay}h/day`, isNew: true, isUpdated: false });
  }

  if (validated.biggestStruggle && !currentState.biggestStruggle) {
    justCaptured.push({ field: "biggestStruggle", label: validated.biggestStruggle.slice(0, 60), isNew: true, isUpdated: false });
  }

  // ── 2. Detect conflicts ───────────────────────────────────────────────────

  const conflictsDetected: ConflictInfo[] = [];

  if (extraction.intent === "correction") {
    if (validated.yearOfStudy && currentState.yearOfStudy &&
        validated.yearOfStudy !== currentState.yearOfStudy) {
      conflictsDetected.push({
        field:         "yearOfStudy",
        previousValue: `Year ${currentState.yearOfStudy}`,
        newValue:      `Year ${validated.yearOfStudy}`,
      });
    }
    if (validated.major && currentState.major &&
        validated.major.toLowerCase() !== currentState.major.toLowerCase()) {
      conflictsDetected.push({
        field:         "major",
        previousValue: currentState.major,
        newValue:      validated.major,
      });
    }
    if (validated.institution && currentState.institution &&
        validated.institution.toLowerCase() !== currentState.institution.toLowerCase()) {
      conflictsDetected.push({
        field:         "institution",
        previousValue: currentState.institution,
        newValue:      validated.institution,
      });
    }
  }

  // ── 3. Projected state ────────────────────────────────────────────────────

  const projectedYear     = validated.yearOfStudy ?? currentState.yearOfStudy;
  const projectedSubjects = currentState.subjectCount +
    validated.subjects.filter(s => !currentState.subjectNames.includes(s.name)).length;
  const projectedGoals    = Array.from(new Set([...currentState.goals, ...validated.goals]));

  const projectedState: ProjectedState = {
    yearOfStudy:  projectedYear,
    subjectCount: projectedSubjects,
    goalsCount:   projectedGoals.length,
    institution:  validated.institution ?? currentState.institution,
  };

  // ── 4. Completion ─────────────────────────────────────────────────────────

  const isCompleteEnough =
    projectedYear !== null &&
    projectedSubjects >= 1 &&
    projectedGoals.length >= 1;

  // ── 5. Next focus ─────────────────────────────────────────────────────────

  const nextFocus = resolveNextFocus(projectedState, currentState, validated);

  // ── 6. Clarification ──────────────────────────────────────────────────────

  const needsClarification =
    conflictsDetected.length > 0 ||
    (extraction.unknownAspects.length > 0 && extraction.confidence < 0.6);

  const clarificationTarget = conflictsDetected.length > 0
    ? conflictsDetected[0]!.field
    : (extraction.unknownAspects.length > 0 ? "unknown" : null);

  return {
    nextFocus,
    isCompleteEnough,
    justCaptured,
    conflictsDetected,
    needsClarification,
    clarificationTarget,
    projectedState,
  };
}
