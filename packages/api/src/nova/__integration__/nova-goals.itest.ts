/**
 * Goals — real Postgres integration test.
 *
 * What it proves: the goal a learner gave at sign-up reaches their Nova
 * profile once, when that profile is first made, and from there Today, the
 * Planner, Progress and Nova's own context; what they save replaces it; a goal
 * they cleared stays cleared through later setup saves, a changed sign-up
 * answer and connecting Telegram; goals belong to the learner who set them;
 * and web and Telegram speak from the same list.
 *
 * Telegram and the model are stood in. Everything between is the real code
 * against a real database.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

import "./test-database.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";

const { prisma }                     = await import("@repo/db/client");
const { handleNovaTelegramEvent }    = await import("../telegram/telegram-turn.js");
const { normalizeTelegramUpdate }    = await import("../telegram/telegram-event.js");
const { parseUnderstandingResponse } = await import("../brains/understanding-parser.js");
const { handleNovaTurn }             = await import("../entry.js");
const { resolveLearnerForAccount }   = await import("../product/learner-identity.js");
const { webLearnerId }               = await import("../product/learner-key.js");
const { ensureSetupProfile, saveSetup } = await import("../product/setup.js");
const { loadGoals, saveGoals }       = await import("../product/goals.js");
const { loadNovaToday }              = await import("../product/today.js");
const { loadNovaPlanner }            = await import("../product/planner.js");
const { loadNovaProgress }           = await import("../product/progress.js");
const { linkTelegramChat, linkTokenExpiry } = await import("../telegram/telegram-link.js");

import type { InlineButton, TelegramClient } from "../telegram/telegram.types.js";

const STAMP = Date.now();
const clock = new Date();

// ── Telegram and the model, stood in ──────────────────────────────────────────

const sent: Array<{ chatId: string; text: string; buttons: InlineButton[][] }> = [];
let messageId = 9000;
const client: TelegramClient = {
  async sendMessage(chatId, text, buttons) { sent.push({ chatId, text, buttons: buttons ?? [] }); return { ok: true as const, messageId: ++messageId }; },
  async answerCallback() {}, async clearButtons() {}, async setChatCommands() {},
};

// What the Response Brain was shown: the only place a goal can reach a reply from.
const worded: Array<{ layer: string; prompt: string }> = [];
const respond = async (layer: string, prompt: string) => {
  worded.push({ layer, prompt });
  return { reply: "WORDED", reasoningMode: "direct" as const, confidence: 0.9, stateUpdates: undefined, investigationUpdate: null, followUpCheck: null };
};

const BASE = { intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0, disclosureClass: "none", ambiguityScore: 0.1, routingSignal: "coaching_only", secondaryIntents: [], sessionIntent: "none", reality: [] };
const REQ  = { clarity: "clear", changeOfMind: false, action: "none", confidence: 0.9, promptAnswer: null, availableMinutes: null, availableMinutesMax: null, sessionOutcome: null, deferUntil: null, struggleTopic: null, exam: null, asks: "none", setup: null };
const model = (over: Record<string, unknown> = {}, req: Record<string, unknown> = {}) => ({ ...BASE, ...over, request: { ...REQ, ...req } });
const understandAs = (output: Record<string, unknown>) => (async (text: string) => parseUnderstandingResponse(JSON.stringify(output), text)) as never;
const ABOUT_ME = model({}, { asks: "about_me" });

let updateId = 600_000;
const onTelegram = (chat: string, text: string, output: Record<string, unknown>) => {
  const event = normalizeTelegramUpdate({ update_id: updateId++, message: { message_id: updateId, chat: { id: Number(chat), type: "private" }, from: { id: Number(chat) }, text } });
  assert.notEqual(event.kind, "ignored");
  const generate = (async () => { throw new Error("no model in tests"); }) as never;
  return handleNovaTelegramEvent(event as never, { client, now: () => clock, webUrl: "https://nova.test", respond, generate, understand: understandAs(output) });
};
const onWeb = (id: string, text: string, output: Record<string, unknown>) =>
  handleNovaTurn({ platformChatId: id, text, onboardingDone: true, surface: "web", awaitPersistence: true, timestamp: clock, understand: understandAs(output), respond });

// ── Accounts ──────────────────────────────────────────────────────────────────

const accounts: string[] = [];
const chats: string[] = [];
let n = 0;

// What sign-up and the quiz leave behind: a User, and a UserProfile whose
// companion is Nova and which holds the answer to "What are you working
// toward right now?" (null: the question was skipped). Then the first request
// of the web app, which makes the learner's row. No Nova profile yet.
async function signUp(goal: string | null) {
  const user = await prisma.user.create({ data: { email: `goal_${STAMP}_${++n}@test.local`, name: `Learner ${n}` }, select: { id: true } });
  accounts.push(user.id);
  await prisma.userProfile.create({ data: { userId: user.id, primaryPersona: "nova", onboardingComplete: true, primaryGoal30d: goal, secondaryDomains: [], aspirationWords: [] } });
  const learner = await resolveLearnerForAccount(user.id, "Asha");
  assert.equal(learner.kind, "learner");
  return { userId: user.id, id: (learner as { platformChatId: string }).platformChatId };
}

const SETUP = { subjects: [{ name: "Operating Systems", topics: ["Deadlocks", "Paging"] }], exams: [], dailyMinutes: 60, studyTime: "evening" };
const setUp = async (id: string, draft: unknown = SETUP) => assert.equal((await saveSetup(id, draft, clock)).status, "saved");

const stored = async (id: string) =>
  (await prisma.messengerUser.findFirstOrThrow({ where: { platformChatId: id }, select: { novaAcademicProfile: { select: { goals: true } } } })).novaAcademicProfile?.goals ?? null;

// The goal as each page's own read model returns it.
async function shown(id: string) {
  const [today, planner, progress] = await Promise.all([loadNovaToday(id, { now: clock }), loadNovaPlanner(id, { now: clock }), loadNovaProgress(id, { now: clock })]);
  assert.equal(today.status, "ready"); assert.equal(planner.status, "ready"); assert.equal(progress.status, "ready");
  return {
    today:    (today as { goals: string[] }).goals,
    planner:  (planner as { goals: string[] }).goals,
    progress: (progress as { goals: string[] }).goals,
    plannerSaysNoGoals: (planner as { unknowns: string[] }).unknowns.includes("no_goals"),
  };
}
const everywhere = (goals: string[]) => ({ today: goals, planner: goals, progress: goals, plannerSaysNoGoals: goals.length === 0 });

before(async () => { await prisma.$queryRaw`SELECT 1`; });
after(async () => {
  await prisma.messengerUser.deleteMany({ where: { OR: [{ platformChatId: { in: chats } }, { platformChatId: { in: accounts.map(a => webLearnerId(a)) } }] } });
  await prisma.user.deleteMany({ where: { id: { in: accounts } } });
  await prisma.$disconnect();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. From sign-up to every page
// ══════════════════════════════════════════════════════════════════════════════

test("a goal given at sign-up is on Today, the Planner and Progress after the first setup", async () => {
  const me = await signUp("  Clear my OS   midterm with an A ");
  assert.equal(await stored(me.id), null, "sign-up alone makes no Nova profile");
  // Before setup, the editor already shows what is about to become the goal, and reading it wrote nothing.
  assert.deepEqual(await loadGoals(me.id), ["Clear my OS midterm with an A"]);
  assert.equal(await stored(me.id), null);

  await setUp(me.id);
  assert.deepEqual(await stored(me.id), ["Clear my OS midterm with an A"]);
  assert.deepEqual(await shown(me.id), everywhere(["Clear my OS midterm with an A"]));
  assert.deepEqual(await loadGoals(me.id), ["Clear my OS midterm with an A"]);
});

test("a learner who skipped the question has no goal anywhere, and none is made up", async () => {
  for (const answer of [null, "", "   "]) {
    const me = await signUp(answer);
    assert.deepEqual(await loadGoals(me.id), []);
    await setUp(me.id);
    assert.deepEqual(await stored(me.id), []);
    assert.deepEqual(await shown(me.id), everywhere([]));
  }
});

test("a profile made by the first chat message, before the setup form, starts with the sign-up goal too", async () => {
  const me = await signUp("Learn SQL for my new role");
  assert.ok(await ensureSetupProfile(me.id));
  assert.deepEqual(await stored(me.id), ["Learn SQL for my new role"]);
  await setUp(me.id);
  assert.deepEqual(await shown(me.id), everywhere(["Learn SQL for my new role"]));
});

test("two first saves at the same moment make one profile holding the goal once", async () => {
  // A double click on the setup form.
  const me = await signUp("Finish my thesis draft");
  const results = await Promise.all([saveSetup(me.id, SETUP, clock), saveSetup(me.id, SETUP, clock)]);
  assert.deepEqual(results.map(r => r.status), ["saved", "saved"]);
  assert.deepEqual(await stored(me.id), ["Finish my thesis draft"]);
  assert.equal(await prisma.novaAcademicProfile.count({ where: { user: { platformChatId: me.id } } }), 1);
});

test("a first chat message and a first setup save at the same moment still seed the goal once", async () => {
  // Neither call is retried here: if either fails under contention, this test fails.
  const me = await signUp("Pass the driving theory test");
  const [saved, ensured] = await Promise.all([saveSetup(me.id, SETUP, clock), ensureSetupProfile(me.id)]);
  assert.equal(saved.status, "saved");
  assert.ok(ensured);
  assert.deepEqual(await stored(me.id), ["Pass the driving theory test"]);
  assert.equal(await prisma.novaAcademicProfile.count({ where: { user: { platformChatId: me.id } } }), 1);
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. Editing and clearing
// ══════════════════════════════════════════════════════════════════════════════

test("an edit replaces the goals and every page shows the new ones on its next load", async () => {
  const me = await signUp("Clear my OS midterm");
  await setUp(me.id);

  assert.deepEqual(await saveGoals(me.id, [" Clear my OS midterm ", "Get a summer internship", "", "get a summer internship"]), { status: "saved", goals: ["Clear my OS midterm", "Get a summer internship"] });
  assert.deepEqual(await shown(me.id), everywhere(["Clear my OS midterm", "Get a summer internship"]));

  assert.equal((await saveGoals(me.id, ["Build a compiler", "Read CLRS", "Run a 10k"])).status, "saved");
  assert.deepEqual(await shown(me.id), everywhere(["Build a compiler", "Read CLRS", "Run a 10k"]));
});

test("a list that is refused changes nothing", async () => {
  const me = await signUp("Keep this one");
  await setUp(me.id);
  assert.deepEqual(await saveGoals(me.id, ["a1", "b2", "c3", "d4"]), { status: "invalid", error: "too_many", message: "At most 3 goals." });
  assert.equal((await saveGoals(me.id, ["x".repeat(201)])).status, "invalid");
  assert.equal((await saveGoals(me.id, { goals: ["sneaky"] })).status, "invalid");
  assert.deepEqual(await stored(me.id), ["Keep this one"]);
});

test("a cleared goal stays cleared: through later setup saves, a changed sign-up answer and the chat's own profile check", async () => {
  const me = await signUp("The goal from the quiz");
  await setUp(me.id);
  assert.deepEqual(await saveGoals(me.id, []), { status: "saved", goals: [] });
  assert.deepEqual(await shown(me.id), everywhere([]));

  await setUp(me.id);                                                                       // the same setup again
  await setUp(me.id, { subjects: [{ name: "Databases", topics: ["SQL joins"] }], exams: [], dailyMinutes: 90, studyTime: "night" });   // a different one
  assert.ok(await ensureSetupProfile(me.id));
  await prisma.userProfile.update({ where: { userId: me.userId }, data: { primaryGoal30d: "A newer answer on the account" } });
  await setUp(me.id);
  await resolveLearnerForAccount(me.userId, "Asha");

  assert.deepEqual(await stored(me.id), []);
  assert.deepEqual(await loadGoals(me.id), []);
  assert.deepEqual(await shown(me.id), everywhere([]));
});

test("goals the learner set are never overwritten by the sign-up answer", async () => {
  const me = await signUp("Old answer");
  await setUp(me.id);
  await saveGoals(me.id, ["What I actually want now"]);
  await prisma.userProfile.update({ where: { userId: me.userId }, data: { primaryGoal30d: "Old answer, changed" } });
  await setUp(me.id, { subjects: [{ name: "Maths", topics: ["Limits"] }], exams: [], dailyMinutes: null, studyTime: null });
  assert.deepEqual(await stored(me.id), ["What I actually want now"]);
});

test("goals saved before setup are kept as saved: the sign-up answer is not added behind them", async () => {
  const cleared = await signUp("From the quiz");
  assert.deepEqual(await saveGoals(cleared.id, []), { status: "saved", goals: [] });
  await setUp(cleared.id);
  assert.deepEqual(await stored(cleared.id), []);

  const replaced = await signUp("From the quiz");
  await saveGoals(replaced.id, ["My own words"]);
  await setUp(replaced.id);
  assert.deepEqual(await stored(replaced.id), ["My own words"]);
});

test("saving goals touches nothing else the learner has", async () => {
  const me = await signUp("Start");
  await setUp(me.id);
  const before = await prisma.novaAcademicProfile.findFirstOrThrow({
    where:  { user: { platformChatId: me.id } },
    select: { onboardingComplete: true, dailyStudyMinutes: true, preferredStudyTime: true, timezone: true, subjects: { select: { name: true, topics: { select: { name: true, masteryProbability: true, reviewCount: true } } } }, _count: { select: { studySessions: true, exams: true, tasks: true } } },
  });
  await saveGoals(me.id, ["Something else entirely"]);
  await saveGoals(me.id, []);
  const afterwards = await prisma.novaAcademicProfile.findFirstOrThrow({
    where:  { user: { platformChatId: me.id } },
    select: { onboardingComplete: true, dailyStudyMinutes: true, preferredStudyTime: true, timezone: true, subjects: { select: { name: true, topics: { select: { name: true, masteryProbability: true, reviewCount: true } } } }, _count: { select: { studySessions: true, exams: true, tasks: true } } },
  });
  assert.deepEqual(afterwards, before);
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. Whose goals
// ══════════════════════════════════════════════════════════════════════════════

test("one learner's goals are not another's to read or change", async () => {
  const mine   = await signUp("Mine: pass the bar exam");
  const theirs = await signUp("Theirs: learn to swim");
  await setUp(mine.id); await setUp(theirs.id);

  await saveGoals(theirs.id, ["Theirs, edited"]);
  assert.deepEqual(await stored(mine.id), ["Mine: pass the bar exam"]);
  assert.deepEqual(await shown(mine.id), everywhere(["Mine: pass the bar exam"]));

  await saveGoals(theirs.id, []);
  assert.deepEqual(await loadGoals(mine.id), ["Mine: pass the bar exam"]);
  assert.deepEqual(await loadGoals(theirs.id), []);

  // A key nobody is behind reaches nothing and creates nothing.
  const stranger = webLearnerId(`nobody_${STAMP}`);
  assert.equal(await loadGoals(stranger), null);
  assert.deepEqual(await saveGoals(stranger, ["Planted"]), { status: "not_ready" });
  assert.equal(await prisma.messengerUser.count({ where: { platformChatId: stranger } }), 0);
});

test("a new learner never starts with another account's sign-up answer", async () => {
  const other = await signUp("Somebody else's goal");
  const me    = await signUp(null);
  await setUp(other.id); await setUp(me.id);
  assert.deepEqual(await stored(me.id), []);
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. Nova's context, on the web and on Telegram
// ══════════════════════════════════════════════════════════════════════════════

const token = (k: number) => `${STAMP}`.padStart(16, "0") + `${k}`.padStart(16, "g");
async function connectTelegram(userId: string, k: number) {
  const chat = `${STAMP}${70 + k}`;
  chats.push(chat);
  await prisma.userProfile.update({ where: { userId }, data: { telegramConnectToken: token(k), telegramConnectTokenExpiresAt: linkTokenExpiry(clock) } });
  const link = await linkTelegramChat(token(k), { id: chat, type: "private" }, clock);
  assert.equal(link.status, "linked");
  return chat;
}

test("web and Telegram speak from the same goals, and connecting Telegram keeps them", async () => {
  const me = await signUp("Clear my OS midterm with an A");
  await setUp(me.id);

  worded.length = 0;
  await onWeb(me.id, "what am I working toward?", ABOUT_ME);
  assert.ok(worded.length > 0, "the web turn was worded by the model");
  assert.match(worded.at(-1)!.layer, /## Working toward[^\n]*\n- Clear my OS midterm with an A/);
  assert.doesNotMatch(worded.at(-1)!.layer, /Name: Student|Year: unknown|Major: unknown|Institution: unknown/);

  // Ordinary conversation also carries who they are: the name on the account, and nothing invented beside it.
  await onWeb(me.id, "hey", model());
  assert.match(worded.at(-1)!.layer, /## Student\nName: Asha\nJoined: /);
  assert.match(worded.at(-1)!.layer, /- Clear my OS midterm with an A/);

  const chat = await connectTelegram(me.userId, 1);
  assert.deepEqual(await loadGoals(chat), ["Clear my OS midterm with an A"], "the same row, found by the chat now");
  assert.deepEqual(await shown(chat), everywhere(["Clear my OS midterm with an A"]));

  // Edited on the web (the account now resolves to the chat's learner); Telegram's next reply has it.
  const viaWeb = (await resolveLearnerForAccount(me.userId, "Asha")) as { platformChatId: string };
  assert.equal(viaWeb.platformChatId, chat);
  await saveGoals(viaWeb.platformChatId, ["Clear my OS midterm with an A", "Land a systems internship"]);

  worded.length = 0;
  await onTelegram(chat, "what am I working toward?", ABOUT_ME);
  assert.ok(worded.length > 0, "the Telegram turn was worded by the model");
  assert.match(worded.at(-1)!.layer, /- Clear my OS midterm with an A\n- Land a systems internship/);
  assert.doesNotMatch(worded.at(-1)!.layer, /Name: Student|Year: unknown|Major: unknown|Institution: unknown/);

  // Cleared: neither surface is told of a goal, so neither has one to state.
  await saveGoals(chat, []);
  worded.length = 0;
  await onTelegram(chat, "what am I working toward?", ABOUT_ME);
  await onWeb(chat, "what am I working toward?", ABOUT_ME);
  assert.equal(worded.length, 2);
  for (const { layer } of worded) {
    assert.doesNotMatch(layer, /Working toward/);
    assert.doesNotMatch(layer, /Clear my OS midterm|Land a systems internship/);
  }
});

test("a question about the subject matter is answered without the learner's goal", async () => {
  const me = await signUp("Clear my OS midterm with an A");
  await setUp(me.id);
  worded.length = 0;
  await onWeb(me.id, "what is a deadlock?", model({ topic: "Deadlocks", topicConfidence: 0.9 }, { asks: "knowledge" }));
  assert.ok(worded.length > 0);
  assert.doesNotMatch(worded.at(-1)!.layer, /Working toward|Clear my OS midterm/);
});

test("a learner with no goal and no name is described to the model by neither", async () => {
  const user = await prisma.user.create({ data: { email: `goal_${STAMP}_anon@test.local` }, select: { id: true } });
  accounts.push(user.id);
  await prisma.userProfile.create({ data: { userId: user.id, primaryPersona: "nova", onboardingComplete: true, secondaryDomains: [], aspirationWords: [] } });
  const id = ((await resolveLearnerForAccount(user.id, null)) as { platformChatId: string }).platformChatId;
  await setUp(id);

  worded.length = 0;
  await onWeb(id, "hey", model());
  assert.ok(worded.length > 0);
  const layer = worded.at(-1)!.layer;
  assert.doesNotMatch(layer, /Name:|Working toward|Year:|Major:|Institution:/);
  assert.match(layer, /## Student\nJoined: /);
});

// ══════════════════════════════════════════════════════════════════════════════
// The learner's own calendar, from the first plan
// ══════════════════════════════════════════════════════════════════════════════

test("a study profile made by setup takes the account's timezone, so its first dates are counted on the learner's calendar", async () => {
  const me = await signUp(null);
  // A zone whose calendar day is not UTC's at this moment, when there is one
  // (eleven hours either side; for two hours around noon UTC there is none).
  const utcDay = clock.toISOString().slice(0, 10);
  const zone = ["Etc/GMT-11", "Etc/GMT+11"].find(z => new Intl.DateTimeFormat("en-CA", { timeZone: z }).format(clock) !== utcDay) ?? "Etc/GMT+11";
  await prisma.userProfile.update({ where: { userId: me.userId }, data: { timezone: zone } });
  const localDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(d);
  const examDay = localDay(new Date(clock.getTime() + 2 * 86_400_000));
  await setUp(me.id, { ...SETUP, exams: [{ subjectName: "Operating Systems", date: examDay, title: null }] });

  const profile = await prisma.messengerUser.findFirstOrThrow({ where: { platformChatId: me.id }, select: { novaAcademicProfile: { select: { timezone: true } } } });
  assert.equal(profile.novaAcademicProfile?.timezone, zone);
  const today = await loadNovaToday(me.id, { now: clock });
  assert.ok(today.status === "ready");
  assert.equal(today.nextDeadline?.daysUntil, 2, "two days on their calendar, whatever the day is in UTC");

  // A zone the learner already has is never replaced by the account's.
  await prisma.userProfile.update({ where: { userId: me.userId }, data: { timezone: "Asia/Kolkata" } });
  await setUp(me.id);
  assert.equal((await prisma.messengerUser.findFirstOrThrow({ where: { platformChatId: me.id }, select: { novaAcademicProfile: { select: { timezone: true } } } })).novaAcademicProfile?.timezone, zone);
});
