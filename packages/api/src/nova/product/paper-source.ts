// ─── Research papers: what a link names, and how a paper sits in a note ──────
// Pure, and imports only note-outline.ts (itself pure), so the notes page and
// the server share it.
//
//   identifyPaper   a pasted link (or a bare arXiv id, DOI, PMCID) read as the
//                   paper it names: arXiv, a DOI, Semantic Scholar, OpenReview,
//                   PubMed, PubMed Central, a direct PDF, or another page.
//                   Nothing is fetched here.
//   paperNoteBody   an imported paper as one note: a paper card (a [!paper]
//                   callout holding its details and where it came from), its
//                   abstract and the text Kivo could get, then "## My notes",
//                   where the learner's own notes go.
//   readPaperCard   the card read back, so the reader, the tutor and the
//                   editor know a note holds a paper and how much of it.
//   paperRegion     where the imported paper's own text is in the note: from
//                   the card to the "My notes" heading. Nova's editor changes
//                   nothing there; the learner may (it is their note).
//
// There is no other copy and no other table: the note body is the paper's
// record, and the original link is in its card.
//
// No regex: text is read by characters (SKILL.md; the no-regex guard).

import { noteBlocks, noteSections, plainHeading, resolvePlacement, squash, type Placement } from "./note-outline";

export type PaperKind = "arxiv" | "doi" | "semantic_scholar" | "openreview" | "pubmed" | "pmc" | "pdf" | "page";

export interface PaperId {
  kind: PaperKind;
  // The identifier in that kind's own terms (an arXiv id, a DOI, a PMCID…),
  // or the address itself for a PDF or a page.
  id:   string;
  // The link as the learner gave it, made https.
  url:  string;
}

export type PaperIdResult =
  | { ok: true; paper: PaperId }
  | { ok: false; reason: "empty" | "not_a_link" | "not_https" | "private"; message: string };

const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";
const isHex = (c: string) => isDigit(c) || (c >= "a" && c <= "f");
const isLetter = (c: string | undefined) => c !== undefined && c.toLowerCase() !== c.toUpperCase();
const digits = (s: string) => s.length > 0 && [...s].every(isDigit);

// "1706.03762", "2301.01234v2" (since 2007), or "hep-th/9901001",
// "math.GT/0309136" (before). The version is kept apart.
export function readArxivId(raw: string): { id: string; version: string | null } | null {
  let s = raw.trim();
  if (s.toLowerCase().startsWith("arxiv:")) s = s.slice(6).trim();
  if (s.toLowerCase().endsWith(".pdf")) s = s.slice(0, -4);
  while (s.endsWith("/")) s = s.slice(0, -1);
  let version: string | null = null;
  const v = s.lastIndexOf("v");
  if (v > 0 && digits(s.slice(v + 1)) && isDigit(s[v - 1])) { version = s.slice(v); s = s.slice(0, v); }
  const dot = s.indexOf(".");
  const slash = s.indexOf("/");
  if (slash === -1 && dot === 4 && digits(s.slice(0, 4)) && (s.length === 9 || s.length === 10) && digits(s.slice(5))) return { id: s, version };
  if (slash > 0) {
    const archive = s.slice(0, slash), num = s.slice(slash + 1);
    const okArchive = [...archive].every(c => isLetter(c) || c === "-" || c === ".") && isLetter(archive[0]);
    if (okArchive && num.length === 7 && digits(num)) return { id: `${archive}/${num}`, version };
  }
  return null;
}

// "10.1145/3292500.3330701": a DOI, without a trailing full stop or bracket.
export function readDoi(raw: string): string | null {
  let s = raw.trim();
  const lower = s.toLowerCase();
  if (lower.startsWith("doi:")) s = s.slice(4).trim();
  while (s.length && (s.endsWith(".") || s.endsWith(",") || s.endsWith(")") || s.endsWith(";"))) s = s.slice(0, -1);
  if (!s.startsWith("10.")) return null;
  const slash = s.indexOf("/");
  if (slash < 4 || slash === s.length - 1) return null;
  const registrant = s.slice(3, slash);
  if (!registrant.split(".").every(digits)) return null;
  if ([...s].some(c => c === " " || c === "\n" || c === "\t")) return null;
  return s;
}

// A DOI some arXiv papers carry: 10.48550/arXiv.1706.03762.
export function arxivFromDoi(doi: string): string | null {
  const lower = doi.toLowerCase();
  return lower.startsWith("10.48550/arxiv.") ? readArxivId(doi.slice("10.48550/arxiv.".length))?.id ?? null : null;
}

const readPmcid = (raw: string) => {
  const s = raw.trim().toUpperCase();
  return s.startsWith("PMC") && digits(s.slice(3)) ? s : null;
};

// The words of the path, decoded.
function segments(path: string): string[] {
  return path.split("/").filter(Boolean).map(p => { try { return decodeURIComponent(p); } catch { return p; } });
}

// Names only a machine on the learner's own network answers to. Addresses
// are checked again where they are fetched (paper-fetch.ts), by what they
// resolve to; this only refuses the obvious early.
function privateName(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".")) return true;
  if (h.startsWith("[")) return true;
  const parts = h.split(".");
  return parts.length === 4 && parts.every(digits);
}

const DOI_TAIL = ["full", "abstract", "pdf", "epdf", "html", "summary", "fulltext", "references", "figures"];

export function identifyPaper(input: string): PaperIdResult {
  const text = input.trim();
  if (!text) return { ok: false, reason: "empty", message: "Paste a link to a paper." };

  // Not a link: a bare arXiv id, DOI or PMCID.
  if (!text.includes("://")) {
    const arxiv = readArxivId(text);
    if (arxiv) return { ok: true, paper: { kind: "arxiv", id: arxiv.id, url: `https://arxiv.org/abs/${arxiv.id}` } };
    const doi = readDoi(text);
    if (doi) {
      const ax = arxivFromDoi(doi);
      return ax ? { ok: true, paper: { kind: "arxiv", id: ax, url: `https://arxiv.org/abs/${ax}` } } : { ok: true, paper: { kind: "doi", id: doi, url: `https://doi.org/${doi}` } };
    }
    const pmc = readPmcid(text);
    if (pmc) return { ok: true, paper: { kind: "pmc", id: pmc, url: `https://pmc.ncbi.nlm.nih.gov/articles/${pmc}/` } };
    return { ok: false, reason: "not_a_link", message: "That isn't a link. Paste the paper's address, like https://arxiv.org/abs/1706.03762, or a DOI." };
  }

  let u: URL;
  try { u = new URL(text); } catch { return { ok: false, reason: "not_a_link", message: "That link couldn't be read. Check it and paste it again." }; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, reason: "not_https", message: "Only web links (https://) can be imported." };
  if (u.username || u.password) return { ok: false, reason: "not_a_link", message: "That link carries a sign-in. Paste the paper's public address." };
  const host = u.hostname.toLowerCase().startsWith("www.") ? u.hostname.toLowerCase().slice(4) : u.hostname.toLowerCase();
  if (privateName(host)) return { ok: false, reason: "private", message: "That address isn't a public website, so Kivo can't import from it." };
  const segs = segments(u.pathname);
  const https = `https://${u.host}${u.pathname}${u.search}`;

  // arXiv: /abs/ID, /pdf/ID(.pdf), /html/ID, /format/ID; ar5iv mirrors.
  if (host === "arxiv.org" || host === "export.arxiv.org" || host === "ar5iv.labs.arxiv.org" || host === "ar5iv.org" || host === "alphaxiv.org") {
    const at = segs.findIndex(s => s === "abs" || s === "pdf" || s === "html" || s === "format" || s === "overview");
    const rest = at === -1 ? segs.join("/") : segs.slice(at + 1).join("/");
    const arxiv = readArxivId(rest);
    if (arxiv) return { ok: true, paper: { kind: "arxiv", id: arxiv.id, url: `https://arxiv.org/abs/${arxiv.id}` } };
  }
  // DOI resolvers.
  if (host === "doi.org" || host === "dx.doi.org") {
    const doi = readDoi(segs.join("/"));
    if (doi) {
      const ax = arxivFromDoi(doi);
      return ax ? { ok: true, paper: { kind: "arxiv", id: ax, url: `https://arxiv.org/abs/${ax}` } } : { ok: true, paper: { kind: "doi", id: doi, url: `https://doi.org/${doi}` } };
    }
  }
  // Semantic Scholar: /paper/<title words>/<40 hex>, or /paper/<40 hex>.
  if (host === "semanticscholar.org" || host === "api.semanticscholar.org") {
    const hex = [...segs].reverse().find(s => s.length === 40 && [...s.toLowerCase()].every(isHex));
    if (hex) return { ok: true, paper: { kind: "semantic_scholar", id: hex.toLowerCase(), url: `https://www.semanticscholar.org/paper/${hex.toLowerCase()}` } };
    const arxivSeg = segs.findIndex(s => s.toLowerCase() === "arxiv");
    const ax = arxivSeg !== -1 ? readArxivId(segs.slice(arxivSeg + 1).join("/")) : null;
    if (ax) return { ok: true, paper: { kind: "arxiv", id: ax.id, url: `https://arxiv.org/abs/${ax.id}` } };
  }
  // OpenReview: /forum?id=…, /pdf?id=…
  if (host === "openreview.net") {
    const id = u.searchParams.get("id")?.trim();
    if (id && id.length <= 40 && [...id].every(c => isLetter(c) || isDigit(c) || c === "_" || c === "-")) {
      return { ok: true, paper: { kind: "openreview", id, url: `https://openreview.net/forum?id=${encodeURIComponent(id)}` } };
    }
  }
  // PubMed and PubMed Central, and Europe PMC.
  if (host === "pubmed.ncbi.nlm.nih.gov" && segs[0] && digits(segs[0])) {
    return { ok: true, paper: { kind: "pubmed", id: segs[0], url: `https://pubmed.ncbi.nlm.nih.gov/${segs[0]}/` } };
  }
  if (host === "ncbi.nlm.nih.gov" || host === "pmc.ncbi.nlm.nih.gov" || host === "europepmc.org") {
    const pmc = segs.map(readPmcid).find(Boolean);
    if (pmc) return { ok: true, paper: { kind: "pmc", id: pmc, url: `https://pmc.ncbi.nlm.nih.gov/articles/${pmc}/` } };
    const med = segs.findIndex(s => s.toLowerCase() === "pubmed" || s.toUpperCase() === "MED");
    if (med !== -1 && segs[med + 1] && digits(segs[med + 1]!)) {
      return { ok: true, paper: { kind: "pubmed", id: segs[med + 1]!, url: `https://pubmed.ncbi.nlm.nih.gov/${segs[med + 1]}/` } };
    }
  }
  // A publisher page with the DOI in its path (/doi/10.1145/…, /article/10.1007/…).
  const start = segs.findIndex((s, i) => s.startsWith("10.") && i < segs.length - 1);
  if (start !== -1) {
    const tail = segs.slice(start);
    while (tail.length > 2 && DOI_TAIL.includes(tail[tail.length - 1]!.toLowerCase())) tail.pop();
    let candidate = tail.join("/");
    if (candidate.toLowerCase().endsWith(".pdf")) candidate = candidate.slice(0, -4);
    const doi = readDoi(candidate);
    if (doi) {
      const ax = arxivFromDoi(doi);
      return ax ? { ok: true, paper: { kind: "arxiv", id: ax, url: `https://arxiv.org/abs/${ax}` } } : { ok: true, paper: { kind: "doi", id: doi, url: https } };
    }
  }
  if (host === "nature.com" && segs[0] === "articles" && segs[1]) {
    const doi = readDoi(`10.1038/${segs[1]}`);
    if (doi) return { ok: true, paper: { kind: "doi", id: doi, url: https } };
  }
  // Anything else: fetched only over https.
  if (u.protocol !== "https:") return { ok: false, reason: "not_https", message: "Kivo fetches papers only over https://. Use the https address." };
  if (u.pathname.toLowerCase().endsWith(".pdf")) return { ok: true, paper: { kind: "pdf", id: https, url: https } };
  return { ok: true, paper: { kind: "page", id: https, url: https } };
}

// ── What was imported ─────────────────────────────────────────────────────────

// full      the paper's text, all of it Kivo could find (figures by caption)
// partial   some of its text (a long paper cut to fit a note, a PDF read in part)
// abstract  its abstract and details only
// details   its title and details only
export type PaperTextStatus = "full" | "partial" | "abstract" | "details";

export const PAPER_STATUS_WORDS: Record<PaperTextStatus, string> = {
  full: "full text", partial: "part of the text", abstract: "abstract only", details: "details only",
};

export interface PaperCard {
  title:     string;
  authors:   string[];
  published: string | null;
  venue:     string | null;
  arxivId:   string | null;
  doi:       string | null;
  pmid:      string | null;
  pmcid:     string | null;
  openreviewId: string | null;
  sourceUrl: string;
  pdfUrl:    string | null;
  status:    PaperTextStatus;
  // Where the text came from ("arXiv's HTML version"), when there is any.
  from:      string | null;
  importedOn: string;
  // The paper's identity across links: arxiv:…, doi:…, pmid:…, pmc:…,
  // openreview:…, s2:… or url:…, most specific first. One paper, one note.
  key:       string;
}

export interface PaperIdentifiers { arxivId?: string | null; doi?: string | null; pmid?: string | null; pmcid?: string | null; openreviewId?: string | null; s2Id?: string | null; url: string }

// The same paper reached by its arXiv page, its DOI or Semantic Scholar has
// the same key, so importing it twice finds the first note.
export function paperKey(ids: PaperIdentifiers): string {
  if (ids.arxivId) return `arxiv:${ids.arxivId.toLowerCase()}`;
  if (ids.doi) return `doi:${ids.doi.toLowerCase()}`;
  if (ids.pmcid) return `pmc:${ids.pmcid.toUpperCase()}`;
  if (ids.pmid) return `pmid:${ids.pmid}`;
  if (ids.openreviewId) return `openreview:${ids.openreviewId}`;
  if (ids.s2Id) return `s2:${ids.s2Id.toLowerCase()}`;
  return `url:${ids.url}`;
}

// The line of the card that carries the key, as the note holds it (what a
// second import looks for).
export const keyLine = (key: string) => `> **Paper key:** ${key}`;

// One line of text: no line breaks, no callout or heading marks at its start.
function oneLine(s: string, max = 600): string {
  let out = "", gap = false;
  for (const c of s) {
    if (c === "\n" || c === "\r" || c === "\t" || c === " ") { gap = out.length > 0; continue; }
    if (gap) out += " ";
    out += c; gap = false;
    if (out.length >= max) break;
  }
  return out;
}

const AUTHORS_SHOWN = 12;

export function paperCardMarkdown(card: PaperCard): string {
  const authors = card.authors.length > AUTHORS_SHOWN ? `${card.authors.slice(0, AUTHORS_SHOWN).join(", ")} and ${card.authors.length - AUTHORS_SHOWN} more` : card.authors.join(", ");
  const ids = [
    card.arxivId ? `**arXiv:** ${card.arxivId}` : null,
    card.doi ? `**DOI:** ${card.doi}` : null,
    card.pmid ? `**PMID:** ${card.pmid}` : null,
    card.pmcid ? `**PMCID:** ${card.pmcid}` : null,
    card.openreviewId ? `**OpenReview:** ${card.openreviewId}` : null,
  ].filter(Boolean).join(" · ");
  const lines = [
    `> [!paper] ${oneLine(card.title, 300)}`,
    authors ? `> **Authors:** ${oneLine(authors, 1_200)}` : null,
    card.published || card.venue ? `> **Published:** ${[card.published, card.venue ? oneLine(card.venue, 200) : null].filter(Boolean).join(" · ")}` : null,
    ids ? `> ${ids}` : null,
    `> **Source:** ${card.sourceUrl}`,
    card.pdfUrl ? `> **PDF:** ${card.pdfUrl}` : null,
    `> **Imported:** ${PAPER_STATUS_WORDS[card.status]}${card.from ? ` · from ${oneLine(card.from, 120)}` : ""} · ${card.importedOn}`,
    keyLine(card.key),
  ];
  return lines.filter(Boolean).join("\n");
}

export const MY_NOTES = "My notes";
// How much of a note holding a paper the editor and the tutor read: nearly
// all of it (a note holds 50,000 characters), so they can teach from and
// write about any section.
export const PAPER_NOTE_WINDOW = 48_000;

// The note an import makes: the card, the abstract, the paper's text, and a
// place for the learner's own notes.
export function paperNoteBody(card: PaperCard, abstract: string | null, text: string | null): string {
  return [
    paperCardMarkdown(card),
    abstract ? `## Abstract\n\n${abstract.trim()}` : null,
    text ? text.trim() : null,
    `## ${MY_NOTES}`,
  ].filter(x => x !== null).join("\n\n") + "\n";
}

const LABELS: Array<[string, keyof PaperCard]> = [
  ["authors", "authors"], ["published", "published"], ["source", "sourceUrl"], ["pdf", "pdfUrl"], ["imported", "status"], ["paper key", "key"],
];

// The card at the top of a note, read back. null: the note holds no paper
// (its first block is not a [!paper] callout).
export function readPaperCard(body: string): { card: PaperCard; start: number; end: number } | null {
  const first = noteBlocks(body)[0];
  if (!first || first.kind !== "quote") return null;
  const lines = first.text.split("\n").map(l => { let t = l.trimStart(); if (t.startsWith(">")) t = t.slice(1); return t.trim(); });
  const head = lines[0] ?? "";
  if (!head.toLowerCase().startsWith("[!paper]")) return null;
  const card: PaperCard = {
    title: head.slice(8).trim(), authors: [], published: null, venue: null, arxivId: null, doi: null, pmid: null, pmcid: null, openreviewId: null,
    sourceUrl: "", pdfUrl: null, status: "details", from: null, importedOn: "", key: "",
  };
  for (const line of lines.slice(1)) {
    // "**Label:** value", several on a line apart with " · ".
    for (const part of line.split(" · ")) {
      const p = part.trim();
      if (!p.startsWith("**")) continue;
      const close = p.indexOf(":**");
      if (close === -1) continue;
      const label = p.slice(2, close).trim().toLowerCase(), value = p.slice(close + 3).trim();
      if (label === "arxiv") card.arxivId = value;
      else if (label === "doi") card.doi = value;
      else if (label === "pmid") card.pmid = value;
      else if (label === "pmcid") card.pmcid = value;
      else if (label === "openreview") card.openreviewId = value;
    }
    if (!line.startsWith("**")) continue;
    const close = line.indexOf(":**");
    if (close === -1) continue;
    const label = line.slice(2, close).trim().toLowerCase(), value = line.slice(close + 3).trim();
    const field = LABELS.find(([l]) => l === label)?.[1];
    if (field === "authors") card.authors = value.split(", ").map(a => a.trim()).filter(Boolean);
    else if (field === "published") { const [when, ...venue] = value.split(" · "); if (when && isDigit(when[0])) { card.published = when; card.venue = venue.join(" · ") || null; } else card.venue = value; }
    else if (field === "sourceUrl") card.sourceUrl = value;
    else if (field === "pdfUrl") card.pdfUrl = value;
    else if (field === "key") card.key = value;
    else if (field === "status") {
      const parts = value.split(" · ");
      const status = (Object.keys(PAPER_STATUS_WORDS) as PaperTextStatus[]).find(s => PAPER_STATUS_WORDS[s] === parts[0]?.trim());
      if (status) card.status = status;
      const from = parts.find(x => x.startsWith("from "));
      card.from = from ? from.slice(5) : null;
      card.importedOn = parts[parts.length - 1] ?? "";
    }
  }
  return card.title ? { card, start: first.start, end: first.end } : null;
}

// The imported paper's own text, [start, end) of the body: the card and
// what follows it up to the "My notes" heading (or to the end, when the
// learner removed that heading). notesAt: where that heading starts.
export function paperRegion(body: string): { start: number; end: number; notesAt: number | null } | null {
  const found = readPaperCard(body);
  if (!found) return null;
  const notes = noteBlocks(body).find(b => b.kind === "heading" && b.level <= 2 && b.start > found.end && squash(plainHeading(b.text)) === squash(MY_NOTES));
  return { start: found.start, end: notes ? notes.start : body.length, notesAt: notes ? notes.start : null };
}

// Where an addition goes in a note holding a paper: never into the paper's
// own text. A place inside it (under one of the paper's sections) becomes the
// same place in "My notes": under a subsection named after that section,
// made when there is none. The other places offered are the learner's own.
export function paperPlacement<T extends { best: Placement; clear: boolean; options: Placement[] }>(body: string, placed: T): T {
  const region = paperRegion(body);
  if (!region) return placed;
  const sections = noteSections(body);
  const mine = region.notesAt !== null ? sections.find(x => x.start === region.notesAt) ?? null : null;
  const inPaper = (p: Placement) => { const at = resolvePlacement(body, p); return at !== null && at < region.end; };
  const level = mine ? Math.min(mine.level + 1, 4) : 3;
  const toMine = (p: Placement): Placement => {
    const title = p.anchor?.words && p.how !== "after" ? p.anchor.words : null;
    const existing = mine && title ? sections.find(x => x.parent === mine.id && squash(x.title) === squash(title)) : null;
    if (existing) return { how: "section", anchor: { hash: existing.hash, words: existing.title }, heading: null, label: `Add under: ${MY_NOTES} › ${existing.title}` };
    if (!mine) return { how: "end", anchor: null, heading: null, label: "At the end of the note" };
    const sub = title ?? "From Nova";
    return { how: "newSection", anchor: { hash: mine.hash, words: mine.title }, heading: `${"#".repeat(level)} ${sub}`, first: false, label: `New subsection in ${MY_NOTES}: ${sub}` };
  };
  const best = inPaper(placed.best) ? toMine(placed.best) : placed.best;
  const options = [best, ...placed.options.filter(o => !inPaper(o) && !(o.label === best.label && o.how === best.how))];
  return { ...placed, best, options };
}
