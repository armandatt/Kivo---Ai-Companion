// ─── Entitlements: the account behind any learner, and what it may use ───────
// The one server-side answer to "what does this person's plan allow?", asked
// by every AI entry point on every surface. It reads the account's billing
// rows and applies access.ts; it never reads a flag from a browser, a chat or
// the extension.
//
// The account is the web User. A learner reached some other way is mapped to
// it the way learner-identity.ts maps the other direction:
//   "web:<userId>"            that user
//   a Telegram chat id        the user whose profile links that chat
//   neither                   no account: Free, metered per learner

import { prisma } from "@repo/db/client";
import { deriveAccess, trialEligible, type Access } from "./access";
import { allowanceFor, type Allowance } from "./limits";
import { graceDays } from "./config";
import { webAccountOf } from "../nova/product/learner-key";

export interface Entitlement extends Access {
  allowance: Allowance;
  // The meter key this person's usage is counted under.
  usageKey:  string;
}

export async function accountForLearner(platformChatId: string): Promise<string | null> {
  const web = webAccountOf(platformChatId);
  if (web !== null) return web || null;
  const profile = await prisma.userProfile.findFirst({ where: { telegramChatId: platformChatId }, select: { userId: true } });
  return profile?.userId ?? null;
}

async function billingRows(userId: string) {
  const [subscription, trial] = await Promise.all([
    prisma.billingSubscription.findUnique({
      where: { userId },
      select: { planKey: true, status: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, endedAt: true },
    }),
    prisma.billingTrial.findUnique({ where: { userId }, select: { startedAt: true, endsAt: true } }),
  ]);
  return { subscription, trial };
}

export async function entitlementForUser(userId: string, now = new Date()): Promise<Entitlement & { trialEligible: boolean }> {
  const rows = await billingRows(userId);
  const access = deriveAccess({ ...rows, now, graceDays: graceDays() });
  return { ...access, allowance: allowanceFor(access.plan), usageKey: `user:${userId}`, trialEligible: trialEligible(rows) };
}

// A learner from any surface. With no account behind it (a Telegram chat no
// web account has linked), it is Free and metered on its own.
export async function entitlementForLearner(platformChatId: string, now = new Date()): Promise<Entitlement> {
  const userId = await accountForLearner(platformChatId);
  if (userId) return entitlementForUser(userId, now);
  return { plan: "free", source: "free", planKey: null, until: null, allowance: allowanceFor("free"), usageKey: `learner:${platformChatId}` };
}
