/**
 * The daily check-in, from what onboarding stored to a recorded Telegram
 * delivery — real Postgres integration test.
 *
 *   UserProfile (check-in time, timezone, tone: written by web onboarding
 *   and Settings) → the proactive tick → decision → outbox → Telegram
 *
 * It starts from the shape found in production: a learner whose account has
 * a timezone and a check-in time, and whose study profile has no timezone.
 * Before this, that learner was never messaged first.
 *
 * Telegram and the wording model are stood in. The clock is passed in, so
 * nothing here waits for real time.
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
const { runNovaProactiveCron } = await import("../proactive/nova-proactive-cron.js");
const { saveSetup }            = await import("../product/setup.js");
const { loadAccountPreferences, ensureLearnerTimezone } = await import("../adapters/account-preferences-adapter.js");
const { dayKey }               = await import("../engines/learner-calendar.js");
const { recordLearnerTimezone } = await import("../product/learning-dna.js");
const { changeLearnerTimezone } = await import("../product/learner-timezone.js");

import type { InlineButton, SendResult, TelegramClient } from "../telegram/telegram.types.js";
import type { ProactiveWordingInput } from "../proactive/nova-proactive-response.js";

const STAMP = Date.now();
const ZONE  = "Asia/Kolkata";   // UTC+5:30, no daylight saving
// Tomorrow, so nothing written "now" by a fixture counts as recent activity.
const DAY0  = Math.floor(Date.now() / 86_400_000) + 1;
// The instant it is HH:MM in Kolkata, `day` days after DAY0.
const ist = (hhmm: string, day = 0): Date => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return new Date((DAY0 + day) * 86_400_000 + (h * 60 + m - 330) * 60_000);
};

// ── Telegram and the wording model, stood in ──────────────────────────────────

interface Sent { chatId: string; text: string; buttons: InlineButton[][] }
const sent: Sent[] = [];
const refuse = new Map<string, SendResult>();   // chatId → what Telegram answers
let messageId = 91_000;
const client: TelegramClient = {
  async sendMessage(chatId, text, buttons) {
    const refused = refuse.get(chatId);
    if (refused) return refused;
    sent.push({ chatId, text, buttons: buttons ?? [] });
    return { ok: true as const, messageId: ++messageId };
  },
  async answerCallback() {}, async clearButtons() {}, async setChatCommands() {},
};
const asked: ProactiveWordingInput[] = [];
const breaks = new Set<string>();   // learner names whose wording throws
const word = (async (input: ProactiveWordingInput) => {
  if (input.studentName && breaks.has(input.studentName)) throw new Error("wording blew up for this learner");
  asked.push(input);
  return { text: `SAID:${input.type}`, generated: true };
}) as never;
const tick = (now: Date) => runNovaProactiveCron(now, { client, word });
const to   = (chat: string) => sent.filter(s => s.chatId === chat);
const askedFor = (name: string) => asked.filter(a => a.studentName === name);

// ── A learner, as web onboarding and Telegram linking leave them ──────────────

let n = 0;
async function learner(over: {
  checkin?: string | null; accountZone?: string | null; studyZone?: string | null; style?: string | null;
  topics?: string[]; studyTime?: string | null;
} = {}) {
  const key  = `${STAMP}${++n}`;
  const chat = `9${String(n).padStart(2, "0")}${String(STAMP).slice(-10)}`;
  const name = `Checkin ${key}`;
  const user = await prisma.user.create({ data: { email: `c${key}@checkin-itest.local`, name } });
  await prisma.userProfile.create({
    data: {
      userId: user.id, onboardingComplete: true, primaryPersona: "nova", telegramChatId: chat, telegramConnected: true,
      preferredCheckInTime: over.checkin === undefined ? "11:00" : over.checkin,
      timezone: over.accountZone === undefined ? "Asia/Calcutta" : over.accountZone,   // the name browsers still report
      accountabilityStyle: over.style === undefined ? "hard" : over.style,
    },
  });
  const messenger = await prisma.messengerUser.create({
    data: { platform: "telegram", platformChatId: chat, persona: "nova", displayName: name, aspirationWords: [], activeModules: [] },
    select: { id: true },
  });
  const topics = over.topics ?? ["Deadlocks", "Paging"];
  const saved = await saveSetup(chat, { subjects: [{ name: "Operating Systems", topics }], exams: [], dailyMinutes: 120, studyTime: over.studyTime ?? null }, ist("09:00"));
  assert.equal(saved.status, "saved", JSON.stringify(saved));
  const profile = await prisma.novaAcademicProfile.findUniqueOrThrow({ where: { userId: messenger.id }, select: { id: true } });
  // Set up, whatever they listed: a learner with subjects and no topics yet is still a learner.
  await prisma.novaAcademicProfile.update({ where: { id: profile.id }, data: { timezone: over.studyZone ?? null, onboardingComplete: true } });
  return { chat, name, userId: user.id, messengerId: messenger.id, profileId: profile.id };
}
const outbox  = (profileId: string) => prisma.novaProactiveMessage.findMany({ where: { profileId }, orderBy: { firedAt: "asc" }, select: { eventType: true, status: true, occurrenceKey: true, attempts: true, localDay: true } });
const studyTz = async (profileId: string) => (await prisma.novaAcademicProfile.findUniqueOrThrow({ where: { id: profileId }, select: { timezone: true } })).timezone;

after(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: "@checkin-itest.local" } } });
  await prisma.messengerUser.deleteMany({ where: { displayName: { startsWith: `Checkin ${STAMP}` } } });
  await prisma.$disconnect();
});

// ── The reported failure ──────────────────────────────────────────────────────

test("a learner whose study profile has no timezone is no longer skipped: the account's is adopted, and the check-in arrives at the time they chose", async () => {
  const l = await learner();
  assert.equal(await studyTz(l.profileId), null, "as found in production");
  assert.deepEqual(await loadAccountPreferences(l.chat), { checkinMinute: 660, checkinTime: "11:00", timezone: ZONE });

  // Ten minutes early: nothing is sent, but Nova now knows what time it is for them.
  await tick(ist("10:50"));
  assert.equal(to(l.chat).length, 0);
  assert.equal(await studyTz(l.profileId), ZONE);
  assert.deepEqual(await outbox(l.profileId), []);

  // At the chosen time, in the learner's zone (05:30 UTC).
  const result = await tick(ist("11:00"));
  assert.equal(to(l.chat).length, 1);
  assert.equal(to(l.chat)[0]!.text, "SAID:daily_checkin");
  assert.ok((result.outcomes?.sent ?? 0) >= 1);
  const [input] = askedFor(l.name);
  assert.deepEqual([input!.type, input!.register, input!.hasStartButton, input!.asksWhatToday], ["daily_checkin", "playful", true, false]);
  assert.ok(input!.facts[0]!.startsWith("Recommended now: "), input!.facts.join(" / "));
  assert.ok(!input!.facts.join(" ").includes("nothing done yet"), "a check-in does not tell them they have not studied");
  assert.ok(to(l.chat)[0]!.buttons.flat().some(b => b.text.startsWith("Start")), "the same Start buttons /today gives");
  assert.deepEqual(await outbox(l.profileId), [{ eventType: "daily_checkin", status: "sent", occurrenceKey: `checkin:${dayKey(ist("11:00"), ZONE)}`, attempts: 1, localDay: dayKey(ist("11:00"), ZONE) }]);
  assert.equal(await prisma.companionMessage.count({ where: { userId: l.messengerId, role: "assistant" } }), 1, "in the conversation log once it was actually said");
});

test("later ticks, a restart and the rest of the day send nothing more; the next day's check-in is its own", async () => {
  const l = await learner();
  for (const time of ["11:00", "11:05", "11:10", "12:30", "13:55", "18:00", "21:30"]) await tick(ist(time));
  assert.equal(to(l.chat).length, 1, "one check-in, and no evening nudge on top of it");
  assert.equal((await outbox(l.profileId)).length, 1);

  await tick(ist("10:59", 1));
  assert.equal(to(l.chat).length, 1);
  await tick(ist("11:02", 1));
  assert.equal(to(l.chat).length, 2);
  assert.deepEqual((await outbox(l.profileId)).map(r => r.occurrenceKey), [`checkin:${dayKey(ist("11:00"), ZONE)}`, `checkin:${dayKey(ist("11:00", 1), ZONE)}`]);
});

// ── A scheduler that was not running at the chosen time ───────────────────────

test("a tick that runs late still delivers the check-in inside its window", async () => {
  const l = await learner();
  await tick(ist("13:40"));   // nothing ran between 11:00 and now
  assert.equal(to(l.chat).length, 1);
});

test("a check-in whose window passed while nothing ran is not sent late, and leaves no row behind", async () => {
  const l = await learner();
  for (const time of ["14:00", "14:30", "19:00"]) await tick(ist(time));
  assert.equal(to(l.chat).length, 0);
  assert.deepEqual(await outbox(l.profileId), []);
  // Tomorrow is unaffected by today's miss.
  await tick(ist("11:20", 1));
  assert.equal(to(l.chat).length, 1);
});

// ── Delivery ──────────────────────────────────────────────────────────────────

test("a send Telegram did not accept is not recorded as sent, is retried on the next tick, and is then sent once", async () => {
  const l = await learner();
  refuse.set(l.chat, { ok: false, kind: "server", detail: "http 502" });
  const failed = await tick(ist("11:00"));
  assert.ok((failed.outcomes?.send_failed ?? 0) >= 1, JSON.stringify(failed.outcomes));
  assert.equal(to(l.chat).length, 0);
  assert.deepEqual((await outbox(l.profileId)).map(r => [r.status, r.attempts]), [["failed", 1]]);
  assert.equal(await prisma.companionMessage.count({ where: { userId: l.messengerId } }), 0, "nothing was said, so nothing is logged as said");

  refuse.delete(l.chat);
  await tick(ist("11:05"));
  assert.equal(to(l.chat).length, 1);
  assert.deepEqual((await outbox(l.profileId)).map(r => [r.status, r.attempts]), [["sent", 2]]);
  assert.equal(askedFor(l.name).length, 1, "worded once; the retry sends the stored text");
  await tick(ist("11:10"));
  assert.equal(to(l.chat).length, 1);
});

test("a failed check-in that is still unsent when its window closes is dropped, not delivered hours later", async () => {
  const l = await learner();
  refuse.set(l.chat, { ok: false, kind: "server", detail: "http 502" });
  await tick(ist("13:50"));
  refuse.delete(l.chat);
  const late = await tick(ist("14:10"));
  assert.equal(to(l.chat).length, 0);
  assert.ok((late.outcomes?.held ?? 0) >= 1, JSON.stringify(late.outcomes));
});

test("a learner who blocked the bot is marked unreachable and not tried again until they write", async () => {
  const l = await learner();
  refuse.set(l.chat, { ok: false, kind: "blocked", detail: "Forbidden: bot was blocked by the user" });
  await tick(ist("11:00"));
  assert.deepEqual((await outbox(l.profileId)).map(r => r.status), ["abandoned"]);
  assert.ok((await prisma.novaTelegramChannel.findUniqueOrThrow({ where: { profileId: l.profileId } })).undeliverableSince !== null);
  refuse.delete(l.chat);
  const next = await tick(ist("11:05", 1));
  assert.equal(to(l.chat).length, 0);
  assert.ok((next.outcomes?.undeliverable ?? 0) >= 1);
});

test("one learner's failure does not stop the others in the same tick", async () => {
  const broken = await learner();
  const fine   = await learner();
  breaks.add(broken.name);
  const result = await tick(ist("11:00"));
  assert.ok(result.errors >= 1);
  assert.equal(to(fine.chat).length, 1);
  assert.equal(to(broken.chat).length, 0);
  // The broken learner's claim is picked up again once whatever broke is fixed.
  breaks.delete(broken.name);
  await tick(ist("11:05"));
  assert.equal(to(broken.chat).length, 1);
  assert.deepEqual((await outbox(broken.profileId)).map(r => r.status), ["sent"]);
});

// ── Who is eligible, and what they are told ───────────────────────────────────

test("a learner can change their own timezone; a device reporting another one cannot; the check-in follows the change", async () => {
  const l = await learner();                       // check-in at 11:00, account zone Kolkata
  await tick(ist("10:50"));
  assert.equal(await studyTz(l.profileId), ZONE);

  // A second device, somewhere else, opens the dashboard: nothing moves.
  assert.deepEqual(await recordLearnerTimezone(l.chat, "Europe/London"), { ok: true, timezone: ZONE, changed: false });
  assert.equal(await studyTz(l.profileId), ZONE);

  // The learner has moved, and says so in Settings.
  assert.deepEqual(await changeLearnerTimezone(l.chat, "Asia/Dubai"), { ok: true, timezone: "Asia/Dubai", changed: true });
  assert.deepEqual(await changeLearnerTimezone(l.chat, "Asia/Dubai"), { ok: true, timezone: "Asia/Dubai", changed: false }, "choosing it again changes nothing");
  // Not a timezone: refused, and the one on record stays.
  assert.deepEqual(await changeLearnerTimezone(l.chat, "Mars/Olympus_Mons"), { ok: false, error: "invalid_timezone" });
  assert.deepEqual(await changeLearnerTimezone(l.chat, "(UTC+05:30) Mumbai, Kolkata"), { ok: false, error: "invalid_timezone" });
  assert.equal(await studyTz(l.profileId), "Asia/Dubai");

  // 11:00 in Kolkata is 09:30 in Dubai: no longer their check-in time.
  await tick(ist("11:00"));
  assert.equal(to(l.chat).length, 0);
  // 11:00 in Dubai (12:30 in Kolkata) is.
  await tick(ist("12:30"));
  assert.deepEqual(to(l.chat).map(s => s.text), ["SAID:daily_checkin"]);
  assert.deepEqual((await outbox(l.profileId)).map(r => [r.eventType, r.status, r.localDay]), [["daily_checkin", "sent", dayKey(ist("12:30"), "Asia/Dubai")]]);
});

test("if the Start buttons cannot be opened, nothing is sent and nothing is written off: the next tick sends it once", async () => {
  const l = await learner();
  await tick(ist("10:50"));
  // Opening the prompt fails, for this learner only.
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION checkin_itest_block() RETURNS trigger AS $$ BEGIN IF NEW."profileId" = '${l.profileId}' THEN RAISE EXCEPTION 'checkin_itest: simulated failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS checkin_itest_block ON "NovaTelegramPrompt"`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER checkin_itest_block BEFORE INSERT ON "NovaTelegramPrompt" FOR EACH ROW EXECUTE FUNCTION checkin_itest_block()`);
  try {
    const failed = await tick(ist("11:00"));
    assert.ok(failed.errors >= 1, "the failure is counted");
    assert.equal(to(l.chat).length, 0, "nothing reached Telegram");
    // Worded and waiting. Not "sending", which a later tick would have to
    // treat as possibly delivered and never send again.
    assert.deepEqual((await outbox(l.profileId)).map(r => [r.status, r.attempts]), [["ready", 0]]);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS checkin_itest_block ON "NovaTelegramPrompt"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS checkin_itest_block()`);
  }
  await tick(ist("11:05"));
  await tick(ist("11:10"));
  assert.deepEqual(to(l.chat).map(s => s.text), ["SAID:daily_checkin"]);
  assert.deepEqual((await outbox(l.profileId)).map(r => [r.status, r.attempts]), [["sent", 1]]);
});

test("a learner nobody has a timezone for is not messaged, and is counted as such instead of vanishing", async () => {
  const l = await learner({ accountZone: null });
  const none = await tick(ist("11:00"));
  assert.equal(to(l.chat).length, 0);
  assert.ok((none.outcomes?.no_timezone ?? 0) >= 1, JSON.stringify(none.outcomes));
  assert.deepEqual(await outbox(l.profileId), []);
  // Settings on the web can hold a label that is not a zone: that is not adopted either.
  const odd = await learner({ accountZone: "(UTC+05:30) Mumbai, Kolkata" });
  await tick(ist("11:00"));
  assert.equal(await studyTz(odd.profileId), null);
  assert.equal(to(odd.chat).length, 0);
});

test("a timezone the learner's own device reported is never replaced by the account's", async () => {
  const l = await learner({ studyZone: "America/New_York", accountZone: "Asia/Calcutta" });
  assert.equal(await ensureLearnerTimezone({ id: l.profileId, timezone: "America/New_York" }, l.chat), "America/New_York");
  await tick(ist("11:00"));   // 01:30 in New York: not their 11:00
  assert.equal(to(l.chat).length, 0);
  assert.equal(await studyTz(l.profileId), "America/New_York");
});

test("a learner with nothing planned is asked what they are working on, and no topic is invented", async () => {
  const l = await learner({ topics: [] });
  const result = await tick(ist("11:00"));
  assert.equal(to(l.chat).length, 1, JSON.stringify(result.outcomes));
  const [input] = askedFor(l.name);
  assert.deepEqual([input!.type, input!.asksWhatToday, input!.hasStartButton], ["daily_checkin", true, false]);
  assert.deepEqual(input!.facts, ["Nothing is planned for today yet"]);
  assert.deepEqual(to(l.chat)[0]!.buttons, []);
});

test("a learner who chose no time, or whose stored time is not a time, is nudged in their study window as before", async () => {
  const none = await learner({ checkin: null, studyTime: "evening" });
  const junk = await learner({ checkin: "soon", studyTime: "evening" });
  await tick(ist("11:00"));
  assert.equal(to(none.chat).length + to(junk.chat).length, 0);
  await tick(ist("18:30"));
  assert.deepEqual([askedFor(none.name)[0]!.type, askedFor(junk.name)[0]!.type], ["daily_nudge", "daily_nudge"]);
});

test("a learner already talking to Nova since their check-in time is not checked in on as well", async () => {
  const l = await learner();
  await prisma.companionMessage.create({ data: { userId: l.messengerId, role: "user", text: "what should I do today", createdAt: ist("11:05") } });
  const result = await tick(ist("11:50"));   // 45 minutes later: not "recent", but since the check-in time
  assert.equal(to(l.chat).length, 0);
  assert.ok((result.outcomes?.suppressed ?? 0) >= 1);
  // A message from before the check-in time does not count against it.
  const early = await learner();
  await prisma.companionMessage.create({ data: { userId: early.messengerId, role: "user", text: "morning", createdAt: ist("09:00") } });
  await tick(ist("11:50"));
  assert.equal(to(early.chat).length, 1);
});

test("nudges turned off silences the check-in; turned back on, it comes at the chosen time again", async () => {
  const l = await learner();
  await prisma.novaTelegramChannel.upsert({ where: { profileId: l.profileId }, create: { profileId: l.profileId, proactiveEnabled: false }, update: { proactiveEnabled: false } });
  const off = await tick(ist("11:00"));
  assert.equal(to(l.chat).length, 0);
  assert.ok((off.outcomes?.proactive_off ?? 0) >= 1);
  await prisma.novaTelegramChannel.update({ where: { profileId: l.profileId }, data: { proactiveEnabled: true } });
  await tick(ist("11:30"));
  assert.equal(to(l.chat).length, 1);
});

test("changing the time in Settings moves the check-in; clearing it returns to the study window", async () => {
  const l = await learner({ studyTime: "evening" });
  await prisma.userProfile.update({ where: { userId: l.userId }, data: { preferredCheckInTime: "15:30" } });
  await tick(ist("11:00"));
  assert.equal(to(l.chat).length, 0);
  await tick(ist("15:29"));
  assert.equal(to(l.chat).length, 0);
  await tick(ist("15:31"));
  assert.equal(to(l.chat).length, 1);

  await prisma.userProfile.update({ where: { userId: l.userId }, data: { preferredCheckInTime: null } });
  await tick(ist("15:31", 1));
  assert.equal(to(l.chat).length, 1);
  await tick(ist("18:10", 1));
  assert.equal(askedFor(l.name).at(-1)!.type, "daily_nudge");
});

test("a time the learner picked inside quiet hours is honoured", async () => {
  const l = await learner({ checkin: "06:30" });
  await tick(ist("06:10"));
  assert.equal(to(l.chat).length, 0);
  await tick(ist("06:35"));
  assert.equal(to(l.chat).length, 1);
});

test("Gentle Nudges and No Mercy get the same check-in, decided the same way, in a different manner", async () => {
  const gentle = await learner({ style: "soft" });
  const firm   = await learner({ style: "hard" });
  const unset  = await learner({ style: null });
  await tick(ist("11:00"));
  const of = (l: { name: string }) => askedFor(l.name)[0]!;
  assert.deepEqual([of(gentle).register, of(firm).register, of(unset).register], ["gentle", "playful", "steady"]);
  assert.deepEqual([of(gentle).type, of(firm).type, of(unset).type], ["daily_checkin", "daily_checkin", "daily_checkin"]);
  assert.deepEqual(of(gentle).facts, of(firm).facts);
  assert.deepEqual(to(gentle.chat)[0]!.buttons.flat().map(b => b.text), to(firm.chat)[0]!.buttons.flat().map(b => b.text));
});
