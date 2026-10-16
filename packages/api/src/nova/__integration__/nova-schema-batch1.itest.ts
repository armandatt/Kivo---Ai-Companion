/**
 * Schema batch 1 (plan overrides, task length and order, topic archive) —
 * real Postgres integration test of the constraints alone. No product code
 * uses these yet; this proves the tables behave as the design says before
 * any does.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

import "./test-database.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";

const { prisma } = await import("@repo/db/client");

const STAMP = Date.now();
const chats: string[] = [];

async function profileWithTopic() {
  const chat = `web:schema1_${STAMP}_${chats.length}`;
  chats.push(chat);
  const user = await prisma.messengerUser.create({
    data: { platform: "web", platformChatId: chat, persona: "nova", novaAcademicProfile: { create: { subjects: { create: { name: "OS", topics: { create: [{ name: "Paging" }, { name: "Deadlocks" }] } } } } } },
    select: { novaAcademicProfile: { select: { id: true, subjects: { select: { topics: { select: { id: true, name: true } } } } } } },
  });
  const p = user.novaAcademicProfile!;
  const topics = p.subjects[0]!.topics;
  return { profileId: p.id, paging: topics.find(t => t.name === "Paging")!.id, deadlocks: topics.find(t => t.name === "Deadlocks")!.id };
}

before(async () => { await prisma.$queryRaw`SELECT 1`; });
after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: chats } } });
  await prisma.$disconnect();
});

test("new columns start empty: nothing existing is given a length, a place or an archive mark", async () => {
  const l = await profileWithTopic();
  const task = await prisma.novaTask.create({ data: { profileId: l.profileId, title: "Lab" } });
  assert.deepEqual([task.estimatedMinutes, task.position], [null, null]);
  assert.equal((await prisma.novaTopicMastery.findUniqueOrThrow({ where: { id: l.paging } })).archivedAt, null);
});

test("one override of each kind per topic per day: a repeat is refused, so writes must upsert", async () => {
  const l = await profileWithTopic();
  const day = "2026-10-17";
  await prisma.novaPlanOverride.create({ data: { profileId: l.profileId, day, kind: "skip", topicId: l.paging } });
  await assert.rejects(prisma.novaPlanOverride.create({ data: { profileId: l.profileId, day, kind: "skip", topicId: l.paging } }), (e: { code?: string }) => e.code === "P2002");
  // Another kind, day or topic is another row.
  await prisma.novaPlanOverride.create({ data: { profileId: l.profileId, day, kind: "order", topicId: l.paging, position: 1 } });
  await prisma.novaPlanOverride.create({ data: { profileId: l.profileId, day: "2026-10-18", kind: "skip", topicId: l.paging } });
  await prisma.novaPlanOverride.create({ data: { profileId: l.profileId, day, kind: "skip", topicId: l.deadlocks } });
  const up = await prisma.novaPlanOverride.upsert({
    where:  { profileId_day_kind_topicId: { profileId: l.profileId, day, kind: "order", topicId: l.paging } },
    create: { profileId: l.profileId, day, kind: "order", topicId: l.paging, position: 2 },
    update: { position: 2 },
  });
  assert.equal(up.position, 2);
  assert.equal(await prisma.novaPlanOverride.count({ where: { profileId: l.profileId } }), 4);
});

test("an override goes with its topic and with its learner; archiving a topic keeps everything", async () => {
  const l = await profileWithTopic();
  await prisma.novaPlanOverride.create({ data: { profileId: l.profileId, day: "2026-10-17", kind: "pin", topicId: l.paging } });
  await prisma.novaPlanOverride.create({ data: { profileId: l.profileId, day: "2026-10-17", kind: "pin", topicId: l.deadlocks } });

  // Archiving is a mark, not a delete: the override and the topic stay.
  await prisma.novaTopicMastery.update({ where: { id: l.deadlocks }, data: { archivedAt: new Date() } });
  assert.equal(await prisma.novaPlanOverride.count({ where: { topicId: l.deadlocks } }), 1);

  // A removed topic (only ever one without history) takes its overrides.
  await prisma.novaTopicMastery.delete({ where: { id: l.paging } });
  assert.equal(await prisma.novaPlanOverride.count({ where: { topicId: l.paging } }), 0);

  // A removed learner takes all of theirs.
  await prisma.novaAcademicProfile.delete({ where: { id: l.profileId } });
  assert.equal(await prisma.novaPlanOverride.count({ where: { profileId: l.profileId } }), 0);
});

test("an override cannot point at a topic or learner that does not exist", async () => {
  const l = await profileWithTopic();
  await assert.rejects(prisma.novaPlanOverride.create({ data: { profileId: l.profileId, day: "2026-10-17", kind: "skip", topicId: "missing" } }));
  await assert.rejects(prisma.novaPlanOverride.create({ data: { profileId: "missing", day: "2026-10-17", kind: "skip", topicId: l.paging } }));
});
