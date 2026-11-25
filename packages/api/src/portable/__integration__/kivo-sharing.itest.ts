/**
 * Full-fidelity Knowledge Map sharing and individual note sharing, on real
 * Postgres, across two accounts (the cofounder review's definition of done,
 * §13.1): everything in scope arrives as the importer's own records, images
 * and files byte for byte, nothing twice on a resume, the wrong kind of .kivo
 * refused before anything is written, storage reserved first, the source
 * untouched, and a note's PDF a real, readable PDF.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npx tsx --test src/portable/__integration__/kivo-sharing.itest.ts
 */

import "../../nova/__integration__/test-database.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";
process.env.ANTHROPIC_API_KEY = "";

const { prisma } = await import("@repo/db/client");
const { ensureSetupProfile } = await import("../../nova/product/setup.js");
const { applyStudyEdits, loadStudyStructure } = await import("../../nova/product/setup-edit.js");
const { createNote, getNote, updateNote, deleteNote } = await import("../../nova/product/notes.js");
const { saveNoteImageBytes, readNoteImage } = await import("../../nova/product/note-images.js");
const { saveNoteAttachmentBytes, readNoteAttachment, noteAttachmentBytes } = await import("../../nova/product/note-attachments.js");
const { recordLearningEvent, organizeResource, listFiledLinks } = await import("../../nova/product/learning-events.js");
const { createTasksIn, listTasksInSubjects, updateTask } = await import("../../nova/product/tasks.js");
const { topicDetailsOf } = await import("../../nova/engines/topic-mastery-engine.js");
const { exportMap, previewExport, WHOLE_MAP } = await import("../export.js");
const { previewImport, startImport, resumeImport, listImports } = await import("../import.js");
const { exportNoteKivo, exportNotePdf, previewNoteImport, startNoteImport } = await import("../note-share.js");

const STAMP = Date.now();
const ids: string[] = [];
let n = 0;
async function learner() {
  const id = `web:share_${STAMP}_${n++}`;
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
}
const subjectNamed = async (profileId: string, name: string) => (await loadStudyStructure(profileId)).subjects.find(s => s.name === name)!;
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

// Real files, made here.
const crcT = Array.from({ length: 256 }, (_, k) => { let c = k; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, "latin1"), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(w: number, h: number, seed: number): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = (x * seed) & 255; raw[o + 1] = (y * seed) & 255; raw[o + 2] = seed; }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const pdfBytes = (label: string) => new Uint8Array(Buffer.from(`%PDF-1.4\n1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj\n2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj\n3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 200 200]>> endobj\n% ${label} ${"x".repeat(2000)}\ntrailer <</Root 1 0 R>>\n%%EOF\n`, "latin1"));
let keyN = 0;
const key = () => `itestkey_${STAMP}_${keyN++}`;

// An admission that records what was asked and can refuse.
function admitter(refuse = false) {
  const asked: number[] = [];
  let released = 0;
  const admit = async (bytes: number) => { asked.push(bytes); return refuse ? { refused: "No room.", release: async () => undefined } : { refused: null, release: async () => { released++; } }; };
  return { admit, asked, released: () => released };
}

// A realistic map: two roots, nested subjects and topics, topic explanations
// and a milestone, notes with rich Markdown, an image and PDFs, saved pages
// with metadata and tags, and tasks with steps and a wait.
async function richMap() {
  const A = await learner();
  await edit(A.profileId, [
    { op: "add_subject", name: "Algorithms", topics: ["Dynamic programming", "Graphs"] },
    { op: "add_subject", name: "DP drills", topics: [], parentName: "Algorithms" },
    { op: "add_subject", name: "Operating Systems", topics: ["Scheduling"] },
  ]);
  const alg = await subjectNamed(A.profileId, "Algorithms");
  const os = await subjectNamed(A.profileId, "Operating Systems");
  await edit(A.profileId, [
    { op: "add_topics", subjectId: alg.id, names: ["Knapsack", "LIS"], parentName: "Dynamic programming" },
    { op: "add_topics", subjectId: os.id, names: ["Build a shell"], kind: "milestone" },
    { op: "add_topics", subjectId: os.id, names: ["Paging (old)"] },
  ]);
  const s1 = await loadStudyStructure(A.profileId);
  const algT = s1.subjects.find(s => s.name === "Algorithms")!.topics;
  const osT = s1.subjects.find(s => s.name === "Operating Systems")!.topics;
  await edit(A.profileId, [
    { op: "update_topic", topicId: algT.find(t => t.name === "Knapsack")!.id, details: { explanation: "Pick items under a weight limit to maximise value.", sources: [{ file: "L4.pdf", page: 3 }] } },
    { op: "update_topic", topicId: osT.find(t => t.name === "Build a shell")!.id, details: { weeks: 2, goals: ["fork and exec", "pipes"], completion: "Runs ls | wc -l" } },
    { op: "archive_topic", topicId: osT.find(t => t.name === "Paging (old)")!.id },
  ].filter(e => e.op !== "archive_topic"));
  // Archive one topic the ordinary way, if this server has it; otherwise leave it.
  await prisma.novaTopicMastery.updateMany({ where: { id: osT.find(t => t.name === "Paging (old)")!.id }, data: { archivedAt: new Date() } });

  const drills = await subjectNamed(A.profileId, "DP drills");
  const dp = await createNote(A.profileId, { title: "Knapsack, worked", subjectId: alg.id, topicName: "Knapsack",
    body: "# 0/1 knapsack\nState: **dp[i][w]** is the best value using the first *i* items.\n\n| i | w | dp |\n|---|---|---|\n| 1 | 3 | 4 |\n\n```python\nfor i in range(n):\n    pass\n```\n\n- [x] Recurrence\n- [ ] Space optimisation\n\nSee [the lecture](https://example.edu/l4) and [[LIS notes]].\n" });
  const lis = await createNote(A.profileId, { title: "LIS notes", subjectId: drills.id, topicName: null, body: "> [!idea] Patience sorting\n> O(n log n).\n" });
  const sched = await createNote(A.profileId, { title: "Scheduling", subjectId: os.id, topicName: "Scheduling", body: "Round robin, MLFQ." });
  const loose = await createNote(A.profileId, { title: "Unfiled thought", body: "Not in the map.", subjectId: null });
  assert.ok(dp.ok && lis.ok && sched.ok && loose.ok);
  const IMG = png(64, 40, 7), IMG2 = png(20, 20, 3), DOC = pdfBytes("lecture 4"), DOC2 = pdfBytes("os slides");
  const img = await saveNoteImageBytes(A.profileId, { noteId: dp.note.id, bytes: IMG, clientKey: key(), sourceUrl: "https://example.edu/l4.pdf", sourceTitle: "L4", page: 3 });
  const img2 = await saveNoteImageBytes(A.profileId, { noteId: sched.note.id, bytes: IMG2, clientKey: key() });
  const doc = await saveNoteAttachmentBytes(A.profileId, { noteId: dp.note.id, bytes: DOC, fileName: "Lecture 4.pdf", clientKey: key() });
  const doc2 = await saveNoteAttachmentBytes(A.profileId, { noteId: sched.note.id, bytes: DOC2, fileName: "OS slides.pdf", clientKey: key() });
  assert.ok(img.ok && img2.ok && doc.ok && doc2.ok);
  assert.ok((await updateNote(A.profileId, dp.note.id, { body: `${dp.note.body}\n![dp table](kivo-image:${img.image.id})\n\n[Lecture 4.pdf](kivo-file:${doc.file.id})\n` })).ok);
  assert.ok((await updateNote(A.profileId, sched.note.id, { body: `Round robin, MLFQ.\n\n![gantt](kivo-image:${img2.image.id})\n` })).ok);   // its PDF is kept but not named

  const page = await recordLearningEvent(A.profileId, { eventType: "resource_saved", clientEventId: `itest-page-${STAMP}-${n}`, url: "https://www.youtube.com/watch?v=abcdefghi", title: "Knapsack in 10 minutes", subjectId: alg.id, topicName: "Knapsack",
    canonicalUrl: "https://www.youtube.com/watch?v=abcdefghi", meta: { description: "A short walk-through.", author: "MIT OCW", siteName: "YouTube", publishedAt: "2024-03-01T00:00:00Z", duration: "PT10M" } }, { source: "web" });
  assert.ok((page as { success?: boolean }).success, JSON.stringify(page));
  const pageId = (page as { eventId: string }).eventId;
  const org = await organizeResource(A.profileId, pageId, { tags: ["dp", "exam"], readingStatus: "done", personalNote: "My own private note on this page" }, async () => false);
  assert.ok(org.ok, JSON.stringify(org));
  const page2 = await recordLearningEvent(A.profileId, { eventType: "resource_saved", clientEventId: `itest-page2-${STAMP}-${n}`, url: "https://pages.cs.wisc.edu/~remzi/OSTEP/", title: "OSTEP", subjectId: os.id, topicName: null }, { source: "web" });
  assert.ok((page2 as { success?: boolean }).success);

  const tasks = await prisma.$transaction(tx => createTasksIn(tx, A.profileId, [
    { title: "Solve 5 knapsack problems", subjectId: alg.id, topicName: "Knapsack", priority: "high", estimatedMinutes: 90, clientKey: `t1-${STAMP}`, dueDay: "2026-12-01" },
    { title: "Write the recurrence", clientKey: `t2-${STAMP}`, parentKey: `t1-${STAMP}`, subjectId: alg.id, topicName: "Knapsack" },
    { title: "Revise DP", subjectId: alg.id, clientKey: `t3-${STAMP}`, afterKeys: [`t1-${STAMP}`], estimatedMinutes: 30 },
    { title: "Implement a pipe", subjectId: os.id, topicName: "Build a shell", clientKey: `t4-${STAMP}` },
  ]));
  assert.ok(tasks.ok, JSON.stringify(tasks));
  const done = (await listTasksInSubjects(A.profileId, [alg.id])).find(t => t.title === "Write the recurrence")!;
  assert.ok((await updateTask(A.profileId, done.id, { status: "done" })).ok);
  return { A, alg, os, notes: { dp: dp.note.id, lis: lis.note.id, sched: sched.note.id }, bytes: { IMG, IMG2, DOC, DOC2 } };
}

test("a whole map round-trips into another account: every in-scope item, images and files byte for byte, nothing personal", async () => {
  const { A, alg, bytes } = await richMap();
  const preview = await previewExport(A.profileId, WHOLE_MAP);
  assert.ok(preview.ok);
  assert.equal(preview.format, "kivo.map/2");
  assert.equal(preview.notes.length, 3);
  assert.equal(preview.images, 2); assert.equal(preview.files, 2);
  assert.equal(preview.storageBytes, bytes.IMG.length + bytes.IMG2.length + bytes.DOC.length + bytes.DOC2.length);
  assert.equal(preview.tasks, 4);
  assert.equal(preview.topicDetails, 2);
  assert.equal(preview.links, 2);
  assert.equal(preview.leftOut.archivedTopics, 1);
  assert.equal(preview.leftOut.unfiledNotes, 1);
  assert.equal(preview.privateNotes, "no_private_flag");

  const file = await exportMap(A.profileId, { rootSubjectId: WHOLE_MAP, title: "Year 2", credit: "Asha" });
  assert.ok(file.ok, JSON.stringify(file));
  const B = await learner();
  const ip = await previewImport(B.profileId, file.bytes);
  assert.ok(ip.ok);
  assert.deepEqual({ images: ip.counts.images, files: ip.counts.files, tasks: ip.counts.tasks, topicDetails: ip.counts.topicDetails, notes: ip.counts.notes, links: ip.counts.links }, { images: 2, files: 2, tasks: 4, topicDetails: 2, notes: 3, links: 2 });
  assert.equal(ip.storageBytes, preview.storageBytes);
  assert.equal(await prisma.novaImportJob.count({ where: { profileId: B.profileId } }), 0, "a preview stores nothing");

  const storage = admitter();
  const res = await startImport(B.profileId, file.bytes, { admit: storage.admit });
  assert.ok(res.ok && res.status === "complete", JSON.stringify(res));
  assert.deepEqual(storage.asked, [preview.storageBytes], "storage reserved once, for every image and file");
  assert.equal(storage.released(), 1);
  assert.deepEqual({ ...res.counts }, { subjects: 3, topics: 6, notes: 3, links: 2, linksAlreadySaved: 0, images: 2, files: 2, tasks: 4, topicDetails: 2 });

  // Structure, nesting and what each topic's plan says.
  const mine = await loadStudyStructure(B.profileId);
  const bAlg = mine.subjects.find(s => s.name === "Algorithms")!, bDrills = mine.subjects.find(s => s.name === "DP drills")!, bOs = mine.subjects.find(s => s.name === "Operating Systems")!;
  assert.equal(bDrills.parentId, bAlg.id);
  assert.notEqual(bAlg.id, alg.id);
  const dpT = bAlg.topics.find(t => t.name === "Dynamic programming")!;
  assert.deepEqual(bAlg.topics.filter(t => t.parentId === dpT.id).map(t => t.name).sort(), ["Knapsack", "LIS"]);
  assert.ok(!bOs.topics.some(t => t.name === "Paging (old)"), "an archived topic stays with its creator");
  assert.equal(bOs.topics.find(t => t.name === "Build a shell")!.kind, "milestone");
  const details = await topicDetailsOf(B.profileId, [bAlg.id, bOs.id]);
  assert.deepEqual(details.get(bAlg.topics.find(t => t.name === "Knapsack")!.id), { explanation: "Pick items under a weight limit to maximise value.", sources: [{ file: "L4.pdf", page: 3 }] });
  assert.deepEqual(details.get(bOs.topics.find(t => t.name === "Build a shell")!.id), { weeks: 2, goals: ["fork and exec", "pipes"], completion: "Runs ls | wc -l" });

  // Notes: exact text with new ids; images and files byte for byte, owned by B.
  const bNotes = await prisma.novaNote.findMany({ where: { profileId: B.profileId, NOT: { title: { startsWith: "About this map" } } }, include: { images: true, attachments: true } });
  assert.deepEqual(bNotes.map(x => x.title).sort(), ["Knapsack, worked", "LIS notes", "Scheduling"]);
  const bDp = bNotes.find(x => x.title === "Knapsack, worked")!;
  assert.equal(bDp.images.length, 1); assert.equal(bDp.attachments.length, 1);
  assert.ok(bDp.body.includes(`(kivo-image:${bDp.images[0]!.id})`) && bDp.body.includes(`](kivo-file:${bDp.attachments[0]!.id})`));
  assert.ok(bDp.body.startsWith("# 0/1 knapsack\nState: **dp[i][w]**"), "rich Markdown exactly");
  const aDp = (await getNote(A.profileId, (await prisma.novaNote.findFirstOrThrow({ where: { profileId: A.profileId, title: "Knapsack, worked" } })).id))!;
  const aImgId = /kivo-image:([a-z0-9]+)/.exec(aDp.body)![1]!;
  assert.equal(bDp.body, aDp.body.replace(aImgId, bDp.images[0]!.id).replace(/kivo-file:[a-z0-9]+/, `kivo-file:${bDp.attachments[0]!.id}`));
  assert.equal(sha((await readNoteImage(B.profileId, bDp.images[0]!.id))!.bytes), sha(bytes.IMG));
  assert.equal(sha((await readNoteAttachment(B.profileId, bDp.attachments[0]!.id))!.bytes), sha(bytes.DOC));
  assert.equal(bDp.attachments[0]!.fileName, "Lecture 4.pdf");
  const bSched = bNotes.find(x => x.title === "Scheduling")!;
  assert.equal(sha((await readNoteAttachment(B.profileId, bSched.attachments[0]!.id))!.bytes), sha(bytes.DOC2), "a file kept but not named in the text still arrives");
  assert.ok(bSched.body.includes(`[OS slides.pdf](kivo-file:${bSched.attachments[0]!.id})`));
  assert.ok(bNotes.every(x => x.profileId === B.profileId) && bNotes.every(x => x.images.every(i => i.profileId === B.profileId) && x.attachments.every(f => f.profileId === B.profileId)));
  assert.equal(await noteAttachmentBytes(B.profileId), bytes.DOC.length + bytes.DOC2.length);

  // Saved pages, native, with metadata and tags; never the creator's reading state or own note.
  const pages = await listFiledLinks(B.profileId, [bAlg.id, bOs.id], 10);
  const yt = pages.find(p => p.title === "Knapsack in 10 minutes")!;
  assert.equal(yt.subjectId, bAlg.id); assert.equal(yt.topicName, "Knapsack");
  assert.deepEqual(yt.tags.sort(), ["dp", "exam"]);
  assert.equal(yt.author, "MIT OCW"); assert.equal(yt.durationSeconds, 600);
  const row = await prisma.novaLearningEvent.findFirstOrThrow({ where: { id: yt.id } });
  assert.equal(row.readingStatus, "unread");
  assert.ok(!row.personalNote!.includes("My own private note"));
  assert.equal(row.processingStatus, "none", "no model is asked about an imported page");

  // Tasks: definitions with steps and waits, never their progress.
  const bTasks = await listTasksInSubjects(B.profileId, [bAlg.id, bOs.id]);
  assert.equal(bTasks.length, 4);
  assert.ok(bTasks.every(t => t.status === "todo" && t.dueDay === null), "no status or due day transfers");
  const solve = bTasks.find(t => t.title === "Solve 5 knapsack problems")!;
  assert.equal(solve.priority, "high"); assert.equal(solve.estimatedMinutes, 90); assert.equal(solve.topicName, "Knapsack");
  assert.equal(bTasks.find(t => t.title === "Write the recurrence")!.parentId, solve.id);
  assert.deepEqual(bTasks.find(t => t.title === "Revise DP")!.after, [solve.id]);

  // Learning state never transfers.
  assert.equal(await prisma.novaTopicMastery.count({ where: { subject: { profileId: B.profileId }, reviewCount: { gt: 0 } } }), 0);

  // Source isolation: changing or deleting B's copy never touches A.
  const aBefore = await prisma.novaNote.findMany({ where: { profileId: A.profileId }, select: { id: true, body: true }, orderBy: { id: "asc" } });
  assert.ok((await updateNote(B.profileId, bDp.id, { body: "changed" })).ok);
  assert.ok(await deleteNote(B.profileId, bSched.id));
  assert.deepEqual(await prisma.novaNote.findMany({ where: { profileId: A.profileId }, select: { id: true, body: true }, orderBy: { id: "asc" } }), aBefore);
  assert.equal(await prisma.novaNoteAttachment.count({ where: { profileId: A.profileId } }), 2);

  // The same file again: the import already made. Asked for another copy: a second, independent one.
  const again = await startImport(B.profileId, file.bytes, { admit: storage.admit });
  assert.ok(again.ok && again.status === "complete" && again.already);
  const copy = await startImport(B.profileId, file.bytes, { admit: storage.admit, copy: true });
  assert.ok(copy.ok && copy.status === "complete" && !copy.already, JSON.stringify(copy));
  assert.ok((await loadStudyStructure(B.profileId)).subjects.some(s => s.name === "Algorithms (imported)"));
  assert.equal((await listImports(B.profileId)).length, 2);
});

test("storage is reserved before anything is written: refused, nothing is made", async () => {
  const { A } = await richMap();
  const file = await exportMap(A.profileId, { rootSubjectId: WHOLE_MAP });
  assert.ok(file.ok);
  const B = await learner();
  const before = await loadStudyStructure(B.profileId);
  const r = await startImport(B.profileId, file.bytes, { admit: admitter(true).admit });
  assert.ok(!r.ok && r.reason === "storage");
  assert.equal((await loadStudyStructure(B.profileId)).version, before.version);
  assert.equal(await prisma.novaNote.count({ where: { profileId: B.profileId } }), 0);
});

test("a stopped import resumes from the same file and makes nothing twice; without the file it says so; another account is refused", async () => {
  const { A } = await richMap();
  const file = await exportMap(A.profileId, { rootSubjectId: WHOLE_MAP });
  assert.ok(file.ok);
  const B = await learner();
  const done = await startImport(B.profileId, file.bytes);
  assert.ok(done.ok && done.status === "complete");
  // Wind back to "stopped after the first note was made, before its image and file".
  const job = await prisma.novaImportJob.findFirstOrThrow({ where: { profileId: B.profileId } });
  const { unpackArchive } = await import("../kivo-archive.js");
  const pkg = (unpackArchive(file.bytes) as { pkg: unknown }).pkg;
  const progress = job.progress as { noteIds: Record<string, string>; assetIds: Record<string, string>; notesDone: string[] };
  const dpRef = Object.keys(progress.noteIds)[0]!;
  await prisma.novaNoteImage.deleteMany({ where: { profileId: B.profileId } });
  await prisma.novaNoteAttachment.deleteMany({ where: { profileId: B.profileId } });
  await prisma.novaTask.deleteMany({ where: { profileId: B.profileId } });
  await prisma.novaImportJob.update({ where: { id: job.id }, data: { status: "failed", stage: "notes", pkg: pkg as never,
    progress: { ...progress, notesDone: [], assetIds: {}, noteIds: { [dpRef]: progress.noteIds[dpRef]! }, tasksDone: false } as never, completedAt: null } });
  const notesBefore = await prisma.novaNote.count({ where: { profileId: B.profileId } });

  const stranger = await learner();
  const denied = await resumeImport(stranger.profileId, job.id);
  assert.ok(!denied.ok && denied.reason === "not_found", "another account's job is refused");
  const noFile = await resumeImport(B.profileId, job.id);
  assert.ok(!noFile.ok && noFile.reason === "file_needed", JSON.stringify(noFile));

  const resumed = await startImport(B.profileId, file.bytes);
  assert.ok(resumed.ok && resumed.status === "complete", JSON.stringify(resumed));
  // Notes not recorded as made were made again; the one recorded was not.
  const titles = (await prisma.novaNote.findMany({ where: { profileId: B.profileId }, select: { title: true } })).map(x => x.title);
  for (const t of ["Knapsack, worked", "LIS notes", "Scheduling"]) assert.ok(titles.filter(x => x === t).length >= 1);
  assert.equal(await prisma.novaNoteImage.count({ where: { profileId: B.profileId } }), 2, "each image once");
  assert.equal(await prisma.novaNoteAttachment.count({ where: { profileId: B.profileId } }), 2, "each file once");
  assert.equal(await prisma.novaTask.count({ where: { profileId: B.profileId } }), 4, "each task once");
  assert.ok(await prisma.novaNote.count({ where: { profileId: B.profileId } }) >= notesBefore);
  // Running it again changes nothing.
  const counts = async () => [await prisma.novaNote.count({ where: { profileId: B.profileId } }), await prisma.novaNoteImage.count({ where: { profileId: B.profileId } }), await prisma.novaTask.count({ where: { profileId: B.profileId } })];
  const c1 = await counts();
  const third = await startImport(B.profileId, file.bytes);
  assert.ok(third.ok && third.already);
  assert.deepEqual(await counts(), c1);
});

test("a .kivo note round-trips into another account as a new editable note, images and files byte for byte", async () => {
  const { A, notes, bytes } = await richMap();
  const out = await exportNoteKivo(A.profileId, { noteId: notes.dp, credit: "Asha" });
  assert.ok(out.ok, JSON.stringify(out));
  assert.equal(out.filename, "Knapsack, worked.kivo");
  assert.deepEqual(out.counts, { images: 1, files: 1, imagesLeftOut: 0, filesLeftOut: 0 });
  const stranger = await learner();
  assert.deepEqual(await exportNoteKivo(stranger.profileId, { noteId: notes.dp }), { ok: false, error: "not_found", message: "That note isn't one of yours." });

  const B = await learner();
  await edit(B.profileId, [{ op: "add_subject", name: "Algorithms", topics: ["Knapsack"] }]);
  const bAlg = await subjectNamed(B.profileId, "Algorithms");
  const p = await previewNoteImport(B.profileId, out.bytes);
  assert.ok(p.ok && p.kind === "kivo");
  assert.equal(p.title, "Knapsack, worked");
  assert.equal(p.creator, "Asha");
  assert.equal(p.storageBytes, bytes.IMG.length + bytes.DOC.length);
  assert.deepEqual(p.suggested, { subjectName: "Algorithms", topicName: "Knapsack", subjectId: bAlg.id });
  assert.equal(await prisma.novaImportJob.count({ where: { profileId: B.profileId } }), 0);

  const storage = admitter();
  const r = await startNoteImport(B.profileId, out.bytes, { subjectId: bAlg.id, topicName: "Knapsack", admit: storage.admit });
  assert.ok(r.ok && r.status === "complete", JSON.stringify(r));
  assert.deepEqual(storage.asked, [bytes.IMG.length + bytes.DOC.length]);
  const note = await prisma.novaNote.findUniqueOrThrow({ where: { id: r.noteId }, include: { images: true, attachments: true } });
  assert.equal(note.profileId, B.profileId);
  assert.equal(note.subjectId, bAlg.id); assert.equal(note.topicName, "Knapsack");
  const src = (await getNote(A.profileId, notes.dp))!;
  assert.equal(note.body, src.body.replace(/kivo-image:[a-z0-9]+/, `kivo-image:${note.images[0]!.id}`).replace(/kivo-file:[a-z0-9]+/, `kivo-file:${note.attachments[0]!.id}`));
  assert.equal(sha(note.images[0]!.bytes), sha(bytes.IMG));
  assert.equal(note.attachments[0]!.sha256, sha(bytes.DOC));
  assert.equal(sha((await readNoteAttachment(B.profileId, note.attachments[0]!.id))!.bytes), sha(bytes.DOC));
  // Editable, and independent of the source.
  assert.ok((await updateNote(B.profileId, note.id, { body: "mine now" })).ok);
  assert.equal((await getNote(A.profileId, notes.dp))!.body, src.body);

  // The same file again is that note; another copy when asked.
  const again = await startNoteImport(B.profileId, out.bytes, { admit: storage.admit });
  assert.ok(again.ok && again.status === "complete" && again.already && again.noteId === r.noteId);
  const copy = await startNoteImport(B.profileId, out.bytes, { admit: storage.admit, copy: true });
  assert.ok(copy.ok && copy.status === "complete" && copy.noteId !== r.noteId);
  assert.equal(await prisma.novaNote.count({ where: { profileId: B.profileId, title: "Knapsack, worked" } }), 2);
});

test("each importer refuses the other kind of .kivo before writing anything", async () => {
  const { A, notes } = await richMap();
  const noteFile = await exportNoteKivo(A.profileId, { noteId: notes.lis });
  const mapFile = await exportMap(A.profileId, { rootSubjectId: WHOLE_MAP });
  assert.ok(noteFile.ok && mapFile.ok);
  const B = await learner();
  const before = await loadStudyStructure(B.profileId);
  const asMap = await startImport(B.profileId, noteFile.bytes);
  assert.ok(!asMap.ok && asMap.reason === "wrong_package_type" && asMap.found === "note");
  assert.match(asMap.message, /single note/);
  const previewAsMap = await previewImport(B.profileId, noteFile.bytes);
  assert.ok(!previewAsMap.ok && previewAsMap.reason === "wrong_package_type");
  const asNote = await startNoteImport(B.profileId, mapFile.bytes);
  assert.ok(!asNote.ok && asNote.reason === "wrong_package_type" && asNote.found === "map");
  assert.match(asNote.message, /Knowledge Map/);
  assert.equal(await prisma.novaImportJob.count({ where: { profileId: B.profileId } }), 0);
  assert.equal(await prisma.novaNote.count({ where: { profileId: B.profileId } }), 0);
  assert.equal((await loadStudyStructure(B.profileId)).version, before.version);
});

test("a PDF imports as a note that keeps the original file byte for byte; the same PDF again is that note", async () => {
  const B = await learner();
  const doc = pdfBytes("a real paper");
  const p = await previewNoteImport(B.profileId, doc, "Attention Is All You Need.pdf");
  assert.ok(p.ok && p.kind === "pdf");
  assert.equal(p.title, "Attention Is All You Need");
  assert.equal(p.storageBytes, doc.length);
  const storage = admitter();
  const r = await startNoteImport(B.profileId, doc, { fileName: "Attention Is All You Need.pdf", admit: storage.admit });
  assert.ok(r.ok && r.status === "complete", JSON.stringify(r));
  assert.deepEqual(storage.asked, [doc.length]);
  const note = await prisma.novaNote.findUniqueOrThrow({ where: { id: r.noteId }, include: { attachments: true } });
  assert.equal(note.attachments.length, 1);
  assert.equal(note.attachments[0]!.fileName, "Attention Is All You Need.pdf");
  assert.ok(note.body.includes(`[Attention Is All You Need.pdf](kivo-file:${note.attachments[0]!.id})`));
  assert.ok(note.body.includes("kept with this note exactly as it was"));
  const back = await readNoteAttachment(B.profileId, note.attachments[0]!.id);
  assert.ok(back && Buffer.from(back.bytes).equals(Buffer.from(doc)), "the original bytes, not a copy of its text");
  const stranger = await learner();
  assert.equal(await readNoteAttachment(stranger.profileId, note.attachments[0]!.id), null, "only its owner can read it");
  const again = await startNoteImport(B.profileId, doc, { fileName: "renamed.pdf", admit: storage.admit });
  assert.ok(again.ok && again.status === "complete" && again.already && again.noteId === r.noteId);
  // Not a PDF, not a .kivo: refused, nothing made.
  const junk = await startNoteImport(B.profileId, new Uint8Array(Buffer.from("<html><script>alert(1)</script>")));
  assert.ok(!junk.ok);
  assert.equal(await prisma.novaNote.count({ where: { profileId: B.profileId } }), 1);
});

test("a note's PDF is a real PDF: its text, clickable links, page numbers, attribution and attached files", async () => {
  const { A, notes } = await richMap();
  const out = await exportNotePdf(A.profileId, { noteId: notes.dp, credit: "Asha" }, new Date("2026-11-25T09:00:00Z"));
  assert.ok(out.ok, JSON.stringify(out));
  assert.equal(out.filename, "Knapsack, worked.pdf");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(out.bytes), useSystemFonts: false, isEvalSupported: false }).promise;
  assert.equal(doc.numPages, out.pages);
  let text = "";
  const links: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    text += (await page.getTextContent()).items.map(x => ("str" in x ? x.str : "")).join(" ") + "\n";
    for (const a of await page.getAnnotations()) if (a.subtype === "Link" && a.url) links.push(a.url);
  }
  for (const want of ["Knapsack, worked", "0/1 knapsack", "dp[i][w]", "Space optimisation", "Algorithms › Knapsack", "Exported from Kivo by Asha on 2026-11-25", `Page 1 of ${out.pages}`, "Lecture 4.pdf", "not inside this PDF"]) {
    assert.ok(text.replace(/\s+/g, " ").includes(want), `PDF text has "${want}"`);
  }
  assert.ok(links.includes("https://example.edu/l4"), "links stay clickable");
  const B = await learner();
  assert.deepEqual(await exportNotePdf(B.profileId, { noteId: notes.dp }), { ok: false, error: "not_found", message: "That note isn't one of yours." });
});
