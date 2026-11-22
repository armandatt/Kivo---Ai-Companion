// ─── An account's four allowances, for the billing page ──────────────────────
// Read-only: what each allowance holds, what is used and left, and when it
// renews (or that it is a lifetime allowance). Units are the learner's own:
// credits, tasks, calls, bytes — never tokens.

import { noteImageBytesForAccount } from "../../nova/product/note-images";
import { draftFileBytesForAccount } from "../../nova/product/builder";
import { balancesOf } from "./ledger";
import { mcpAllowanceOf, type McpAllowanceView } from "./mcp";
import type { Tier } from "./rules";
import { accountingMode, enforcing, targetFor, type AccountingMode } from "./targets";

export interface Allowance { used: number; limit: number | null; remaining: number | null; resetsAt: string | null }
export interface UsageView {
  mode:     AccountingMode;
  enforced: { nova: boolean; browser: boolean; mcp: boolean; storage: boolean };
  tier:     Tier;
  nova:     Allowance;
  browser:  Allowance;
  mcp:      McpAllowanceView;
  storage:  { usedBytes: number; limitBytes: number; remainingBytes: number };
}

const left = (used: number, limit: number | null) => (limit === null ? null : Math.max(0, limit - used));

export async function usageViewFor(userId: string, now = new Date()): Promise<UsageView> {
  const accountKey = `user:${userId}`;
  const [nova, browser, storageT] = await Promise.all([
    targetFor(accountKey, "nova_credits", now), targetFor(accountKey, "browser_tasks", now), targetFor(accountKey, "storage_bytes", now),
  ]);
  const [b, mcp, images, files] = await Promise.all([
    balancesOf(accountKey, [{ product: "nova_credits", periodKey: nova.period.key }, { product: "browser_tasks", periodKey: browser.period.key }]),
    mcpAllowanceOf(userId, now),
    noteImageBytesForAccount(userId),
    draftFileBytesForAccount(userId),
  ]);
  // Held in reservations counts as used: it is not available.
  const novaUsed = (b.get(`nova_credits|${nova.period.key}`)?.committed ?? 0) + (b.get(`nova_credits|${nova.period.key}`)?.reserved ?? 0);
  const tasksUsed = (b.get(`browser_tasks|${browser.period.key}`)?.committed ?? 0) + (b.get(`browser_tasks|${browser.period.key}`)?.reserved ?? 0);
  const usedBytes = images + files;
  const limitBytes = storageT.limit ?? 0;
  return {
    mode: accountingMode(),
    enforced: { nova: enforcing("nova_credits"), browser: enforcing("browser_tasks"), mcp: enforcing("mcp_calls"), storage: enforcing("storage_bytes") },
    tier: nova.tier,
    nova:    { used: novaUsed, limit: nova.limit, remaining: left(novaUsed, nova.limit), resetsAt: nova.period.end?.toISOString() ?? null },
    browser: { used: tasksUsed, limit: browser.limit, remaining: left(tasksUsed, browser.limit), resetsAt: browser.period.end?.toISOString() ?? null },
    mcp,
    storage: { usedBytes, limitBytes, remainingBytes: Math.max(0, limitBytes - usedBytes) },
  };
}
