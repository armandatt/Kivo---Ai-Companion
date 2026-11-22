// ─── The usage ledger: reserve → commit or refund, record, gauge ─────────────
// The only code that writes UsageBalance, UsageReservation and UsageLedger
// (with the reports in report.ts, which read them). Every change is one
// transaction:
//   - the ledger entry first, under a unique idempotency key per transition,
//     so a retried write changes nothing;
//   - the balance changed by one guarded UPDATE, so concurrent requests cannot
//     pass an allowance together (Postgres re-checks the condition on the row
//     it locks);
//   - a reservation moves out of `reserved` exactly once (guarded on its state).
// Enforcement (`mode: "enforce"`) refuses a reservation that would go over the
// limit; shadow mode (Phase 1, the only mode any caller uses) never refuses
// and records what enforcement would have said.
//
// These writes are not a reason for the scheduler to wake (runWithoutWriteSignal):
// they change nothing it schedules, and every AI or MCP call would otherwise
// force its next full run, keeping Neon's compute awake.

import { randomUUID } from "crypto";
import { prisma } from "@repo/db/client";
import { runWithoutWriteSignal } from "@repo/db/write-signal";
import { RESERVATION_TTL_MS, DEFAULT_RESERVATION_TTL_MS, type Period, type Product, type Tier } from "./rules";

export type Mode = "shadow" | "enforce";
type Tx = Pick<typeof prisma, "$queryRaw" | "$executeRaw">;

// Which balance an entry changes, and the allowance it is measured against.
export interface Target {
  accountKey: string;
  product:    Product;
  period:     Period;
  tier:       Tier;
  limit:      number | null;
}

export type RefusalCode =
  | "nova_allowance_exhausted" | "browser_allowance_exhausted" | "storage_allowance_exhausted"
  | "mcp_lifetime_exhausted" | "mcp_read_only_allowance_exhausted";

export function refusalFor(product: Product): RefusalCode | null {
  switch (product) {
    case "nova_credits":  return "nova_allowance_exhausted";
    case "browser_tasks": return "browser_allowance_exhausted";
    case "storage_bytes": return "storage_allowance_exhausted";
    case "mcp_calls":     return "mcp_lifetime_exhausted";
    case "mcp_read_only": return "mcp_read_only_allowance_exhausted";
    default:              return null;
  }
}

const quiet = <T>(work: () => Promise<T>) => runWithoutWriteSignal("usage-accounting", work);
const n = (v: unknown) => Number(v ?? 0);
const entryKey = (t: Pick<Target, "accountKey" | "product">, key: string, entry: string) => `${t.accountKey}|${t.product}|${key}|${entry}`;

// ── Low-level steps, for callers that combine several in one transaction ──

// The balance row for a target, made once (two first writes at once: one
// makes it, the other finds it). The tier and limit are refreshed on each
// touch, so a plan change shows on the next write.
export async function ensureBalance(tx: Tx, t: Target): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "UsageBalance" (id, "accountKey", product, "periodKey", "periodStart", "periodEnd", tier, "limitUnits", "updatedAt")
    VALUES (${randomUUID()}, ${t.accountKey}, ${t.product}, ${t.period.key}, ${t.period.start}, ${t.period.end}, ${t.tier}, ${t.limit === null ? null : BigInt(t.limit)}, now())
    ON CONFLICT ("accountKey", product, "periodKey")
    DO UPDATE SET tier = EXCLUDED.tier, "limitUnits" = EXCLUDED."limitUnits", "updatedAt" = now()`;
}

export interface LedgerEntry {
  entry:          "reserve" | "commit" | "refund" | "record" | "gauge";
  units:          number;
  reserved?:      number;
  committed?:     number;
  refunded?:      number;
  costMicros?:    number;
  items?:         number;
  feature?:       string | null;
  detail?:        string | null;
  reason:         string;
  key:            string;           // unique per transition, within the target
  reservationId?: string | null;
  shadowRefusal?: string | null;
  mode?:          Mode;
  rateVersion?:   string | null;
}

// Appends one entry. false: an entry with this key exists (a retry).
export async function appendLedger(tx: Tx, t: Pick<Target, "accountKey" | "product" | "period">, e: LedgerEntry): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "UsageLedger" (id, "accountKey", product, "periodKey", entry, units, "reservedUnits", "committedUnits", "refundedUnits",
      "costMicros", items, feature, detail, reason, "idempotencyKey", "reservationId", "shadowRefusal", mode, "rateVersion")
    VALUES (${randomUUID()}, ${t.accountKey}, ${t.product}, ${t.period.key}, ${e.entry}, ${BigInt(Math.round(e.units))},
      ${BigInt(Math.round(e.reserved ?? 0))}, ${BigInt(Math.round(e.committed ?? 0))}, ${BigInt(Math.round(e.refunded ?? 0))},
      ${BigInt(Math.round(e.costMicros ?? 0))}, ${Math.round(e.items ?? 0)}, ${e.feature ?? null}, ${e.detail ?? null}, ${e.reason},
      ${entryKey(t, e.key, e.entry)}, ${e.reservationId ?? null}, ${e.shadowRefusal ?? null}, ${e.mode ?? "shadow"}, ${e.rateVersion ?? null})
    ON CONFLICT ("idempotencyKey") DO NOTHING
    RETURNING id`;
  return rows.length === 1;
}

// Adds to a balance and returns it as it now stands.
export async function bumpBalance(tx: Tx, t: Pick<Target, "accountKey" | "product" | "period">, d: { reserved?: number; committed?: number; refunded?: number; costMicros?: number; items?: number; refusals?: number }) {
  const rows = await tx.$queryRaw<{ reservedUnits: bigint; committedUnits: bigint; limitUnits: bigint | null }[]>`
    UPDATE "UsageBalance" SET
      "reservedUnits"  = "reservedUnits"  + ${BigInt(Math.round(d.reserved ?? 0))},
      "committedUnits" = "committedUnits" + ${BigInt(Math.round(d.committed ?? 0))},
      "refundedUnits"  = "refundedUnits"  + ${BigInt(Math.round(d.refunded ?? 0))},
      "costMicros"     = "costMicros"     + ${BigInt(Math.round(d.costMicros ?? 0))},
      items            = items            + ${BigInt(Math.round(d.items ?? 0))},
      "shadowRefusals" = "shadowRefusals" + ${Math.round(d.refusals ?? 0)},
      "updatedAt" = now()
    WHERE "accountKey" = ${t.accountKey} AND product = ${t.product} AND "periodKey" = ${t.period.key}
    RETURNING "reservedUnits", "committedUnits", "limitUnits"`;
  const r = rows[0];
  return { reserved: n(r?.reservedUnits), committed: n(r?.committedUnits), limit: r?.limitUnits === null || r === undefined ? null : n(r.limitUnits) };
}

// ── Reserve ──

export type Reservation =
  | { ok: true; reservationId: string; duplicate: boolean; state: string; shadowRefusal: RefusalCode | null }
  | { ok: false; refusal: RefusalCode; used: number; limit: number };

class Refused extends Error { constructor(readonly refusal: RefusalCode, readonly used: number, readonly limit: number) { super(refusal); } }

export async function reserve(t: Target, input: {
  units: number; idempotencyKey: string; feature?: string | null; ref?: string | null; reason?: string;
  ttlMs?: number; mode?: Mode; rateVersion?: string | null; now?: Date;
}): Promise<Reservation> {
  const mode = input.mode ?? "shadow";
  const units = Math.max(0, Math.round(input.units));
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + (input.ttlMs ?? RESERVATION_TTL_MS[t.product] ?? DEFAULT_RESERVATION_TTL_MS));
  try {
    return await quiet(() => prisma.$transaction(async tx => {
      await ensureBalance(tx, t);
      const id = randomUUID();
      const made = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO "UsageReservation" (id, "accountKey", product, "periodKey", "idempotencyKey", state, feature, ref, "reservedUnits", "expiresAt", "createdAt")
        VALUES (${id}, ${t.accountKey}, ${t.product}, ${t.period.key}, ${input.idempotencyKey}, 'reserved', ${input.feature ?? null}, ${input.ref ?? null}, ${BigInt(units)}, ${expiresAt}, ${now})
        ON CONFLICT ("accountKey", product, "idempotencyKey") DO NOTHING
        RETURNING id`;
      if (made.length === 0) {
        // The same work asked again: its reservation as it stands, nothing new held.
        const [existing] = await tx.$queryRaw<{ id: string; state: string; shadowRefusal: string | null }[]>`
          SELECT id, state, "shadowRefusal" FROM "UsageReservation"
          WHERE "accountKey" = ${t.accountKey} AND product = ${t.product} AND "idempotencyKey" = ${input.idempotencyKey}`;
        return { ok: true as const, reservationId: existing!.id, duplicate: true, state: existing!.state, shadowRefusal: (existing!.shadowRefusal as RefusalCode | null) };
      }

      let after: { reserved: number; committed: number };
      if (mode === "enforce" && t.limit !== null) {
        // The guarded write: only while what is used and held leaves room.
        const rows = await tx.$queryRaw<{ reservedUnits: bigint; committedUnits: bigint }[]>`
          UPDATE "UsageBalance" SET "reservedUnits" = "reservedUnits" + ${BigInt(units)}, "updatedAt" = now()
          WHERE "accountKey" = ${t.accountKey} AND product = ${t.product} AND "periodKey" = ${t.period.key}
            AND "committedUnits" + "reservedUnits" + ${BigInt(units)} <= ${BigInt(t.limit)}
          RETURNING "reservedUnits", "committedUnits"`;
        if (rows.length === 0) {
          const [b] = await tx.$queryRaw<{ reservedUnits: bigint; committedUnits: bigint }[]>`
            SELECT "reservedUnits", "committedUnits" FROM "UsageBalance" WHERE "accountKey" = ${t.accountKey} AND product = ${t.product} AND "periodKey" = ${t.period.key}`;
          throw new Refused(refusalFor(t.product)!, n(b?.committedUnits) + n(b?.reservedUnits), t.limit);
        }
        after = { reserved: n(rows[0]!.reservedUnits), committed: n(rows[0]!.committedUnits) };
      } else {
        const b = await bumpBalance(tx, t, { reserved: units });
        after = b;
      }

      // Shadow: what enforcement would have answered.
      const over = mode === "shadow" && t.limit !== null && after.committed + after.reserved > t.limit;
      const shadowRefusal = over ? refusalFor(t.product) : null;
      if (shadowRefusal) {
        await tx.$executeRaw`UPDATE "UsageReservation" SET "shadowRefusal" = ${shadowRefusal} WHERE id = ${id}`;
        await bumpBalance(tx, t, { refusals: 1 });
      }
      await appendLedger(tx, t, {
        entry: "reserve", units, reserved: units, feature: input.feature, reason: input.reason ?? "reserve",
        key: input.idempotencyKey, reservationId: id, shadowRefusal, mode, rateVersion: input.rateVersion,
      });
      return { ok: true as const, reservationId: id, duplicate: false, state: "reserved", shadowRefusal };
    }));
  } catch (err) {
    if (err instanceof Refused) return { ok: false, refusal: err.refusal, used: err.used, limit: err.limit };
    throw err;
  }
}

// ── Commit and refund: a reservation leaves `reserved` once ──

export type Settled = { applied: boolean; state: string | null };

async function settle(reservationId: string, outcome: "committed" | "refunded", input: {
  units: number; costMicros: number; reason: string; rateVersion?: string | null; now?: Date;
}): Promise<Settled> {
  const now = input.now ?? new Date();
  const units = Math.max(0, Math.round(input.units));
  const cost = Math.max(0, Math.round(input.costMicros));
  return quiet(() => prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ accountKey: string; product: string; periodKey: string; reservedUnits: bigint; feature: string | null; mode: string | null }[]>`
      UPDATE "UsageReservation" SET state = ${outcome}, "committedUnits" = ${BigInt(outcome === "committed" ? units : 0)},
        "costMicros" = "costMicros" + ${BigInt(cost)}, reason = ${input.reason}, "settledAt" = ${now}
      WHERE id = ${reservationId} AND state = 'reserved'
      RETURNING "accountKey", product, "periodKey", "reservedUnits", feature, NULL::text AS mode`;
    if (rows.length === 0) {
      const [cur] = await tx.$queryRaw<{ state: string }[]>`SELECT state FROM "UsageReservation" WHERE id = ${reservationId}`;
      return { applied: false, state: cur?.state ?? null };
    }
    const r = rows[0]!;
    const held = n(r.reservedUnits);
    const t = { accountKey: r.accountKey, product: r.product as Product, period: { key: r.periodKey, start: null, end: null } };
    await bumpBalance(tx, t, outcome === "committed"
      ? { reserved: -held, committed: units, costMicros: cost }
      : { reserved: -held, refunded: held, costMicros: cost });
    await appendLedger(tx, t, outcome === "committed"
      ? { entry: "commit", units, reserved: -held, committed: units, costMicros: cost, feature: r.feature, reason: input.reason, key: reservationId, reservationId, rateVersion: input.rateVersion }
      : { entry: "refund", units: held, reserved: -held, refunded: held, costMicros: cost, feature: r.feature, reason: input.reason, key: reservationId, reservationId, rateVersion: input.rateVersion });
    return { applied: true, state: outcome };
  }));
}

export const commit = (reservationId: string, input: { units: number; costMicros?: number; reason: string; rateVersion?: string | null; now?: Date }) =>
  settle(reservationId, "committed", { costMicros: 0, ...input });
export const refund = (reservationId: string, input: { reason: string; costMicros?: number; now?: Date }) =>
  settle(reservationId, "refunded", { units: 0, costMicros: input.costMicros ?? 0, reason: input.reason, now: input.now });

// Cost that arrives after a reservation was made or settled (a browser task's
// later steps): added to the reservation and its balance, never to its units.
// `key` names the cost (a step's interaction), so it is added once.
// Answers the reservation's cost before and after (null: nothing added, a
// repeat or no such reservation), so a crossing of a cost target is seen once.
export async function addCost(reservationId: string, input: { costMicros: number; key: string; reason: string; feature?: string | null }): Promise<{ before: number; after: number } | null> {
  const cost = Math.max(0, Math.round(input.costMicros));
  return quiet(() => prisma.$transaction(async tx => {
    const [r] = await tx.$queryRaw<{ accountKey: string; product: string; periodKey: string }[]>`
      SELECT "accountKey", product, "periodKey" FROM "UsageReservation" WHERE id = ${reservationId}`;
    if (!r) return null;
    const t = { accountKey: r.accountKey, product: r.product as Product, period: { key: r.periodKey, start: null, end: null } };
    const fresh = await appendLedger(tx, t, { entry: "record", units: 0, costMicros: cost, feature: input.feature, reason: input.reason, key: `${reservationId}:cost:${input.key}`, reservationId });
    if (!fresh) return null;
    const [row] = await tx.$queryRaw<{ costMicros: bigint }[]>`
      UPDATE "UsageReservation" SET "costMicros" = "costMicros" + ${BigInt(cost)} WHERE id = ${reservationId} RETURNING "costMicros"`;
    await bumpBalance(tx, t, { costMicros: cost });
    const after = n(row?.costMicros);
    return { before: after - cost, after };
  }));
}

// One more step under a reservation (a browser task's agent step); answers the
// count after it, so the step cap holds across restarts. null: no such reservation.
export async function countStep(reservationId: string): Promise<number | null> {
  return quiet(async () => {
    const rows = await prisma.$queryRaw<{ steps: number }[]>`
      UPDATE "UsageReservation" SET steps = steps + 1 WHERE id = ${reservationId} RETURNING steps`;
    return rows[0]?.steps ?? null;
  });
}

// Reservations of a product an account made since `since` that were not
// refunded (browser tasks still within their ticket's life).
export async function recentReservations(accountKey: string, product: Product, since: Date): Promise<number> {
  const rows = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*) AS c FROM "UsageReservation"
    WHERE "accountKey" = ${accountKey} AND product = ${product} AND "createdAt" >= ${since} AND state <> 'refunded'`;
  return n(rows[0]?.c);
}

// The balances of an account for a set of periods (the usage view).
export async function balancesOf(accountKey: string, keys: Array<{ product: Product; periodKey: string }>): Promise<Map<string, { reserved: number; committed: number; limit: number | null }>> {
  const out = new Map<string, { reserved: number; committed: number; limit: number | null }>();
  if (keys.length === 0) return out;
  const rows = await prisma.$queryRaw<{ product: string; periodKey: string; reservedUnits: bigint; committedUnits: bigint; limitUnits: bigint | null }[]>`
    SELECT product, "periodKey", "reservedUnits", "committedUnits", "limitUnits" FROM "UsageBalance"
    WHERE "accountKey" = ${accountKey} AND (product, "periodKey") IN (SELECT * FROM unnest(${keys.map(k => k.product)}::text[], ${keys.map(k => k.periodKey)}::text[]))`;
  for (const r of rows) out.set(`${r.product}|${r.periodKey}`, { reserved: n(r.reservedUnits), committed: n(r.committedUnits), limit: r.limitUnits === null ? null : n(r.limitUnits) });
  return out;
}

// The latest reservation of a product made for a piece of work (a browser
// task's id, an interaction's id).
export async function reservationByRef(product: Product, ref: string): Promise<{ id: string; state: string; accountKey: string } | null> {
  const rows = await prisma.$queryRaw<{ id: string; state: string; accountKey: string }[]>`
    SELECT id, state, "accountKey" FROM "UsageReservation" WHERE product = ${product} AND ref = ${ref} ORDER BY "createdAt" DESC LIMIT 1`;
  return rows[0] ?? null;
}

export async function reservationByKey(accountKey: string, product: Product, idempotencyKey: string): Promise<{ id: string; state: string } | null> {
  const rows = await prisma.$queryRaw<{ id: string; state: string }[]>`
    SELECT id, state FROM "UsageReservation" WHERE "accountKey" = ${accountKey} AND product = ${product} AND "idempotencyKey" = ${idempotencyKey}`;
  return rows[0] ?? null;
}

export async function reservationById(id: string): Promise<{ id: string; state: string; ref: string | null; reservedUnits: number; committedUnits: number; costMicros: number; reason: string | null; shadowRefusal: string | null } | null> {
  const rows = await prisma.$queryRaw<{ id: string; state: string; ref: string | null; reservedUnits: bigint; committedUnits: bigint; costMicros: bigint; reason: string | null; shadowRefusal: string | null }[]>`
    SELECT id, state, ref, "reservedUnits", "committedUnits", "costMicros", reason, "shadowRefusal" FROM "UsageReservation" WHERE id = ${id}`;
  const r = rows[0];
  return r ? { ...r, reservedUnits: n(r.reservedUnits), committedUnits: n(r.committedUnits), costMicros: n(r.costMicros) } : null;
}

// ── Record: usage with no reservation (counted as it happens) ──
// MCP calls, Kivo-funded and system cost, Nova work that reached no entry
// point that reserves. `shadowRefusal` is what enforcement would have said,
// decided by the caller from the balance as it stood.
export async function record(t: Target, e: Omit<LedgerEntry, "entry" | "committed"> & { committed?: number }): Promise<boolean> {
  return quiet(() => prisma.$transaction(async tx => {
    await ensureBalance(tx, t);
    const committed = e.committed ?? e.units;
    const fresh = await appendLedger(tx, t, { ...e, entry: "record", committed });
    if (!fresh) return false;
    await bumpBalance(tx, t, { committed, costMicros: e.costMicros, items: e.items, refusals: e.shadowRefusal ? 1 : 0 });
    return true;
  }));
}

// ── Gauge: a measured amount (storage bytes) ──
// The balance holds the latest measurement, not a sum; each measurement is
// still one ledger entry.
export async function gauge(t: Target, input: { units: number; key: string; detail?: string; reason?: string }): Promise<{ over: boolean }> {
  const units = Math.max(0, Math.round(input.units));
  const over = t.limit !== null && units > t.limit;
  await quiet(() => prisma.$transaction(async tx => {
    await ensureBalance(tx, t);
    const fresh = await appendLedger(tx, t, { entry: "gauge", units, detail: input.detail, reason: input.reason ?? "measured", key: input.key, shadowRefusal: over ? refusalFor(t.product) : null });
    if (!fresh) return;
    await tx.$executeRaw`
      UPDATE "UsageBalance" SET "committedUnits" = ${BigInt(units)}, "shadowRefusals" = "shadowRefusals" + ${over ? 1 : 0}, "updatedAt" = now()
      WHERE "accountKey" = ${t.accountKey} AND product = ${t.product} AND "periodKey" = ${t.period.key}`;
  }));
  return { over };
}

// ── Reconciliation: reservations left open past their time ──
// A process that stopped after reserving (a crash, a deploy, a lost request)
// leaves its reservation `reserved`. Each is settled from what is on record:
// `costOf(reservation)` answers the measured cost of the work it held for
// (Nova: the interaction's usage events), and the policy turns that into a
// commit or a refund. Idempotent: a reservation settled meanwhile is skipped.
export interface StaleReservation { id: string; accountKey: string; product: Product; feature: string | null; ref: string | null; reservedUnits: number; costMicros: number }
export type StaleDecision = { commit: number; costMicros: number; reason: string } | { refund: true; costMicros?: number; reason: string };

export async function reconcileStale(now: Date, decide: (r: StaleReservation) => Promise<StaleDecision>, limit = 200): Promise<{ committed: number; refunded: number; skipped: number }> {
  const rows = await prisma.$queryRaw<{ id: string; accountKey: string; product: string; feature: string | null; ref: string | null; reservedUnits: bigint; costMicros: bigint }[]>`
    SELECT id, "accountKey", product, feature, ref, "reservedUnits", "costMicros" FROM "UsageReservation"
    WHERE state = 'reserved' AND "expiresAt" < ${now} ORDER BY "expiresAt" LIMIT ${limit}`;
  const out = { committed: 0, refunded: 0, skipped: 0 };
  for (const row of rows) {
    const r: StaleReservation = { id: row.id, accountKey: row.accountKey, product: row.product as Product, feature: row.feature, ref: row.ref, reservedUnits: n(row.reservedUnits), costMicros: n(row.costMicros) };
    const d = await decide(r);
    const res = "refund" in d
      ? await refund(r.id, { reason: d.reason, costMicros: d.costMicros ?? 0, now })
      : await commit(r.id, { units: d.commit, costMicros: d.costMicros, reason: d.reason, now });
    if (!res.applied) out.skipped++;
    else if ("refund" in d) out.refunded++;
    else out.committed++;
  }
  return out;
}

// ── An account's rows, removed with the account ──
// The tables are checked first: a database the schema has not been pushed to
// yet (the API deployed before `prisma db push`) must not fail the deletion.
export async function deleteAccountUsage(tx: Tx, accountKeys: string[]): Promise<void> {
  if (accountKeys.length === 0) return;
  const [present] = await tx.$queryRaw<{ ok: boolean }[]>`
    SELECT (to_regclass('"UsageLedger"') IS NOT NULL AND to_regclass('"UsageReservation"') IS NOT NULL AND to_regclass('"UsageBalance"') IS NOT NULL) AS ok`;
  if (!present?.ok) return;
  await tx.$executeRaw`DELETE FROM "UsageLedger" WHERE "accountKey" = ANY(${accountKeys})`;
  await tx.$executeRaw`DELETE FROM "UsageReservation" WHERE "accountKey" = ANY(${accountKeys})`;
  await tx.$executeRaw`DELETE FROM "UsageBalance" WHERE "accountKey" = ANY(${accountKeys})`;
}
