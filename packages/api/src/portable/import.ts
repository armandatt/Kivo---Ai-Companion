// ─── Importing a .kivo file: an independent copy, made by the map's own writers
// Nothing here writes a subject, topic or note directly. The subject tree is
// made with setup-edit's applyStudyEdits (versioned, all or nothing per batch
// of up to STUDY_EDITS_MAX edits), notes with notes.ts createNote, links as
// saved pages with learning-events.ts importSavedLink (filed under the same
// subject and topic as in the map; before 25 Nov they were only a list in the
// "About this map" note, founder review #15). The only table this file writes
// is NovaImportJob, which records how far an import got, so that:
//   - one package is imported once per learner (unique profile + packageId);
//   - a stopped import resumes and makes nothing twice (each stage checks what
//     is already there before it adds);
//   - success is reported only after the result is read back and matches the
//     package.
// Package refs are mapped to the learner's new ids by name inside the new
// subjects, which are named so they do not clash with any subject the learner
// already has. The exporter's account is never touched: a package carries no
// ids, and nothing here reads any account but the importer's.

import { prisma } from "@repo/db/client";
import { applyStudyEdits, loadStudyStructure, subjectName } from "../nova/product/setup-edit";
import { createNote } from "../nova/product/notes";
import { importSavedLink, linksByClientIds, type ImportedLinkOutcome } from "../nova/product/learning-events";
import { createHash } from "node:crypto";
import { STUDY_EDITS_MAX, SUBJECT_DEPTH_MAX, SUBJECT_NAME_MAX, TOPIC_NAME_MAX, type StudyEdit, type StudyStructure } from "../nova/product/setup-edit.types";
import { TOPIC_DEPTH_MAX } from "../nova/product/topic-tree";
import { normalizeTopicName } from "../nova/engines/topic-mastery-engine";
import { unpackArchive, type UnpackFailure } from "./kivo-archive";
import { packageRoots, validatePackage, type MapPackage } from "./map-package";

const NAMES_PER_EDIT = 100;
const LEASE_MS = 2 * 60_000;

const key = (name: string) => normalizeTopicName(name).toLowerCase();
const topicNameOf = (raw: string) => normalizeTopicName(raw).slice(0, TOPIC_NAME_MAX);

export interface ImportProgress {
  subjectNames: Record<string, string>;   // package subject ref → the name it gets here
  notesDone: string[];                    // package note refs already created
  // Package resource ref → what happened to it (absent: not yet done). Jobs
  // started before the links stage existed have none and run it on resume.
  links?: Record<string, ImportedLinkOutcome>;
  aboutNoteId: string | null;
  rootSubjectIds?: string[];
  counts?: ImportCounts;
}
export interface ImportCounts { subjects: number; topics: number; notes: number; links?: number; linksAlreadySaved?: number }

// The saved page made from one link of one package: the same id every run, so
// a resumed or repeated import makes it once (unique per learner).
export const linkClientId = (packageId: string, ref: string) => `kivo-${createHash("sha256").update(`${packageId}:${ref}`).digest("hex").slice(0, 40)}`;

// ── Checks a package must pass before anything is made ──
export type ImportCheck = { ok: true } | { ok: false; reason: "too_deep" | "name_too_long"; detail: string };

export function checkImportable(pkg: MapPackage): ImportCheck {
  const depth = new Map<string, number>();
  for (const s of pkg.subjects) {
    const d = s.parentRef ? (depth.get(s.parentRef) ?? 0) + 1 : 1;
    if (d > SUBJECT_DEPTH_MAX) return { ok: false, reason: "too_deep", detail: `"${s.name}" sits ${d} subjects deep; Kivo allows ${SUBJECT_DEPTH_MAX}.` };
    depth.set(s.ref, d);
    if (normalizeTopicName(s.name).length > SUBJECT_NAME_MAX) return { ok: false, reason: "name_too_long", detail: `Subject "${s.name.slice(0, 40)}…" is longer than ${SUBJECT_NAME_MAX} characters.` };
  }
  const tDepth = new Map<string, number>();
  for (const t of pkg.topics) {
    const d = t.parentRef ? (tDepth.get(t.parentRef) ?? 0) + 1 : 1;
    if (d > TOPIC_DEPTH_MAX) return { ok: false, reason: "too_deep", detail: `"${t.name}" sits ${d} topics deep; Kivo allows ${TOPIC_DEPTH_MAX}.` };
    tDepth.set(t.ref, d);
    if (normalizeTopicName(t.name).length > TOPIC_NAME_MAX) return { ok: false, reason: "name_too_long", detail: `Topic "${t.name.slice(0, 40)}…" is longer than ${TOPIC_NAME_MAX} characters.` };
  }
  return { ok: true };
}

// Names for the package's subjects that clash with nothing the learner has
// (subject names are unique per learner): "Compiler Design (imported)", then
// "(imported 2)", … Pure.
export function planSubjectNames(pkg: MapPackage, existing: Iterable<string>): Record<string, string> {
  const taken = new Set([...existing].map(key));
  const out: Record<string, string> = {};
  for (const s of pkg.subjects) {
    const base = subjectName(s.name);
    let name = base, n = 1;
    while (taken.has(key(name))) {
      const suffix = n === 1 ? " (imported)" : ` (imported ${n})`;
      name = base.slice(0, SUBJECT_NAME_MAX - suffix.length).trimEnd() + suffix;
      n += 1;
    }
    taken.add(key(name));
    out[s.ref] = name;
  }
  return out;
}

// The edits still needed to make the package's subjects and topics, given the
// structure as it is now. Pure; re-run after every batch, so a resumed import
// adds only what is missing.
export function missingEdits(pkg: MapPackage, names: Record<string, string>, structure: StudyStructure): StudyEdit[] {
  const byName = new Map(structure.subjects.map(s => [key(s.name), s]));
  const edits: StudyEdit[] = [];
  const missingSubjects = pkg.subjects.filter(s => !byName.has(key(names[s.ref]!)));
  for (const s of missingSubjects) edits.push({ op: "add_subject", name: names[s.ref]!, topics: [], ...(s.parentRef ? { parentName: names[s.parentRef]! } : {}) });
  if (missingSubjects.length > 0) return edits;     // topics need their subjects' ids: next pass

  const groups: Array<{ subjectId: string; parentName: string | null; kind: "milestone" | null; names: string[] }> = [];
  const groupKey = new Map<string, number>();
  const tName = new Map(pkg.topics.map(t => [t.ref, topicNameOf(t.name)]));
  for (const t of pkg.topics) {
    const subject = byName.get(key(names[t.subjectRef]!))!;
    const here = new Set(subject.topics.map(x => key(x.name)));
    const name = tName.get(t.ref)!;
    if (here.has(key(name))) continue;
    const parentName = t.parentRef ? tName.get(t.parentRef)! : null;
    const k = `${subject.id}|${parentName ?? ""}|${t.kind ?? ""}`;
    let gi = groupKey.get(k);
    if (gi === undefined || groups[gi]!.names.length >= NAMES_PER_EDIT) { gi = groups.length; groupKey.set(k, gi); groups.push({ subjectId: subject.id, parentName, kind: t.kind, names: [] }); }
    groups[gi]!.names.push(name);
  }
  for (const g of groups) edits.push({ op: "add_topics", subjectId: g.subjectId, names: g.names, ...(g.parentName ? { parentName: g.parentName } : {}), ...(g.kind ? { kind: g.kind } : {}) });
  return edits;
}

// Read back: every subject in place under its parent, every topic under its
// subject and parent. Pure.
export function verifyStructure(pkg: MapPackage, names: Record<string, string>, structure: StudyStructure): { ok: true; rootSubjectId: string; rootSubjectIds: string[] } | { ok: false; detail: string } {
  const byName = new Map(structure.subjects.map(s => [key(s.name), s]));
  for (const s of pkg.subjects) {
    const here = byName.get(key(names[s.ref]!));
    if (!here) return { ok: false, detail: `subject ${s.ref} missing` };
    const parent = s.parentRef ? byName.get(key(names[s.parentRef]!)) : null;
    if ((here.parentId ?? null) !== (parent?.id ?? null)) return { ok: false, detail: `subject ${s.ref} not under its parent` };
  }
  const tName = new Map(pkg.topics.map(t => [t.ref, topicNameOf(t.name)]));
  for (const t of pkg.topics) {
    const subject = byName.get(key(names[t.subjectRef]!))!;
    const topic = subject.topics.find(x => key(x.name) === key(tName.get(t.ref)!));
    if (!topic) return { ok: false, detail: `topic ${t.ref} missing` };
    const parent = t.parentRef ? subject.topics.find(x => key(x.name) === key(tName.get(t.parentRef!)!)) : null;
    if ((topic.parentId ?? null) !== (parent?.id ?? null)) return { ok: false, detail: `topic ${t.ref} not under its parent` };
  }
  const rootSubjectIds = packageRoots(pkg).map(r => byName.get(key(names[r.ref]!))!.id);
  return { ok: true, rootSubjectId: rootSubjectIds[0]!, rootSubjectIds };
}

// Read back: every link saved here is a saved page filed under its subject and
// topic as in the map. A link the learner had already saved and filed
// elsewhere is theirs and is not moved (outcome "already_saved"). Pure.
export function verifyLinks(
  pkg: MapPackage, names: Record<string, string>, structure: StudyStructure, packageId: string,
  outcomes: Record<string, ImportedLinkOutcome>, rows: Array<{ clientEventId: string; subjectId: string | null; topicName: string | null }>,
): { ok: true; saved: number; alreadySaved: number } | { ok: false; detail: string } {
  const byName = new Map(structure.subjects.map(s => [key(s.name), s]));
  const byClient = new Map(rows.map(r => [r.clientEventId, r]));
  let saved = 0, alreadySaved = 0;
  for (const r of pkg.resources) {
    if (!r.subjectRef) continue;
    const outcome = outcomes[r.ref];
    if (!outcome) return { ok: false, detail: `link ${r.ref} not done` };
    if (outcome === "already_saved") { alreadySaved += 1; continue; }
    if (outcome === "filed_existing") { saved += 1; continue; }
    if (outcome === "invalid") return { ok: false, detail: `link ${r.ref} invalid` };
    const row = byClient.get(linkClientId(packageId, r.ref));
    if (!row) return { ok: false, detail: `link ${r.ref} missing` };
    const subject = byName.get(key(names[r.subjectRef]!));
    if (!subject || row.subjectId !== subject.id) return { ok: false, detail: `link ${r.ref} not under its subject` };
    if ((r.topicName ? key(r.topicName) : null) !== (row.topicName ? key(row.topicName) : null)) return { ok: false, detail: `link ${r.ref} not under its topic` };
    saved += 1;
  }
  return { ok: true, saved, alreadySaved };
}

// The provenance note at the root (or, for a whole map with several roots,
// filed nowhere): where the map came from, its licence, what was not carried,
// and its links as a list (each is also a saved page of its own).
export function aboutNoteBody(pkg: MapPackage, names: Record<string, string>, importedAt: Date): string {
  const lic: Record<string, string> = {
    "all-rights-reserved": "All rights reserved by the creator. For your own study; don't redistribute it.",
    "cc-by-4.0": "CC BY 4.0: share and adapt, with credit to the creator.",
    "cc-by-sa-4.0": "CC BY-SA 4.0: share and adapt, with credit, under the same licence.",
    "cc-by-nc-4.0": "CC BY-NC 4.0: share and adapt for non-commercial use, with credit.",
    "cc0-1.0": "CC0: no rights reserved.",
  };
  const a = pkg.attribution;
  const lines = [
    `> [!source] Imported map`,
    `> **${pkg.title}**`,
    ...(pkg.description ? [`> ${pkg.description}`] : []),
    ...(a.creator ? [`> Made by: ${a.creator}`] : []),
    ...(a.source ? [`> Source: ${a.source}`] : []),
    `> Licence: ${lic[pkg.license]}`,
    ...(a.exportedAt ? [`> Exported: ${a.exportedAt.slice(0, 10)}`] : []),
    `> Imported: ${importedAt.toISOString().slice(0, 10)}`,
    ...(a.packageId ? [`> Package: ${a.packageId}`] : []),
    "",
    "This map is your own copy. Change, reorganise or delete anything in it; nothing you do here reaches the creator, and nothing they change reaches you.",
  ];
  const left = [
    pkg.excluded.noteImages ? `${pkg.excluded.noteImages} image${pkg.excluded.noteImages === 1 ? "" : "s"} in notes` : null,
    "the creator's study progress (it was never in the file)",
  ].filter(Boolean);
  lines.push("", `Not included: ${left.join("; ")}.`);
  if (pkg.resources.length > 0) {
    lines.push("", "## Links in this map", "", "Each one is also in your Saved pages, filed under its subject and topic.");
    const bySubject = new Map<string, typeof pkg.resources>();
    for (const r of pkg.resources) { const k = r.subjectRef ?? ""; bySubject.set(k, [...(bySubject.get(k) ?? []), r]); }
    for (const [ref, rs] of bySubject) {
      lines.push("", `### ${ref ? names[ref] ?? "Other" : "Other"}`);
      for (const r of rs) lines.push(`- [${r.title.replace(/[[\]]/g, "")}](${r.url.replace(/\)/g, "%29")}) · ${r.domain}${r.topicName ? ` · ${r.topicName}` : ""}`);
    }
  }
  return lines.join("\n");
}

// ── What the learner sees before anything is made ──
export type ImportPreview =
  | { ok: true; packageId: string; title: string; description: string | null; creator: string | null; source: string | null; license: string; exportedAt: string | null;
      counts: { subjects: number; topics: number; notes: number; links: number; edges: number; nestedSubjects: number };
      excluded: MapPackage["excluded"]; renames: Array<{ from: string; to: string }>; outline: Array<{ name: string; depth: number; topics: number }>;
      storageBytes: 0; job: { id: string; status: string; rootSubjectId: string | null } | null }
  | { ok: false; reason: UnpackFailure | "too_deep" | "name_too_long" | "different_file"; detail?: string; message: string };

const MESSAGES: Record<string, string> = {
  too_large: "That file is too large for a Kivo map (10 MB at most).",
  not_a_kivo_file: "That isn't a .kivo map file.",
  unsupported_version: "This map was made by a newer version of Kivo. Ask for a new export, or try again after Kivo updates.",
  checksum_mismatch: "This file was changed or damaged after it was exported, so it can't be imported safely. Ask for the file again.",
  missing_file: "This file is incomplete. Ask for the file again.",
  inventory_mismatch: "This file holds something it shouldn't, so it can't be imported safely.",
  unsafe_path: "This file holds something it shouldn't, so it can't be imported safely.",
  unexpected_file: "This file holds something it shouldn't, so it can't be imported safely.",
  compression_bomb: "This file expands to far more than a map holds, so it can't be imported.",
  entry_too_large: "Part of this file is larger than a map allows.",
  too_many_files: "This file holds more items than a map allows.",
  too_deep: "This map nests deeper than Kivo allows.",
  name_too_long: "A name in this map is longer than Kivo allows.",
  different_file: "A different file with the same package id was imported before. Ask the creator for a fresh export.",
};
const message = (reason: string, detail?: string) => (reason === "too_deep" || reason === "name_too_long") && detail ? detail : MESSAGES[reason] ?? "This file can't be read as a Kivo map.";

function read(bytes: Uint8Array) {
  const out = unpackArchive(bytes);
  if (!out.ok) return { ok: false as const, reason: out.reason, detail: out.detail, message: message(out.reason, out.detail) };
  const fit = checkImportable(out.pkg);
  if (!fit.ok) return { ok: false as const, reason: fit.reason, detail: fit.detail, message: message(fit.reason, fit.detail) };
  return { ok: true as const, pkg: out.pkg, manifest: out.manifest, sha256: out.sha256 };
}

export async function previewImport(profileId: string, bytes: Uint8Array): Promise<ImportPreview> {
  const r = read(bytes);
  if (!r.ok) return r;
  const { pkg, manifest } = r;
  const structure = await loadStudyStructure(profileId);
  const names = planSubjectNames(pkg, structure.subjects.map(s => s.name));
  const job = await prisma.novaImportJob.findUnique({ where: { profileId_packageId: { profileId, packageId: manifest.packageId } }, select: { id: true, status: true, rootSubjectId: true, packageSha256: true } });
  const depth = new Map<string, number>();
  const outline = pkg.subjects.map(s => { const d = s.parentRef ? (depth.get(s.parentRef) ?? 0) + 1 : 1; depth.set(s.ref, d); return { name: names[s.ref]!, depth: d, topics: pkg.topics.filter(t => t.subjectRef === s.ref).length }; });
  return {
    ok: true, packageId: manifest.packageId, title: pkg.title, description: pkg.description, creator: pkg.attribution.creator, source: pkg.attribution.source, license: pkg.license, exportedAt: pkg.attribution.exportedAt ?? manifest.createdAt,
    counts: { subjects: manifest.counts.subjects, topics: manifest.counts.topics, notes: manifest.counts.notes, links: manifest.counts.resources, edges: manifest.counts.edges, nestedSubjects: manifest.counts.nestedSubjects },
    excluded: pkg.excluded,
    renames: pkg.subjects.filter(s => names[s.ref] !== subjectName(s.name)).map(s => ({ from: s.name, to: names[s.ref]! })),
    outline: outline.slice(0, 200), storageBytes: 0,
    job: job ? { id: job.id, status: job.status, rootSubjectId: job.rootSubjectId } : null,
  };
}

// ── Running an import ──
export type ImportResult =
  | { ok: true; status: "complete"; jobId: string; rootSubjectId: string; rootSubjectIds: string[]; already: boolean; counts: ImportCounts }
  | { ok: true; status: "running"; jobId: string }
  | { ok: false; status: "failed" | "refused"; jobId?: string; reason: string; message: string };

export async function startImport(profileId: string, bytes: Uint8Array, now = new Date()): Promise<ImportResult> {
  const r = read(bytes);
  if (!r.ok) return { ok: false, status: "refused", reason: r.reason, message: r.message };
  const { pkg, manifest, sha256 } = r;
  const where = { profileId_packageId: { profileId, packageId: manifest.packageId } };
  let job = await prisma.novaImportJob.findUnique({ where });
  if (job && job.packageSha256 !== sha256) return { ok: false, status: "refused", reason: "different_file", message: MESSAGES.different_file! };
  if (job?.status === "complete") return completed(job, true);
  if (!job) {
    const structure = await loadStudyStructure(profileId);
    const progress: ImportProgress = { subjectNames: planSubjectNames(pkg, structure.subjects.map(s => s.name)), notesDone: [], aboutNoteId: null };
    try {
      job = await prisma.novaImportJob.create({ data: { profileId, packageId: manifest.packageId, packageSha256: sha256, title: pkg.title.slice(0, 200), status: "running", stage: "structure", pkg: pkg as never, progress: progress as never } });
      return await runImport(job.id, profileId, now);
    } catch (err) {
      // Two requests at once: the other made the job and runs it.
      if ((err as { code?: string }).code !== "P2002") throw err;
      job = await prisma.novaImportJob.findUnique({ where });
      if (!job) throw err;
    }
  }
  return resumeImport(profileId, job.id, now);
}

export async function resumeImport(profileId: string, jobId: string, now = new Date()): Promise<ImportResult> {
  // Claim the job: only one request runs it at a time; a run that stopped
  // (its lease older than LEASE_MS) can be taken over.
  const claimed = await prisma.novaImportJob.updateMany({
    where: { id: jobId, profileId, OR: [{ status: "failed" }, { status: "running", updatedAt: { lt: new Date(now.getTime() - LEASE_MS) } }] },
    data:  { status: "running", error: null },
  });
  const job = await prisma.novaImportJob.findFirst({ where: { id: jobId, profileId }, select: { id: true, status: true, rootSubjectId: true, progress: true } });
  if (!job) return { ok: false, status: "refused", reason: "not_found", message: "That import isn't yours, or no longer exists." };
  if (job.status === "complete") return completed(job, true);
  if (claimed.count === 0) return { ok: true, status: "running", jobId };
  return runImport(jobId, profileId, now);
}

function completed(job: { id: string; rootSubjectId: string | null; progress: unknown }, already: boolean): ImportResult {
  const progress = job.progress as ImportProgress;
  return { ok: true, status: "complete", jobId: job.id, rootSubjectId: job.rootSubjectId!, rootSubjectIds: progress.rootSubjectIds ?? [job.rootSubjectId!], already, counts: progress.counts ?? { subjects: 0, topics: 0, notes: 0 } };
}

async function save(jobId: string, data: Record<string, unknown>) {
  await prisma.novaImportJob.update({ where: { id: jobId }, data: data as never });
}

async function runImport(jobId: string, profileId: string, now: Date): Promise<ImportResult> {
  const job = await prisma.novaImportJob.findUniqueOrThrow({ where: { id: jobId } });
  const checked = validatePackage(job.pkg);
  if (!checked.ok) { await save(jobId, { status: "failed", error: `stored package: ${checked.reason}` }); return { ok: false, status: "failed", jobId, reason: "bad_graph", message: "This import can't continue. Import the file again." }; }
  const pkg = checked.pkg;
  const progress = job.progress as unknown as ImportProgress;
  const names = progress.subjectNames;
  let stage = job.stage;
  const fail = async (reason: string, msg: string): Promise<ImportResult> => {
    await save(jobId, { status: "failed", stage, error: reason.slice(0, 500) });
    console.error(`[portable] import ${jobId} failed at ${stage}: ${reason.slice(0, 200)}`);
    return { ok: false, status: "failed", jobId, reason, message: msg };
  };

  try {
    // 1. Subjects and topics, in batches the map's own writer accepts.
    if (stage === "structure") {
      for (let pass = 0; pass < 200; pass++) {
        const structure = await loadStudyStructure(profileId);
        const edits = missingEdits(pkg, names, structure);
        if (edits.length === 0) break;
        const batch = edits.slice(0, STUDY_EDITS_MAX);
        const res = await applyStudyEdits(profileId, { version: structure.version, edits: batch });
        if (!res.ok && res.error !== "stale") return fail(`structure: ${res.error} ${res.issues?.map(i => i.message).join("; ") ?? res.message}`, "Part of this map couldn't be made. Nothing else was changed; you can try again.");
        await save(jobId, {});   // renews the lease
      }
      stage = "notes"; await save(jobId, { stage });
    }

    // 2. Notes, each once.
    if (stage === "notes") {
      const structure = await loadStudyStructure(profileId);
      const idOf = new Map(structure.subjects.map(s => [key(s.name), s.id]));
      const done = new Set(progress.notesDone);
      for (const n of pkg.notes) {
        if (done.has(n.ref)) continue;
        const subjectId = n.subjectRef ? idOf.get(key(names[n.subjectRef]!)) ?? null : null;
        const res = await createNote(profileId, { title: n.title, body: n.body, subjectId, topicName: n.topicName, once: true });
        if (!res.ok) return fail(`note ${n.ref}: ${res.error}`, "A note in this map couldn't be saved. Nothing else was changed; you can try again.");
        done.add(n.ref);
        progress.notesDone = [...done];
        await save(jobId, { progress: progress as never });
      }
      stage = "links"; await save(jobId, { stage });
    }

    // 3. Links, each saved once as a saved page under its subject and topic.
    if (stage === "links") {
      const structure = await loadStudyStructure(profileId);
      const idOf = new Map(structure.subjects.map(s => [key(s.name), s.id]));
      const outcomes = { ...(progress.links ?? {}) };
      const credit = [pkg.attribution.creator ? `made by ${pkg.attribution.creator}` : null, `imported ${now.toISOString().slice(0, 10)}`].filter(Boolean).join(", ");
      for (const r of pkg.resources) {
        if (outcomes[r.ref] || !r.subjectRef) continue;
        const subjectId = idOf.get(key(names[r.subjectRef]!));
        if (!subjectId) return fail(`link ${r.ref}: subject missing`, "A link in this map couldn't be saved. Nothing else was changed; you can try again.");
        const res = await importSavedLink(profileId, {
          clientEventId: linkClientId(job.packageId, r.ref), url: r.url, title: r.title, domain: r.domain, subjectId, topicName: r.topicName,
          description: r.description ?? null, resourceType: r.resourceType ?? null, siteName: r.siteName ?? null,
          provenance: `From the shared map “${pkg.title}” (${credit}).`,
        }, now);
        outcomes[r.ref] = res.outcome;
        progress.links = outcomes;
        await save(jobId, { progress: progress as never });
      }
      progress.links = outcomes;
      stage = "about"; await save(jobId, { stage, progress: progress as never });
    }

    // 4. Where it came from, at its root.
    if (stage === "about") {
      if (!progress.aboutNoteId) {
        const structure = await loadStudyStructure(profileId);
        const roots = packageRoots(pkg);
        const rootId = roots.length === 1 ? structure.subjects.find(s => key(s.name) === key(names[roots[0]!.ref]!))?.id ?? null : null;
        const res = await createNote(profileId, { title: `About this map: ${pkg.title}`.slice(0, 200), body: aboutNoteBody(pkg, names, now), subjectId: rootId, once: true });
        if (!res.ok) return fail(`about: ${res.error}`, "The map was made, but its source note couldn't be saved. You can try again.");
        progress.aboutNoteId = res.note.id;
        await save(jobId, { progress: progress as never });
      }
      stage = "verify"; await save(jobId, { stage });
    }

    // 5. Read it back before saying it worked.
    const structure = await loadStudyStructure(profileId);
    const v = verifyStructure(pkg, names, structure);
    if (!v.ok) return fail(`verify: ${v.detail}`, "The map was made but doesn't match the file. You can try again.");
    if (progress.notesDone.length !== pkg.notes.length) return fail("verify: notes", "Not every note was saved. You can try again.");
    const filed = pkg.resources.filter(r => r.subjectRef);
    const rows = await linksByClientIds(profileId, filed.map(r => linkClientId(job.packageId, r.ref)));
    const l = verifyLinks(pkg, names, structure, job.packageId, progress.links ?? {}, rows);
    if (!l.ok) {
      // A link not done yet (a job that reached here before the links stage existed): do it now.
      if (/not done/.test(l.detail)) { await save(jobId, { stage: "links", status: "running" }); return runImport(jobId, profileId, now); }
      return fail(`verify: ${l.detail}`, "The map was made but a link doesn't match the file. You can try again.");
    }
    progress.rootSubjectIds = v.rootSubjectIds;
    progress.counts = { subjects: pkg.subjects.length, topics: pkg.topics.length, notes: pkg.notes.length, links: l.saved, linksAlreadySaved: l.alreadySaved };
    await save(jobId, { status: "complete", stage: "done", pkg: null as never, progress: progress as never, rootSubjectId: v.rootSubjectId, completedAt: new Date(), error: null });
    return { ok: true, status: "complete", jobId, rootSubjectId: v.rootSubjectId, rootSubjectIds: v.rootSubjectIds, already: false, counts: progress.counts };
  } catch (err) {
    return fail(`error: ${(err as Error).name}: ${(err as Error).message}`, "The import stopped. Nothing was lost; you can try again and it continues where it stopped.");
  }
}

// The learner's imports, newest first (for the import page).
export async function listImports(profileId: string) {
  return prisma.novaImportJob.findMany({ where: { profileId }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, title: true, status: true, stage: true, rootSubjectId: true, createdAt: true, completedAt: true, error: true } });
}
