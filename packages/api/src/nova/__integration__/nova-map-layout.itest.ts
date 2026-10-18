/**
 * Knowledge Map layout — real Postgres integration test.
 *
 * What it proves: a learner's card positions are theirs alone (saved only for
 * items on their own map, read back only by them, reset only for them); a
 * save is checked whole and an invalid one writes nothing; repeated and
 * concurrent saves leave one row per card; and moving or resetting cards
 * changes no note, saved page, topic, session or anything else.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npm run test:integration
 */

import "./test-database.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";

const { prisma }                   = await import("@repo/db/client");
const { resolveLearnerForAccount } = await import("../product/learner-identity.js");
const { saveSetup }                = await import("../product/setup.js");
const { createNote, resolveNoteLearner } = await import("../product/notes.js");
const { loadNovaKnowledgeMap }     = await import("../product/knowledge-map.js");
const { loadMapLayout, saveMapLayout, resetMapLayout } = await import("../product/map-layout.js");

const STAMP = Date.now();
const now   = new Date();
const accounts: string[] = [];
let n = 0;

async function learner(subjects: Array<{ name: string; topics: string[] }> = [{ name: "Operating Systems", topics: ["Deadlocks", "Paging"] }]) {
  const user = await prisma.user.create({ data: { email: `layout_${STAMP}_${++n}@test.local`, name: "Asha" }, select: { id: true } });
  accounts.push(user.id);
  await prisma.userProfile.create({ data: { userId: user.id, primaryPersona: "nova", onboardingComplete: true, secondaryDomains: [], aspirationWords: [] } });
  const web = (await resolveLearnerForAccount(user.id, "Asha")) as { platformChatId: string };
  if (subjects.length > 0) await saveSetup(web.platformChatId, { subjects, exams: [], dailyMinutes: null, studyTime: null }, now);
  const resolved = await resolveNoteLearner(web.platformChatId);
  const profileId = resolved.status === "ready" ? resolved.profileId : "";
  return { chat: web.platformChatId, profileId };
}

async function nodesOf(chat: string) {
  const map = await loadNovaKnowledgeMap(chat);
  assert.equal(map.status, "ready");
  return map.status === "ready" ? map.nodes : [];
}

// Everything a card move must never touch, as it stands.
async function elsewhere(profileId: string) {
  const [subjects, topics, notes, events, sessions, profile] = await Promise.all([
    prisma.novaSubject.findMany({ where: { profileId }, orderBy: { id: "asc" } }),
    prisma.novaTopicMastery.findMany({ where: { subject: { profileId } }, orderBy: { id: "asc" } }),
    prisma.novaNote.findMany({ where: { profileId }, orderBy: { id: "asc" } }),
    prisma.novaLearningEvent.findMany({ where: { profileId }, orderBy: { id: "asc" } }),
    prisma.novaStudySession.findMany({ where: { profileId }, orderBy: { id: "asc" } }),
    prisma.novaAcademicProfile.findUniqueOrThrow({ where: { id: profileId } }),
  ]);
  return JSON.stringify({ subjects, topics, notes, events, sessions, profile });
}

const rowsOf = (profileId: string) => prisma.novaMapLayout.findMany({ where: { profileId }, orderBy: [{ nodeType: "asc" }, { nodeId: "asc" }] });

before(async () => { await prisma.$queryRaw`SELECT 1`; });
after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { startsWith: "web:" }, novaAcademicProfile: null } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: accounts } } });
  await prisma.$disconnect();
});

test("positions are saved for the learner's own items, read back, and moving a card changes nothing else", async () => {
  const l = await learner();
  const note = await createNote(l.profileId, { title: "Banker's algorithm", body: "text the layout never reads", topicName: "Deadlocks" });
  assert.ok(note.ok);
  const nodes = await nodesOf(l.chat);
  const subject = nodes.find(x => x.type === "subject")!;
  const topic   = nodes.find(x => x.type === "topic")!;
  const noteId  = `note:${note.ok ? note.note.id : ""}`;

  const before = await elsewhere(l.profileId);
  const saved = await saveMapLayout(l.chat, { positions: [
    { node: subject.id, x: 10, y: -20.256 },
    { node: noteId, x: 400, y: 300 },
    { node: noteId, x: 410, y: 310 },     // named twice: the last wins
    { node: topic.id, x: 0, y: 0 },
  ] });
  assert.deepEqual(saved, { ok: true, saved: 3, skipped: [] });
  assert.equal(await elsewhere(l.profileId), before, "a layout save writes no other table");

  const view = await loadMapLayout(l.chat);
  assert.ok(view.ok);
  const at = new Map(view.ok ? view.positions.map(p => [p.node, [p.x, p.y]]) : []);
  assert.deepEqual(at.get(subject.id), [10, -20.26], "rounded to hundredths");
  assert.deepEqual(at.get(noteId), [410, 310]);
  assert.deepEqual(at.get(topic.id), [0, 0]);

  // A second save moves a card: one row, the new position.
  assert.deepEqual(await saveMapLayout(l.chat, { positions: [{ node: noteId, x: -5, y: 5 }] }), { ok: true, saved: 1, skipped: [] });
  const rows = await rowsOf(l.profileId);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.filter(r => r.nodeType === "note").map(r => [r.x, r.y]), [[-5, 5]]);
});

test("a learner cannot place, read or reset another learner's cards", async () => {
  const mine   = await learner();
  const theirs = await learner([{ name: "Physics", topics: ["Optics"] }]);
  const theirNote = await createNote(theirs.profileId, { title: "Their note", body: "" });
  assert.ok(theirNote.ok);
  const theirNodes = await nodesOf(theirs.chat);
  const theirTopic = theirNodes.find(x => x.type === "topic")!;
  await saveMapLayout(theirs.chat, { positions: [{ node: theirTopic.id, x: 1, y: 2 }] });

  // Their ids, sent by me: well-formed, not on my map, so not stored.
  const myTopic = (await nodesOf(mine.chat)).find(x => x.type === "topic")!;
  const sent = await saveMapLayout(mine.chat, { positions: [
    { node: theirTopic.id, x: 999, y: 999 },
    { node: `note:${theirNote.ok ? theirNote.note.id : ""}`, x: 5, y: 5 },
    { node: "note:doesnotexist123", x: 5, y: 5 },
    { node: myTopic.id, x: 7, y: 8 },
  ] });
  assert.ok(sent.ok);
  if (sent.ok) {
    assert.equal(sent.saved, 1);
    assert.deepEqual(sent.skipped.sort(), [theirTopic.id, `note:${theirNote.ok ? theirNote.note.id : ""}`, "note:doesnotexist123"].sort());
  }
  assert.deepEqual((await rowsOf(mine.profileId)).map(r => `${r.nodeType}:${r.nodeId}`), [myTopic.id]);

  // Their position is untouched, and mine is not in what they read.
  const theirView = await loadMapLayout(theirs.chat);
  assert.deepEqual(theirView.ok && theirView.positions, [{ node: theirTopic.id, x: 1, y: 2 }]);
  const myView = await loadMapLayout(mine.chat);
  assert.deepEqual(myView.ok && myView.positions.map(p => p.node), [myTopic.id]);

  // My reset removes mine only.
  assert.deepEqual(await resetMapLayout(mine.chat), { ok: true, removed: 1 });
  assert.equal((await rowsOf(mine.profileId)).length, 0);
  assert.equal((await rowsOf(theirs.profileId)).length, 1);
});

test("an invalid save is refused whole and writes nothing", async () => {
  const l = await learner();
  const topic = (await nodesOf(l.chat)).find(x => x.type === "topic")!;
  const bad: unknown[] = [
    null, [], "positions", { positions: "x" },
    { positions: [{ node: topic.id, x: Number.NaN, y: 0 }] },
    { positions: [{ node: topic.id, x: Number.POSITIVE_INFINITY, y: 0 }] },
    { positions: [{ node: topic.id, x: 100_001, y: 0 }] },
    { positions: [{ node: topic.id, x: "10", y: 0 }] },
    { positions: [{ node: topic.id, x: 1, y: 1 }, { node: "exam:abc", x: 1, y: 1 }] },
    { positions: [{ node: "topic:", x: 1, y: 1 }] },
    { positions: [{ node: "topic:has space", x: 1, y: 1 }] },
    { positions: [{ node: `topic:${"a".repeat(65)}`, x: 1, y: 1 }] },
    { positions: Array.from({ length: 1001 }, () => ({ node: topic.id, x: 1, y: 1 })) },
  ];
  for (const body of bad) {
    const result = await saveMapLayout(l.chat, body);
    assert.equal(result.ok, false, JSON.stringify(body)?.slice(0, 80));
    if (!result.ok) assert.equal(result.error, "invalid");
  }
  assert.equal((await rowsOf(l.profileId)).length, 0, "nothing half-applied");
});

test("concurrent saves of the same cards leave one row per card", async () => {
  const l = await learner();
  const nodes = await nodesOf(l.chat);
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) =>
    saveMapLayout(l.chat, { positions: nodes.map(x => ({ node: x.id, x: i, y: i })) })));
  for (const r of results) assert.ok(r.ok);
  const rows = await rowsOf(l.profileId);
  assert.equal(rows.length, nodes.length);
  // Every card holds one of the positions that was sent, never a mix within a row.
  for (const r of rows) assert.equal(r.x, r.y);
});

test("reset restores nothing but the default layout: notes, pages, topics and links stay", async () => {
  const l = await learner();
  const note = await createNote(l.profileId, { title: "Paging notes", body: "See [[Deadlocks]]", topicName: "Paging" });
  assert.ok(note.ok);
  const nodes = await nodesOf(l.chat);
  await saveMapLayout(l.chat, { positions: nodes.map((x, i) => ({ node: x.id, x: i * 10, y: 0 })) });
  const mapBefore = await loadNovaKnowledgeMap(l.chat);
  const before = await elsewhere(l.profileId);

  const reset = await resetMapLayout(l.chat);
  assert.deepEqual(reset, { ok: true, removed: nodes.length });
  assert.equal(await elsewhere(l.profileId), before);
  assert.deepEqual(await loadNovaKnowledgeMap(l.chat), mapBefore, "the map itself is unchanged");
  const view = await loadMapLayout(l.chat);
  assert.deepEqual(view.ok && view.positions, []);
  // A second reset finds nothing to remove.
  assert.deepEqual(await resetMapLayout(l.chat), { ok: true, removed: 0 });
});

test("a learner who has not finished setup has no layout to read or write", async () => {
  const l = await learner([]);
  const view = await loadMapLayout(l.chat);
  assert.equal(view.ok, false);
  const saved = await saveMapLayout(l.chat, { positions: [] });
  assert.equal(saved.ok, false);
});
