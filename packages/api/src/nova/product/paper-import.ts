// ─── Importing a research paper into a note ───────────────────────────────────
// The learner pastes a paper's link (Ctrl/Cmd+P on Notes); Kivo identifies it
// (paper-source.ts), fetches its details and any openly available text from
// the source's own API (paper-fetch.ts), shows what it found, and, when the
// learner confirms where it goes, saves it as one note through createNote:
// the paper card (with the original link), the abstract, the text, and
// "## My notes" for their own notes. Filed under the subject and topic they
// chose, like any note (subjectId and topicName: the existing filing).
//
// Honesty, by construction:
//   - the card says what was imported: full text, part of it, the abstract
//     only, or the details only, and where the text came from; a paper cut to
//     fit a note says where it stops;
//   - a full text is only what the sources give openly (arXiv's HTML, Europe
//     PMC's open-access set); nothing behind a paywall or a sign-in is
//     fetched, and a PDF is read only when the learner asks Nova to
//     transcribe it (or uploads it), and then the card says it is Nova's
//     transcription;
//   - the paper's text is the source's, converted, never summarised or
//     rewritten here; Nova's editor does not change it (note-edit.ts).
//
// One paper, one note: the card carries the paper's key (arXiv id, DOI, …),
// and an import of a paper the learner already has returns that note. Two
// imports of one paper at once share one run.
//
// What arrives from a source is untrusted text: it becomes note text and is
// read by the tutor as material, never as instructions.

import { createNote, findNoteContaining } from "./notes";
import { NOTE_BODY_MAX, NOTE_TITLE_MAX, NOTE_TOPIC_MAX } from "./notes.types";
import { transcribeForNote } from "./note-import";
import { FetchRefused, PaperNotFound, findPaper, safeGet, type Get, type PaperFound } from "./paper-fetch";
import { blocksToMarkdown, type PaperBlock } from "./paper-markup";
import { identifyPaper, keyLine, paperNoteBody, type PaperCard, type PaperTextStatus } from "./paper-source";
import { PAPER_TRANSCRIPT_MAX, PAPER_URL_MAX, type PaperError, type PaperImportResponse, type PaperPreviewResponse } from "./paper.types";

export const PAPER_PREVIEWS_PER_MINUTE = 12;
export const PAPER_IMPORTS_PER_MINUTE = 6;
const PDF_MAX_BYTES = 3 * 1024 * 1024;

type Refusal = { ok: false; error: PaperError; message: string };
const refuse = (error: PaperError, message: string): Refusal => ({ ok: false, error, message });

function failure(err: unknown): Refusal {
  if (err instanceof PaperNotFound) return refuse(err.reason, err.message);
  if (err instanceof FetchRefused) {
    if (err.reason === "blocked") return refuse("private", "That address isn't on the public internet, so Kivo can't import from it.");
    if (err.reason === "too_large") return refuse("too_large", "That file is too large to import.");
    if (err.reason === "timeout") return refuse("unavailable", "The source took too long to answer. Try again in a moment.");
    return refuse("unavailable", "The source couldn't be reached. Try again in a moment.");
  }
  console.error("[nova:paper-import]", (err as Error)?.message);
  return refuse("failed", "That didn't work. Try again.");
}

function readUrl(raw: unknown): { ok: true; url: string } | { ok: false; refusal: Refusal } {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  const url = typeof input?.url === "string" ? input.url.trim() : "";
  if (!url) return { ok: false, refusal: refuse("invalid", "Paste a link to a paper.") };
  if (url.length > PAPER_URL_MAX) return { ok: false, refusal: refuse("invalid", "That link is too long.") };
  return { ok: true, url };
}

// ── The note's text, within what a note holds ─────────────────────────────────

const isReferences = (heading: string) => {
  const h = heading.toLowerCase();
  return h.includes("reference") || h.includes("bibliography") || h.includes("works cited");
};

// The paper's blocks in sections (each from a ## heading; what comes before
// the first is its own), the references kept for last.
function sectionsOf(blocks: PaperBlock[]): Array<{ heading: string | null; blocks: PaperBlock[] }> {
  const out: Array<{ heading: string | null; blocks: PaperBlock[] }> = [];
  for (const b of blocks) {
    if (b.kind === "heading" && b.level <= 2) out.push({ heading: b.text, blocks: [b] });
    else if (out.length) out[out.length - 1]!.blocks.push(b);
    else out.push({ heading: null, blocks: [b] });
  }
  return out;
}

// "# " lines of a transcription are the paper's headings: under the card
// they are "## ".
function demoteHeadings(text: string): string {
  return text.split("\n").map(l => (l.startsWith("#") && !l.startsWith("####") ? `#${l}` : l)).join("\n");
}

export interface Assembled { title: string; body: string; status: PaperTextStatus; notes: string[]; card: PaperCard }

export function assemblePaperNote(found: PaperFound, options: { today: string; title?: string | null; transcript?: { text: string; complete: boolean; fileName: string; by: "upload" | "pdf" } | null }): Assembled {
  const meta = found.meta;
  const notes = [...found.notes];
  const title = (options.title?.trim() || meta.title || "Untitled paper").slice(0, NOTE_TITLE_MAX);
  let status = found.status, from = found.textFrom;
  let text: string | null = null;
  const card: PaperCard = {
    title, authors: meta.authors, published: meta.published, venue: meta.venue, arxivId: meta.arxivId, doi: meta.doi, pmid: meta.pmid,
    pmcid: meta.pmcid, openreviewId: meta.openreviewId, sourceUrl: meta.sourceUrl, pdfUrl: meta.pdfUrl, status, from, importedOn: options.today, key: found.key,
  };
  const abstract = meta.abstract ? meta.abstract.slice(0, 6_000) : null;
  // What the card, the abstract and "My notes" take, with room for the card
  // to say more once the status is known.
  const room = NOTE_BODY_MAX - paperNoteBody(card, abstract, null).length - 400;

  if (found.blocks && found.blocks.length) {
    const sections = sectionsOf(found.blocks);
    const refs = sections.filter(s => s.heading && isReferences(s.heading));
    const main = sections.filter(s => !refs.includes(s));
    const kept: string[] = [];
    let used = 0, stoppedAt: string | null = null;
    for (const s of main) {
      const md = blocksToMarkdown(s.blocks);
      if (used + md.length + 2 > room) { stoppedAt = s.heading ?? "the start"; break; }
      kept.push(md); used += md.length + 2;
    }
    let refsLeftOut = false;
    for (const s of refs) {
      const md = blocksToMarkdown(s.blocks);
      if (!stoppedAt && used + md.length + 2 <= room) { kept.push(md); used += md.length + 2; }
      else refsLeftOut = true;
    }
    text = kept.join("\n\n");
    if (stoppedAt) {
      status = "partial";
      notes.push(`The paper is longer than a note holds (${NOTE_BODY_MAX.toLocaleString("en-US")} characters), so its text stops before “${stoppedAt}”. The rest is in the original.`);
    } else if (refsLeftOut) notes.push("The reference list was left out: with it, the note would be longer than a note holds.");
  } else if (options.transcript) {
    const t = options.transcript;
    let body = demoteHeadings(t.text.trim());
    let cut = false;
    if (body.length > room) {
      const at = body.lastIndexOf("\n\n", room);
      body = body.slice(0, at > room / 2 ? at : room);
      cut = true;
    }
    text = body;
    status = t.complete && !cut ? "full" : "partial";
    from = t.by === "upload" ? `the PDF you uploaded (${t.fileName}), transcribed by Nova` : "the PDF, transcribed by Nova";
    notes.push(`The text is Nova's transcription of ${t.by === "upload" ? "your PDF" : "the paper's PDF"}, not the publisher's text: check equations and numbers against the original.`);
    if (!t.complete) notes.push("Nova's transcription stopped before the end of the PDF.");
    if (cut) notes.push("The transcription is longer than a note holds, so it stops part-way.");
  }

  card.status = status; card.from = from;
  const body = paperNoteBody(card, abstract, text);
  return { title, body: body.length > NOTE_BODY_MAX ? body.slice(0, NOTE_BODY_MAX) : body, status, notes, card };
}

// ── Preview ───────────────────────────────────────────────────────────────────

export async function previewPaper(profileId: string, raw: unknown, get: Get = safeGet): Promise<PaperPreviewResponse> {
  const read = readUrl(raw);
  if (!read.ok) return read.refusal;
  const id = identifyPaper(read.url);
  if (!id.ok) return refuse(id.reason, id.message);
  try {
    const found = await findPaper(id.paper, get);
    const existing = await findNoteContaining(profileId, keyLine(found.key));
    const assembled = assemblePaperNote(found, { today: new Date().toISOString().slice(0, 10) });
    const m = found.meta;
    return {
      ok: true, kind: id.paper.kind, key: found.key, title: m.title, authors: m.authors, abstract: m.abstract, published: m.published, venue: m.venue,
      doi: m.doi, arxivId: m.arxivId, pmid: m.pmid, pmcid: m.pmcid, sourceUrl: m.sourceUrl, pdfUrl: m.pdfUrl, keywords: m.keywords, detailsFrom: m.detailsFrom,
      status: assembled.status, textFrom: assembled.card.from,
      sections: found.blocks ? sectionsOf(found.blocks).flatMap(s => (s.heading ? [s.heading] : [])).slice(0, 40) : [],
      textChars: found.blocks ? blocksToMarkdown(found.blocks).length : 0,
      notes: assembled.notes, canTranscribe: Boolean(m.pdfUrl) && assembled.status !== "full", existing,
    };
  } catch (err) { return failure(err); }
}

// ── Import ────────────────────────────────────────────────────────────────────

// One run per learner and paper link at a time: a second press, or a retry
// while the first is on its way, gets the first one's answer.
const running = new Map<string, Promise<PaperImportResponse>>();

export async function importPaper(
  profileId: string,
  raw: unknown,
  // Test seams.
  get: Get = safeGet,
  transcribe: typeof transcribeForNote = transcribeForNote,
): Promise<PaperImportResponse> {
  const read = readUrl(raw);
  if (!read.ok) return read.refusal;
  const runKey = `${profileId}\n${read.url}`;
  const inFlight = running.get(runKey);
  if (inFlight) return inFlight;
  const run = importOnce(profileId, read.url, raw as Record<string, unknown>, get, transcribe);
  running.set(runKey, run);
  try { return await run; } finally { running.delete(runKey); }
}

async function importOnce(profileId: string, url: string, input: Record<string, unknown>, get: Get, transcribe: typeof transcribeForNote): Promise<PaperImportResponse> {
  const id = identifyPaper(url);
  if (!id.ok) return refuse(id.reason, id.message);
  const subjectId = typeof input.subjectId === "string" && input.subjectId ? input.subjectId : null;
  const topicName = subjectId && typeof input.topicName === "string" && input.topicName.trim() ? input.topicName.trim() : null;
  if (topicName && topicName.length > NOTE_TOPIC_MAX) return refuse("invalid", "That topic name is too long.");
  const title = typeof input.title === "string" ? input.title.trim().slice(0, NOTE_TITLE_MAX) : null;

  let found: PaperFound;
  try { found = await findPaper(id.paper, get); } catch (err) { return failure(err); }

  // Already imported: that note, as it is. Nothing is made or changed.
  const existing = await findNoteContaining(profileId, keyLine(found.key));
  if (existing) return { ok: true, noteId: existing.id, title: existing.title, existing: true, status: found.status, notes: ["You had already imported this paper, so it opens the note you have."] };

  let transcript: { text: string; complete: boolean; fileName: string; by: "upload" | "pdf" } | null = null;
  const given = input.transcript as { fileName?: unknown; text?: unknown; complete?: unknown } | undefined;
  if (!found.blocks && given && typeof given.text === "string" && given.text.trim()) {
    if (given.text.length > PAPER_TRANSCRIPT_MAX) return refuse("too_large", "That transcription is too long to keep.");
    transcript = { text: given.text, complete: given.complete === true, fileName: typeof given.fileName === "string" ? given.fileName.slice(0, 120) : "your PDF", by: "upload" };
  } else if (!found.blocks && input.transcribe === true && found.meta.pdfUrl) {
    // The paper's PDF, read by Nova on the learner's request: fetched like
    // any address (public https only, size-capped), never past a sign-in.
    let pdf: Buffer;
    try {
      const res = await get(found.meta.pdfUrl, { accept: "application/pdf", maxBytes: PDF_MAX_BYTES, timeoutMs: 25_000 });
      if (res.status === 401 || res.status === 403 || res.status === 402) return refuse("unavailable", "The PDF needs a sign-in or a subscription, so Kivo can't open it. If you have access, download it and upload it here.");
      if (res.status !== 200 || res.body.subarray(0, 5).toString("latin1") !== "%PDF-") return refuse("unavailable", "That PDF couldn't be downloaded. If you have it, upload it here instead.");
      pdf = res.body;
    } catch (err) {
      const f = failure(err);
      return f.error === "too_large" ? refuse("too_large", "That PDF is over 3 MB, which is as much as Nova can transcribe. Upload a smaller copy, or import the paper without its text.") : f;
    }
    const name = (found.meta.title || "paper").slice(0, 100).split("/").join(" ") + ".pdf";
    const read = await transcribe({ file: { name, data: pdf.toString("base64") } });
    if (!read.ok) return refuse(read.error === "too_many_pages" ? "too_large" : "transcription_failed", read.message);
    transcript = { text: read.text, complete: read.complete, fileName: name, by: "pdf" };
  }

  const assembled = assemblePaperNote(found, { today: new Date().toISOString().slice(0, 10), title, transcript });
  const saved = await createNote(profileId, { title: assembled.title, body: assembled.body, subjectId, topicName, once: true });
  if (!saved.ok) return refuse(saved.error === "unknown_subject" ? "unknown_subject" : "invalid", saved.message);
  return { ok: true, noteId: saved.note.id, title: saved.note.title, existing: false, status: assembled.status, notes: assembled.notes };
}
