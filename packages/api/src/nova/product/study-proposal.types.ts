// ─── Ask Nova to update your subjects: the contract with the web app ──────────
// No imports, so the web app imports it directly (a StudyEdit is the same
// shape as in setup-edit.types.ts). Rules: product/study-proposal.ts.

export const STUDY_REQUEST_MAX = 800;

type Edit =
  | { op: "add_subject";    name: string; topics: string[] }
  | { op: "add_topics";     subjectId: string; names: string[] }
  | { op: "rename_subject"; subjectId: string; name: string }
  | { op: "rename_topic";   topicId: string; name: string }
  | { op: "move_topic";     topicId: string; toSubjectId: string }
  | { op: "remove_topic";   topicId: string }
  | { op: "remove_subject"; subjectId: string };

export type StudyProposalResponse =
  | {
      ok: true;
      // The structure version the proposal was checked against. Approval is
      // refused if the subjects changed since.
      version:   string;
      // Changes that passed the same check a hand-made edit gets, in order.
      // Nothing is applied until the learner approves.
      changes:   Array<{ edit: Edit; why: string; sentence: string }>;
      // Changes the model suggested that Kivo will not make, and why.
      dropped:   Array<{ what: string; reason: string }>;
      // When the request was unclear.
      questions: string[];
    }
  | { ok: false; error: "invalid" | "too_long" | "unavailable" | "rate_limited" | "unauthenticated" | "not_nova" | "not_connected" | "onboarding_incomplete" | "failed"; message: string };
