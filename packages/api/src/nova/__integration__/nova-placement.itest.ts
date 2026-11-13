/**
 * Where a captured passage belongs, and research context: real Postgres.
 *
 * Proves: a passage naming one topic outright is filed there with no model; a
 * passage that needs the model is filed by its pick among existing places
 * only; a low-confidence pick is kept as a suggestion, not filed; the
 * learner's own choice is stored as theirs and never replaced; clearing is a
 * choice too; a subject or topic that is not the learner's is refused;
 * another learner's draft is out of reach; the browser agent's context finds the
 * learner's related notes and places, and its workspace reads reach the
 * learner's own notes and saved pages only.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npx tsx --test src/nova/__integration__/nova-placement.itest.ts
 */

import "./test-database.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";
process.env.ANTHROPIC_API_KEY = "";

const { prisma } = await import("@repo/db/client");
const { ensureSetupProfile, saveSetup } = await import("../product/setup.js");
const { createNote } = await import("../product/notes.js");
const { captureToDraft, getDraft, placeDraftItem, setDraftItemPlacement } = await import("../product/capture-drafts.js");
const { forgetStructure, workspacePlaces } = await import("../product/knowledge-placement.js");
const { agentContext, agentReadNote, agentWorkspaceSearch } = await import("../product/browser-agent.js");

const STAMP = Date.now();
const ids: string[] = [];
let n = 0;

async function learner(subjects: Array<{ name: string; topics: string[] }>) {
  const id = `web:place_${STAMP}_${n++}`;
  ids.push(id);
  await prisma.messengerUser.create({ data: { platform: "web", platformChatId: id, persona: "nova", displayName: "Asha" } });
  const profileId = (await ensureSetupProfile(id))!.profileId;
  await saveSetup(id, { subjects, exams: [], dailyMinutes: 60, studyTime: null });
  await prisma.novaAcademicProfile.update({ where: { id: profileId }, data: { onboardingComplete: true } });
  forgetStructure(profileId);
  return { id, profileId };
}

after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: ids } } });
  await prisma.$disconnect();
});

const WORKSPACE = [
  { name: "Artificial Intelligence", topics: ["Machine Learning", "Retrieval-Augmented Generation", "Vector Databases"] },
  { name: "Computer Science", topics: ["Database Systems", "Distributed Systems"] },
];
let k = 0;
const key = () => `place-key-${STAMP}-${k++}`;

// A model that picks the candidate naming `topic` (or nothing), with a confidence.
const pickFor = (topic: string | null, confidence = "high") => async (input: { prompt: string }) => {
  if (!topic) return JSON.stringify({ pick: null, confidence: "low" });
  const line = input.prompt.split("\n").find(l => l.startsWith("C") && l.includes(topic));
  return JSON.stringify({ pick: line ? line.slice(0, line.indexOf(":")) : null, confidence });
};
const noModel = async () => { throw new Error("the model was asked"); };

test("a passage that names one topic outright is filed there, with no model call", async () => {
  const { profileId } = await learner(WORKSPACE);
  const c = await captureToDraft(profileId, { key: key(), url: "https://www.pinecone.io/learn/vector-database/", title: "What is a vector database?", text: "Vector databases store embeddings and answer nearest-neighbour queries." });
  assert.ok(c.ok);
  const placed = await placeDraftItem(profileId, c.draft.id, c.itemId, { generate: noModel as never });
  assert.ok(placed.ok);
  assert.equal(placed.placement?.topicName, "Vector Databases");
  assert.equal(placed.placement?.subjectName, "Artificial Intelligence");
  assert.equal(placed.placement?.confidence, "high");
  assert.equal(placed.placement?.basis, "name");
  const { places } = await workspacePlaces(profileId);
  assert.equal(placed.placement?.topicId, places.find(p => p.topicName === "Vector Databases")!.topicId, "an existing topic's own id");
  const stored = await getDraft(profileId, c.draft.id);
  assert.equal(stored!.items[0]!.placement?.topicName, "Vector Databases", "kept on the passage");
  assert.equal(stored!.items[0]!.placedBy, "kivo");
});

test("by meaning: the model picks among existing places only, and code keeps its say on confidence", async () => {
  const { profileId } = await learner(WORKSPACE);
  const c = await captureToDraft(profileId, { key: key(), url: "https://raft.github.io/", title: "Raft consensus", text: "A leader is elected and replicates its log to followers; a majority must agree before an entry is committed." });
  assert.ok(c.ok);
  const placed = await placeDraftItem(profileId, c.draft.id, c.itemId, { generate: pickFor("Distributed Systems", "high") as never });
  assert.ok(placed.ok);
  assert.equal(placed.placement?.topicName, "Distributed Systems");
  assert.equal(placed.placement?.basis, "model");
  assert.ok(["high", "medium"].includes(placed.placement!.confidence));
});

test("low confidence: not filed, only suggested; and asking again changes nothing", async () => {
  const { profileId } = await learner(WORKSPACE);
  const c = await captureToDraft(profileId, { key: key(), url: "https://example.com/systems", title: "On systems", text: "Systems of many kinds share a vocabulary of parts and wholes." });
  assert.ok(c.ok);
  const placed = await placeDraftItem(profileId, c.draft.id, c.itemId, { generate: pickFor("Distributed Systems", "low") as never });
  assert.ok(placed.ok);
  assert.equal(placed.placement, null, "not filed");
  assert.equal(placed.suggestion?.topicName, "Distributed Systems", "but suggested");
  const again = await placeDraftItem(profileId, c.draft.id, c.itemId, { generate: noModel as never });
  assert.ok(again.ok);
  assert.equal(again.suggestion?.topicName, "Distributed Systems", "asked once: the stored answer stands");
});

test("an irrelevant passage in a workspace with nothing like it: unfiled, nothing invented", async () => {
  const { profileId } = await learner(WORKSPACE);
  const c = await captureToDraft(profileId, { key: key(), url: "https://cooking.example/bread", title: "Sourdough", text: "Feed the starter twice a day and keep it warm." });
  assert.ok(c.ok);
  const placed = await placeDraftItem(profileId, c.draft.id, c.itemId, { generate: pickFor(null) as never });
  assert.ok(placed.ok);
  assert.equal(placed.placement, null);
  const { places } = await workspacePlaces(profileId);
  assert.equal(places.length, 7, "no subject or topic was created");
});

test("an empty workspace: the capture is kept, unfiled, and no model is asked", async () => {
  const { profileId } = await learner([]);
  const c = await captureToDraft(profileId, { key: key(), url: "https://example.com/a", title: "A", text: "Anything at all, captured before any subject exists." });
  assert.ok(c.ok);
  const placed = await placeDraftItem(profileId, c.draft.id, c.itemId, { generate: noModel as never });
  assert.ok(placed.ok);
  assert.equal(placed.placement, null);
  assert.equal(placed.suggestion, null);
});

test("the learner's own choice is kept as theirs, and Kivo never replaces it", async () => {
  const { profileId } = await learner(WORKSPACE);
  const c = await captureToDraft(profileId, { key: key(), url: "https://www.pinecone.io/learn/vector-database/", title: "Vector databases", text: "Vector databases store embeddings for similarity search." });
  assert.ok(c.ok);
  const auto = await placeDraftItem(profileId, c.draft.id, c.itemId, { generate: noModel as never });
  assert.equal(auto.ok && auto.placement?.topicName, "Vector Databases");
  const { places } = await workspacePlaces(profileId);
  const dbs = places.find(p => p.topicName === "Database Systems")!;
  const mine = await setDraftItemPlacement(profileId, c.draft.id, c.itemId, { subjectId: dbs.subjectId, topicId: dbs.topicId });
  assert.ok(mine.ok);
  assert.equal(mine.placement?.topicName, "Database Systems");
  assert.equal(mine.placedBy, "learner");
  const later = await placeDraftItem(profileId, c.draft.id, c.itemId, { generate: pickFor("Vector Databases") as never });
  assert.ok(later.ok);
  assert.equal(later.placement?.topicName, "Database Systems", "Kivo did not overwrite the learner's choice");
  // By name, as the Drafts page sends it.
  const byName = await setDraftItemPlacement(profileId, c.draft.id, c.itemId, { subjectId: dbs.subjectId, topicId: null, topicName: "distributed systems" });
  assert.ok(byName.ok);
  assert.equal(byName.placement?.topicName, "Distributed Systems");
  // Clearing is a choice too, and also stands.
  const cleared = await setDraftItemPlacement(profileId, c.draft.id, c.itemId, { subjectId: null, topicId: null });
  assert.ok(cleared.ok);
  assert.equal(cleared.placement, null);
  const stillClear = await placeDraftItem(profileId, c.draft.id, c.itemId, { generate: pickFor("Vector Databases") as never });
  assert.ok(stillClear.ok);
  assert.equal(stillClear.placement, null);
  assert.equal(stillClear.placedBy, "learner");
});

test("a subject or topic that is not the learner's is refused, and another learner's draft is out of reach", async () => {
  const asha = await learner(WORKSPACE);
  const ravi = await learner([{ name: "History", topics: ["Rome"] }]);
  const c = await captureToDraft(asha.profileId, { key: key(), url: "https://example.com/x", title: "X", text: "A passage about distributed systems and consensus." });
  assert.ok(c.ok);
  const raviPlaces = (await workspacePlaces(ravi.profileId)).places;
  const rome = raviPlaces.find(p => p.topicName === "Rome")!;
  const theirs = await setDraftItemPlacement(asha.profileId, c.draft.id, c.itemId, { subjectId: rome.subjectId, topicId: rome.topicId });
  assert.equal(theirs.ok, false);
  assert.equal(!theirs.ok && theirs.error, "unknown_place");
  const ashaPlaces = (await workspacePlaces(asha.profileId)).places;
  const wrongTopic = await setDraftItemPlacement(asha.profileId, c.draft.id, c.itemId, { subjectId: ashaPlaces.find(p => p.subjectName === "Computer Science")!.subjectId, topicId: ashaPlaces.find(p => p.topicName === "Vector Databases")!.topicId });
  assert.equal(!wrongTopic.ok && wrongTopic.error, "unknown_place", "a topic of another subject is not a place");
  const reach = await placeDraftItem(ravi.profileId, c.draft.id, c.itemId, { generate: noModel as never });
  assert.equal(!reach.ok && reach.error, "not_found", "Ravi cannot place Asha's passage");
  const choose = await setDraftItemPlacement(ravi.profileId, c.draft.id, c.itemId, { subjectId: rome.subjectId, topicId: rome.topicId });
  assert.equal(!choose.ok && choose.error, "not_found");
});

test("the learner's notes are evidence: a note filed under a topic pulls a related passage there", async () => {
  const { profileId } = await learner(WORKSPACE);
  const { places } = await workspacePlaces(profileId);
  const rag = places.find(p => p.topicName === "Retrieval-Augmented Generation")!;
  const made = await createNote(profileId, { title: "Dense passage retrieval", body: "Dense passage retrieval encodes questions and passages into vectors; the retriever feeds the generator.", subjectId: rag.subjectId, topicName: rag.topicName });
  assert.ok(made.ok);
  const c = await captureToDraft(profileId, { key: key(), url: "https://example.com/dpr", title: "DPR explained", text: "Dense passage retrieval trains a retriever that feeds the generator with passages." });
  assert.ok(c.ok);
  let shortlist = "";
  const placed = await placeDraftItem(profileId, c.draft.id, c.itemId, { generate: (async (input: { prompt: string }) => { shortlist = input.prompt; return JSON.stringify({ pick: "C1", confidence: "medium" }); }) as never });
  assert.ok(placed.ok);
  assert.match(shortlist.split("Candidate places:")[1]!.split("\n")[1]!, /Retrieval-Augmented Generation/, "the topic its related note is filed under leads the shortlist");
  assert.equal(placed.placement?.topicName, "Retrieval-Augmented Generation");
  assert.equal(placed.placement?.confidence, "medium");
});

test("agent context: the learner's related notes and places, never the whole workspace", async () => {
  const { profileId } = await learner(WORKSPACE);
  const { places } = await workspacePlaces(profileId);
  const rag = places.find(p => p.topicName === "Retrieval-Augmented Generation")!;
  await createNote(profileId, { title: "RAG basics", body: "Retrieval-augmented generation combines a retriever with a generator.", subjectId: rag.subjectId, topicName: rag.topicName });
  const ctx = await agentContext(profileId, "Research retrieval-augmented generation architectures");
  assert.ok(ctx.notes.some(note => note.title === "RAG basics"), "the related note is found");
  assert.ok(ctx.places.some(p => p.path.includes("Retrieval-Augmented Generation")), "the matching topic is listed");
  assert.match(ctx.summary, /Retrieval-Augmented Generation/);
  assert.ok(ctx.summary.length <= 2_400);
});

test("agent workspace: search finds the learner's own notes and places, with what Kivo knows of each topic; another learner's note is out of reach", async () => {
  const me = await learner(WORKSPACE);
  const other = await learner(WORKSPACE);
  const { places } = await workspacePlaces(me.profileId);
  const vdb = places.find(p => p.topicName === "Vector Databases")!;
  const mine = await createNote(me.profileId, { title: "HNSW notes", body: "HNSW builds a layered proximity graph; search starts at the top layer and descends greedily to the nearest neighbours.", subjectId: vdb.subjectId, topicName: vdb.topicName });
  const theirs = await createNote(other.profileId, { title: "HNSW secrets", body: "Another learner's private HNSW note about proximity graphs.", subjectId: null, topicName: null });
  assert.ok(mine.ok && theirs.ok);
  const found = await agentWorkspaceSearch({ profileId: me.profileId, platformChatId: me.id }, "HNSW proximity graph");
  assert.match(found.text, /HNSW notes/);
  assert.match(found.text, /layered proximity graph/, "a snippet of the note, around its words");
  assert.doesNotMatch(found.text, /HNSW secrets|private HNSW/, "never another learner's");
  assert.ok(found.text.length <= 6_000);
  const searchVdb = await agentWorkspaceSearch({ profileId: me.profileId, platformChatId: me.id }, "vector databases");
  assert.match(searchVdb.text, /Vector Databases \(not studied in Kivo yet\)/, "a topic with no sessions has no level");
  const read = await agentReadNote(me.profileId, (mine as { note: { id: string } }).note.id);
  assert.match(read!.text, /filed in Artificial Intelligence › Vector Databases/);
  assert.match(read!.text, /descends greedily/);
  assert.equal(await agentReadNote(me.profileId, (theirs as { note: { id: string } }).note.id), null, "another learner's note is not found");
});
