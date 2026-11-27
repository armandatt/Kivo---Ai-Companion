/**
 * Bug batch 28 Nov, item 7: a topic's status (not_started / in_progress /
 * completed). Set by the learner; starting a session moves not_started to
 * in_progress; time never completes a topic; filing can set it; the map and
 * Kivo Connect read and write it.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npx tsx --test src/nova/__integration__/nova-topic-status.itest.ts
 */
import "./test-database.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";

const { prisma } = await import("@repo/db/client");
const { runNovaSessionCommand } = await import("../product/session.js");
const { setTopicStatus, effectiveTopicStatus } = await import("../product/topic-status.js");
const { buildKnowledgeMap } = await import("../product/knowledge-map.js");

const STAMP = Date.now();
const CHAT = `nova_itest_status_${STAMP}`;
let profileId = "", subjectId = "";
const statusOf = async (name: string) => (await prisma.novaTopicMastery.findFirst({ where: { subjectId, name }, select: { status: true } }))!.status;

before(async () => {
  const user = await prisma.messengerUser.create({
    data: { platform: "telegram", platformChatId: CHAT, persona: "nova", novaAcademicProfile: { create: { onboardingComplete: true, subjects: { create: { name: "Finance" } } } } },
    select: { novaAcademicProfile: { select: { id: true, subjects: { select: { id: true } } } } },
  });
  profileId = user.novaAcademicProfile!.id;
  subjectId = user.novaAcademicProfile!.subjects[0]!.id;
  for (const name of ["WACC", "DCF", "Beta"]) await prisma.novaTopicMastery.create({ data: { subjectId, name } });
});
after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: CHAT } });
  await prisma.$disconnect();
});

test("REGRESSION item 7: shown status is the learner's word, else implied by study", () => {
  assert.equal(effectiveTopicStatus(null, false), "not_started");
  assert.equal(effectiveTopicStatus(null, true), "in_progress");
  assert.equal(effectiveTopicStatus("completed", false), "completed");
  assert.equal(effectiveTopicStatus("bogus", true), "in_progress");
});

test("REGRESSION item 7: starting a session moves not started to in progress; ending it never completes the topic", async () => {
  const t0 = new Date("2026-11-28T09:00:00Z");
  assert.ok((await runNovaSessionCommand(CHAT, { action: "start", topicName: "WACC", subjectName: "Finance", plannedMinutes: 25 }, t0)).ok);
  assert.equal(await statusOf("WACC"), "in_progress");
  await runNovaSessionCommand(CHAT, { action: "end", outcome: "crushed_it" }, new Date(t0.getTime() + 60 * 60_000));
  assert.equal(await statusOf("WACC"), "in_progress", "an hour studied, 'crushed it': still not completed");
});

test("REGRESSION item 7: the learner sets it; completed survives another session; another learner cannot", async () => {
  const done = await setTopicStatus(profileId, { subjectId, topicName: "wacc" }, "completed");
  assert.ok(done.ok && done.changed && done.status === "completed");
  assert.ok(!(await setTopicStatus(profileId, { subjectId, topicName: "WACC" }, "finished")).ok, "only the three words");
  const t1 = new Date("2026-11-28T12:00:00Z");
  await runNovaSessionCommand(CHAT, { action: "start", topicName: "WACC", subjectName: "Finance", plannedMinutes: 25 }, t1);
  await runNovaSessionCommand(CHAT, { action: "end", outcome: "good" }, new Date(t1.getTime() + 30 * 60_000));
  assert.equal(await statusOf("WACC"), "completed", "a revision does not undo completed");
  const other = await prisma.messengerUser.create({ data: { platform: "telegram", platformChatId: `${CHAT}_o`, persona: "nova", novaAcademicProfile: { create: { onboardingComplete: true } } }, select: { novaAcademicProfile: { select: { id: true } } } });
  try {
    assert.ok(!(await setTopicStatus(other.novaAcademicProfile!.id, { subjectId, topicName: "DCF" }, "completed")).ok);
  } finally { await prisma.messengerUser.deleteMany({ where: { platformChatId: `${CHAT}_o` } }); }
  assert.equal(await statusOf("DCF"), null);
});

test("REGRESSION item 7: filing a finished session can say where the topic stands", async () => {
  const t0 = new Date("2026-11-28T15:00:00Z");
  await runNovaSessionCommand(CHAT, { action: "start", topicName: null, subjectName: null, plannedMinutes: 0, label: "Quick focus" }, t0);
  const ended = await runNovaSessionCommand(CHAT, { action: "end", outcome: null }, new Date(t0.getTime() + 20 * 60_000));
  assert.ok(ended.ok && ended.ended);
  const filed = await runNovaSessionCommand(CHAT, { action: "file", sessionId: ended.ended!.sessionId, subjectId, topicName: "Beta", topicStatus: "completed" });
  assert.ok(filed.ok && filed.filed?.topicStatus === "completed", JSON.stringify(filed));
  assert.equal(await statusOf("Beta"), "completed");
});

test("REGRESSION item 7: the map carries each topic's status", () => {
  const m = buildKnowledgeMap({
    subjects: [{ id: "s", name: "Finance" }],
    topics: [
      { id: "a", subjectId: "s", name: "A", masteryProbability: 0, reviewCount: 0, status: "completed" },
      { id: "b", subjectId: "s", name: "B", masteryProbability: 0, reviewCount: 0, status: null },
      { id: "c", subjectId: "s", name: "C", masteryProbability: 0, reviewCount: 0, status: null },
    ],
    notes: [], resources: [], totals: { notes: 0, resources: 0 },
    sessionsByTopic: [{ subjectId: "s", topicName: "C", sessions: 1, minutes: 20 }],
  });
  const st = (id: string) => (m.nodes.find(n => n.id === `topic:${id}`) as { status?: string; statusSet?: boolean });
  assert.deepEqual([st("a").status, st("a").statusSet], ["completed", true]);
  assert.deepEqual([st("b").status, st("b").statusSet], ["not_started", false]);
  assert.deepEqual([st("c").status, st("c").statusSet], ["in_progress", false]);
});
