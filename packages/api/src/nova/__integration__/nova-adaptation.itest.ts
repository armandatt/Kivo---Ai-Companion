/**
 * What Nova has learned about a learner reaching what it recommends — real
 * Postgres integration test.
 *
 *   finished sessions (the record) → Learning DNA → the plan → Today on the
 *   web, /today on Telegram and the proactive check-in, all the same answer
 *
 * No model is involved: the wording model is stood in and only its input is read.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

import "./test-database.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";

const { prisma }               = await import("@repo/db/client");
const { saveSetup }            = await import("../product/setup.js");
const { loadNovaToday }        = await import("../product/today.js");
const { loadNovaPlanner }      = await import("../product/planner.js");
const { loadNovaLearningDna }  = await import("../product/learning-dna.js");
const { runNovaProactiveCron } = await import("../proactive/nova-proactive-cron.js");
const { todayReply }           = await import("../telegram/telegram-replies.js");

import type { TelegramClient } from "../telegram/telegram.types.js";
import type { ProactiveWordingInput } from "../proactive/nova-proactive-response.js";

const STAMP = Date.now();
const DAY   = 86_400_000;
// Tomorrow at 11:00 in Kolkata, so the fixtures' own rows are in its past.
const NOW   = new Date((Math.floor(Date.now() / DAY) + 1) * DAY + (11 * 60 - 330) * 60_000);

let n = 0;
async function learner() {
  const key  = `${String(++n).padStart(2, "0")}${String(STAMP).slice(-10)}`;
  const chat = `8${key}`;
  const name = `Adapt ${key}`;
  const user = await prisma.user.create({ data: { email: `a${key}@adapt-itest.local`, name } });
  await prisma.userProfile.create({ data: { userId: user.id, onboardingComplete: true, primaryPersona: "nova", telegramChatId: chat, telegramConnected: true, timezone: "Asia/Kolkata", preferredCheckInTime: "11:00" } });
  const messenger = await prisma.messengerUser.create({ data: { platform: "telegram", platformChatId: chat, persona: "nova", displayName: name, aspirationWords: [], activeModules: [] }, select: { id: true } });
  const saved = await saveSetup(chat, { subjects: [{ name: "Operating Systems", topics: ["Deadlocks", "Paging", "Scheduling"] }], exams: [], dailyMinutes: 120, studyTime: null }, new Date(NOW.getTime() - 40 * DAY));
  assert.equal(saved.status, "saved", JSON.stringify(saved));
  const profile = await prisma.novaAcademicProfile.findUniqueOrThrow({ where: { userId: messenger.id }, select: { id: true, subjects: { select: { id: true } } } });
  await prisma.novaAcademicProfile.update({ where: { id: profile.id }, data: { timezone: "Asia/Kolkata", onboardingComplete: true } });
  return { chat, name, profileId: profile.id, subjectId: profile.subjects[0]!.id };
}
// Finished sessions of the given lengths, one a day, the last one two days ago.
async function studied(l: { profileId: string; subjectId: string }, minutes: number[]) {
  await prisma.novaStudySession.createMany({
    data: minutes.map((m, i) => ({
      profileId: l.profileId, subjectId: l.subjectId, topicName: "Paging", durationMinutes: m, plannedDurationMinutes: 25,
      status: "completed", activityType: "review", sessionDate: new Date(NOW.getTime() - (minutes.length - i + 1) * DAY),
    })),
  });
}
const today = async (chat: string, availableMinutes?: number) => {
  const view = await loadNovaToday(chat, { now: NOW, availableMinutes });
  assert.equal(view.status, "ready");
  return view as Extract<typeof view, { status: "ready" }>;
};

after(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: "@adapt-itest.local" } } });
  await prisma.messengerUser.deleteMany({ where: { displayName: { startsWith: "Adapt " }, platformChatId: { endsWith: String(STAMP).slice(-10) } } });
  await prisma.$disconnect();
});

test("a learner with no record is recommended the ordinary block", async () => {
  const l = await learner();
  assert.equal((await today(l.chat)).recommendation!.durationMinutes, 25);
});

test("three short sessions change nothing: a few events are not a habit", async () => {
  const l = await learner();
  await studied(l, [12, 14, 13]);
  assert.equal((await today(l.chat)).recommendation!.durationMinutes, 25);
});

test("twelve sessions of about fifteen minutes do: Home, the Planner, /today and the check-in all recommend fifteen", async () => {
  const l = await learner();
  await studied(l, [12, 14, 15, 13, 15, 14, 12, 15, 16, 14, 15, 13]);

  // What Nova concluded, as the learner can read it on the Learning DNA page.
  const dna = await loadNovaLearningDna(l.chat, { now: NOW });
  assert.equal(dna.status, "ready");
  const typical = (dna as { signals: Array<{ key: string; level: string; headline: string | null; evidenceCount: number }> }).signals.find(s => s.key === "typical_session")!;
  assert.deepEqual([typical.level, typical.headline, typical.evidenceCount], ["supported", "About 14 minutes", 12]);

  // The web app.
  const view = await today(l.chat);
  assert.equal(view.recommendation!.durationMinutes, 15);
  assert.ok(view.alternatives.every(a => a.durationMinutes <= 15), JSON.stringify(view.alternatives.map(a => a.durationMinutes)));
  const planner = await loadNovaPlanner(l.chat, { now: NOW });
  assert.equal(planner.status, "ready");
  const blocks = (planner as { today: { blocks: Array<{ durationMinutes: number }> } }).today.blocks;
  assert.ok(blocks.length > 0 && blocks.every(b => b.durationMinutes <= 15), JSON.stringify(blocks.map(b => b.durationMinutes)));

  // Telegram's /today is the same view, said in a line.
  assert.match(todayReply(view, null).text, /15 min/);

  // And the proactive check-in recommends the same block.
  const asked: ProactiveWordingInput[] = [];
  const client: TelegramClient = { async sendMessage() { return { ok: true as const, messageId: 1 }; }, async answerCallback() {}, async clearButtons() {}, async setChatCommands() {} };
  await runNovaProactiveCron(NOW, { client, word: (async (input: ProactiveWordingInput) => { asked.push(input); return { text: "SAID", generated: true }; }) as never });
  const mine = asked.find(a => a.studentName === l.name)!;
  assert.match(mine.facts.join(" / "), /Recommended now: .*, 15 min/);
});

test("what the learner says they have today still wins over their habit", async () => {
  const l = await learner();
  await studied(l, [12, 14, 15, 13, 15, 14, 12, 15, 16, 14, 15, 13]);
  const view = await today(l.chat, 45);
  assert.ok(view.recommendation!.durationMinutes > 15, String(view.recommendation!.durationMinutes));
});

test("a learner whose sessions run long is not handed longer blocks, and their mastery is untouched by any of this", async () => {
  const l = await learner();
  await studied(l, Array.from({ length: 12 }, () => 60));
  const before = await prisma.novaTopicMastery.findMany({ where: { subject: { profileId: l.profileId } }, orderBy: { id: "asc" } });
  assert.equal((await today(l.chat)).recommendation!.durationMinutes, 25);
  assert.deepEqual(await prisma.novaTopicMastery.findMany({ where: { subject: { profileId: l.profileId } }, orderBy: { id: "asc" } }), before);
});
