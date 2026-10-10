/**
 * Nova learning events and the browser extension's connection — real
 * Postgres integration test.
 *
 *   pairing code → extension credential → explicit learning event → the
 *   learner's own record → (only if they study it) a canonical session
 *
 * Everything is real here: the one-statement code redemption and the unique
 * keys behind idempotency (which a mock cannot show), the rate limit, and
 * the session commands. No LLM is involved in any of it.
 *
 * Run from packages/api:
 *   NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

import "./test-database.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const { prisma } = await import("@repo/db/client");
const {
  recordLearningEvent, loadSavedResources, getLearningResource, removeSavedResource, loadExtensionContext,
} = await import("../product/learning-events.js");
const {
  createPairingCode, redeemPairingCode, authenticateExtensionToken, revokeExtensionConnection, listExtensionConnections,
  MAX_CONNECTIONS, TOKEN_IDLE_DAYS,
} = await import("../product/extension-connection.js");
const { runNovaSessionCommand } = await import("../product/session.js");
const { loadNovaKnowledge }     = await import("../product/knowledge.js");
const { deleteAccount }         = await import("../../services/accountDeletion.service.js");

const STAMP = Date.now();
const KEYS  = ["a", "b", "limit", "gone"] as const;
const CHAT  = Object.fromEntries(KEYS.map(k => [k, `nova_itest_ev_${k}_${STAMP}`])) as Record<typeof KEYS[number], string>;
const DAY   = 86_400_000;

const userId: Record<string, string> = {};
const messengerId: Record<string, string> = {};
const profile: Record<string, string> = {};
const subject: Record<string, Record<string, string>> = {};

const source = { source: "browser_extension" as const };
const input = (over: Record<string, unknown> = {}) => ({
  eventType: "resource_saved", clientEventId: randomUUID(), url: `https://example.com/p/${randomUUID()}`, title: "A page", ...over,
});
type Result = Awaited<ReturnType<typeof recordLearningEvent>>;
const saved = (r: Result) => { assert.ok(r.success, r.success ? "" : `${r.error}: ${r.message}`); return r as Extract<Result, { success: true }>; };
const events = (key: string) => prisma.novaLearningEvent.findMany({ where: { profileId: profile[key]! }, orderBy: { createdAt: "asc" } });

// Everything a learning event must never touch, for one learner.
async function cognitiveState(key: string) {
  const profileId = profile[key]!, uid = messengerId[key]!;
  const [topics, history, sessions, dna, cognitive, notes, facts, reality, patterns, messages, jobs, academic] = await Promise.all([
    prisma.novaTopicMastery.findMany({ where: { subject: { profileId } }, orderBy: { id: "asc" } }),
    prisma.novaTopicMasterySnapshot.findMany({ where: { profileId }, orderBy: { id: "asc" } }),
    prisma.novaStudySession.findMany({ where: { profileId }, orderBy: { id: "asc" } }),
    prisma.novaLearningDNA.findMany({ where: { profileId } }),
    prisma.novaCognitiveState.findMany({ where: { profileId } }),
    prisma.novaNote.findMany({ where: { profileId } }),
    prisma.userFact.findMany({ where: { userId: uid } }),
    prisma.userReality.findMany({ where: { userId: uid } }),
    prisma.behavioralPattern.findMany({ where: { userId: uid } }),
    prisma.companionMessage.count({ where: { userId: uid } }),
    prisma.novaConsolidationJob.count({ where: { userId: uid } }),
    prisma.novaAcademicProfile.findUniqueOrThrow({ where: { id: profileId } }),
  ]);
  return JSON.stringify({ topics, history, sessions, dna, cognitive, notes, facts, reality, patterns, messages, jobs, academic });
}

before(async () => {
  for (const key of KEYS) {
    const user = await prisma.user.create({ data: { email: `${key}@events-itest-${STAMP}.local`, name: `${key.toUpperCase()} Learner` } });
    await prisma.userProfile.create({ data: { userId: user.id, onboardingComplete: true, primaryPersona: "nova", telegramChatId: CHAT[key], telegramConnected: true } });
    const messenger = await prisma.messengerUser.create({
      data: {
        platform: "telegram", platformChatId: CHAT[key], persona: "nova",
        novaAcademicProfile: { create: { onboardingComplete: true, subjects: { create: [{ name: "DSA" }, { name: "Operating Systems" }] } } },
      },
      select: { id: true, novaAcademicProfile: { select: { id: true, subjects: { select: { id: true, name: true } } } } },
    });
    userId[key] = user.id; messengerId[key] = messenger.id; profile[key] = messenger.novaAcademicProfile!.id;
    subject[key] = Object.fromEntries(messenger.novaAcademicProfile!.subjects.map(s => [s.name, s.id]));
  }
});

after(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@events-itest-${STAMP}.local` } } });
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: Object.values(CHAT) } } });
  await prisma.$disconnect();
});

// ── Connecting a browser ──────────────────────────────────────────────────────

let tokenA = "";

test("a pairing code becomes a credential once, and the table holds neither", async () => {
  const { code, expiresAt } = await createPairingCode(userId.a!);
  assert.match(code, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  assert.ok(expiresAt.getTime() - Date.now() > 9 * 60_000 && expiresAt.getTime() - Date.now() <= 10 * 60_000);

  assert.deepEqual(await redeemPairingCode("AAAAA-AAAAA", "x"), { ok: false });
  const redeemed = await redeemPairingCode(code.toLowerCase().replace("-", " "), "Chrome on macOS");
  assert.ok(redeemed.ok);
  tokenA = redeemed.token;
  assert.match(tokenA, /^nvx_[A-Za-z0-9_-]{43}$/);

  // Used: the same code opens nothing a second time.
  assert.deepEqual(await redeemPairingCode(code, "again"), { ok: false });

  const rows = await prisma.novaExtensionConnection.findMany({ where: { userId: userId.a } });
  assert.equal(rows.length, 1);
  const stored = JSON.stringify(rows);
  assert.ok(!stored.includes(tokenA) && !stored.includes(tokenA.slice(4)), "the credential is not in the table");
  assert.ok(!stored.includes(code) && !stored.includes(code.replace("-", "")), "the code is not in the table");
  assert.match(rows[0]!.tokenHash!, /^[0-9a-f]{64}$/);
  assert.deepEqual([rows[0]!.codeHash, rows[0]!.codeExpiresAt, rows[0]!.label, rows[0]!.revokedAt], [null, null, "Chrome on macOS", null]);
});

test("an expired code, a withdrawn code and a guessed code all fail the same way", async () => {
  const first = await createPairingCode(userId.b!);
  const second = await createPairingCode(userId.b!);     // asking again withdraws the first
  assert.deepEqual(await redeemPairingCode(first.code, "x"), { ok: false });
  assert.equal(await prisma.novaExtensionConnection.count({ where: { userId: userId.b, tokenHash: null } }), 1);

  const late = new Date(Date.now() + 11 * 60_000);
  assert.deepEqual(await redeemPairingCode(second.code, "x", late), { ok: false });
  for (const junk of ["", null, undefined, 12345, "ZZZZZ-ZZZZZ", "' OR 1=1 --", { code: second.code }]) {
    assert.deepEqual(await redeemPairingCode(junk, "x"), { ok: false });
  }
  assert.equal(await prisma.novaExtensionConnection.count({ where: { userId: userId.b, tokenHash: { not: null } } }), 0);
});

test("six browsers redeeming one code at the same moment: exactly one is connected", async () => {
  const { code } = await createPairingCode(userId.b!);
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => redeemPairingCode(code, `tab ${i}`)));
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.equal(await prisma.novaExtensionConnection.count({ where: { userId: userId.b, tokenHash: { not: null } } }), 1);
});

test("the credential identifies its own account and nothing else does", async () => {
  const who = await authenticateExtensionToken(tokenA);
  assert.equal(who?.userId, userId.a);
  for (const bad of ["", "nvx_", "nvx_" + "A".repeat(43), tokenA.slice(0, -1) + "x", tokenA.toUpperCase(), tokenA.slice(4), `Bearer ${tokenA}`, null, undefined, 42, "x".repeat(5000)]) {
    assert.equal(await authenticateExtensionToken(bad), null);
  }
});

test("a credential stops working after thirty days without use, and using it keeps it alive", async () => {
  assert.equal(TOKEN_IDLE_DAYS, 30);
  assert.ok(await authenticateExtensionToken(tokenA, new Date(Date.now() + 29 * DAY)));
  // That use, 29 days on, was recorded: day 50 is 21 days after it.
  assert.ok(await authenticateExtensionToken(tokenA, new Date(Date.now() + 50 * DAY)));
  assert.equal(await authenticateExtensionToken(tokenA, new Date(Date.now() + 81 * DAY)), null);
  await prisma.novaExtensionConnection.updateMany({ where: { userId: userId.a }, data: { lastUsedAt: new Date() } });
});

test("only the account's own learner can disconnect a browser, and then the credential opens nothing", async () => {
  const [connection] = await listExtensionConnections(userId.a!);
  assert.ok(connection);
  assert.deepEqual(Object.keys(connection).sort(), ["connectedAt", "id", "label", "lastUsedAt"], "no hash or credential is listed");
  assert.equal((await listExtensionConnections(userId.b!)).some(c => c.id === connection.id), false);

  assert.equal(await revokeExtensionConnection(userId.b!, connection.id), false, "another account cannot close it");
  assert.ok(await authenticateExtensionToken(tokenA));

  assert.equal(await revokeExtensionConnection(userId.a!, connection.id), true);
  assert.equal(await authenticateExtensionToken(tokenA), null);
  assert.equal(await revokeExtensionConnection(userId.a!, connection.id), false, "already closed");
  assert.deepEqual(await listExtensionConnections(userId.a!), []);
});

test("an account keeps at most five connected browsers; the oldest is closed", async () => {
  const tokens: string[] = [];
  for (let i = 0; i < MAX_CONNECTIONS + 1; i++) {
    const { code } = await createPairingCode(userId.a!);
    const r = await redeemPairingCode(code, `browser ${i}`, new Date(Date.now() + i * 1000));
    assert.ok(r.ok); tokens.push(r.token);
  }
  assert.equal((await listExtensionConnections(userId.a!)).length, MAX_CONNECTIONS);
  assert.equal(await authenticateExtensionToken(tokens[0]!), null);
  assert.ok(await authenticateExtensionToken(tokens[tokens.length - 1]!));
});

// ── Recording an explicit action ──────────────────────────────────────────────

test("Save to Nova stores the address, the title and where it was filed, and nothing else", async () => {
  const before = await cognitiveState("a");
  const result = saved(await recordLearningEvent(profile.a!, {
    ...input({ url: "https://user:pw@www.example.com/graphs/bfs?utm=1&token=SECRET#queue", title: "  BFS\nexplained ", subjectId: subject.a!.DSA, topicName: "Graphs" }),
    profileId: profile.b, userId: userId.b, source: "internal", body: "the page text", metadata: { big: "x".repeat(2000) },
  }, source));

  assert.deepEqual([result.action, result.duplicate, result.focusPath], ["saved", false, null]);
  assert.deepEqual(result.resource, {
    id: result.eventId, eventType: "resource_saved", url: "https://www.example.com/graphs/bfs?utm=1", domain: "example.com",
    title: "BFS explained", subjectId: subject.a!.DSA, subjectName: "DSA", topicName: "Graphs",
    savedAt: result.resource.savedAt, study: { available: true, blockedBy: null, minutes: 25 },
  });

  const [row] = await events("a");
  assert.deepEqual(Object.keys(row!).sort(), ["clientEventId", "createdAt", "domain", "eventType", "id", "occurredAt", "profileId", "source", "subjectId", "title", "topicName", "url"]);
  assert.equal(row!.profileId, profile.a, "owned by the caller, not by the profileId in the request");
  assert.equal(row!.source, "browser_extension", "source is the server's, not the request's");
  assert.ok(!JSON.stringify(row).match(/SECRET|page text|xxxx|user:pw|queue/));
  assert.equal(await prisma.novaLearningEvent.count({ where: { profileId: profile.b } }), 0);
  assert.equal(await cognitiveState("a"), before, "saving a page changed nothing Nova knows about the learner");
});

test("a retried action is stored once, however many times and however concurrently it arrives", async () => {
  const action = input({ title: "Dijkstra", subjectId: subject.a!.DSA });
  const first  = saved(await recordLearningEvent(profile.a!, action, source));
  const retry  = saved(await recordLearningEvent(profile.a!, action, source));
  assert.deepEqual([retry.eventId, retry.duplicate, retry.action], [first.eventId, true, "saved"]);
  // A retry cannot be used to rewrite what was stored.
  const tampered = saved(await recordLearningEvent(profile.a!, { ...action, title: "Something else", url: "https://evil.example/" }, source));
  assert.deepEqual([tampered.eventId, tampered.duplicate, tampered.resource.title], [first.eventId, true, "Dijkstra"]);

  const burst = input({ title: "A*", eventType: "study_requested" });
  const all = await Promise.all(Array.from({ length: 8 }, () => recordLearningEvent(profile.a!, burst, source)));
  assert.ok(all.every(r => r.success));
  assert.equal(new Set(all.map(r => saved(r).eventId)).size, 1);
  assert.equal(all.filter(r => !saved(r).duplicate).length, 1, "one request stored it; the rest were answered as retries");
  assert.equal(await prisma.novaLearningEvent.count({ where: { profileId: profile.a, clientEventId: burst.clientEventId } }), 1);
});

test("an action id is the learner's own: the same id from another learner is a different event", async () => {
  const shared = randomUUID();
  const a = saved(await recordLearningEvent(profile.a!, input({ clientEventId: shared, title: "A's page" }), source));
  const b = saved(await recordLearningEvent(profile.b!, input({ clientEventId: shared, title: "B's page" }), source));
  assert.notEqual(a.eventId, b.eventId);
  assert.deepEqual([b.duplicate, b.resource.title], [false, "B's page"], "B is not handed A's event");
});

test("a page cannot be filed under someone else's subject, or one that does not exist", async () => {
  const count = (await events("a")).length;
  for (const subjectId of [subject.b!.DSA, "does-not-exist", "' OR 1=1 --"]) {
    const result = await recordLearningEvent(profile.a!, input({ subjectId, topicName: "Graphs" }), source);
    assert.deepEqual([result.success, !result.success && result.error], [false, "unknown_subject"]);
  }
  assert.equal((await events("a")).length, count, "nothing was stored");
});

test("a typed topic creates no topic and no mastery; an existing topic keeps its spelling", async () => {
  await prisma.novaTopicMastery.create({ data: { subjectId: subject.a!.DSA!, name: "Dynamic Programming", masteryProbability: 0.4, reviewCount: 2 } });
  const topicsBefore = JSON.stringify(await prisma.novaTopicMastery.findMany({ where: { subject: { profileId: profile.a } }, orderBy: { id: "asc" } }));

  const existing = saved(await recordLearningEvent(profile.a!, input({ subjectId: subject.a!.DSA, topicName: "  dynamic   programming " }), source));
  assert.equal(existing.resource.topicName, "Dynamic Programming");
  const fresh = saved(await recordLearningEvent(profile.a!, input({ subjectId: subject.a!.DSA, topicName: "Segment Trees" }), source));
  assert.equal(fresh.resource.topicName, "Segment Trees");
  // A name with ILIKE wildcards is compared as the text it is.
  const wild = saved(await recordLearningEvent(profile.a!, input({ subjectId: subject.a!.DSA, topicName: "D%" }), source));
  assert.equal(wild.resource.topicName, "D%");

  assert.equal(JSON.stringify(await prisma.novaTopicMastery.findMany({ where: { subject: { profileId: profile.a } }, orderBy: { id: "asc" } })), topicsBefore);
  const knowledge = await loadNovaKnowledge(CHAT.a);
  assert.ok(knowledge.status === "ready" && !JSON.stringify(knowledge).includes("Segment Trees"), "Knowledge has no such topic");
});

test("saving a page that is already saved re-files it; there is one entry per page", async () => {
  const url = "https://example.com/tries";
  const first  = saved(await recordLearningEvent(profile.a!, input({ url, title: "Tries" }), source));
  const second = saved(await recordLearningEvent(profile.a!, input({ url: `${url}#insert`, title: "Tries (prefix trees)", subjectId: subject.a!.DSA, topicName: "Tries" }), source));
  assert.deepEqual([second.action, second.eventId, second.duplicate], ["already_saved", first.eventId, false]);
  assert.deepEqual([second.resource.title, second.resource.subjectName, second.resource.topicName], ["Tries (prefix trees)", "DSA", "Tries"]);
  assert.equal(await prisma.novaLearningEvent.count({ where: { profileId: profile.a, url } }), 1);
  // The same address saved by another learner is theirs, separately.
  const other = saved(await recordLearningEvent(profile.b!, input({ url, title: "Tries" }), source));
  assert.deepEqual([other.action, other.eventId !== first.eventId], ["saved", true]);
});

test("a link saved from the web app is the same kind of record, marked with where it came from", async () => {
  const before = await cognitiveState("b");
  const web = { source: "web" as const };
  const action = input({ url: "https://user:pw@docs.example.org/os/deadlocks?token=SECRET#coffman", title: "Deadlocks", subjectId: subject.b!["Operating Systems"], topicName: "Deadlocks" });

  const first = saved(await recordLearningEvent(profile.b!, { ...action, profileId: profile.a, source: "browser_extension" }, web));
  assert.deepEqual([first.action, first.duplicate, first.focusPath, first.resource.url], ["saved", false, null, "https://docs.example.org/os/deadlocks"]);
  const row = await prisma.novaLearningEvent.findUniqueOrThrow({ where: { id: first.eventId } });
  assert.deepEqual([row.source, row.profileId, row.eventType], ["web", profile.b, "resource_saved"]);

  // Pressing Save twice, or retrying after a dropped connection: one row.
  const retry = saved(await recordLearningEvent(profile.b!, action, web));
  assert.deepEqual([retry.eventId, retry.duplicate], [first.eventId, true]);
  const burst = input({ url: "https://docs.example.org/os/paging", title: "Paging" });
  const all = await Promise.all(Array.from({ length: 6 }, () => recordLearningEvent(profile.b!, burst, web)));
  assert.equal(new Set(all.map(r => saved(r).eventId)).size, 1);
  assert.equal(await prisma.novaLearningEvent.count({ where: { profileId: profile.b, url: "https://docs.example.org/os/paging" } }), 1);

  // The same page again, as a new action from the web and then from the
  // extension: still one saved entry, re-filed, and it keeps where it first came from.
  const again = saved(await recordLearningEvent(profile.b!, input({ url: "https://docs.example.org/os/deadlocks#again", title: "Deadlocks (Coffman conditions)" }), web));
  const fromExtension = saved(await recordLearningEvent(profile.b!, input({ url: "https://docs.example.org/os/deadlocks", title: "Deadlocks" }), source));
  assert.deepEqual([again.action, again.eventId, fromExtension.action, fromExtension.eventId], ["already_saved", first.eventId, "already_saved", first.eventId]);
  assert.equal(await prisma.novaLearningEvent.count({ where: { profileId: profile.b, url: "https://docs.example.org/os/deadlocks" } }), 1);
  assert.equal((await prisma.novaLearningEvent.findUniqueOrThrow({ where: { id: first.eventId } })).source, "web");

  assert.equal(await cognitiveState("b"), before, "saving links changed nothing Nova knows about the learner: no session, no mastery");
});

test("a link Nova does not keep is refused from the web app too, and nothing is stored", async () => {
  const count = (await events("b")).length;
  for (const url of ["javascript:alert(1)", "file:///etc/passwd", "chrome://settings", "ftp://example.com/a", "example.com/no-scheme", "", `https://example.com/${"a".repeat(3000)}`]) {
    const result = await recordLearningEvent(profile.b!, input({ url }), { source: "web" });
    assert.deepEqual([url.slice(0, 30), result.success, !result.success && result.error], [url.slice(0, 30), false, "invalid_url"]);
  }
  assert.equal((await events("b")).length, count);
});

test("invalid events are refused and nothing is stored", async () => {
  const count = (await events("b")).length;
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ url: "javascript:alert(document.cookie)" }, "invalid_url"], [{ url: "data:text/html,<script>1</script>" }, "invalid_url"],
    [{ url: "file:///etc/passwd" }, "invalid_url"], [{ url: `https://example.com/${"a".repeat(3000)}` }, "invalid_url"],
    [{ title: "x".repeat(301) }, "invalid"], [{ subjectId: subject.b!.DSA, topicName: "x".repeat(121) }, "invalid"],
    [{ eventType: "page_viewed" }, "invalid"], [{ eventType: "session_completed" }, "invalid"], [{ clientEventId: "short" }, "invalid"],
    [{ topicName: "No subject given" }, "invalid"],
  ];
  for (const [over, error] of cases) {
    const result = await recordLearningEvent(profile.b!, input(over), source);
    assert.deepEqual([JSON.stringify(over).slice(0, 50), result.success, !result.success && result.error], [JSON.stringify(over).slice(0, 50), false, error]);
  }
  assert.equal((await events("b")).length, count);
});

test("more than twenty events in a minute are refused; retries and other learners are not", async () => {
  const now = new Date();
  const sent = [];
  for (let i = 0; i < 20; i++) sent.push(input({ title: `Page ${i}` }));
  for (const action of sent) saved(await recordLearningEvent(profile.limit!, action, { ...source, now }));

  const over = await recordLearningEvent(profile.limit!, input(), { ...source, now });
  assert.deepEqual([over.success, !over.success && over.error], [false, "rate_limited"]);
  assert.equal(await prisma.novaLearningEvent.count({ where: { profileId: profile.limit } }), 20);

  // A retry of something already stored is still answered: it writes nothing.
  assert.equal(saved(await recordLearningEvent(profile.limit!, sent[3]!, { ...source, now })).duplicate, true);
  // Another learner is not slowed by this one.
  saved(await recordLearningEvent(profile.b!, input(), { ...source, now }));
  // A minute later it is open again.
  saved(await recordLearningEvent(profile.limit!, input(), { ...source, now: new Date(now.getTime() + 61_000) }));
});

// ── What the learner sees, and only the learner ───────────────────────────────

test("the Saved list is the learner's own saved pages, newest first, and filters stay inside it", async () => {
  const mine = await loadSavedResources(CHAT.a);
  assert.equal(mine.status, "ready");
  if (mine.status !== "ready") return;
  assert.ok(mine.resources.length >= 5);
  assert.ok(mine.resources.every(r => r.eventType === "resource_saved"), "study requests are not saved pages");
  assert.deepEqual([...mine.resources].sort((x, y) => y.savedAt.localeCompare(x.savedAt)).map(r => r.id), mine.resources.map(r => r.id));
  const own = new Set((await events("a")).map(e => e.id));
  assert.ok(mine.resources.every(r => own.has(r.id)));
  assert.ok(!JSON.stringify(mine).includes("B's page"));
  assert.deepEqual(mine.subjects.map(s => s.name), ["DSA", "Operating Systems"]);

  const bySubject = await loadSavedResources(CHAT.a, { subjectId: subject.a!.DSA });
  assert.ok(bySubject.status === "ready" && bySubject.resources.length > 0 && bySubject.resources.every(r => r.subjectName === "DSA"));
  const byTopic = await loadSavedResources(CHAT.a, { topic: "tries" });
  assert.ok(byTopic.status === "ready" && byTopic.resources.length === 1 && byTopic.resources[0]!.topicName === "Tries");
  // Another learner's subject id selects nothing; a wildcard is a literal.
  const foreign = await loadSavedResources(CHAT.a, { subjectId: subject.b!.DSA });
  assert.ok(foreign.status === "ready" && foreign.resources.length === 0);
  const wildcard = await loadSavedResources(CHAT.a, { topic: "%" });
  assert.ok(wildcard.status === "ready" && wildcard.resources.length === 0);

  assert.deepEqual(await loadSavedResources("no_such_chat"), { status: "not_connected" });
});

test("an event id alone reaches nothing: another learner's event is not found, and cannot be removed", async () => {
  const [mine] = await events("a");
  const got = await getLearningResource(profile.a!, mine!.id);
  assert.ok(got.ok && got.resource.id === mine!.id);
  assert.deepEqual(got.ok && got.subjects.map(s => s.name), ["DSA", "Operating Systems"]);

  const stolen = await getLearningResource(profile.b!, mine!.id);
  assert.deepEqual([stolen.ok, !stolen.ok && stolen.error], [false, "not_found"]);
  const never = await getLearningResource(profile.b!, "does-not-exist");
  assert.deepEqual(stolen, never, "someone else's id looks exactly like one that never existed");

  assert.equal(await removeSavedResource(profile.b!, mine!.id), false);
  assert.equal(await prisma.novaLearningEvent.count({ where: { id: mine!.id } }), 1);
  assert.equal(await removeSavedResource(profile.a!, mine!.id), true);
  assert.equal(await prisma.novaLearningEvent.count({ where: { id: mine!.id } }), 0);
});

test("the extension is told the learner's subjects and topic names, and nothing about how they are doing", async () => {
  const context = await loadExtensionContext(CHAT.a, "A Learner");
  assert.equal(context.status, "ready");
  if (context.status !== "ready") return;
  assert.deepEqual(context.subjects.map(s => [s.name, s.topics]), [["DSA", ["Dynamic Programming"]], ["Operating Systems", []]]);
  assert.deepEqual(Object.keys(context).sort(), ["activeSession", "learner", "limits", "status", "subjects"]);
  assert.ok(!JSON.stringify(context).match(/mastery|0\.4|reviewCount|retention/i));
  assert.ok(context.subjects.every(s => Object.values(subject.a!).includes(s.id)));
  assert.deepEqual(await loadExtensionContext("no_such_chat", null), { status: "not_connected" });
});

// ── The product test: save → later study → a real session is the evidence ─────

test("a saved page moves no mastery; the session the learner then runs on it does", async () => {
  const before = await cognitiveState("b");
  const save = saved(await recordLearningEvent(profile.b!, input({
    url: "https://cp-algorithms.example/graph/breadth-first-search.html", title: "Breadth-first search", subjectId: subject.b!.DSA, topicName: "Graphs",
  }), source));
  const again = saved(await recordLearningEvent(profile.b!, input({ url: save.resource.url, title: "Breadth-first search", subjectId: subject.b!.DSA, topicName: "Graphs" }), source));
  assert.equal(again.action, "already_saved");

  // "Study this": a request, with where to continue. Not a session.
  const request = saved(await recordLearningEvent(profile.b!, input({
    eventType: "study_requested", url: save.resource.url, title: "Breadth-first search", subjectId: subject.b!.DSA, topicName: "Graphs",
  }), source));
  assert.deepEqual([request.action, request.focusPath], ["study_requested", `/focus?study=${request.eventId}`]);

  assert.equal(await cognitiveState("b"), before, "two saves and a study request: no session, no topic, no mastery, no Learning DNA, no memory");
  assert.equal(await prisma.novaStudySession.count({ where: { profileId: profile.b } }), 0);
  assert.equal(await prisma.novaTopicMastery.count({ where: { subject: { profileId: profile.b }, name: "Graphs" } }), 0);

  // The Focus screen reads the request back and starts the ordinary session.
  const offered = await getLearningResource(profile.b!, request.eventId);
  assert.ok(offered.ok && offered.resource.study.available);
  if (!offered.ok) return;
  const start = new Date(Date.now() - 40 * 60_000);
  const started = await runNovaSessionCommand(CHAT.b, {
    action: "start", topicName: offered.resource.topicName!, subjectName: offered.resource.subjectName!, plannedMinutes: offered.resource.study.minutes,
  }, start);
  assert.ok(started.ok && started.session);
  assert.equal(await prisma.novaStudySession.count({ where: { profileId: profile.b, status: "in_progress" } }), 1, "one canonical session, opened by the session command");

  const ended = await runNovaSessionCommand(CHAT.b, { action: "end", outcome: "good" }, new Date(start.getTime() + 30 * 60_000));
  assert.ok(ended.ok && ended.ended?.topicRecorded);

  // Now, and only now, Nova knows something about Graphs.
  const topic = await prisma.novaTopicMastery.findFirstOrThrow({ where: { subject: { profileId: profile.b }, name: "Graphs" } });
  assert.deepEqual([topic.masteryProbability, topic.reviewCount], [0.75, 1]);
  const history = await prisma.novaTopicMasterySnapshot.findMany({ where: { topicId: topic.id } });
  assert.deepEqual(history.map(h => [h.source, h.masteryBefore, h.masteryAfter]), [["session_report", null, 0.75]]);
  assert.equal((await prisma.novaLearningDNA.findUniqueOrThrow({ where: { profileId: profile.b } })).dataPointCount, 1);

  // More saves afterwards still move nothing.
  const after = await cognitiveState("b");
  for (let i = 0; i < 3; i++) saved(await recordLearningEvent(profile.b!, input({ subjectId: subject.b!.DSA, topicName: "Graphs" }), source));
  assert.equal(await cognitiveState("b"), after);
});

test("a page with no subject or topic says what it is missing before it can be studied", async () => {
  const bare = saved(await recordLearningEvent(profile.b!, input({ title: "Unfiled" }), source));
  assert.deepEqual(bare.resource.study, { available: false, blockedBy: "no_subject", minutes: 25 });
  const half = saved(await recordLearningEvent(profile.b!, input({ subjectId: subject.b!.DSA }), source));
  assert.deepEqual(half.resource.study, { available: false, blockedBy: "no_topic", minutes: 25 });
});

// ── Lifetime ──────────────────────────────────────────────────────────────────

test("deleting a subject unfiles its saved pages; it does not delete them", async () => {
  const kept = saved(await recordLearningEvent(profile.a!, input({ title: "Paging notes", subjectId: subject.a!["Operating Systems"], topicName: "Paging" }), source));
  await prisma.novaSubject.delete({ where: { id: subject.a!["Operating Systems"]! } });
  const row = await prisma.novaLearningEvent.findUniqueOrThrow({ where: { id: kept.eventId } });
  assert.deepEqual([row.subjectId, row.topicName, row.title], [null, "Paging", "Paging notes"]);
});

test("deleting the account removes its saved pages and its connected browsers", async () => {
  saved(await recordLearningEvent(profile.gone!, input(), source));
  const { code } = await createPairingCode(userId.gone!);
  const redeemed = await redeemPairingCode(code, "soon gone");
  assert.ok(redeemed.ok && await authenticateExtensionToken(redeemed.token));

  await deleteAccount(userId.gone!);
  assert.equal(await prisma.novaLearningEvent.count({ where: { profileId: profile.gone } }), 0);
  assert.equal(await prisma.novaExtensionConnection.count({ where: { userId: userId.gone } }), 0);
  assert.equal(redeemed.ok && await authenticateExtensionToken(redeemed.token), null);
});
