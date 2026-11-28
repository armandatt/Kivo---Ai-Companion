// ─── Kivo Connect: whose Kivo a call reaches ──────────────────────────────────
// The account comes from the verified access token (oauth.ts), never from a
// tool's arguments. The account becomes a learner by the one rule the web
// app and the extension use (learner-identity.ts), and the learner a profile
// by the notes' rule. Every tool works on that profile id and nothing else.

import { resolveLearnerForAccount } from "../nova/product/learner-identity";
import { ensureConnectSpace } from "../nova/product/setup";
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

// Which learner an account is changes only when the account is set up or
// deleted, so a ready answer is kept for LEARNER_TTL_MS in this process
// (one API instance). Only the mapping: the token itself is verified on
// every request (oauth.ts), so revoking or disconnecting is immediate, and a
// deleted account's tokens go with it.
export const LEARNER_TTL_MS = 30_000;
const LEARNER_CACHE_MAX = 2_000;
const ready = new Map<string, { platformChatId: string; profileId: string; at: number }>();

export function forgetLearner(userId?: string) { if (userId) ready.delete(userId); else ready.clear(); }

export async function learnerFor(caller: ConnectCaller, name: string | null = null, now = Date.now()): Promise<LearnerOutcome> {
  const hit = ready.get(caller.userId);
  if (hit && now - hit.at < LEARNER_TTL_MS) {
    return { ok: true, learner: { userId: caller.userId, grantId: caller.grantId, scopes: caller.scopes, clientName: caller.clientName, name, platformChatId: hit.platformChatId, profileId: hit.profileId } };
  }
  // A brand-new account works from its first call (28 Nov): no map, no notes,
  // no Nova setup and no signup quiz needed. Its learner and learning space
  // are made here if missing (idempotent), from the verified token's account
  // only. An empty space is a valid space: reads answer empty, writes create.
  const account = await resolveLearnerForAccount(caller.userId, name, { undecided: "nova" });
  if (account.kind !== "learner") {
    return { ok: false, reason: account.kind === "not_nova" ? "not_nova" : "not_connected", message: "This Kivo account uses a different companion, so its Knowledge Map isn't available to assistants." };
  }
  const space = await ensureConnectSpace(account.platformChatId);
  if (!space) return { ok: false, reason: "not_connected", message: "This Kivo account couldn't be opened. Try again in a moment." };
  if (ready.size >= LEARNER_CACHE_MAX) ready.delete(ready.keys().next().value!);
  ready.set(caller.userId, { platformChatId: account.platformChatId, profileId: space.profileId, at: now });
  return { ok: true, learner: { userId: caller.userId, grantId: caller.grantId, scopes: caller.scopes, clientName: caller.clientName, name, platformChatId: account.platformChatId, profileId: space.profileId } };
}

// The signed-in learner's profile, for their own approval on Kivo (the
// session cookie's account, never an id from the request). null: no notes
// space yet.
// The same rule as learnerFor: an account whose map an assistant is building
// can approve its changes before it has set Nova up.
export async function profileForAccount(userId: string): Promise<string | null> {
  const account = await resolveLearnerForAccount(userId, null, { undecided: "nova" });
  if (account.kind !== "learner") return null;
  const space = await ensureConnectSpace(account.platformChatId);
  return space?.profileId ?? null;
}
