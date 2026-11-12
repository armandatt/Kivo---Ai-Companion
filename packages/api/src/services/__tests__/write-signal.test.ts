// The database write signal (packages/db/src/write-signal.ts): every committed
// write this process makes is counted at the driver, so the scheduler never
// misses one, whatever code made it. Against a stand-in Prisma adapter; the
// real Prisma + Postgres path is in scheduler-idle.itest.ts.

import { databaseWriteState, isWriteStatement, quietFromHere, runWithoutWriteSignal, signallingAdapter } from "@repo/db/write-signal";

type Q = { sql: string; args?: unknown[]; argTypes?: unknown[] };

// A Prisma-like adapter factory that records what reached it.
function fakeFactory() {
  const seen: string[] = [];
  const tx = {
    queryRaw:   async (q: Q) => { seen.push(`tx:${q.sql}`); return { rows: [] }; },
    executeRaw: async (q: Q) => { seen.push(`tx:${q.sql}`); return 1; },
    commit:     async () => { seen.push("tx:commit()"); },
    rollback:   async () => { seen.push("tx:rollback()"); },
  };
  const adapter = {
    provider: "postgres", adapterName: "fake",
    queryRaw:   async (q: Q) => { seen.push(q.sql); return { rows: [] }; },
    executeRaw: async (q: Q) => { seen.push(q.sql); return 1; },
    startTransaction: async () => tx,
    executeScript: async (s: string) => { seen.push(`script:${s}`); },
  };
  const factory = { provider: "postgres", adapterName: "fake", connect: async () => adapter };
  return { factory: signallingAdapter(factory), seen };
}

const writes = () => databaseWriteState().writes;

test("a read is not a write; a write is counted once it returns", async () => {
  const { factory } = fakeFactory();
  const db = await factory.connect();
  const before = writes();
  await db.queryRaw({ sql: 'SELECT * FROM "MessengerUser"' });
  await db.queryRaw({ sql: "SELECT 1 FOR UPDATE" });
  expect(writes()).toBe(before);
  await db.queryRaw({ sql: 'INSERT INTO "CustomReminder" ("id") VALUES ($1) RETURNING "id"' });
  await db.executeRaw({ sql: 'UPDATE "MessengerUser" SET "nextCheckInAt" = $1' });
  await db.executeRaw({ sql: '  delete from "NovaCalendarEvent"' });
  expect(writes()).toBe(before + 3);
});

test("inside a transaction: counted at COMMIT, never on rollback", async () => {
  const { factory } = fakeFactory();
  const db = await factory.connect();
  const before = writes();

  const tx = await db.startTransaction();
  await tx.executeRaw({ sql: "BEGIN" });
  await tx.queryRaw({ sql: 'UPDATE "CustomReminder" SET "triggerTime" = $1' });
  expect(writes()).toBe(before);                     // not yet durable
  await tx.executeRaw({ sql: "COMMIT" });
  expect(writes()).toBe(before + 1);
  await tx.commit();
  expect(writes()).toBe(before + 1);                 // once, not twice

  const rolled = await db.startTransaction();
  await rolled.queryRaw({ sql: 'INSERT INTO "CustomReminder" VALUES ($1)' });
  await rolled.executeRaw({ sql: "ROLLBACK" });
  await rolled.rollback();
  expect(writes()).toBe(before + 1);

  const readOnly = await db.startTransaction();
  await readOnly.queryRaw({ sql: "SELECT 1" });
  await readOnly.executeRaw({ sql: "COMMIT" });
  expect(writes()).toBe(before + 1);
});

test("a transaction committed by commit() alone is still counted", async () => {
  const { factory } = fakeFactory();
  const db = await factory.connect();
  const before = writes();
  const tx = await db.startTransaction();
  await tx.queryRaw({ sql: 'INSERT INTO "NovaCalendarEvent" VALUES ($1)' });
  await tx.commit();
  expect(writes()).toBe(before + 1);
});

test("the scheduler's own writes are not counted, including what it awaits later", async () => {
  const { factory } = fakeFactory();
  const db = await factory.connect();
  const before = writes();
  await runWithoutWriteSignal("scheduler", async () => {
    await db.executeRaw({ sql: 'UPDATE "MessengerUser" SET "nextCheckInAt" = $1' });
    await new Promise(r => setTimeout(r, 2));
    const tx = await db.startTransaction();
    await tx.queryRaw({ sql: 'INSERT INTO "CompanionMessage" VALUES ($1)' });
    await tx.executeRaw({ sql: "COMMIT" });
  });
  expect(writes()).toBe(before);
  // And a write outside, at the same time, still is.
  await db.executeRaw({ sql: 'UPDATE "MessengerUser" SET "timezone" = $1' });
  expect(writes()).toBe(before + 1);
});

test("a script counts as a write; queries reach the real adapter unchanged", async () => {
  const { factory, seen } = fakeFactory();
  const db = await factory.connect() as unknown as { executeScript(s: string): Promise<void>; queryRaw(q: Q): Promise<unknown> };
  const before = writes();
  await db.executeScript("CREATE TABLE x (id int)");
  await db.queryRaw({ sql: "SELECT 2" });
  expect(writes()).toBe(before + 1);
  expect(seen).toEqual(["script:CREATE TABLE x (id int)", "SELECT 2"]);
});

test("write statements are recognised generously", () => {
  for (const sql of ["INSERT INTO a", "update a set", "DELETE FROM a", "WITH x AS (UPDATE a SET b=1) SELECT 1", "MERGE INTO a", "TRUNCATE a"]) {
    expect(isWriteStatement(sql)).toBe(true);
  }
  for (const sql of ["SELECT 1", "SELECT * FROM a FOR UPDATE", "BEGIN", "COMMIT", "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE"]) {
    expect(isWriteStatement(sql)).toBe(false);
  }
});

test("quietFromHere silences the rest of its own function, not its caller, nor a request running beside it", async () => {
  const { factory } = fakeFactory();
  const db = await factory.connect();
  const before = writes();

  // The webhook's Rex branch: inline, so quiet from a point on.
  async function rexBranch() {
    await db.executeRaw({ sql: 'UPDATE "MessengerUser" SET "intakeStep" = $1' });   // before: counted
    quietFromHere("rex-legacy");
    await new Promise(r => setTimeout(r, 2));
    await db.executeRaw({ sql: 'INSERT INTO "CompanionMessage" VALUES ($1)' });      // after: not
    const tx = await db.startTransaction();
    await tx.queryRaw({ sql: 'UPDATE "MemoryFact" SET "value" = $1' });
    await tx.executeRaw({ sql: "COMMIT" });
  }
  // A Nova request at the same moment, in its own context.
  async function novaRequest() {
    await new Promise(r => setTimeout(r, 1));
    await db.executeRaw({ sql: 'INSERT INTO "NovaCalendarEvent" VALUES ($1)' });
  }

  await Promise.all([rexBranch(), novaRequest()]);
  expect(writes()).toBe(before + 2);                 // the Rex write before the mark, and Nova's
  await db.executeRaw({ sql: 'UPDATE "NovaTelegramChannel" SET "x" = 1' });   // the caller, afterwards
  expect(writes()).toBe(before + 3);
});
