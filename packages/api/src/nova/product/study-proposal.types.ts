// ─── Ask Nova to update your subjects: the contract with the web app ──────────
// Only a type import from setup-edit.types.ts (itself import-free), so the
// web app imports it directly. Rules: product/study-proposal.ts.

import type { StudyEdit } from "./setup-edit.types";

export const STUDY_REQUEST_MAX = 800;

type Edit = StudyEdit;

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
