// ─── Shadow report: the new balances beside the old daily meter ──────────────
// Read-only. For a range of days: the old meter's counted requests and the
// new Nova credits per account, browser tasks with their outcomes and cost,
// MCP calls by tool and kind, Kivo-funded and system cost, what enforcement
// would have refused, reservations still open, and coverage (does the ledger
// hold the cost of every model call the usage events recorded?). Accounts are
// shown by a short opaque label, never by id. Run by
// scripts/usageShadowReport.ts; the Phase 2 gate reads it.

import { createHash } from "crypto";
import { prisma } from "@repo/db/client";
import { requestsBySubject } from "../usage";
import { costByFeature, costByFeatureSurface, interactionsInRange } from "../usage-events";
import { allowanceVersion, browserTaskCostTargetMicros, creditRateVersion } from "./rules";

const label = (accountKey: string) => `${accountKey.split(":")[0]}#${createHash("sha256").update(accountKey).digest("hex").slice(0, 8)}`;
const num = (v: unknown) => Number(v ?? 0);
const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]!;
};

export async function shadowReport(from: Date, to: Date) {
  const fromDay = from.toISOString().slice(0, 10), toDay = new Date(to.getTime() - 1).toISOString().slice(0, 10);

  // Old meter vs Nova credits, per account.
  const old = await requestsBySubject(fromDay, toDay);
  const credits = await prisma.$queryRaw<Array<{ accountKey: string; units: bigint; cost: bigint; n: bigint }>>`
    SELECT "accountKey", COALESCE(SUM("committedUnits"),0)::bigint AS units, COALESCE(SUM("costMicros"),0)::bigint AS cost, COUNT(*) AS n
    FROM "UsageLedger" WHERE product = 'nova_credits' AND entry IN ('commit','record','refund') AND "createdAt" >= ${from} AND "createdAt" < ${to}
    GROUP BY 1`;
  const accounts = new Set([...old.keys(), ...credits.map(c => c.accountKey)]);
  const byAccount = [...accounts].map(k => {
    const c = credits.find(x => x.accountKey === k);
    return { account: label(k), oldRequests: old.get(k) ?? 0, novaCredits: num(c?.units), novaCostUsd: num(c?.cost) / 1e6, settlements: num(c?.n) };
  }).sort((a, b) => b.novaCredits - a.novaCredits);

  const settle = await prisma.$queryRaw<Array<{ entry: string; reason: string; n: bigint; units: bigint; cost: bigint }>>`
    SELECT entry, reason, COUNT(*) AS n, COALESCE(SUM(units),0)::bigint AS units, COALESCE(SUM("costMicros"),0)::bigint AS cost
    FROM "UsageLedger" WHERE product = 'nova_credits' AND entry <> 'reserve' AND "createdAt" >= ${from} AND "createdAt" < ${to}
    GROUP BY 1, 2 ORDER BY 3 DESC`;

  // Browser tasks.
  const tasks = await prisma.$queryRaw<Array<{ state: string; reason: string | null; cost: bigint }>>`
    SELECT state, reason, "costMicros" AS cost FROM "UsageReservation"
    WHERE product = 'browser_tasks' AND "createdAt" >= ${from} AND "createdAt" < ${to}`;
  const taskCosts = tasks.filter(t => t.state === "committed").map(t => num(t.cost));
  const taskOutcomes: Record<string, number> = {};
  for (const t of tasks) { const k = `${t.state}:${t.reason ?? "-"}`; taskOutcomes[k] = (taskOutcomes[k] ?? 0) + 1; }

  // MCP.
  const mcp = await prisma.$queryRaw<Array<{ detail: string | null; calls: bigint; items: bigint; refusals: bigint; accounts: bigint }>>`
    SELECT detail, COUNT(*) AS calls, COALESCE(SUM(items),0)::bigint AS items, COUNT("shadowRefusal") AS refusals, COUNT(DISTINCT "accountKey") AS accounts
    FROM "UsageLedger" WHERE product = 'mcp_calls' AND "createdAt" >= ${from} AND "createdAt" < ${to} GROUP BY 1 ORDER BY 2 DESC`;
  const mcpPerAccount = (await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n FROM "UsageLedger" WHERE product = 'mcp_calls' AND "createdAt" >= ${from} AND "createdAt" < ${to} GROUP BY "accountKey"`).map(r => num(r.n));
  const mcpLifetime = (await prisma.$queryRaw<Array<{ committedUnits: bigint }>>`
    SELECT "committedUnits" FROM "UsageBalance" WHERE product = 'mcp_calls' AND "periodKey" = 'lifetime'`).map(r => num(r.committedUnits));

  // Kivo-funded and system work.
  const unmetered = await prisma.$queryRaw<Array<{ product: string; feature: string | null; n: bigint; cost: bigint }>>`
    SELECT product, feature, COUNT(*) AS n, COALESCE(SUM("costMicros"),0)::bigint AS cost FROM "UsageLedger"
    WHERE product IN ('kivo_funded','system') AND "createdAt" >= ${from} AND "createdAt" < ${to} GROUP BY 1, 2 ORDER BY 4 DESC`;

  // What enforcement would have refused.
  const refusals = await prisma.$queryRaw<Array<{ product: string; shadowRefusal: string; n: bigint; accounts: bigint }>>`
    SELECT product, "shadowRefusal", COUNT(*) AS n, COUNT(DISTINCT "accountKey") AS accounts FROM "UsageLedger"
    WHERE "shadowRefusal" IS NOT NULL AND "createdAt" >= ${from} AND "createdAt" < ${to} GROUP BY 1, 2`;

  const open = await prisma.$queryRaw<Array<{ product: string; open: bigint; stale: bigint }>>`
    SELECT product, COUNT(*) AS open, COUNT(*) FILTER (WHERE "expiresAt" < now()) AS stale FROM "UsageReservation" WHERE state = 'reserved' GROUP BY 1`;

  const storage = (await prisma.$queryRaw<Array<{ committedUnits: bigint; limitUnits: bigint | null }>>`
    SELECT "committedUnits", "limitUnits" FROM "UsageBalance" WHERE product = 'storage_bytes'`).map(r => ({ bytes: num(r.committedUnits), over: r.limitUnits !== null && num(r.committedUnits) > num(r.limitUnits) }));

  // Coverage: model cost on the ledger vs model cost in the usage events.
  const events = await costByFeature(from, to);
  const eventCost = events.reduce((a, e) => a + e.costMicros, 0);
  const [ledgerCost] = await prisma.$queryRaw<Array<{ cost: bigint }>>`
    SELECT COALESCE(SUM("costMicros"),0)::bigint AS cost FROM "UsageLedger"
    WHERE product IN ('nova_credits','browser_tasks','kivo_funded','system') AND entry <> 'reserve' AND "createdAt" >= ${from} AND "createdAt" < ${to}`;

  // Every usage event's interaction should have reached the ledger: as a Nova
  // reservation's interaction, a settlement's detail, or a record's key.
  const interactions = await interactionsInRange(from, to);
  const settled = new Set<string>();
  const refs = await prisma.$queryRaw<Array<{ ref: string | null }>>`
    SELECT ref FROM "UsageReservation" WHERE product = 'nova_credits' AND "createdAt" >= ${new Date(from.getTime() - 3_600_000)} AND "createdAt" < ${to}`;
  for (const r of refs) if (r.ref) settled.add(r.ref);
  const marks = await prisma.$queryRaw<Array<{ idempotencyKey: string; detail: string | null }>>`
    SELECT "idempotencyKey", detail FROM "UsageLedger" WHERE "createdAt" >= ${from} AND "createdAt" < ${new Date(to.getTime() + 3_600_000)}
      AND product IN ('nova_credits','browser_tasks','kivo_funded','system')`;
  for (const m of marks) {
    if (m.detail?.startsWith("interaction:")) settled.add(m.detail.slice(12));
    const k = m.idempotencyKey.split("|").slice(2, -1).join("|");
    if (k.startsWith("interaction:")) settled.add(k.slice(12));
    const step = k.match(/:cost:(.+):\d+$/) ?? k.match(/^(.+):\d+$/);
    if (step) settled.add(step[1]!);
  }
  const missing = interactions.filter(i => !settled.has(i.interactionId));
  const missingByFeature: Record<string, number> = {};
  for (const m of missing) missingByFeature[`${m.feature}/${m.surface}`] = (missingByFeature[`${m.feature}/${m.surface}`] ?? 0) + 1;

  // A reservation settled twice would be a duplicate charge or refund.
  const duplicates = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n FROM (SELECT "reservationId" FROM "UsageLedger" WHERE entry IN ('commit','refund') AND "reservationId" IS NOT NULL
      AND "createdAt" >= ${from} AND "createdAt" < ${to} GROUP BY "reservationId" HAVING COUNT(*) > 1) d`;

  // Free's monthly read-only MCP calls, this month.
  const readOnly = (await prisma.$queryRaw<Array<{ committedUnits: bigint }>>`
    SELECT "committedUnits" FROM "UsageBalance" WHERE product = 'mcp_read_only' AND "periodStart" <= ${to} AND "periodEnd" > ${new Date(to.getTime() - 1)}`).map(r => num(r.committedUnits));

  const novaBySurface = (await costByFeatureSurface(from, to)).map(r => ({ ...r, costUsd: r.costMicros / 1e6 }));
  const coverageRatio = eventCost > 0 ? num(ledgerCost?.cost) / eventCost : 1;
  const staleOpen = open.reduce((a, o) => a + num(o.stale), 0);

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    // Pass/fail at a glance (the gate in docs/USAGE_ACCOUNTING.md reads these).
    checks: {
      coverageAtLeast99pct: coverageRatio >= 0.99,
      coverageRatio: Math.round(coverageRatio * 10_000) / 10_000,
      interactions: interactions.length,
      interactionsWithoutSettlement: missing.length,
      duplicateSettlements: num(duplicates[0]?.n),
      staleReservations: staleOpen,
      browserTasksOverCostTarget: taskCosts.filter(c => c > browserTaskCostTargetMicros()).length,
    },
    missingSettlements: { byFeature: missingByFeature, sample: missing.slice(0, 20).map(m => ({ feature: m.feature, surface: m.surface, costUsd: m.costMicros / 1e6 })) },
    novaCostBySurface: novaBySurface,
    mcpReadOnlyThisMonth: { accounts: readOnly.length, p50: pct(readOnly, 0.5), max: pct(readOnly, 1), atLimit: readOnly.filter(x => x >= 100).length },
    versions: { credits: creditRateVersion(), allowances: allowanceVersion() },
    nova: {
      accounts: byAccount.length,
      totals: { oldRequests: byAccount.reduce((a, r) => a + r.oldRequests, 0), credits: byAccount.reduce((a, r) => a + r.novaCredits, 0) },
      creditsPerAccount: { p50: pct(byAccount.map(r => r.novaCredits), 0.5), p95: pct(byAccount.map(r => r.novaCredits), 0.95), max: pct(byAccount.map(r => r.novaCredits), 1) },
      byAccount,
      settlements: settle.map(s => ({ entry: s.entry, reason: s.reason, count: num(s.n), units: num(s.units), costUsd: num(s.cost) / 1e6 })),
    },
    browser: {
      tasks: tasks.length, outcomes: taskOutcomes,
      committedCostUsd: { p50: (pct(taskCosts, 0.5) ?? 0) / 1e6, p75: (pct(taskCosts, 0.75) ?? 0) / 1e6, p95: (pct(taskCosts, 0.95) ?? 0) / 1e6, max: (pct(taskCosts, 1) ?? 0) / 1e6 },
      // The $0.03 target (rules.ts): tasks that passed it, and by how much in total.
      costTargetUsd: browserTaskCostTargetMicros() / 1e6,
      overTarget: taskCosts.filter(c => c > browserTaskCostTargetMicros()).length,
      overTargetExcessUsd: taskCosts.reduce((a, c) => a + Math.max(0, c - browserTaskCostTargetMicros()), 0) / 1e6,
    },
    mcp: {
      byTool: mcp.map(m => ({ tool: m.detail, calls: num(m.calls), items: num(m.items), shadowRefusals: num(m.refusals), accounts: num(m.accounts) })),
      callsPerAccount: { p50: pct(mcpPerAccount, 0.5), p95: pct(mcpPerAccount, 0.95), max: pct(mcpPerAccount, 1) },
      lifetime: { accounts: mcpLifetime.length, max: pct(mcpLifetime, 1), over2000: mcpLifetime.filter(x => x >= 2_000).length },
    },
    unmetered: unmetered.map(u => ({ product: u.product, feature: u.feature, count: num(u.n), costUsd: num(u.cost) / 1e6 })),
    shadowRefusals: refusals.map(r => ({ product: r.product, refusal: r.shadowRefusal, count: num(r.n), accounts: num(r.accounts) })),
    openReservations: open.map(o => ({ product: o.product, open: num(o.open), stale: num(o.stale) })),
    storage: { accounts: storage.length, maxBytes: pct(storage.map(s => s.bytes), 1), over: storage.filter(s => s.over).length },
    coverage: { eventCostUsd: eventCost / 1e6, ledgerCostUsd: num(ledgerCost?.cost) / 1e6, byFeature: events.map(e => ({ ...e, costUsd: e.costMicros / 1e6 })) },
  };
}
