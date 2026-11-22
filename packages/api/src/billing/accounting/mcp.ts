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
import { appendLedger, bumpBalance, ensureBalance } from "./ledger";
import { mcpDecision, type McpRefusal } from "./rules";
import { accountingFault, accountingMode, targetFor } from "./targets";

export interface McpCallRecord {
  userId:  string;
  grantId: string;
  tool:    string;
  args:    Record<string, unknown> | null | undefined;
  outcome: string;               // "ok" or the tool's error code
  now?:    Date;
  callId?: string;               // tests; otherwise a new id per call
}

export interface McpCallAccounted { kind: "read" | "write"; items: number; lifetime: number; readOnly: number | null; shadowRefusal: McpRefusal | null; classified: boolean }

export async function recordMcpCall(c: McpCallRecord): Promise<McpCallAccounted | null> {
  if (accountingMode() === "off") return null;
  try {
    const now = c.now ?? new Date();
    const accountKey = `user:${c.userId}`;
    const cls = classifyMcpCall(c.tool, c.args);
    if (!cls.classified) console.warn(JSON.stringify({ layer: "usage_accounting", event: "mcp_unclassified_tool", tool: c.tool }));
    const life = await targetFor(accountKey, "mcp_calls", now);
    const ro = await targetFor(accountKey, "mcp_read_only", now);
    const callId = c.callId ?? randomUUID();
    const detail = `${c.tool}:${cls.kind}${cls.classified ? "" : ":unclassified"}`;
    return await runWithoutWriteSignal("usage-accounting", () => prisma.$transaction(async tx => {
      await ensureBalance(tx, life);
      const [row] = await tx.$queryRaw<{ committedUnits: bigint }[]>`
        SELECT "committedUnits" FROM "UsageBalance" WHERE "accountKey" = ${accountKey} AND product = 'mcp_calls' AND "periodKey" = 'lifetime' FOR UPDATE`;
      const lifetimeBefore = Number(row?.committedUnits ?? 0);
      let readOnlyBefore = 0;
      const needsRo = life.limit !== null && lifetimeBefore >= life.limit;
      if (needsRo) {
        await ensureBalance(tx, ro);
        const [r] = await tx.$queryRaw<{ committedUnits: bigint }[]>`
          SELECT "committedUnits" FROM "UsageBalance" WHERE "accountKey" = ${accountKey} AND product = 'mcp_read_only' AND "periodKey" = ${ro.period.key}`;
        readOnlyBefore = Number(r?.committedUnits ?? 0);
      }
      const d = mcpDecision({ tier: life.tier, kind: cls.kind, lifetimeBefore, readOnlyBefore });
      const common = { units: 1, items: cls.items, feature: "mcp", detail, reason: c.outcome === "ok" ? "tool_call" : `tool_call_${c.outcome}`.slice(0, 60), shadowRefusal: d.refusal };
      const fresh = await appendLedger(tx, life, { ...common, entry: "record", committed: 1, key: `call:${callId}` });
      if (!fresh) return null;
      const lifeAfter = await bumpBalance(tx, life, { committed: 1, items: cls.items, refusals: d.refusal === "mcp_lifetime_exhausted" ? 1 : 0 });
      let roAfter: number | null = null;
      if (d.countReadOnly) {
        await appendLedger(tx, ro, { ...common, entry: "record", committed: 1, key: `call:${callId}` });
        roAfter = (await bumpBalance(tx, ro, { committed: 1, items: cls.items, refusals: d.refusal === "mcp_read_only_allowance_exhausted" ? 1 : 0 })).committed;
      }
      return { kind: cls.kind, items: cls.items, lifetime: lifeAfter.committed, readOnly: roAfter, shadowRefusal: d.refusal, classified: cls.classified };
    }));
  } catch (err) {
    accountingFault("mcp.record", err);
    return null;
  }
}
