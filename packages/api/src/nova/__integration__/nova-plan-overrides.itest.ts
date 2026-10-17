/**
 * The learner's changes to today's plan — real Postgres integration test.
 *
 * What it proves: a skip, an added topic and an order reach the plan Home,
 * the Planner and the proactive tick all read (they share planning-inputs);
 * the day is the server's, so yesterday's changes do not apply today; a
 * repeat changes nothing; skip and add on one topic undo each other; another
 * learner's topic is refused; nothing outside the overrides table changes.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

import "./test-database.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";

const { prisma }                   = await import("@repo/db/client");
const { resolveLearnerForAccount } = await import("../product/learner-identity.js");
const { saveSetup }                = await import("../product/setup.js");
const { resolveNoteLearner }       = await import("../product/notes.js");
const { changeTodayPlan }          = await import("../product/plan-overrides.js");
const { loadNovaToday }            = await import("../product/today.js");
const { loadNovaPlanner }          = await import("../product/planner.js");
const { dayKey }                   = await import("../engines/learner-calendar.js");

const STAMP = Date.now();
const now = new Date();
const accounts: string[] = [];
let n = 0;

async function learner() {
  const user = await prisma.user.create({ data: { email: `povr_${STAMP}_${++n}@test.local`, name: "Asha" }, select: { id: true } });
  accounts.push(user.id);
  await prisma.userProfile.create({ data: { userId: user.id, primaryPersona: "nova", onboardingComplete: true, secondaryDomains: [], aspirationWords: [] } });
  const web = (await resolveLearnerForAccount(user.id, "Asha")) as { platformChatId: string };
  await saveSetup(web.platformChatId, { subjects: [{ name: "Operating Systems", topics: ["Deadlocks", "Paging", "Scheduling", "File systems"] }], exams: [], dailyMinutes: 60, studyTime: null }, now);
  const resolved = await resolveNoteLearner(web.platformChatId);
  const profileId = resolved.status === "ready" ? resolved.profileId : "";
  await prisma.novaAcademicProfile.update({ where: { id: profileId }, data: { timezone: "UTC" } });
  const topics = await prisma.novaTopicMastery.findMany({ where: { subject: { profileId } }, select: { id: true, name: true } });
  return { chat: web.platformChatId, profileId, topic: (name: string) => topics.find(t => t.name === name)!.id };
}

const today = async (chat: string) => {
  const v = await loadNovaToday(chat, { now });
  assert.ok(v.status === "ready");
  return v.status === "ready" ? v : null!;
};
const planned = (v: Awaited<ReturnType<typeof today>>) => [v.recommendation, ...v.alternatives].filter(Boolean).map(a => a!.topicName);

before(async () => { await prisma.$queryRaw`SELECT 1`; });
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: accounts } } });
  await prisma.$disconnect();
});

test("skip, add back, and order reach Today and the Planner; a repeat changes nothing", async () => {
  const l = await learner();
  const before = await today(l.chat);
  const first = before.recommendation!.topicName;
  const firstId = before.recommendation!.topicId!;
  assert.ok(firstId, "a plan block names its topic");

  assert.deepEqual(await changeTodayPlan(l.profileId, { action: "skip", topicId: firstId }, now), { ok: true, day: dayKey(now, "UTC") });
  assert.ok((await changeTodayPlan(l.profileId, { action: "skip", topicId: firstId }, now)).ok, "a repeat is fine");
  assert.equal(await prisma.novaPlanOverride.count({ where: { profileId: l.profileId } }), 1);
  const skipped = await today(l.chat);
  assert.ok(!planned(skipped).includes(first), `${first} is left out`);
  assert.deepEqual(skipped.planChanges?.skipped, [{ topicId: firstId, topicName: first }]);
  const planner = await loadNovaPlanner(l.chat, { now });
  assert.ok(planner.status === "ready" && !planner.today.blocks.some(b => b.topicName === first));

  // Adding it back takes the skip away, and puts it first.
  assert.ok((await changeTodayPlan(l.profileId, { action: "pin", topicId: firstId }, now)).ok);
  const added = await today(l.chat);
  assert.equal(added.recommendation?.topicName, first);
  assert.deepEqual([added.planChanges?.skipped, added.planChanges?.added.map(a => a.topicName)], [[], [first]]);
  assert.ok((await changeTodayPlan(l.profileId, { action: "clear", kind: "pin", topicId: firstId }, now)).ok);

  // The learner's order.
  const blocks = planned(await today(l.chat));
  const reversed = [...blocks].reverse().map(name => l.topic(name));
  assert.ok((await changeTodayPlan(l.profileId, { action: "order", topicIds: reversed }, now)).ok);
  assert.deepEqual(planned(await today(l.chat)), [...blocks].reverse());
  assert.ok((await changeTodayPlan(l.profileId, { action: "clear_order" }, now)).ok);
  assert.deepEqual(planned(await today(l.chat)), blocks);
});

test("the day is the server's: yesterday's changes do not apply, and no day can be sent", async () => {
  const l = await learner();
  const v = await today(l.chat);
  const id = v.recommendation!.topicId!;
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000), "UTC");
  await prisma.novaPlanOverride.create({ data: { profileId: l.profileId, day: yesterday, kind: "skip", topicId: id } });
  assert.equal((await today(l.chat)).recommendation?.topicId, id, "yesterday's skip does not apply");
  // A day in the request is ignored: the write lands on today.
  const r = await changeTodayPlan(l.profileId, { action: "skip", topicId: id, day: "2099-01-01" }, now);
  assert.ok(r.ok && r.day === dayKey(now, "UTC"));
  assert.equal(await prisma.novaPlanOverride.count({ where: { profileId: l.profileId, day: "2099-01-01" } }), 0);
});

test("another learner's topic, an unknown action and a bad order are refused; nothing else is written", async () => {
  const owner = await learner();
  const other = await learner();
  const theirs = owner.topic("Paging");
  const sessions = await prisma.novaStudySession.count({ where: { profileId: other.profileId } });
  for (const body of [
    { action: "skip", topicId: theirs },
    { action: "pin", topicId: theirs },
    { action: "order", topicIds: [theirs] },
  ]) {
    const r = await changeTodayPlan(other.profileId, body, now);
    assert.ok(!r.ok && r.error === "not_found", JSON.stringify(body));
  }
  for (const body of [null, {}, { action: "delete_everything" }, { action: "order", topicIds: [] }, { action: "order", topicIds: [other.topic("Paging"), other.topic("Paging")] }, { action: "clear", kind: "order", topicId: "x" }]) {
    const r = await changeTodayPlan(other.profileId, body, now);
    assert.ok(!r.ok && r.error === "invalid", JSON.stringify(body));
  }
  assert.equal(await prisma.novaPlanOverride.count({ where: { profileId: { in: [owner.profileId, other.profileId] } } }), 0);
  assert.equal(await prisma.novaStudySession.count({ where: { profileId: other.profileId } }), sessions);
});

test("concurrent changes to today: two orders at once leave one whole order; skip and add on one topic at once leave one of them", async () => {
  const l = await learner();
  const ids = ["Deadlocks", "Paging", "Scheduling"].map(n => l.topic(n));
  for (let round = 0; round < 5; round++) {
    const rs = await Promise.all([
      changeTodayPlan(l.profileId, { action: "order", topicIds: ids }, now),
      changeTodayPlan(l.profileId, { action: "order", topicIds: [...ids].reverse() }, now),
    ]);
    assert.ok(rs.every(r => r.ok), JSON.stringify(rs));
    const rows = await prisma.novaPlanOverride.findMany({ where: { profileId: l.profileId, kind: "order" }, orderBy: { position: "asc" } });
    const got = rows.map(r => r.topicId);
    assert.ok(JSON.stringify(got) === JSON.stringify(ids) || JSON.stringify(got) === JSON.stringify([...ids].reverse()), JSON.stringify(got));
  }
  const both = await Promise.all([
    changeTodayPlan(l.profileId, { action: "skip", topicId: ids[0] }, now),
    changeTodayPlan(l.profileId, { action: "pin", topicId: ids[0] }, now),
  ]);
  assert.ok(both.every(r => r.ok));
  const kinds = (await prisma.novaPlanOverride.findMany({ where: { profileId: l.profileId, topicId: ids[0], kind: { in: ["skip", "pin"] } } })).map(r => r.kind);
  assert.equal(kinds.length, 1, `skip and add exclude each other: ${kinds}`);
});
