// ─── MCP tool calls on the ledger (shadow) ────────────────────────────────────
// Every `tools/call` that reached a tool (the token was valid, the account
// ready) is recorded here by the MCP server (apps/api/lib/connect/mcp.ts),
// server-side: nothing the client says about its own usage is read.
// `initialize`, `tools/list` and refusals before a tool runs are not calls.
//
// One call = one unit on the account's lifetime balance (`mcp_calls`,
// "lifetime", never reset), whatever the tier. After Free's lifetime
// allowance, a read also counts on the month's read-only balance
// (`mcp_read_only`) and a write is what enforcement would refuse. Batch
// items are counted beside, as abuse units. Nothing is refused in Phase 1.
//
// The two balances are read and changed in one transaction, under a lock on
// the lifetime row, so concurrent calls see each other's counts.

import { randomUUID } from "crypto";
import { prisma } from "@repo/db/client";
import { runWithoutWriteSignal } from "@repo/db/write-signal";
import { classifyMcpCall } from "../../connect/usage-class";
import { appendLedger, balancesOf, bumpBalance, ensureBalance } from "./ledger";
import { hitLimit } from "./limiter";
import { fairUse, mcpDecision, type McpRefusal, type Tier } from "./rules";
import { accountingFault, accountingMode, enforcing, targetFor } from "./targets";

export interface McpCallRecord {
  userId:  string;
  grantId: string;
  tool:    string;
  args:    Record<string, unknown> | null | undefined;
  outcome?: string;
  now?:    Date;
  callId?: string;               // tests; otherwise the call's idempotency key, or a new id
}

// What the account has of its MCP allowance, for the assistant and the page.
export interface McpAllowanceView {
  tier:             Tier;
  lifetimeUsed:     number;
  lifetimeLimit:    number | null;     // null: no fixed quota (fair use)
  readOnly:         boolean;           // Free after its lifetime allowance: reads only
  readOnlyUsed:     number | null;
  readOnlyLimit:    number | null;
  readOnlyResetsAt: string | null;
}

export type McpRefusalCode = McpRefusal | "mcp_rate_limited";
export interface McpCallAccounted {
  admitted:      boolean;
  refusal:       McpRefusalCode | null;
  // Enforcement off: what it would have answered.
  shadowRefusal: McpRefusal | null;
  kind:          "read" | "write";
  items:         number;
  classified:    boolean;
  duplicate:     boolean;
  retryAfterSeconds?: number;
  allowance:     McpAllowanceView;
  // Phase 1 fields, kept for its callers.
  lifetime:      number;
  readOnly:      number | null;
}

// One tools/call, before the tool runs: counted on the lifetime balance (and,
// after Free's lifetime allowance, a read on the month's read-only balance),
// and — enforcing (USAGE_ACCOUNTING=enforce, mcp_calls) — refused when it may
// not run: a write after Free's lifetime allowance (whichever tool, batch,
// preview or plan carries it: every tool not classed read is a write), a read
// past the month's read-only calls, or traffic past fair use. A refused call
// counts nothing. A call carrying an idempotency key is counted once however
// often it is retried. The transition at 2,000 is decided under a lock on the
// lifetime row, so concurrent calls cannot all slip in at once.
// A fault in accounting admits the call.
export async function admitMcpCall(c: McpCallRecord): Promise<McpCallAccounted> {
  const cls = classifyMcpCall(c.tool, c.args);
  const open: McpCallAccounted = {
    admitted: true, refusal: null, shadowRefusal: null, kind: cls.kind, items: cls.items, classified: cls.classified, duplicate: false,
    allowance: { tier: "free", lifetimeUsed: 0, lifetimeLimit: null, readOnly: false, readOnlyUsed: null, readOnlyLimit: null, readOnlyResetsAt: null },
    lifetime: 0, readOnly: null,
  };
  if (accountingMode() === "off") return open;
  if (!cls.classified) console.warn(JSON.stringify({ layer: "usage_accounting", event: "mcp_unclassified_tool", tool: c.tool }));
  const enforce = enforcing("mcp_calls");
  try {
    const now = c.now ?? new Date();
    const accountKey = `user:${c.userId}`;
    const life = await targetFor(accountKey, "mcp_calls", now);
    const ro = await targetFor(accountKey, "mcp_read_only", now);

    // Fair use, every tier (persistent; enforced only).
    if (enforce) {
      const fair = fairUse();
      const checks = [
        await hitLimit(`mcp-grant:${c.grantId}`, fair.mcpCallsPerMinute, 60_000, now),
        await hitLimit(`mcp-day:${accountKey}`, fair.mcpCallsPerDay, 86_400_000, now),
      ];
      if (cls.items > 1) checks.push(await hitLimit(`mcp-items:${accountKey}`, fair.mcpItemsPerDay, 86_400_000, now));
      const over = checks.find(h => !h.allowed);
      if (over) return { ...open, admitted: false, refusal: "mcp_rate_limited", retryAfterSeconds: over.retryAfterSeconds, allowance: { ...open.allowance, tier: life.tier, lifetimeLimit: life.limit } };
    }

    const idem = typeof c.args?.idempotencyKey === "string" && c.args.idempotencyKey ? `idem:${c.tool}:${String(c.args.idempotencyKey).slice(0, 120)}` : null;
    const callId = c.callId ? `call:${c.callId}` : idem ?? `call:${randomUUID()}`;
    const detail = `${c.tool}:${cls.kind}${cls.classified ? "" : ":unclassified"}`;

    return await runWithoutWriteSignal("usage-accounting", () => prisma.$transaction(async tx => {
      await ensureBalance(tx, life);
      const [row] = await tx.$queryRaw<{ committedUnits: bigint }[]>`
        SELECT "committedUnits" FROM "UsageBalance" WHERE "accountKey" = ${accountKey} AND product = 'mcp_calls' AND "periodKey" = 'lifetime' FOR UPDATE`;
      const lifetimeBefore = Number(row?.committedUnits ?? 0);
      let readOnlyBefore = 0;
      const pastLifetime = life.limit !== null && lifetimeBefore >= life.limit;
      if (pastLifetime) {
        await ensureBalance(tx, ro);
        const [r] = await tx.$queryRaw<{ committedUnits: bigint }[]>`
          SELECT "committedUnits" FROM "UsageBalance" WHERE "accountKey" = ${accountKey} AND product = 'mcp_read_only' AND "periodKey" = ${ro.period.key}`;
        readOnlyBefore = Number(r?.committedUnits ?? 0);
      }
      const d = mcpDecision({ tier: life.tier, kind: cls.kind, lifetimeBefore, readOnlyBefore });
      const view = (lifetimeUsed: number, readOnlyUsed: number | null): McpAllowanceView => ({
        tier: life.tier, lifetimeUsed, lifetimeLimit: life.limit,
        readOnly: life.limit !== null && lifetimeUsed >= life.limit,
        readOnlyUsed: life.limit !== null && lifetimeUsed >= life.limit ? (readOnlyUsed ?? readOnlyBefore) : null,
        readOnlyLimit: life.limit !== null ? ro.limit : null,
        readOnlyResetsAt: life.limit !== null ? ro.period.end?.toISOString() ?? null : null,
      });

      if (enforce && d.refusal) {
        // Refused: nothing counted; the refusal itself is on the ledger (units 0).
        await appendLedger(tx, life, { entry: "record", units: 0, committed: 0, items: 0, feature: "mcp", detail, reason: "refused", key: `${callId}:refused:${randomUUID()}`, shadowRefusal: d.refusal, mode: "enforce" });
        await bumpBalance(tx, d.refusal === "mcp_read_only_allowance_exhausted" ? ro : life, { refusals: 1 });
        const v = view(lifetimeBefore, readOnlyBefore);
        return { ...open, admitted: false, refusal: d.refusal, shadowRefusal: null, allowance: v, lifetime: lifetimeBefore, readOnly: v.readOnlyUsed };
      }

      const mode = enforce ? "enforce" as const : "shadow" as const;
      const shadow = enforce ? null : d.refusal;
      const common = { units: 1, items: cls.items, feature: "mcp", detail, reason: c.outcome && c.outcome !== "ok" ? `tool_call_${c.outcome}`.slice(0, 60) : "tool_call", shadowRefusal: shadow, mode };
      const fresh = await appendLedger(tx, life, { ...common, entry: "record", committed: 1, key: callId });
      if (!fresh) {
        // The same call again (its idempotency key): admitted, counted once.
        const v = view(lifetimeBefore, readOnlyBefore);
        return { ...open, duplicate: true, allowance: v, lifetime: lifetimeBefore, readOnly: v.readOnlyUsed };
      }
      const lifeAfter = await bumpBalance(tx, life, { committed: 1, items: cls.items, refusals: shadow === "mcp_lifetime_exhausted" ? 1 : 0 });
      let roAfter: number | null = null;
      if (d.countReadOnly) {
        await appendLedger(tx, ro, { ...common, entry: "record", committed: 1, key: callId });
        roAfter = (await bumpBalance(tx, ro, { committed: 1, items: cls.items, refusals: shadow === "mcp_read_only_allowance_exhausted" ? 1 : 0 })).committed;
      }
      const v = view(lifeAfter.committed, roAfter);
      return { ...open, shadowRefusal: shadow, allowance: v, lifetime: lifeAfter.committed, readOnly: roAfter };
    }));
  } catch (err) {
    accountingFault("mcp.admit", err);
    return open;
  }
}

// Phase 1's name (record a call; in shadow it never refuses).
export async function recordMcpCall(c: McpCallRecord): Promise<McpCallAccounted | null> {
  if (accountingMode() === "off") return null;
  return admitMcpCall(c);
}

// The account's MCP allowance as it stands, without counting a call.
export async function mcpAllowanceOf(userId: string, now = new Date()): Promise<McpAllowanceView> {
  const accountKey = `user:${userId}`;
  const life = await targetFor(accountKey, "mcp_calls", now);
  const ro = await targetFor(accountKey, "mcp_read_only", now);
  const b = await balancesOf(accountKey, [{ product: "mcp_calls", periodKey: "lifetime" }, { product: "mcp_read_only", periodKey: ro.period.key }]);
  const used = b.get("mcp_calls|lifetime")?.committed ?? 0;
  const past = life.limit !== null && used >= life.limit;
  return {
    tier: life.tier, lifetimeUsed: used, lifetimeLimit: life.limit, readOnly: past,
    readOnlyUsed: past ? (b.get(`mcp_read_only|${ro.period.key}`)?.committed ?? 0) : null,
    readOnlyLimit: life.limit !== null ? ro.limit : null,
    readOnlyResetsAt: life.limit !== null ? ro.period.end?.toISOString() ?? null : null,
  };
}
