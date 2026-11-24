/**
 * Portable Knowledge Maps (.kivo): export and import on real Postgres.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npx tsx --test src/portable/__integration__/kivo-portable.itest.ts
 */

import "../../nova/__integration__/test-database.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { strToU8, unzipSync, zipSync } from "fflate";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";

const { prisma } = await import("@repo/db/client");
const { ensureSetupProfile } = await import("../../nova/product/setup.js");
const { applyStudyEdits, loadStudyStructure } = await import("../../nova/product/setup-edit.js");
const { createNote, listNotes } = await import("../../nova/product/notes.js");
const { exportMap, previewExport } = await import("../export.js");
const { previewImport, startImport, resumeImport } = await import("../import.js");
const { buildPackage } = await import("../map-package.js");
const { packArchive } = await import("../kivo-archive.js");

const STAMP = Date.now();
const ids: string[] = [];
let n = 0;
async function learner() {
  const id = `web:kivo_${STAMP}_${n++}`;
  ids.push(id);
  await prisma.messengerUser.create({ data: { platform: "web", platformChatId: id, persona: "nova", displayName: "Asha" } });
  return { id, profileId: (await ensureSetupProfile(id))!.profileId };
}
after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: ids } } });
  await prisma.$disconnect();
});

async function edit(profileId: string, edits: unknown[]) {
  const s = await loadStudyStructure(profileId);
  const r = await applyStudyEdits(profileId, { version: s.version, edits });
  assert.ok(r.ok, JSON.stringify(r));
  return r.structure;
}
const subjectNamed = async (profileId: string, name: string) => (await loadStudyStructure(profileId)).subjects.find(s => s.name === name)!;

// The source map: B.Tech CSE › Year 3 › Compiler Design (topic tree), plus notes.
async function sourceMap() {
  const A = await learner();
  await edit(A.profileId, [
    { op: "add_subject", name: "B.Tech CSE", topics: [] },
    { op: "add_subject", name: "Year 3", topics: [], parentName: "B.Tech CSE" },
    { op: "add_subject", name: "Compiler Design", topics: ["Lexical analysis", "Parsing"], parentName: "Year 3" },
  ]);
  const cd = await subjectNamed(A.profileId, "Compiler Design");
  await edit(A.profileId, [{ op: "add_topics", subjectId: cd.id, names: ["Regular expressions", "Finite automata"], parentName: "Lexical analysis" }]);
  const shared = await createNote(A.profileId, { title: "Lexers", body: "# Lexers\nTokens.\n![d](kivo-image:abc)\nEnd.", subjectId: cd.id, topicName: "Lexical analysis" });
  const secret = await createNote(A.profileId, { title: "My private worries", body: "Not for anyone.", subjectId: cd.id });
  assert.ok(shared.ok && secret.ok);
  const root = await subjectNamed(A.profileId, "B.Tech CSE");
  return { A, root, sharedNoteId: shared.note.id, secretNoteId: secret.note.id };
}

test("export reads only, takes only the ticked notes, and the file carries no ids or private text", async () => {
  const { A, root, sharedNoteId } = await sourceMap();
  const before = await loadStudyStructure(A.profileId);
  const preview = await previewExport(A.profileId, root.id);
  assert.ok(preview.ok);
  assert.deepEqual(preview.subjects.map(s => [s.name, s.depth]), [["B.Tech CSE", 1], ["Year 3", 2], ["Compiler Design", 3]]);
  assert.equal(preview.topics, 4);
  const out = await exportMap(A.profileId, { rootSubjectId: root.id, noteIds: [sharedNoteId], license: "cc-by-4.0", credit: "Kivo" });
  assert.ok(out.ok);
  assert.equal(out.filename, "B.Tech CSE.kivo");
  assert.equal((await loadStudyStructure(A.profileId)).version, before.version, "export changed nothing");
  const files = unzipSync(out.bytes);
  const all = Object.values(files).map(f => new TextDecoder().decode(f)).join("\n");
  for (const leak of [A.profileId, root.id, sharedNoteId, "My private worries", "Not for anyone", "kivo-image:abc", A.id]) assert.ok(!all.includes(leak), `leaked ${leak}`);
  // Another learner can't export A's subject.
  const B = await learner();
  assert.deepEqual(await previewExport(B.profileId, root.id), { ok: false, error: "not_found", message: "That subject isn't one of yours." });
});

test("import makes an independent copy: new ids, the same nesting, notes filed, provenance kept; the source is untouched", async () => {
  const { A, root, sharedNoteId } = await sourceMap();
  const file = await exportMap(A.profileId, { rootSubjectId: root.id, noteIds: [sharedNoteId], license: "cc-by-4.0", credit: "Kivo", source: "Kivo curated maps" });
  assert.ok(file.ok);
  const B = await learner();
  await edit(B.profileId, [{ op: "add_subject", name: "B.Tech CSE", topics: ["Something of mine"] }]);   // a clash

  const preview = await previewImport(B.profileId, file.bytes);
  assert.ok(preview.ok);
  assert.deepEqual(preview.counts, { subjects: 3, topics: 4, notes: 1, links: 0, edges: 2 + 4 + 2 + 1, nestedSubjects: 2 });
  assert.deepEqual(preview.renames, [{ from: "B.Tech CSE", to: "B.Tech CSE (imported)" }]);
  assert.equal(preview.job, null);
  assert.equal(await prisma.novaImportJob.count({ where: { profileId: B.profileId } }), 0, "a preview stores nothing");

  const sourceBefore = await loadStudyStructure(A.profileId);
  const res = await startImport(B.profileId, file.bytes);
  assert.ok(res.ok && res.status === "complete", JSON.stringify(res));
  const mine = await loadStudyStructure(B.profileId);
  const byName = new Map(mine.subjects.map(s => [s.name, s]));
  const top = byName.get("B.Tech CSE (imported)")!, y3 = byName.get("Year 3")!, cd = byName.get("Compiler Design")!;
  assert.equal(res.rootSubjectId, top.id);
  assert.equal(y3.parentId, top.id); assert.equal(cd.parentId, y3.id);
  assert.notEqual(top.id, root.id, "new ids");
  const lex = cd.topics.find(t => t.name === "Lexical analysis")!;
  assert.deepEqual(cd.topics.filter(t => t.parentId === lex.id).map(t => t.name).sort(), ["Finite automata", "Regular expressions"]);
  assert.equal(byName.get("B.Tech CSE")!.topics.length, 1, "the learner's own subject is untouched");
  const notes = (await listNotes(B.profileId)).notes;
  const lexers = notes.find(x => x.title === "Lexers")!;
  assert.equal(lexers.subjectId, cd.id); assert.equal(lexers.topicName, "Lexical analysis");
  const about = notes.find(x => x.title.startsWith("About this map"))!;
  assert.equal(about.subjectId, top.id);
  const aboutRow = await prisma.novaNote.findUnique({ where: { id: about.id }, select: { body: true } });
  assert.match(aboutRow!.body, /Made by: Kivo/); assert.match(aboutRow!.body, /CC BY 4\.0/); assert.match(aboutRow!.body, /1 image in notes/);
  assert.equal((await loadStudyStructure(A.profileId)).version, sourceBefore.version, "the source never changes");
  const job = await prisma.novaImportJob.findFirstOrThrow({ where: { profileId: B.profileId } });
  assert.equal(job.status, "complete"); assert.equal(job.pkg, null, "the package is not kept once done");

  // The same file again: nothing new.
  const again = await startImport(B.profileId, file.bytes);
  assert.ok(again.ok && again.status === "complete" && again.already);
  assert.equal((await loadStudyStructure(B.profileId)).subjects.length, mine.subjects.length);
  assert.equal((await listNotes(B.profileId)).notes.length, notes.length);

  // Editing and deleting the copy leaves the source as it was.
  await edit(B.profileId, [{ op: "rename_topic", topicId: lex.id, name: "Lexing (my words)" }]);
  const regex = cd.topics.find(t => t.name === "Regular expressions")!;
  await edit(B.profileId, [{ op: "remove_topic", topicId: regex.id }]);
  await prisma.novaNote.delete({ where: { id: lexers.id } });
  const source = await loadStudyStructure(A.profileId);
  assert.equal(source.version, sourceBefore.version);
  const srcCd = source.subjects.find(s => s.name === "Compiler Design")!;
  assert.ok(srcCd.topics.some(t => t.name === "Lexical analysis") && srcCd.topics.some(t => t.name === "Regular expressions"));
  assert.ok((await listNotes(A.profileId)).notes.some(x => x.title === "Lexers"), "the source's note is still there");
});

test("a damaged or tampered file is refused and nothing is made", async () => {
  const { A, root } = await sourceMap();
  const file = await exportMap(A.profileId, { rootSubjectId: root.id, noteIds: [] });
  assert.ok(file.ok);
  const files = unzipSync(file.bytes);
  const graph = JSON.parse(new TextDecoder().decode(files["graph.json"]));
  graph.subjects[0].name = "Hijacked";
  const tampered = zipSync({ ...files, "graph.json": strToU8(JSON.stringify(graph)) });
  const C = await learner();
  const before = await loadStudyStructure(C.profileId);
  const p = await previewImport(C.profileId, tampered);
  assert.ok(!p.ok); assert.equal(p.reason, "checksum_mismatch");
  const r = await startImport(C.profileId, tampered);
  assert.ok(!r.ok); assert.equal(r.status, "refused");
  assert.equal((await loadStudyStructure(C.profileId)).version, before.version);
  assert.equal(await prisma.novaImportJob.count({ where: { profileId: C.profileId } }), 0);
  const garbage = await startImport(C.profileId, strToU8("PK\x03\x04 not really a zip"));
  assert.ok(!garbage.ok);
});

test("a stopped import resumes where it stopped and makes nothing twice; another learner can't touch the job", async () => {
  const { A, root, sharedNoteId } = await sourceMap();
  const extra = await createNote(A.profileId, { title: "Parsers", body: "LL and LR.", subjectId: (await subjectNamed(A.profileId, "Compiler Design")).id, topicName: "Parsing" });
  assert.ok(extra.ok);
  const file = await exportMap(A.profileId, { rootSubjectId: root.id, noteIds: [sharedNoteId, extra.note.id] });
  assert.ok(file.ok);
  const D = await learner();
  const done = await startImport(D.profileId, file.bytes);
  assert.ok(done.ok && done.status === "complete");

  // Wind the job back to "failed in the notes stage after the first note",
  // as if the server stopped there: the second note and the source note go.
  const job = await prisma.novaImportJob.findFirstOrThrow({ where: { profileId: D.profileId } });
  const progress = job.progress as { notesDone: string[]; aboutNoteId: string | null };
  const notesNow = (await listNotes(D.profileId)).notes;
  await prisma.novaNote.deleteMany({ where: { id: { in: notesNow.filter(x => x.title === "Parsers" || x.title.startsWith("About this map")).map(x => x.id) } } });
  const unpacked = await previewImport(D.profileId, file.bytes);
  assert.ok(unpacked.ok);
  const { unpackArchive } = await import("../kivo-archive.js");
  const pkg = (unpackArchive(file.bytes) as { pkg: unknown }).pkg;
  await prisma.novaImportJob.update({ where: { id: job.id }, data: { status: "failed", stage: "notes", pkg: pkg as never, progress: { ...progress, notesDone: [progress.notesDone[0]!], aboutNoteId: null } as never, completedAt: null } });

  const E = await learner();
  const stranger = await resumeImport(E.profileId, job.id);
  assert.ok(!stranger.ok);

  const resumed = await resumeImport(D.profileId, job.id);
  assert.ok(resumed.ok && resumed.status === "complete", JSON.stringify(resumed));
  const titles = (await listNotes(D.profileId)).notes.map(x => x.title).sort();
  assert.deepEqual(titles.filter(t => t === "Lexers" || t === "Parsers"), ["Lexers", "Parsers"], "each note once");
  assert.equal(titles.filter(t => t.startsWith("About this map")).length, 1);
  assert.equal((await loadStudyStructure(D.profileId)).subjects.filter(s => s.name === "Compiler Design").length, 1);
});

test("a map larger than one batch of edits is made in several, and read back whole", async () => {
  const subjects = [{ id: "root", name: "Big Map", parentId: null as string | null }];
  const topics: Array<{ id: string; subjectId: string; name: string; parentId: string | null; kind: null; position: number; archived: boolean }> = [];
  for (let i = 0; i < 70; i++) {
    subjects.push({ id: `s${i}`, name: `Unit ${i + 1}`, parentId: "root" });
    for (let j = 0; j < 3; j++) topics.push({ id: `t${i}_${j}`, subjectId: `s${i}`, name: `Topic ${i + 1}.${j + 1}`, parentId: j === 0 ? null : `t${i}_0`, kind: null, position: j, archived: false });
  }
  const pkg = buildPackage({ rootSubjectId: "root", subjects, topics, notes: [], resources: [], title: "Big Map", description: null, license: "all-rights-reserved", attribution: { creator: null, source: null, packageId: null, exportedAt: null }, privateNotesLeftOut: 0 });
  const { bytes } = packArchive(pkg);
  const F = await learner();
  const r = await startImport(F.profileId, bytes);
  assert.ok(r.ok && r.status === "complete", JSON.stringify(r));
  const s = await loadStudyStructure(F.profileId);
  assert.equal(s.subjects.filter(x => x.name.startsWith("Unit ")).length, 70);
  assert.equal(s.subjects.filter(x => x.name.startsWith("Unit ")).reduce((k, x) => k + x.topics.length, 0), 210);
});

// ── Founder review #15 and #12: links arrive as saved pages, whole maps ──────
const { recordLearningEvent, listFiledLinks } = await import("../../nova/product/learning-events.js");

let clientN = 0;
async function saveLink(profileId: string, url: string, title: string, subjectId: string, topicName: string | null) {
  const r = await recordLearningEvent(profileId, { eventType: "resource_saved", clientEventId: `itest-link-${STAMP}-${clientN++}`, url, title, subjectId, topicName }, { source: "web" });
  assert.ok(r.success, JSON.stringify(r));
}
// What a learner's saved pages are, by address: subject name, topic, source.
async function savedPlaces(profileId: string) {
  const s = await loadStudyStructure(profileId);
  const name = new Map(s.subjects.map(x => [x.id, x.name]));
  const rows = await prisma.novaLearningEvent.findMany({ where: { profileId, eventType: "resource_saved" }, orderBy: { url: "asc" }, select: { url: true, title: true, subjectId: true, topicName: true, source: true, personalNote: true } });
  return rows.map(r => ({ url: r.url, title: r.title, subject: r.subjectId ? name.get(r.subjectId) ?? "?" : null, topic: r.topicName, source: r.source, note: r.personalNote }));
}

// Two top-level subjects; links filed under different topics, one under a subject inside a subject.
async function linkedMap() {
  const A = await learner();
  await edit(A.profileId, [
    { op: "add_subject", name: "Operating Systems", topics: ["Deadlocks", "Paging"] },
    { op: "add_subject", name: "OS Lab", topics: ["Fork"], parentName: "Operating Systems" },
    { op: "add_subject", name: "DBMS", topics: ["Normalisation"] },
  ]);
  const os = await subjectNamed(A.profileId, "Operating Systems");
  const lab = await subjectNamed(A.profileId, "OS Lab");
  const db = await subjectNamed(A.profileId, "DBMS");
  await saveLink(A.profileId, "https://example.edu/deadlocks", "Deadlock lecture", os.id, "Deadlocks");
  await saveLink(A.profileId, "https://example.edu/paging", "Paging notes", os.id, "Paging");
  await saveLink(A.profileId, "https://example.edu/os-general", "OS syllabus", os.id, null);
  await saveLink(A.profileId, "https://example.edu/fork", "fork(2)", lab.id, "Fork");
  await saveLink(A.profileId, "https://example.org/3nf", "3NF explained", db.id, "Normalisation");
  return { A, os, db };
}

test("links in a shared subject arrive as saved pages under the same subject and topic (round trip)", async () => {
  const { A, os } = await linkedMap();
  const sourceBefore = await savedPlaces(A.profileId);
  const structureBefore = await loadStudyStructure(A.profileId);

  const preview = await previewExport(A.profileId, os.id);
  assert.ok(preview.ok);
  assert.equal(preview.links, 4, "the four links under Operating Systems and OS Lab");
  const file = await exportMap(A.profileId, { rootSubjectId: os.id });   // links are in by default
  assert.ok(file.ok);

  const B = await learner();
  const done = await startImport(B.profileId, file.bytes);
  assert.ok(done.ok && done.status === "complete", JSON.stringify(done));
  assert.equal(done.counts.links, 4);

  const copy = await savedPlaces(B.profileId);
  assert.deepEqual(copy.map(c => [c.url, c.title, c.subject, c.topic]), [
    ["https://example.edu/deadlocks", "Deadlock lecture", "Operating Systems", "Deadlocks"],
    ["https://example.edu/fork", "fork(2)", "OS Lab", "Fork"],
    ["https://example.edu/os-general", "OS syllabus", "Operating Systems", null],
    ["https://example.edu/paging", "Paging notes", "Operating Systems", "Paging"],
  ]);
  assert.ok(copy.every(c => c.source === "kivo_import" && c.note?.startsWith("From the shared map")), "provenance kept on each");
  // They are the map's own: the map's reader finds them under the new subjects.
  const bOs = await subjectNamed(B.profileId, "Operating Systems");
  assert.equal((await listFiledLinks(B.profileId, [bOs.id], 50)).length, 3);

  // The source is untouched.
  assert.deepEqual(await savedPlaces(A.profileId), sourceBefore);
  assert.equal((await loadStudyStructure(A.profileId)).version, structureBefore.version);

  // Importing the same file again makes nothing.
  const again = await startImport(B.profileId, file.bytes);
  assert.ok(again.ok && again.status === "complete" && again.already);
  assert.equal((await savedPlaces(B.profileId)).length, 4);
});

test("a resumed import that stopped among the links makes none twice", async () => {
  const { A, os } = await linkedMap();
  const file = await exportMap(A.profileId, { rootSubjectId: os.id });
  assert.ok(file.ok);
  const B = await learner();
  const done = await startImport(B.profileId, file.bytes);
  assert.ok(done.ok && done.status === "complete");

  // Wind back to "stopped in the links stage after two links".
  const job = await prisma.novaImportJob.findFirstOrThrow({ where: { profileId: B.profileId } });
  const progress = job.progress as { links: Record<string, string>; aboutNoteId: string | null };
  const kept = Object.keys(progress.links).slice(0, 2);
  const { linkClientId } = await import("../import.js");
  const dropped = Object.keys(progress.links).slice(2).map(ref => linkClientId(job.packageId, ref));
  await prisma.novaLearningEvent.deleteMany({ where: { profileId: B.profileId, clientEventId: { in: dropped } } });
  const { unpackArchive } = await import("../kivo-archive.js");
  const pkg = (unpackArchive(file.bytes) as { pkg: unknown }).pkg;
  await prisma.novaImportJob.update({ where: { id: job.id }, data: { status: "failed", stage: "links", pkg: pkg as never, progress: { ...progress, links: Object.fromEntries(kept.map(k => [k, progress.links[k]])) } as never, completedAt: null } });
  assert.equal((await savedPlaces(B.profileId)).length, 2);

  const resumed = await resumeImport(B.profileId, job.id);
  assert.ok(resumed.ok && resumed.status === "complete", JSON.stringify(resumed));
  const copy = await savedPlaces(B.profileId);
  assert.equal(copy.length, 4, "each link once");
  assert.equal(new Set(copy.map(c => c.url)).size, 4);

  // A job from before the links stage existed (no `links` in progress, stage "about"): resumed, its links are made.
  await prisma.novaLearningEvent.deleteMany({ where: { profileId: B.profileId, source: "kivo_import" } });
  await prisma.novaImportJob.update({ where: { id: job.id }, data: { status: "failed", stage: "about", pkg: pkg as never, progress: { ...progress, links: undefined } as never, completedAt: null } });
  const old = await resumeImport(B.profileId, job.id);
  assert.ok(old.ok && old.status === "complete", JSON.stringify(old));
  assert.equal((await savedPlaces(B.profileId)).length, 4);
});

test("a page the importer already saved is not duplicated and keeps their filing", async () => {
  const { A, os } = await linkedMap();
  const file = await exportMap(A.profileId, { rootSubjectId: os.id });
  assert.ok(file.ok);
  const C = await learner();
  await edit(C.profileId, [{ op: "add_subject", name: "My OS notes", topics: ["Locks"] }]);
  const mine = await subjectNamed(C.profileId, "My OS notes");
  await saveLink(C.profileId, "https://example.edu/deadlocks", "My copy", mine.id, "Locks");
  const done = await startImport(C.profileId, file.bytes);
  assert.ok(done.ok && done.status === "complete", JSON.stringify(done));
  assert.equal(done.counts.links, 3);
  assert.equal(done.counts.linksAlreadySaved, 1);
  const deadlocks = (await savedPlaces(C.profileId)).filter(c => c.url === "https://example.edu/deadlocks");
  assert.deepEqual(deadlocks.map(d => [d.title, d.subject, d.topic]), [["My copy", "My OS notes", "Locks"]]);
});

test("the whole map exports every top-level subject and imports as independent copies", async () => {
  const { A } = await linkedMap();
  const notesBefore = (await listNotes(A.profileId)).notes.length;
  const preview = await previewExport(A.profileId, "map");
  assert.ok(preview.ok);
  assert.equal(preview.scope, "map");
  assert.deepEqual(preview.roots.map(r => r.name), ["Operating Systems", "DBMS"]);
  assert.equal(preview.links, 5);
  const file = await exportMap(A.profileId, { rootSubjectId: "map", title: "2nd year roadmap" });
  assert.ok(file.ok);
  assert.equal(file.filename, "2nd year roadmap.kivo");
  assert.equal(file.manifest.mapFormat, "kivo.map/2");

  const B = await learner();
  await edit(B.profileId, [{ op: "add_subject", name: "DBMS", topics: ["My own topic"] }]);
  const bp = await previewImport(B.profileId, file.bytes);
  assert.ok(bp.ok);
  assert.deepEqual(bp.renames, [{ from: "DBMS", to: "DBMS (imported)" }]);
  const done = await startImport(B.profileId, file.bytes);
  assert.ok(done.ok && done.status === "complete", JSON.stringify(done));
  assert.equal(done.rootSubjectIds.length, 2);
  const s = await loadStudyStructure(B.profileId);
  const byName = new Map(s.subjects.map(x => [x.name, x]));
  assert.ok(byName.get("Operating Systems") && byName.get("DBMS (imported)") && byName.get("OS Lab"));
  assert.equal(byName.get("OS Lab")!.parentId, byName.get("Operating Systems")!.id);
  assert.deepEqual(byName.get("DBMS")!.topics.map(t => t.name), ["My own topic"], "the learner's own DBMS is untouched");
  const copy = await savedPlaces(B.profileId);
  assert.deepEqual(copy.filter(c => c.url.endsWith("/3nf")).map(c => [c.subject, c.topic]), [["DBMS (imported)", "Normalisation"]]);
  assert.equal(copy.length, 5);
  // Source unchanged.
  assert.equal((await listNotes(A.profileId)).notes.length, notesBefore);
  assert.equal((await savedPlaces(A.profileId)).every(c => c.source === "web"), true);
});
