/**
 * Deleting a Nova learner's account — real Postgres integration test.
 *
 * The settings page says "Permanently remove your account and all data."
 * Before this, a learner who had connected Telegram kept, after deletion,
 * the chat's own row and everything hung from it: the whole conversation
 * (what they had said about their health included), what Nova had kept from
 * it, and pending consolidation work. The chat also stayed a connected one.
 *
 * Each test builds the learner the way the product does, runs the real
 * deleteAccount, and counts what is left in the database.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

import "./test-database.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";

const { prisma }        = await import("@repo/db/client");
const { saveSetup }     = await import("../product/setup.js");
const { runNovaSessionCommand } = await import("../product/session.js");
const { deleteAccount } = await import("../../services/accountDeletion.service.js");
const { resolveLearnerForAccount } = await import("../product/learner-identity.js");
const { saveUserMessage, saveAssistantMessage } = await import("../adapters/conversation-adapter.js");
const { enqueueJob }    = await import("../consolidation/stores/consolidation-job-store.js");
const { createPairingCode } = await import("../product/extension-connection.js");
const { isLinkedTelegramChat } = await import("../telegram/telegram-link.js");
const { ensureChannel } = await import("../telegram/channel-store.js");

const STAMP = Date.now();
const SENSITIVE = `I've had the flu all week and my doctor signed me off ${STAMP}`;
let n = 0;
const chatId = () => `3${String(++n).padStart(2, "0")}${String(STAMP).slice(-10)}`;

after(async () => {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS deletion_itest_block ON "User"`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS deletion_itest_block()`);
  await prisma.user.deleteMany({ where: { email: { endsWith: "@deletion-itest.local" } } });
  await prisma.messengerUser.deleteMany({ where: { displayName: { startsWith: `Deletion ${STAMP}` } } });
  await prisma.$disconnect();
});

interface Built { userId: string; messengerId: string; profileId: string; learnerId: string; chat: string | null }

// A Nova learner with everything the product writes for one: a setup, a
// finished session with its mastery record, a conversation, what Nova kept
// from it, a pending consolidation job, a proactive message, a paired browser.
async function learner(kind: "telegram" | "web", chat: string | null = kind === "telegram" ? chatId() : null): Promise<Built> {
  const key  = `${STAMP}${++n}`;
  const name = `Deletion ${key}`;
  const user = await prisma.user.create({ data: { email: `d${key}@deletion-itest.local`, name } });
  await prisma.userProfile.create({
    data: { userId: user.id, onboardingComplete: true, primaryPersona: "nova", telegramChatId: chat, telegramConnected: chat !== null },
  });
  let learnerId = chat ?? "";
  if (chat) {
    await prisma.messengerUser.upsert({
      where:  { platform_platformChatId: { platform: "telegram", platformChatId: chat } },
      update: {},
      create: { platform: "telegram", platformChatId: chat, persona: "nova", displayName: name, aspirationWords: [], activeModules: [] },
    });
  } else {
    const resolved = await resolveLearnerForAccount(user.id, name);
    assert.equal(resolved.kind, "learner");
    learnerId = resolved.kind === "learner" ? resolved.platformChatId : "";
  }
  const messenger = await prisma.messengerUser.findFirstOrThrow({ where: { platformChatId: learnerId }, select: { id: true } });

  if (!(await prisma.novaAcademicProfile.findUnique({ where: { userId: messenger.id } }))) {
    const saved = await saveSetup(learnerId, { subjects: [{ name: "Operating Systems", topics: ["Deadlocks"] }], exams: [], dailyMinutes: 60, studyTime: null });
    assert.equal(saved.status, "saved", JSON.stringify(saved));
  }
  const profile = await prisma.novaAcademicProfile.findUniqueOrThrow({ where: { userId: messenger.id }, select: { id: true } });
  await prisma.novaAcademicProfile.update({ where: { id: profile.id }, data: { onboardingComplete: true } });

  const t0 = new Date(Date.now() - 3 * 3_600_000);
  await runNovaSessionCommand(learnerId, { action: "start", topicName: "Deadlocks", subjectName: "Operating Systems", plannedMinutes: 25 }, t0);
  await runNovaSessionCommand(learnerId, { action: "end", outcome: "good" }, new Date(t0.getTime() + 25 * 60_000));

  const now = new Date();
  const messageId = await saveUserMessage(messenger.id, SENSITIVE, { intent: "excuse", emotion: "low", signals: [] }, now);
  await saveAssistantMessage(messenger.id, "Rest first. One short pass on deadlocks when you can.", "nova_coaching", {}, now);
  await enqueueJob(messageId, messenger.id, { profileId: profile.id, patternScanRan: false, hasActiveSession: false, evidence: [] } as never);
  await prisma.userFact.create({ data: { userId: messenger.id, type: "commitment", key: `revise-${key}`, value: "Will revise deadlocks on Friday", sourceCompanion: "nova" } });
  await prisma.userReality.create({ data: { userId: messenger.id, category: "health", fact: "Student has the flu", expiresAt: new Date(now.getTime() + 86_400_000) } });
  await prisma.behavioralPattern.create({ data: { userId: messenger.id, companion: "nova", patternType: "excuse_loop", description: "Says they are too busy", confidence: 0.6 } });
  await ensureChannel(profile.id);
  await prisma.novaProactiveMessage.create({ data: { profileId: profile.id, eventType: "daily_checkin", occurrenceKey: `checkin:${key}`, status: "sent", text: "Checking in.", firedAt: now, cooldownUntil: now, priority: 3, confidence: 1 } });
  await createPairingCode(user.id);
  return { userId: user.id, messengerId: messenger.id, profileId: profile.id, learnerId, chat };
}

// Every table that holds something of the learner's, counted.
async function census(l: Built) {
  const byUser = { userId: l.messengerId }, byProfile = { profileId: l.profileId };
  const [account, profile, browsers, identity, conversation, facts, realities, patterns, jobs,
         study, sessions, subjects, mastery, history, proactive, channel] = await Promise.all([
    prisma.user.count({ where: { id: l.userId } }),
    prisma.userProfile.count({ where: { userId: l.userId } }),
    prisma.novaExtensionConnection.count({ where: { userId: l.userId } }),
    prisma.messengerUser.count({ where: { id: l.messengerId } }),
    prisma.companionMessage.count({ where: byUser }),
    prisma.userFact.count({ where: byUser }),
    prisma.userReality.count({ where: byUser }),
    prisma.behavioralPattern.count({ where: byUser }),
    prisma.novaConsolidationJob.count({ where: byUser }),
    prisma.novaAcademicProfile.count({ where: { id: l.profileId } }),
    prisma.novaStudySession.count({ where: byProfile }),
    prisma.novaSubject.count({ where: byProfile }),
    prisma.novaTopicMastery.count({ where: { subject: byProfile } }),
    prisma.novaTopicMasterySnapshot.count({ where: byProfile }),
    prisma.novaProactiveMessage.count({ where: byProfile }),
    prisma.novaTelegramChannel.count({ where: byProfile }),
  ]);
  return { account, profile, browsers, identity, conversation, facts, realities, patterns, jobs, study, sessions, subjects, mastery, history, proactive, channel };
}
const NOTHING = { account: 0, profile: 0, browsers: 0, identity: 0, conversation: 0, facts: 0, realities: 0, patterns: 0, jobs: 0, study: 0, sessions: 0, subjects: 0, mastery: 0, history: 0, proactive: 0, channel: 0 };
const sensitiveLeft = () => prisma.companionMessage.count({ where: { text: { contains: String(STAMP) } } });

test("a learner who connected Telegram: the account, the study record, the chat and the whole conversation are gone", async () => {
  const l = await learner("telegram");
  const before = await census(l);
  for (const [what, count] of Object.entries(before)) assert.ok(count >= 1, `the fixture has a ${what} to delete`);
  assert.equal(before.conversation, 3, "what they said, what Nova said, and the session's closing entry");
  const sensitiveBefore = await sensitiveLeft();
  assert.equal(await isLinkedTelegramChat(l.chat!), true);

  const result = await deleteAccount(l.userId);
  assert.deepEqual(result, { deleted: true, novaProfileRemoved: true, novaProfileKept: null });

  assert.deepEqual(await census(l), NOTHING);
  assert.equal(await sensitiveLeft(), sensitiveBefore - 1, "the message about their health is not in the database");
  assert.equal(await prisma.messengerUser.count({ where: { platformChatId: l.chat! } }), 0, "no row for the chat under any platform");
  assert.equal(await isLinkedTelegramChat(l.chat!), false, "and the chat is an unconnected one again");
});

test("a learner who never connected Telegram is deleted as completely", async () => {
  const l = await learner("web");
  const before = await census(l);
  for (const [what, count] of Object.entries(before)) assert.ok(count >= 1, `the fixture has a ${what} to delete`);
  assert.deepEqual(await deleteAccount(l.userId), { deleted: true, novaProfileRemoved: true, novaProfileKept: null });
  assert.deepEqual(await census(l), NOTHING);
});

test("deleting one learner removes nothing of another's", async () => {
  const [a, b] = [await learner("telegram"), await learner("telegram")];
  const others = await census(b);
  await deleteAccount(a.userId);
  assert.deepEqual(await census(a), NOTHING);
  assert.deepEqual(await census(b), others);
  assert.equal(await isLinkedTelegramChat(b.chat!), true);
});

test("a chat two accounts both name is left whole for the other: only this account and its tie to the chat go", async () => {
  const first = await learner("telegram");
  // A second account naming the same chat (telegramChatId is not unique).
  const second = await prisma.user.create({ data: { email: `d${STAMP}shared@deletion-itest.local`, name: `Deletion ${STAMP} shared` } });
  await prisma.userProfile.create({ data: { userId: second.id, onboardingComplete: true, primaryPersona: "nova", telegramChatId: first.chat, telegramConnected: true } });
  const before = await census(first);

  assert.deepEqual(await deleteAccount(first.userId), { deleted: true, novaProfileRemoved: false, novaProfileKept: "chat_shared_with_another_account" });
  const after_ = await census(first);
  assert.deepEqual([after_.account, after_.profile, after_.browsers], [0, 0, 0], "this account, its profile and its paired browser are gone");
  assert.deepEqual({ ...after_, account: 0, profile: 0, browsers: 0 }, { ...before, account: 0, profile: 0, browsers: 0 }, "the chat, its conversation and its study record are untouched");
  assert.equal(await prisma.userProfile.count({ where: { userId: second.id, telegramChatId: first.chat } }), 1, "the other account still names the chat");
  assert.equal(await isLinkedTelegramChat(first.chat!), true);

  // The other account is now the chat's only one, and its deletion takes the rest.
  assert.deepEqual(await deleteAccount(second.id), { deleted: true, novaProfileRemoved: true, novaProfileKept: null });
  assert.deepEqual(await census(first), NOTHING);
});

test("a chat that is another companion's is not Nova's to delete", async () => {
  const chat = chatId();
  const user = await prisma.user.create({ data: { email: `d${STAMP}rex@deletion-itest.local`, name: `Deletion ${STAMP} rex` } });
  await prisma.userProfile.create({ data: { userId: user.id, onboardingComplete: true, primaryPersona: "rex", telegramChatId: chat, telegramConnected: true } });
  const row = await prisma.messengerUser.create({ data: { platform: "telegram", platformChatId: chat, persona: "rex", intakeComplete: true, displayName: `Deletion ${STAMP} rexchat`, aspirationWords: [], activeModules: [] } });
  await saveUserMessage(row.id, "leg day done", { intent: "report", emotion: "neutral", signals: [] }, new Date());

  assert.deepEqual(await deleteAccount(user.id), { deleted: true, novaProfileRemoved: false, novaProfileKept: "no_nova_profile" });
  assert.equal(await prisma.user.count({ where: { id: user.id } }), 0);
  assert.equal(await prisma.messengerUser.count({ where: { id: row.id } }), 1, "as before this change");
  assert.equal(await prisma.companionMessage.count({ where: { userId: row.id } }), 1);
});

test("deleting again is safe: nothing to do, nothing thrown, nobody else touched", async () => {
  const [l, bystander] = [await learner("telegram"), await learner("web")];
  const others = await census(bystander);
  assert.equal((await deleteAccount(l.userId)).deleted, true);
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(await deleteAccount(l.userId), { deleted: false, novaProfileRemoved: false, novaProfileKept: null });
  }
  assert.deepEqual(await deleteAccount("no-such-account"), { deleted: false, novaProfileRemoved: false, novaProfileKept: null });
  assert.deepEqual(await census(l), NOTHING);
  assert.deepEqual(await census(bystander), others);
});

test("two deletions of one account at once delete it once and neither leaves it half done", async () => {
  const l = await learner("telegram");
  const results = await Promise.allSettled([deleteAccount(l.userId), deleteAccount(l.userId)]);
  assert.ok(results.some(r => r.status === "fulfilled" && r.value.deleted), "one of them deleted it");
  assert.deepEqual(await census(l), NOTHING);
  assert.equal((await deleteAccount(l.userId)).deleted, false);
});

test("if the database fails part-way, nothing is deleted: the account and all of the learner's data are still there", async () => {
  const l = await learner("telegram");
  const before = await census(l);
  // The last step of the deletion is made to fail, for this account only.
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION deletion_itest_block() RETURNS trigger AS $$ BEGIN IF OLD.id = '${l.userId}' THEN RAISE EXCEPTION 'deletion_itest: simulated failure'; END IF; RETURN OLD; END; $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS deletion_itest_block ON "User"`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER deletion_itest_block BEFORE DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION deletion_itest_block()`);
  try {
    await assert.rejects(() => deleteAccount(l.userId));
    assert.deepEqual(await census(l), before, "the chat row and the study record deleted earlier in the transaction were rolled back");
    assert.equal(await isLinkedTelegramChat(l.chat!), true);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS deletion_itest_block ON "User"`);
  }
  // With the fault gone, the same request goes through.
  assert.deepEqual(await deleteAccount(l.userId), { deleted: true, novaProfileRemoved: true, novaProfileKept: null });
  assert.deepEqual(await census(l), NOTHING);
});
