/**
 * Which Telegram chats are connected to Kivo — real Postgres integration test.
 *
 * The webhook asks isLinkedTelegramChat before it writes anything for a chat
 * or hands it to a companion. A chat that is not connected is told how to
 * connect and nothing else; before this it was given a Rex row and Rex's gym
 * onboarding, which could then refuse the learner's own connect link.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

import "./test-database.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";

const { prisma } = await import("@repo/db/client");
const { isLinkedTelegramChat, linkTelegramChat, linkTokenExpiry } = await import("../telegram/telegram-link.js");
const { resolveLearnerForAccount } = await import("../product/learner-identity.js");

const STAMP = Date.now();
let n = 0;
const chatId = () => `5${String(++n).padStart(2, "0")}${String(STAMP).slice(-10)}`;
const rowsFor = (chat: string) => prisma.messengerUser.findMany({
  where:  { OR: [{ platformChatId: chat }, { platformChatId: { startsWith: `${chat}:` } }] },
  select: { platform: true, persona: true, intakeComplete: true },
});

async function account(persona: "nova" | "rex", over: { chat?: string; token?: string } = {}) {
  const key = `${STAMP}${++n}`;
  const user = await prisma.user.create({ data: { email: `u${key}@unlinked-itest.local`, name: `Unlinked ${key}` } });
  await prisma.userProfile.create({
    data: {
      userId: user.id, onboardingComplete: true, primaryPersona: persona,
      telegramChatId: over.chat ?? null, telegramConnected: over.chat !== undefined,
      telegramConnectToken: over.token ?? null, telegramConnectTokenExpiresAt: over.token ? linkTokenExpiry() : null,
    },
  });
  return user.id;
}
const token = () => `tok${STAMP}${++n}`.padEnd(32, "x");

after(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: "@unlinked-itest.local" } } });
  await prisma.messengerUser.deleteMany({ where: { OR: [{ displayName: { startsWith: "Unlinked " } }, { username: `unlinked_${STAMP}` }] } });
  await prisma.$disconnect();
});

test("a chat Kivo has never heard of is not connected, and asking leaves nothing behind", async () => {
  const chat = chatId();
  for (let i = 0; i < 3; i++) assert.equal(await isLinkedTelegramChat(chat), false);
  assert.deepEqual(await rowsFor(chat), []);
  assert.equal(await prisma.userProfile.count({ where: { telegramChatId: chat } }), 0);
});

test("a row left by a chat that only ever wrote to the bot is not a connection", async () => {
  const chat = chatId();
  // What the webhook used to make for any chat that said anything: a Rex row, setup not started.
  await prisma.messengerUser.create({ data: { platform: "telegram", platformChatId: chat, username: `unlinked_${STAMP}`, intakeStep: "not_started" } });
  assert.deepEqual(await rowsFor(chat), [{ platform: "telegram", persona: "rex", intakeComplete: false }]);
  assert.equal(await isLinkedTelegramChat(chat), false);

  // Part-way through Rex's setup, with no account: still not a connection.
  await prisma.messengerUser.updateMany({ where: { platformChatId: chat }, data: { intakeStep: "ga_goal" } });
  assert.equal(await isLinkedTelegramChat(chat), false);
});

test("a Rex chat that finished Rex's setup is connected, as it always was", async () => {
  const chat = chatId();
  await prisma.messengerUser.create({ data: { platform: "telegram", platformChatId: chat, username: `unlinked_${STAMP}`, persona: "rex", intakeComplete: true } });
  assert.equal(await isLinkedTelegramChat(chat), true);
});

test("a Rex account's chat is connected from the moment it is linked, before Rex's setup is finished", async () => {
  const chat = chatId();
  await account("rex", { chat });
  assert.equal(await isLinkedTelegramChat(chat), true, "the account names the chat, with no row for it yet");
  await prisma.messengerUser.create({ data: { platform: "telegram", platformChatId: chat, username: `unlinked_${STAMP}`, persona: "rex", intakeStep: "ga_name" } });
  assert.equal(await isLinkedTelegramChat(chat), true, "and part-way through setup");
});

test("a Nova chat is connected", async () => {
  const chat = chatId();
  await prisma.messengerUser.create({ data: { platform: "telegram", platformChatId: chat, username: `unlinked_${STAMP}`, persona: "nova" } });
  assert.equal(await isLinkedTelegramChat(chat), true);
});

test("the connect link turns an unconnected chat into the Nova learner's chat, with no row made for the chat beforehand", async () => {
  const chat = chatId();
  const tok  = token();
  const userId = await account("nova", { token: tok });
  // The learner has been using Nova on the web: their row is keyed by the account.
  const web = await resolveLearnerForAccount(userId, "Unlinked web");
  assert.equal(web.kind, "learner");

  assert.equal(await isLinkedTelegramChat(chat), false);
  assert.deepEqual(await rowsFor(chat), []);

  const link = await linkTelegramChat(tok, { id: chat, type: "private" });
  assert.deepEqual([link.status, link.status === "linked" && link.companion], ["linked", "nova"]);
  assert.equal(await isLinkedTelegramChat(chat), true);
  assert.deepEqual(await rowsFor(chat), [{ platform: "telegram", persona: "nova", intakeComplete: false }], "one row: the learner's own, now keyed by the chat");
  await prisma.messengerUser.updateMany({ where: { platformChatId: chat }, data: { displayName: "Unlinked linked" } });
});

test("a wrong or used link connects nothing, and the chat stays unconnected with no row", async () => {
  const chat = chatId();
  const tok  = token();
  await account("nova", { token: tok });
  for (const bad of ["x".repeat(32), "short", `${tok}x`]) {
    assert.equal((await linkTelegramChat(bad, { id: chat, type: "private" })).status, "invalid");
  }
  assert.equal((await linkTelegramChat(tok, { id: chat, type: "group" })).status, "not_private");
  assert.equal(await isLinkedTelegramChat(chat), false);
  assert.deepEqual(await rowsFor(chat), []);
});

test("a Rex account's connect link connects the chat to Rex, as before", async () => {
  const chat = chatId();
  const tok  = token();
  await account("rex", { token: tok });
  const link = await linkTelegramChat(tok, { id: chat, type: "private" });
  assert.deepEqual([link.status, link.status === "linked" && link.companion], ["linked", "rex"]);
  assert.equal(await isLinkedTelegramChat(chat), true);
});
