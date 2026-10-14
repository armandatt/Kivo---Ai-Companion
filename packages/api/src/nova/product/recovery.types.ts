// ─── Getting back on track: the contract with the web app ─────────────────────
// No imports, so the web app imports it directly. Rules: product/recovery.ts
// and engines/recovery-engine.ts.

export type RecoverySituationName = "no_history" | "on_track" | "missed_one" | "missed_several" | "returning";

export interface RecoveryMoveView {
  taskId: string;
  title:  string;
  from:   string;          // YYYY-MM-DD, the overdue day it has now
  to:     string;          // YYYY-MM-DD, the day proposed
  reason: string;
}

export interface RecoveryUnplacedView {
  taskId: string;
  title:  string;
  from:   string;
  why:    "deadline_conflict" | "no_room";
  reason: string;
}

export interface NovaRecoveryReady {
  status:           "ready";
  today:            string;
  situation:        RecoverySituationName;
  lastStudyDay:     string | null;
  daysSinceStudy:   number | null;
  missedDays:       number;
  overdueTaskCount: number;
  // Made by itself: today's computed plan is a shorter re-entry day. Nothing
  // is stored; it ends with the next counted session.
  reentryDay:       boolean;
  headline:         string;
  // Waiting for the learner. Nothing in it is applied until they accept
  // this id; asked again, the same record gives the same proposal.
  proposal: {
    id:          string;
    moves:       RecoveryMoveView[];
    unplaced:    RecoveryUnplacedView[];
    assumptions: string[];
  } | null;
}

export type NovaRecoveryView =
  | NovaRecoveryReady
  | { status: "not_nova" }
  | { status: "not_connected" }
  | { status: "onboarding_incomplete" };

// What an accept or an undo carries. Anything else is ignored.
export interface RecoveryMoveInput { taskId: string; from: string; to: string }
export interface RecoveryAcceptInput { action: "accept"; proposalId: string; moves: RecoveryMoveInput[] }
export interface RecoveryUndoInput   { action: "undo"; moves: RecoveryMoveInput[] }
export const RECOVERY_MOVES_MAX = 300;

export type RecoveryActionResponse =
  | {
      ok: true;
      // applied: written now. already_applied: a retry or a second tab found
      // it done. undone / already_undone: the same for an undo.
      outcome: "applied" | "already_applied" | "undone" | "already_undone";
      // The moves to send back to undo this (accept only).
      undo:    RecoveryMoveInput[];
      view:    NovaRecoveryReady;
    }
  | { ok: false; error: "invalid" | "changed" | "refused" | "unauthenticated" | "not_nova" | "not_connected" | "onboarding_incomplete" | "failed"; message: string; view?: NovaRecoveryReady };
