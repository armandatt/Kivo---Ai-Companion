// ─── Kivo Connect: whose Kivo a call reaches ──────────────────────────────────
// The account comes from the verified access token (oauth.ts), never from a
// tool's arguments. The account becomes a learner by the one rule the web
// app and the extension use (learner-identity.ts), and the learner a profile
// by the notes' rule. Every tool works on that profile id and nothing else.

import { resolveLearnerForAccount } from "../nova/product/learner-identity";
import { resolveNoteLearner } from "../nova/product/notes";
import type { ConnectCaller } from "./oauth";

export interface ConnectLearner {
  userId: string;
  grantId: string;
  scopes: string[];
  clientName: string;
  name: string | null;
  platformChatId: string;
  profileId: string;
}

export type LearnerOutcome =
  | { ok: true; learner: ConnectLearner }
  | { ok: false; reason: "not_nova" | "not_connected" | "onboarding_incomplete"; message: string };

export async function learnerFor(caller: ConnectCaller, name: string | null = null): Promise<LearnerOutcome> {
  const account = await resolveLearnerForAccount(caller.userId, name);
  if (account.kind !== "learner") {
    return { ok: false, reason: account.kind === "not_nova" ? "not_nova" : "not_connected", message: "This Kivo account has no Nova learning space yet. Open Kivo on the web and finish setting up first." };
  }
  const profile = await resolveNoteLearner(account.platformChatId);
  if (profile.status !== "ready") return { ok: false, reason: profile.status, message: "Finish setting up Kivo on the web first; then this assistant can reach your notes and map." };
  return { ok: true, learner: { userId: caller.userId, grantId: caller.grantId, scopes: caller.scopes, clientName: caller.clientName, name, platformChatId: account.platformChatId, profileId: profile.profileId } };
}
