/**
 * Today's flow — real Postgres integration test.
 *
 * What it proves, with the session commands the web page sends:
 *   • after a 35-minute session on the plan's first block, Today and the
 *     Planner move on to the next block: the topic just studied is not
 *     handed back, and the third block comes into the plan;
 *   • the minutes done count against the day, and once the day's time is
 *     used Today says today's study is done;
 *   • a session stopped before ten minutes does not count as done;
 *   • choosing another subject plans that subject alone, from where the
 *     learner left off in it, and an unknown subject changes nothing.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

import "./test-database.js";
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";

const { prisma } = await import("@repo/db/client");
const { saveSetup } = await import("../product/setup.js");
const { runNovaSessionCommand } = await import("../product/session.js");
const { loadNovaToday } = await import("../product/today.js");
const { loadNovaPlanner } = await import("../product/planner.js");
const { localHour } = await import("../engines/learner-calendar.js");

import type { NovaTodayReady } from "../product/today.types.js";

const STAMP = Date.now();
// The sessions run in the last hour of real time, so the learner's zone is
// one where that hour and now are the same, ordinary day.
const NOW  = new Date();
const ZONE = ["UTC", "Asia/Tokyo", "America/New_York", "Asia/Kolkata"].find(z => { const h = localHour(NOW, z); return h >= 2 && h <= 22; })!;
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

let n = 0;
async function learner(dailyMinutes: number): Promise<string> {
  const id = `web:flow_${STAMP}_${n++}`;
  await prisma.messengerUser.create({ data: { platform: "web", platformChatId: id, persona: "nova", displayName: "Asha" } });
  const saved = await saveSetup(id, {
    subjects: [
      { name: "DSA", topics: ["Arrays", "Linked lists", "Stacks", "Queues", "Trees"] },
      { name: "Operating Systems", topics: ["Processes", "Threads", "Scheduling"] },
    ],
    exams: [], dailyMinutes, studyTime: null,
  }, minutesAgo(120));
  assert.equal(saved.status, "saved");
  await prisma.novaAcademicProfile.updateMany({ where: { user: { platformChatId: id } }, data: { timezone: ZONE } });
  return id;
}

async function today(id: string, focusSubject: string | null = null): Promise<NovaTodayReady> {
  const v = await loadNovaToday(id, { now: NOW, focusSubject });
  assert.equal(v.status, "ready");
  return v as NovaTodayReady;
}
const blocks = (v: NovaTodayReady) => [v.recommendation, ...v.alternatives].flatMap(a => (a ? [a.topicName] : []));

// The block the page's Start button sends, then End after `minutes`.
async function study(id: string, block: { topicName: string; subjectName: string; durationMinutes: number }, minutes: number, outcome: "okay" | "good" = "okay") {
  const start = minutesAgo(minutes + 1);
  const started = await runNovaSessionCommand(id, { action: "start", topicName: block.topicName, subjectName: block.subjectName, plannedMinutes: block.durationMinutes }, start, "web");
  assert.ok(started.ok, started.ok ? "" : started.message);
  const ended = await runNovaSessionCommand(id, { action: "end", outcome }, minutesAgo(1), "web");
  assert.ok(ended.ok && ended.ended, ended.ok ? "" : ended.message);
  return ended.ok ? ended.ended! : null!;
}

test("after a 35-minute session on the first block, the plan moves on to the next", async () => {
  const id = await learner(120);
  const first = await today(id);
  const plan = blocks(first);
  assert.ok(plan.length >= 2, `a plan to work through: ${plan.join(", ")}`);
  assert.equal(plan[0], "Arrays");

  const ended = await study(id, first.recommendation!, 35);
  assert.equal(ended.counted, true);

  const after = await today(id);
  assert.notEqual(after.recommendation?.topicName, "Arrays", "the topic just studied is not handed back");
  assert.ok(!blocks(after).includes("Arrays"));
  assert.equal(after.recommendation?.topicName, plan[1], "what was next is now first");
  assert.equal(after.doneToday?.minutes, 35);
  assert.deepEqual(after.doneToday?.topics, [{ topicName: "Arrays", subjectName: "DSA" }]);

  // The Planner shows the same day.
  const planner = await loadNovaPlanner(id, { now: NOW });
  assert.ok(planner.status === "ready");
  assert.equal(planner.today.blocks[0]?.topicName, after.recommendation?.topicName);
  assert.ok(planner.today.done.some(s => s.topicName === "Arrays"));

  // The second block done too: the third comes forward.
  const second = await study(id, after.recommendation!, 30);
  assert.equal(second.counted, true);
  const third = await today(id);
  assert.ok(third.recommendation, "there is still time and a next block");
  assert.ok(!["Arrays", plan[1]].includes(third.recommendation!.topicName));
  assert.equal(third.doneToday?.minutes, 65);
});

test("once the day's time is used, Today says today's study is done", async () => {
  const id = await learner(30);
  const first = await today(id);
  await study(id, first.recommendation!, 28, "good");
  const after = await today(id);
  assert.equal(after.recommendation, null);
  assert.equal(after.emptyReason, "done_today");
  // Saying they have more time now plans it.
  const more = await loadNovaToday(id, { now: NOW, availableMinutes: 30 });
  assert.ok(more.status === "ready" && more.recommendation && more.recommendation.topicName !== "Arrays");
});

test("a session stopped before ten minutes does not count as done", async () => {
  const id = await learner(120);
  const first = await today(id);
  const short = await study(id, first.recommendation!, 5);
  assert.equal(short.counted, false);
  const after = await today(id);
  assert.equal(after.recommendation?.topicName, "Arrays", "still to do");
  assert.equal(after.doneToday?.minutes, 0);
});

test("choosing another subject plans that subject, from where they left off", async () => {
  const id = await learner(120);
  const all = await today(id);
  assert.equal(all.focusSubject, null);
  assert.deepEqual(all.subjectProgress?.map(p => [p.subjectName, p.topicsStarted, p.nextTopic]), [["DSA", 0, "Arrays"], ["Operating Systems", 0, "Processes"]]);

  const os = await today(id, "operating systems");
  assert.equal(os.focusSubject, "Operating Systems");
  assert.ok(blocks(os).length > 0);
  assert.ok([os.recommendation, ...os.alternatives].every(a => a?.subjectName === "Operating Systems"));
  assert.equal(os.recommendation?.topicName, "Processes");

  await study(id, os.recommendation!, 30);
  const next = await today(id, "Operating Systems");
  assert.equal(next.recommendation?.topicName, "Threads", "picks up after what was studied");
  const progress = next.subjectProgress?.find(p => p.subjectName === "Operating Systems");
  assert.deepEqual([progress?.topicsStarted, progress?.lastTopic, progress?.nextTopic], [1, "Processes", "Threads"]);

  // Back to DSA: it starts where DSA was left, untouched by the OS session.
  const dsa = await today(id, "DSA");
  assert.equal(dsa.recommendation?.topicName, "Arrays");

  // A subject that is not theirs changes nothing.
  const unknown = await today(id, "Chemistry");
  assert.equal(unknown.focusSubject, null);
});
