// ─── Sharing one note: a .kivo note, a PDF of it, and bringing either in ─────
// Export reads only the learner's own note, its images (note-images.ts) and
// files (note-attachments.ts); it writes nothing.
//   - .kivo (packageType "note", kivo.note/1): lossless for Kivo, opens as a
//     new editable note with its images and files (note-package.ts);
//   - PDF: a rendition to read and print (note-pdf.ts), never a substitute.
// Import makes a new note as the importer's own, through the note's own
// writers, from either:
//   - a .kivo note: its text exactly, its images and files as the importer's
//     own (new ids written back into the text), filed where the importer
//     chooses (the creator's subject name is only a suggestion);
//   - a PDF: the original bytes kept, untouched, as a file of the note (never
//     flattened into text). Text extracted from it in the browser (PDF.js) is
//     an optional addition the learner chooses, labelled as such
//     (KIVO_NOTE_FORMAT.md, "PDF import").
// Each import is a NovaImportJob (packageType "note"): validated before it
// writes, storage reserved before it writes, the note made and recorded in
// one transaction, its images and files under keys made from the package, a
// stopped import resumed by sending the same file, and success reported only
// after the note is read back (text exact, every image and file byte for byte).
// The same file again opens the note already made unless the learner asks for
// another copy. No model is called and no credit is spent, on any plan.

import { prisma } from "@repo/db/client";
import { createHash } from "node:crypto";
import { createNoteIn, getNote, notesByIds, updateNote } from "../nova/product/notes";
import { imagesByKeys, imagesOfNotes, saveNoteImageBytes } from "../nova/product/note-images";
import { attachmentBytes, attachmentsByKeys, attachmentsOfNotes, saveNoteAttachmentBytes } from "../nova/product/note-attachments";
import { checkFileBytes, cleanFileName, fileMarkdown, NOTE_FILE_BYTES_MAX, sha256Hex } from "../nova/product/note-files";
import { loadStudyStructure } from "../nova/product/setup-edit";
import { normalizeTopicName } from "../nova/engines/topic-mastery-engine";
import { buildNotePackage, NOTE_FORMAT, packNote, unpackNote, type NotePackage } from "./note-package";
import { assetClientKey, rewriteAssetRefs, type StorageAdmit } from "./import";
import { attachmentHeader } from "./export";
import { LICENSES, type License } from "./map-package";
import { renderNotePdf } from "./note-pdf";

export { attachmentHeader };

const text = (v: unknown, max: number): string | null => typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, max) : null;

/** A download name: the note's title as written, without what a file system can't hold. */
export function noteFileName(title: string, ext: ".kivo" | ".pdf"): string {
  const base = title.normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
    .replace(/(\.kivo|\.pdf)+$/i, "").replace(/^\.+/, "").trim().slice(0, 80).trim();
  return `${base || "note"}${ext}`;
}

async function noteForExport(profileId: string, noteId: unknown) {
  if (typeof noteId !== "string" || !noteId || noteId.length > 40) return null;
  const note = await getNote(profileId, noteId);
  if (!note) return null;
  const [images, fileRows] = await Promise.all([imagesOfNotes(profileId, [note.id]), attachmentsOfNotes(profileId, [note.id])]);
  return { note, images, fileRows };
}

export type NoteExportFailure = { ok: false; error: "not_found" | "invalid" | "failed"; message: string };

export async function exportNoteKivo(profileId: string, input: { noteId?: unknown; credit?: unknown; license?: unknown }, now = new Date()): Promise<{ ok: true; bytes: Uint8Array; filename: string; packageId: string; counts: { images: number; files: number; imagesLeftOut: number; filesLeftOut: number } } | NoteExportFailure> {
  const found = await noteForExport(profileId, input.noteId);
  if (!found) return { ok: false, error: "not_found", message: "That note isn't one of yours." };
  const { note, images, fileRows } = found;
  const data = await attachmentBytes(profileId, fileRows.map(f => f.id));
  const license = (typeof input.license === "string" && (LICENSES as readonly string[]).includes(input.license) ? input.license : "all-rights-reserved") as License;
  const { pkg, assetData } = buildNotePackage({
    title: note.title, body: note.body, subjectName: note.subjectName, topicName: note.topicName, source: null,
    creator: text(input.credit, 120), license, now,
    images: images.map(i => ({ id: i.id, mimeType: i.mimeType, width: i.width, height: i.height, bytes: i.bytes, sourceUrl: i.sourceUrl, sourceTitle: i.sourceTitle, page: i.page })),
    files: fileRows.flatMap(f => { const b = data.get(f.id); return b ? [{ id: f.id, fileName: f.fileName, mimeType: f.mimeType, bytes: b }] : []; }),
  });
  const bytes = packNote(pkg, assetData);
  // What leaves is what an import accepts.
  const check = unpackNote(bytes);
  if (!check.ok) { console.error(`[portable] note export failed its own check: ${check.reason} ${check.detail ?? ""}`); return { ok: false, error: "failed", message: "The file couldn't be made. Nothing was changed; try again." }; }
  return {
    ok: true, bytes, filename: noteFileName(note.title, ".kivo"), packageId: pkg.attribution.packageId,
    counts: { images: pkg.assets.filter(a => a.kind === "image").length, files: pkg.assets.filter(a => a.kind === "document").length, imagesLeftOut: pkg.excluded.images, filesLeftOut: pkg.excluded.files },
  };
}

export async function exportNotePdf(profileId: string, input: { noteId?: unknown; credit?: unknown }, now = new Date()): Promise<{ ok: true; bytes: Uint8Array; filename: string; pages: number } | NoteExportFailure> {
  const found = await noteForExport(profileId, input.noteId);
  if (!found) return { ok: false, error: "not_found", message: "That note isn't one of yours." };
  const { note, images, fileRows } = found;
  try {
    const out = await renderNotePdf({
      title: note.title, body: note.body, subjectName: note.subjectName, topicName: note.topicName,
      exportedBy: text(input.credit, 120), exportedAt: now, updatedAt: new Date(note.updatedAt),
      images: images.map(i => ({ id: i.id, mimeType: i.mimeType, bytes: i.bytes })),
      files: fileRows.map(f => ({ id: f.id, fileName: f.fileName, bytes: f.byteSize })),
    });
    return { ok: true, bytes: out.bytes, filename: noteFileName(note.title, ".pdf"), pages: out.pages };
  } catch (err) {
    console.error(`[portable] note PDF failed: ${(err as Error).name}`);
    return { ok: false, error: "failed", message: "The PDF couldn't be made. Nothing was changed; try again." };
  }
}

// ── Bringing a note in ──

type PdfPackage = { kind: "pdf"; fileName: string; title: string; bytes: number; sha256: string };
type Incoming =
  | { ok: true; kind: "kivo"; pkg: NotePackage; assetData: Map<string, Uint8Array>; sha256: string; key: string }
  | { ok: true; kind: "pdf"; pdf: PdfPackage; data: Uint8Array; key: string }
  | { ok: false; reason: string; message: string; found?: "map" | "note" };

const NOTE_MESSAGES: Record<string, string> = {
  too_large: "That file is too large (50 MB at most for a .kivo note, 10 MB for a PDF).",
  not_a_kivo_file: "That isn't a .kivo note or a PDF.",
  unsupported_version: "This note was made by a newer version of Kivo. Ask for a new export, or try again after Kivo updates.",
  checksum_mismatch: "This file was changed or damaged after it was exported, so it can't be imported safely. Ask for the file again.",
  missing_file: "This file is incomplete. Ask for the file again.",
  inventory_mismatch: "This file holds something it shouldn't, so it can't be imported safely.",
  unsafe_path: "This file holds something it shouldn't, so it can't be imported safely.",
  unexpected_file: "This file holds something it shouldn't, so it can't be imported safely.",
  compression_bomb: "This file expands to far more than a note holds, so it can't be imported.",
  bad_asset: "An image or file inside this note isn't what the note says it is, so it can't be imported safely.",
  bad_note: "This file can't be read as a Kivo note.",
  wrong_package_type: "This .kivo file is a Knowledge Map, not a single note. Import it from Knowledge Map → Import a map.",
  different_file: "A different file with the same package id was imported before. Ask for a fresh export.",
  unknown_subject: "That subject isn't one of yours.",
};

function readIncoming(bytes: Uint8Array, fileName: unknown): Incoming {
  // A PDF starts %PDF-; anything else is read as a .kivo file.
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    const check = checkFileBytes(bytes);
    if (!check.ok) return { ok: false, reason: check.error === "too_large" ? "too_large" : "not_a_kivo_file", message: check.error === "too_large" ? `That PDF is larger than ${NOTE_FILE_BYTES_MAX / 1_000_000} MB.` : check.message };
    const name = cleanFileName(fileName, "document.pdf");
    const fullName = /\.pdf$/i.test(name) ? name : `${name}.pdf`;
    const sha256 = sha256Hex(bytes);
    return { ok: true, kind: "pdf", data: bytes, key: `pdf-${sha256.slice(0, 40)}`, pdf: { kind: "pdf", fileName: fullName, title: fullName.replace(/\.pdf$/i, "").slice(0, 200) || "Imported PDF", bytes: bytes.length, sha256 } };
  }
  const out = unpackNote(bytes);
  if (!out.ok) return { ok: false, reason: out.reason, message: NOTE_MESSAGES[out.reason] ?? "This file can't be read as a Kivo note.", ...(out.found ? { found: out.found } : {}) };
  return { ok: true, kind: "kivo", pkg: out.pkg, assetData: out.assetData, sha256: out.sha256, key: out.pkg.attribution.packageId };
}

const storageOf = (inc: Extract<Incoming, { ok: true }>) => inc.kind === "pdf" ? inc.pdf.bytes : inc.pkg.assets.reduce((n, a) => n + a.bytes, 0);
const shaOf = (inc: Extract<Incoming, { ok: true }>) => inc.kind === "pdf" ? inc.pdf.sha256 : inc.sha256;
const jobsOf = (profileId: string, key: string) => prisma.novaImportJob.findMany({
  where: { profileId, packageType: "note", OR: [{ packageId: key }, { packageId: { startsWith: `${key}#` } }] },
  orderBy: { createdAt: "asc" }, select: { id: true, packageId: true, status: true, packageSha256: true, progress: true, createdAt: true },
});

export type NoteImportPreview =
  | { ok: true; kind: "kivo" | "pdf"; title: string; creator: string | null; exportedAt: string | null; license: string | null;
      images: number; files: number; storageBytes: number; leftOut: { images: number; files: number };
      fileName: string | null;
      // The creator's filing, as names, and the learner's subject of that name if they have one.
      suggested: { subjectName: string | null; topicName: string | null; subjectId: string | null };
      already: { noteId: string; at: string } | null; copies: number }
  | { ok: false; reason: string; message: string; found?: "map" | "note" };

export async function previewNoteImport(profileId: string, bytes: Uint8Array, fileName?: unknown): Promise<NoteImportPreview> {
  const inc = readIncoming(bytes, fileName);
  if (!inc.ok) return inc;
  const jobs = await jobsOf(profileId, inc.key);
  if (jobs.some(j => j.packageSha256 !== shaOf(inc))) return { ok: false, reason: "different_file", message: NOTE_MESSAGES.different_file! };
  const done = jobs.find(j => j.status === "complete");
  const structure = await loadStudyStructure(profileId);
  const subjectName = inc.kind === "kivo" ? inc.pkg.subjectName : null;
  const match = subjectName ? structure.subjects.find(s => s.name.trim().toLowerCase() === subjectName.trim().toLowerCase()) ?? null : null;
  return {
    ok: true, kind: inc.kind,
    title: inc.kind === "kivo" ? inc.pkg.title : inc.pdf.title,
    creator: inc.kind === "kivo" ? inc.pkg.attribution.creator : null,
    exportedAt: inc.kind === "kivo" ? inc.pkg.attribution.exportedAt : null,
    license: inc.kind === "kivo" ? inc.pkg.license : null,
    images: inc.kind === "kivo" ? inc.pkg.assets.filter(a => a.kind === "image").length : 0,
    files: inc.kind === "kivo" ? inc.pkg.assets.filter(a => a.kind === "document").length : 1,
    storageBytes: storageOf(inc),
    leftOut: inc.kind === "kivo" ? inc.pkg.excluded : { images: 0, files: 0 },
    fileName: inc.kind === "pdf" ? inc.pdf.fileName : null,
    suggested: { subjectName, topicName: inc.kind === "kivo" ? inc.pkg.topicName : null, subjectId: match?.id ?? null },
    already: done ? { noteId: (done.progress as unknown as NoteJobProgress).noteId ?? "", at: done.createdAt.toISOString() } : null,
    copies: jobs.length,
  };
}

interface NoteJobProgress { noteId: string | null; assetIds: Record<string, string>; done: boolean; subjectId: string | null; topicName: string | null; title: string }

export type NoteImportResult =
  | { ok: true; status: "complete"; jobId: string; noteId: string; already: boolean; counts: { images: number; files: number } }
  | { ok: true; status: "running"; jobId: string }
  | { ok: false; status: "failed" | "refused"; jobId?: string; reason: string; message: string; found?: "map" | "note" };

const LEASE_MS = 2 * 60_000;

export async function startNoteImport(
  profileId: string, bytes: Uint8Array,
  opts: { fileName?: unknown; subjectId?: unknown; topicName?: unknown; title?: unknown; copy?: boolean; admit?: StorageAdmit; now?: Date } = {},
): Promise<NoteImportResult> {
  const now = opts.now ?? new Date();
  const inc = readIncoming(bytes, opts.fileName);
  if (!inc.ok) return { ok: false, status: "refused", reason: inc.reason, message: inc.message, ...(inc.found ? { found: inc.found } : {}) };
  const jobs = await jobsOf(profileId, inc.key);
  if (jobs.some(j => j.packageSha256 !== shaOf(inc))) return { ok: false, status: "refused", reason: "different_file", message: NOTE_MESSAGES.different_file! };
  const unfinished = jobs.find(j => j.status !== "complete");
  let key = inc.key;
  if (unfinished) key = unfinished.packageId;
  else if (jobs.length > 0 && !opts.copy) return completedNote(jobs[0]!.id, (jobs[0]!.progress as unknown as NoteJobProgress).noteId!, true, inc);
  else if (jobs.length > 0) key = `${inc.key}#${jobs.length + 1}`;

  // Where it goes: checked before anything is written.
  let job = await prisma.novaImportJob.findUnique({ where: { profileId_packageId: { profileId, packageId: key } } });
  if (!job) {
    const subjectId = typeof opts.subjectId === "string" && opts.subjectId ? opts.subjectId : null;
    if (subjectId && !(await loadStudyStructure(profileId)).subjects.some(s => s.id === subjectId)) return { ok: false, status: "refused", reason: "unknown_subject", message: NOTE_MESSAGES.unknown_subject! };
    const topicName = typeof opts.topicName === "string" && opts.topicName.trim() ? normalizeTopicName(opts.topicName).slice(0, 120) : null;
    const title = text(opts.title, 200) ?? (inc.kind === "kivo" ? inc.pkg.title : inc.pdf.title);
    const progress: NoteJobProgress = { noteId: null, assetIds: {}, done: false, subjectId, topicName: subjectId ? topicName : null, title };
    const pkg = inc.kind === "kivo" ? inc.pkg : inc.pdf;
    try {
      job = await prisma.novaImportJob.create({ data: { profileId, packageId: key, packageSha256: shaOf(inc), packageType: "note", title: title.slice(0, 200), status: "running", stage: "note", pkg: pkg as never, progress: progress as never } });
    } catch (err) {
      if ((err as { code?: string }).code !== "P2002") throw err;
      job = await prisma.novaImportJob.findUnique({ where: { profileId_packageId: { profileId, packageId: key } } });
      if (!job) throw err;
    }
  } else {
    const claimed = await prisma.novaImportJob.updateMany({
      where: { id: job.id, profileId, OR: [{ status: "failed" }, { status: "running", updatedAt: { lt: new Date(now.getTime() - LEASE_MS) } }] },
      data: { status: "running", error: null },
    });
    if (job.status === "complete") return completedNote(job.id, (job.progress as unknown as NoteJobProgress).noteId!, true, inc);
    if (claimed.count === 0) return { ok: true, status: "running", jobId: job.id };
  }
  // Storage for the images and files (or the PDF), reserved before any is written.
  const need = storageOf(inc);
  let release = async () => undefined as void;
  if (need > 0 && opts.admit) {
    const a = await opts.admit(need);
    if (a.refused) { await prisma.novaImportJob.update({ where: { id: job.id }, data: { status: "failed", error: "storage" } }); return { ok: false, status: "refused", jobId: job.id, reason: "storage", message: a.refused }; }
    release = a.release;
  }
  try { return await runNoteImport(job.id, profileId, inc, now); } finally { await release(); }
}

function completedNote(jobId: string, noteId: string, already: boolean, inc: Extract<Incoming, { ok: true }>): NoteImportResult {
  return { ok: true, status: "complete", jobId, noteId, already, counts: inc.kind === "kivo" ? { images: inc.pkg.assets.filter(a => a.kind === "image").length, files: inc.pkg.assets.filter(a => a.kind === "document").length } : { images: 0, files: 1 } };
}

// The text of an imported PDF's note: what it is, and the file itself. Pure.
export function pdfNoteBody(pdf: { fileName: string; bytes: number }, fileRef: string, importedAt: Date): string {
  const size = pdf.bytes >= 1_000_000 ? `${(pdf.bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(pdf.bytes / 1000))} KB`;
  return [
    "> [!source] Imported PDF",
    `> **${pdf.fileName.replace(/[*_[\]]/g, " ")}** · ${size} · imported ${importedAt.toISOString().slice(0, 10)}`,
    "> The original PDF is kept with this note exactly as it was: open or download it below.",
    "",
    fileMarkdown(pdf.fileName, fileRef),
    "",
  ].join("\n");
}

async function runNoteImport(jobId: string, profileId: string, inc: Extract<Incoming, { ok: true }>, now: Date): Promise<NoteImportResult> {
  const job = await prisma.novaImportJob.findUniqueOrThrow({ where: { id: jobId } });
  const progress = job.progress as unknown as NoteJobProgress;
  const key = job.packageId;
  const fail = async (reason: string, message: string): Promise<NoteImportResult> => {
    await prisma.novaImportJob.update({ where: { id: jobId }, data: { status: "failed", error: reason.slice(0, 500) } });
    console.error(`[portable] note import ${jobId} failed: ${reason.slice(0, 200)}`);
    return { ok: false, status: "failed", jobId, reason, message };
  };
  // The note's text with package refs (a1…), and its assets.
  const assets = inc.kind === "kivo" ? inc.pkg.assets.map(a => ({ ref: a.ref, kind: a.kind, fileName: a.fileName, bytes: inc.assetData.get(a.ref)!, sha256: a.sha256, source: a.source ?? null }))
    : [{ ref: "a1", kind: "document" as const, fileName: inc.pdf.fileName, bytes: inc.data, sha256: inc.pdf.sha256, source: null }];
  const body = inc.kind === "kivo" ? inc.pkg.body : pdfNoteBody(inc.pdf, "a1", job.createdAt);

  try {
    // 1. The note, made and recorded together.
    if (!progress.noteId) {
      progress.noteId = await prisma.$transaction(async tx => {
        const made = await createNoteIn(tx, profileId, { title: progress.title, body, subjectId: progress.subjectId, topicName: progress.topicName });
        if (!made.ok) throw Object.assign(new Error(made.error), { userMessage: made.message });
        await tx.novaImportJob.update({ where: { id: jobId }, data: { stage: "assets", progress: { ...progress, noteId: made.id } as never } });
        return made.id;
      });
    }
    const noteId = progress.noteId;
    // 2. Images and files, each once.
    for (const a of assets) {
      if (progress.assetIds[a.ref]) continue;
      const clientKey = assetClientKey(key, a.ref);
      const res = a.kind === "image"
        ? await saveNoteImageBytes(profileId, { noteId, bytes: Buffer.from(a.bytes), clientKey, sourceUrl: a.source?.url ?? null, sourceTitle: a.source?.title ?? null, page: a.source?.page ?? null })
        : await saveNoteAttachmentBytes(profileId, { noteId, bytes: a.bytes, fileName: a.fileName ?? "document.pdf", clientKey });
      if (!res.ok) return fail(`asset ${a.ref}: ${res.error}`, "An image or file in this note couldn't be saved. Nothing else was changed; you can try again.");
      progress.assetIds[a.ref] = "image" in res ? res.image.id : res.file.id;
      await prisma.novaImportJob.update({ where: { id: jobId }, data: { progress: progress as never } });
    }
    // 3. The text, naming the new ids.
    const finalBody = rewriteAssetRefs(body, progress.assetIds);
    if (assets.length) {
      const upd = await updateNote(profileId, noteId, { body: finalBody });
      if (!upd.ok) return fail(`text: ${upd.error}`, "The note couldn't be saved. You can try again.");
    }
    // 4. Read it back: the text exactly, every image and file byte for byte.
    const [row] = await notesByIds(profileId, [noteId]);
    if (!row || row.body !== finalBody.replace(/\r\n?/g, "\n")) return fail("verify: text", "The note was made but doesn't match the file. You can try again.");
    const keys = assets.map(a => assetClientKey(key, a.ref));
    const imgs = new Map((await imagesByKeys(profileId, keys)).map(r => [r.clientKey, r]));
    const files = new Map((await attachmentsByKeys(profileId, keys)).map(r => [r.clientKey, r]));
    for (const a of assets) {
      const k = assetClientKey(key, a.ref);
      const ok = a.kind === "image"
        ? (() => { const r = imgs.get(k); return r && r.noteId === noteId && createHash("sha256").update(r.bytes).digest("hex") === a.sha256; })()
        : (() => { const r = files.get(k); return r && r.noteId === noteId && r.sha256 === a.sha256 && r.byteSize === a.bytes.length; })();
      if (!ok) return fail(`verify: ${a.ref}`, "An image or file doesn't match the file. You can try again.");
    }
    progress.done = true;
    await prisma.novaImportJob.update({ where: { id: jobId }, data: { status: "complete", stage: "done", pkg: null as never, progress: progress as never, completedAt: now, error: null } });
    return completedNote(jobId, noteId, false, inc);
  } catch (err) {
    const m = (err as { userMessage?: string }).userMessage;
    return fail(`error: ${(err as Error).message}`.slice(0, 300), m ?? "The import stopped. Nothing was lost; send the same file again and it continues where it stopped.");
  }
}

export { NOTE_FORMAT };
