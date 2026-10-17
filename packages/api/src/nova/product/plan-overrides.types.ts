// ─── The learner's changes to today's plan: the contract with the web app ─────
// No imports, so the web app imports it directly. Rules: product/plan-overrides.ts.

export type PlanOverrideResponse =
  | { ok: true; day: string }
  | { ok: false; error: "invalid" | "not_found" | "unauthenticated" | "not_nova" | "not_connected" | "onboarding_incomplete" | "failed"; message: string };

// Shown with today's plan: what the learner changed about it.
export interface TodayPlanChanges {
  skipped: Array<{ topicId: string; topicName: string }>;
  added:   Array<{ topicId: string; topicName: string }>;
  // The learner put the blocks in their own order.
  ordered: boolean;
}
