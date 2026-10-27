// ─── The AI meter ─────────────────────────────────────────────────────────────
// Each allowed model request is counted against the person's daily allowance
// before it is made; the tokens it used are added after, when the model says.
// The check and the count are one UPDATE that only succeeds while the count is
// under the limit, so concurrent requests cannot pass the allowance together:
// Postgres re-checks the condition on the row it locks.

import { prisma } from "@repo/db/client";
import { meterLlmUsage, type LlmUsage } from "../services/llm-usage";
import type { Entitlement } from "./entitlements";

export const utcDay = (now: Date) => now.toISOString().slice(0, 10);

const isUniqueViolation = (err: unknown) => (err as { code?: string } | null)?.code === "P2002";

export type Spend =
  | { ok: true;  used: number; limit: number }
  | { ok: false; used: number; limit: number; plan: Entitlement["plan"] };

export async function spendAiRequest(ent: Pick<Entitlement, "usageKey" | "allowance" | "plan">, now = new Date()): Promise<Spend> {
  const key = { subjectKey: ent.usageKey, day: utcDay(now) };
  const limit = ent.allowance.dailyRequests;
  // The day's row, made once. Two first requests at once: one makes it.
  try {
    await prisma.aiUsageDay.upsert({ where: { subjectKey_day: key }, create: key, update: {} });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }
  const spent = await prisma.aiUsageDay.updateMany({
    where: { ...key, requests: { lt: limit } },
    data:  { requests: { increment: 1 } },
  });
  const row = await prisma.aiUsageDay.findUnique({ where: { subjectKey_day: key }, select: { requests: true } });
  const used = row?.requests ?? 0;
  return spent.count === 1 ? { ok: true, used, limit } : { ok: false, used, limit, plan: ent.plan };
}

export async function recordTokens(usageKey: string, usage: LlmUsage, now = new Date()) {
  const input = Math.max(0, Math.round(usage.inputTokens ?? 0));
  const output = Math.max(0, Math.round(usage.outputTokens ?? 0));
  if (input === 0 && output === 0) return;
  await prisma.aiUsageDay.updateMany({
    where: { subjectKey: usageKey, day: utcDay(now) },
    data:  { inputTokens: { increment: input }, outputTokens: { increment: output } },
  });
}

// Runs `work` as one metered AI request: refused when the allowance is used
// up, and every model call inside it adds its tokens to the day's row. A
// fault in the meter or in recording tokens never fails the work.
export async function withAiAllowance<T>(
  ent: Pick<Entitlement, "usageKey" | "allowance" | "plan">,
  work: () => Promise<T>,
  now = new Date(),
): Promise<{ ok: true; value: T } | { ok: false; spend: Extract<Spend, { ok: false }> }> {
  let spend: Spend;
  try {
    spend = await spendAiRequest(ent, now);
  } catch (err) {
    // The meter could not be read: the learner is not refused for Kivo's fault.
    console.error(`[billing] meter unavailable: ${(err as Error).name}`);
    return { ok: true, value: await work() };
  }
  if (!spend.ok) return { ok: false, spend };
  const pending: Array<Promise<unknown>> = []
  const value = await meterLlmUsage(usage => { pending.push(recordTokens(ent.usageKey, usage, now).catch(() => undefined)) }, work);
  await Promise.all(pending);
  return { ok: true, value };
}

export async function usageToday(usageKey: string, now = new Date()) {
  const row = await prisma.aiUsageDay.findUnique({ where: { subjectKey_day: { subjectKey: usageKey, day: utcDay(now) } } });
  return { requests: row?.requests ?? 0, inputTokens: row?.inputTokens ?? 0, outputTokens: row?.outputTokens ?? 0 };
}

// For cost per active user: totals over a range of days, and how many people
// used AI at all. Internal; no learner sees it.
export async function usageSummary(fromDay: string, toDay: string) {
  const rows = await prisma.aiUsageDay.groupBy({
    by: ["subjectKey"],
    where: { day: { gte: fromDay, lte: toDay } },
    _sum: { requests: true, inputTokens: true, outputTokens: true },
  });
  const total = rows.reduce((acc, r) => ({
    requests: acc.requests + (r._sum.requests ?? 0),
    inputTokens: acc.inputTokens + (r._sum.inputTokens ?? 0),
    outputTokens: acc.outputTokens + (r._sum.outputTokens ?? 0),
  }), { requests: 0, inputTokens: 0, outputTokens: 0 });
  return { fromDay, toDay, activeUsers: rows.length, ...total };
}

// Adds the tokens of every model call inside `work` to the learner's day,
// without counting a request (the caller's own gate does that). The account
// is looked up only if a model was actually called.
export async function meterTokensForLearner<T>(platformChatId: string, work: () => Promise<T>, now = new Date()): Promise<T> {
  const used: LlmUsage[] = [];
  const value = await meterLlmUsage(usage => { used.push(usage) }, work);
  if (used.length > 0) {
    try {
      const { entitlementForLearner } = await import("./entitlements");
      const ent = await entitlementForLearner(platformChatId, now);
      const total = used.reduce((a, u) => ({ ...a, inputTokens: (a.inputTokens ?? 0) + (u.inputTokens ?? 0), outputTokens: (a.outputTokens ?? 0) + (u.outputTokens ?? 0) }), { ...used[0]!, inputTokens: 0, outputTokens: 0 });
      await recordTokens(ent.usageKey, total, now);
    } catch { /* metering never fails the work */ }
  }
  return value;
}
