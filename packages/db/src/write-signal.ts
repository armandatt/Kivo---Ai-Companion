// ─── Database write signal ────────────────────────────────────────────────────
// Every committed write this process makes is noted here, at the driver
// (signallingAdapter below wraps the Prisma pg adapter), whatever code made
// it: a Telegram webhook, a web route, an extension call, a background job.
// The scheduler reads it to know that something may have changed since its
// last full run (apps/api/lib/internal-checkin-scheduler.ts,
// @repo/api/services/schedulerIdle).
//
// Why at the driver and not at each write site: a write site that forgot to
// say so would leave the scheduler believing nothing changed. Here none can
// forget, and a write that changes nothing about timing only costs one extra
// full run.
//
// The scheduler's own writes are made inside runWithoutWriteSignal and are not
// noted: it reads what it needs after its run, and noting them would make
// every run force the next.
//
// Limits: this sees only this process. A write from another process (an
// operator script, a second API instance, the Vercel web app) is found by the
// scheduler's periodic full run instead.
//
// State lives on globalThis: Next bundles route handlers and the
// instrumentation hook separately, and they must share one signal.

import { AsyncLocalStorage } from "node:async_hooks";

type SignalState = {
  lastWriteAt: number | null;   // ms since epoch of the last noted commit
  writes:      number;          // noted commits since the process started
  quiet:       AsyncLocalStorage<string>;
};

const KEY = "__kivoDatabaseWriteSignal";

function state(): SignalState {
  const g = globalThis as unknown as Record<string, SignalState | undefined>;
  return (g[KEY] ??= { lastWriteAt: null, writes: 0, quiet: new AsyncLocalStorage<string>() });
}

// A committed write. Ignored inside runWithoutWriteSignal.
export function noteDatabaseWrite(at = Date.now()): void {
  const s = state();
  if (s.quiet.getStore() !== undefined) return;
  s.lastWriteAt = at;
  s.writes += 1;
}

// Runs `work` with its database writes not noted (the scheduler's own run).
// Everything `work` awaits or starts inherits this, through AsyncLocalStorage.
export function runWithoutWriteSignal<T>(label: string, work: () => Promise<T>): Promise<T> {
  return state().quiet.run(label, work);
}

// The same, for the rest of the current async function and everything it
// awaits from here on, where wrapping it in a callback is not practical (the
// legacy Rex branch of the Telegram webhook, which is inline). The caller's
// own context, once this function has returned, is untouched.
export function quietFromHere(label: string): void {
  state().quiet.enterWith(label);
}

export function databaseWriteState(): { lastWriteAt: number | null; writes: number } {
  const s = state();
  return { lastWriteAt: s.lastWriteAt, writes: s.writes };
}

// Statements that change data. Over-inclusive on purpose (a WITH that only
// reads counts): a false "changed" costs one full run, a missed one could
// cost a reminder.
const WRITE = /^\s*(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|WITH|CALL|COPY)\b/i;
const COMMIT = /^\s*(?:COMMIT|END)\b/i;
const ROLLBACK = /^\s*(?:ROLLBACK|ABORT)\b(?!\s+TO\b)/i;

export function isWriteStatement(sql: string): boolean { return WRITE.test(sql); }

// ── The adapter wrapper ───────────────────────────────────────────────────────
// Structural types only: the Prisma driver-adapter interfaces
// (@prisma/driver-adapter-utils) without importing them.

type Query = { sql: string };
interface Queryable { queryRaw(q: Query): Promise<unknown>; executeRaw(q: Query): Promise<unknown> }
interface Tx extends Queryable { commit(): Promise<void>; rollback(): Promise<void> }
interface Adapter extends Queryable { startTransaction(...args: unknown[]): Promise<Tx>; executeScript?(script: string): Promise<void> }
interface Factory { connect(): Promise<Adapter>; connectToShadowDb?(): Promise<Adapter> }

// Outside a transaction a write is committed when it returns. Inside one it
// is noted when the transaction commits (Prisma sends COMMIT as a statement;
// commit() itself only releases the connection), and never if it rolls back.
function wrapTransaction(tx: Tx): Tx {
  let wrote = false;
  let noted = false;
  const run = <K extends "queryRaw" | "executeRaw">(method: K) => async (q: Query) => {
    const result = await tx[method](q);
    if (isWriteStatement(q.sql)) wrote = true;
    else if (COMMIT.test(q.sql)) { if (wrote && !noted) { noted = true; noteDatabaseWrite(); } }
    else if (ROLLBACK.test(q.sql)) wrote = false;
    return result;
  };
  const wrapped = Object.create(tx) as Tx;
  wrapped.queryRaw   = run("queryRaw") as Tx["queryRaw"];
  wrapped.executeRaw = run("executeRaw") as Tx["executeRaw"];
  wrapped.commit = async () => { await tx.commit(); if (wrote && !noted) { noted = true; noteDatabaseWrite(); } };
  wrapped.rollback = async () => { wrote = false; await tx.rollback(); };
  return wrapped;
}

function wrapAdapter(adapter: Adapter): Adapter {
  const wrapped = Object.create(adapter) as Adapter;
  const run = <K extends "queryRaw" | "executeRaw">(method: K) => async (q: Query) => {
    const result = await adapter[method](q);
    if (isWriteStatement(q.sql)) noteDatabaseWrite();
    return result;
  };
  wrapped.queryRaw   = run("queryRaw") as Adapter["queryRaw"];
  wrapped.executeRaw = run("executeRaw") as Adapter["executeRaw"];
  wrapped.startTransaction = async (...args: unknown[]) => wrapTransaction(await adapter.startTransaction(...args));
  if (adapter.executeScript) {
    wrapped.executeScript = async (script: string) => { await adapter.executeScript!(script); noteDatabaseWrite(); };
  }
  return wrapped;
}

// The Prisma adapter factory, with every connection it makes wrapped.
export function signallingAdapter<F extends Factory>(factory: F): F {
  const wrapped = Object.create(factory) as F;
  wrapped.connect = async () => wrapAdapter(await factory.connect());
  if (factory.connectToShadowDb) wrapped.connectToShadowDb = async () => wrapAdapter(await factory.connectToShadowDb!());
  return wrapped;
}
