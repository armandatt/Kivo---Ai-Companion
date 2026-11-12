// The proactive tick reads every learner's account preferences in one query
// (loadAccountPreferencesFor) instead of one each. Each learner must get
// exactly what loadAccountPreferences would have given them.

import { prisma } from "@repo/db/client";
import { loadAccountPreferences, loadAccountPreferencesFor } from "../adapters/account-preferences-adapter";

type Row = { userId: string; telegramChatId: string | null; preferredCheckInTime: string | null; timezone: string | null; onboardingAnswers: unknown };

function install(rows: Row[]) {
  const calls: unknown[] = [];
  const matches = (r: Row, where: any): boolean =>
    where.userId !== undefined ? r.userId === where.userId
    : where.telegramChatId !== undefined ? r.telegramChatId === where.telegramChatId
    : where.OR ? where.OR.some((w: any) => (w.userId?.in ?? []).includes(r.userId) || (w.telegramChatId?.in ?? []).includes(r.telegramChatId))
    : false;
  Object.assign(prisma as any, {
    userProfile: {
      findMany:  async (args: any) => { calls.push(args); return rows.filter(r => matches(r, args.where)); },
      findFirst: async (args: any) => rows.find(r => matches(r, args.where)) ?? null,
    },
  });
  return calls;
}

const rows: Row[] = [
  { userId: "u1", telegramChatId: "111", preferredCheckInTime: "08:30", timezone: "Asia/Kolkata", onboardingAnswers: { learningContexts: ["school"] } },
  { userId: "u2", telegramChatId: null,  preferredCheckInTime: null,    timezone: "Not/AZone",    onboardingAnswers: null },
  { userId: "u3", telegramChatId: "333", preferredCheckInTime: "bogus", timezone: null,           onboardingAnswers: {} },
];

test("one query for every learner, each answer the same as the single read", async () => {
  const calls = install(rows);
  const ids = ["111", "web:u2", "333", "999", "web:missing"];
  const batch = await loadAccountPreferencesFor(ids);
  expect(calls).toHaveLength(1);
  for (const id of ids) expect(batch.get(id)).toEqual(await loadAccountPreferences(id));
  expect(batch.get("111")).toMatchObject({ checkinMinute: 510, checkinTime: "08:30", timezone: "Asia/Kolkata" });
});

test("no learners: no query", async () => {
  const calls = install(rows);
  expect((await loadAccountPreferencesFor([])).size).toBe(0);
  expect(calls).toHaveLength(0);
});

test("a failed read gives every learner 'nothing chosen', as the single read does", async () => {
  Object.assign(prisma as any, { userProfile: { findMany: async () => { throw new Error("down"); } } });
  const batch = await loadAccountPreferencesFor(["111"]);
  expect(batch.get("111")).toEqual({ checkinMinute: null, checkinTime: null, timezone: null, learningContexts: [] });
});
