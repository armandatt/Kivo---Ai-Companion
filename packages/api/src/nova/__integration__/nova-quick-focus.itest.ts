/**
 * Quick Focus — real Postgres.
 *
 * A session started with no task, no topic and no plan, through the ordinary
 * start command: it runs untimed, takes optional details (title, category,
 * description) while it runs, survives a reload (the clock is the server's),
 * ends once however often End is pressed, appears in recent sessions and in
 * Progress's totals when long enough, and creates no task and no mastery.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npx tsx --test src/nova/__integration__/nova-quick-focus.itest.ts
 */

import "./test-database.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";

const { prisma } = await import("@repo/db/client");
const { runNovaSessionCommand, loadNovaSession } = await import("../product/session.js");
const { parseSessionCommand } = await import("../product/session-view.js");
const { recentSessions } = await import("../product/focus-history.js");
const { loadNovaProgress } = await import("../product/progress.js");

const STAMP = Date.now();
const CHAT = `nova_itest_quick_${STAMP}`;
let profileId = "";

before(async () => {
  const user = await prisma.messengerUser.create({
    data: { platform: "telegram", platformChatId: CHAT, persona: "nova", novaAcademicProfile: { create: { onboardingComplete: true, subjects: { create: { name: "Physics" } } } } },
    select: { novaAcademicProfile: { select: { id: true } } },
  });
  profileId = user.novaAcademicProfile!.id;
});
after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: CHAT } });
  await prisma.$disconnect();
});

const QUICK = parseSessionCommand({ action: "start", label: "Quick focus", untimed: true })!;

test("the start is the ordinary command: a label, no topic, no time limit", () => {
  assert.deepEqual(QUICK, { action: "start", topicName: null, subjectName: null, plannedMinutes: 0, label: "Quick focus" });
  assert.equal(parseSessionCommand({ action: "set_details" }), null, "details with nothing in them are not a command");
  assert.equal(parseSessionCommand({ action: "set_details", category: 5 }), null);
  assert.deepEqual(parseSessionCommand({ action: "set_details", title: "  Essay draft ", category: "", description: null }), { action: "set_details", title: "Essay draft", category: null, description: null });
});

test("a Quick Focus session starts at once, takes its details, ends once, and is on the record", async () => {
  const started = await runNovaSessionCommand(CHAT, QUICK);
  assert.ok(started.ok && started.session, JSON.stringify(started));
  assert.equal(started.session!.topicName, null);
  assert.equal(started.session!.untimed, true);
  assert.equal(started.session!.label, "Quick focus");

  const details = await runNovaSessionCommand(CHAT, parseSessionCommand({ action: "set_details", title: "Essay draft", category: "Writing", description: "Intro and first section" })!);
  assert.ok(details.ok, JSON.stringify(details));
  // A reload reads it back from the server: the clock and the details are its own.
  const reloaded = (await loadNovaSession(CHAT))!;
  assert.equal(reloaded.label, "Essay draft");
  assert.deepEqual(reloaded.details, { category: "Writing", description: "Intro and first section" });

  // Only the category changed: the description stays.
  assert.ok((await runNovaSessionCommand(CHAT, parseSessionCommand({ action: "set_details", category: "Study" })!)).ok);
  assert.deepEqual((await loadNovaSession(CHAT))!.details, { category: "Study", description: "Intro and first section" });

  // Twenty minutes of focus, then End pressed three times at once.
  await prisma.novaStudySession.updateMany({ where: { profileId, status: "in_progress" }, data: { sessionDate: new Date(Date.now() - 20 * 60_000) } });
  const ends = await Promise.all([1, 2, 3].map(() => runNovaSessionCommand(CHAT, { action: "end", outcome: "good" })));
  assert.equal(ends.filter(e => e.ok && e.ended).length, 1, "one of them ended it");
  assert.equal(await prisma.novaStudySession.count({ where: { profileId } }), 1, "one session, not three");

  const [recent] = await recentSessions(profileId);
  assert.equal(recent!.title, "Essay draft");
  assert.equal(recent!.kind, "focus");
  assert.equal(recent!.category, "Study");
  assert.ok(recent!.minutes >= 19 && recent!.counted, JSON.stringify(recent));

  const progress = await loadNovaProgress(CHAT);
  assert.equal(progress.status, "ready");
  if (progress.status === "ready") {
    assert.equal(progress.overview.sessions, 1, "it counts as a focus session");
    assert.ok(progress.overview.learningMinutes >= 19, "and as focus time");
  }
  assert.equal(await prisma.novaTask.count({ where: { profileId } }), 0, "no task was made or completed");
  assert.equal(await prisma.novaTopicMastery.count({ where: { subject: { profileId } } }), 0, "no topic mastery was made");
});

test("details need a running session", async () => {
  const res = await runNovaSessionCommand(CHAT, parseSessionCommand({ action: "set_details", title: "Late" })!);
  assert.ok(!res.ok);
});
