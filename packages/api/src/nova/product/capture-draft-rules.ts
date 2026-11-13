// ─── Drafts: the rules, with no database ──────────────────────────────────────
// Pure, shared by the server (capture-drafts.ts) and the review page. A draft
// is the learner's capture inbox for one reading session: passages collected
// before they decide which note they belong in (docs/CAPTURE_FIRST.md).
//
//   - Each passage keeps its own source (address, title, site) and time, so
//     combining passages from several pages never loses where each came from.
//   - A capture joins the learner's latest open draft while the session lasts
//     (SESSION_GAP_MS since its last capture, and room left); otherwise it
//     starts a new one. "New draft" always starts a new one.
//   - In a note, a source is named once per group of its passages: a heading
//     and one compact line, `[View source](address) · site`. Never the raw
//     address after every passage.
//
// No regex, and nothing but resource-link (pure, no imports).

import { normalizeResourceUrl } from "./resource-link";

export const SESSION_GAP_MS     = 3 * 60 * 60_000;
export const DRAFT_ITEMS_MAX    = 100;
export const CAPTURE_TEXT_MAX   = 8_000;
export const CAPTURE_CONTEXT_MAX = 600;
export const CAPTURE_NOTE_MAX   = 4_000;
export const CAPTURE_TITLE_MAX  = 300;
export const DRAFT_TITLE_MAX    = 120;
export const CAPTURE_KEY_MAX    = 64;
const NOTE_BODY_MAX = 1_000_000;   // notes.types NOTE_BODY_MAX

export interface CaptureItem {
  id:         string;
  key:        string | null;    // the client's idempotency key, if it sent one
  url:        string | null;
  title:      string;
  site:       string | null;
  text:       string;           // the passage; "" when only the page was captured
  context:    string | null;    // a little of what surrounds it, when the page gave it
  note:       string;           // the learner's own observation
  capturedAt: string;           // ISO
}

export type DraftStatus = "open" | "merged" | "discarded";

export interface DraftSummary {
  id: string; title: string; named: boolean; status: DraftStatus;
  passages: number; sources: number; lastCaptureAt: string; createdAt: string;
  mergedNoteId: string | null;
  // The first few sources, for the inbox row.
  sourceTitles: string[];
}

export interface DraftDetail extends DraftSummary { items: CaptureItem[]; version: number }

export interface SourceGroup { url: string | null; title: string; site: string | null; items: CaptureItem[] }

// ── Reading what arrives ─────────────────────────────────────────────────────

const unifyLines = (s: string) => s.split("\r\n").join("\n").split("\r").join("\n");
const oneLine = (s: string) => [...s].map(ch => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch)).join("").split(" ").filter(Boolean).join(" ");
// Control characters out (tabs and line breaks kept), lines trimmed at the end.
const cleanText = (s: string) => unifyLines(s)
  .split("\n")
  .map(line => [...line].map(ch => { const c = ch.charCodeAt(0); return (c < 32 && c !== 9) || c === 127 ? " " : ch }).join("").trimEnd())
  .join("\n").trim();

export interface CaptureInput {
  key: string | null; url: string | null; site: string | null; title: string;
  text: string; context: string | null; note: string; fresh: boolean;
}

export type CaptureRefusal = { error: "invalid" | "too_long" | "empty"; message: string };

// A capture from a client: { key?, url?, title?, text?, context?, note?, newDraft? }.
// A page with no passage is a capture too (the page itself, to come back to).
export function parseCapture(raw: unknown): { ok: true; input: CaptureInput } | { ok: false; refusal: CaptureRefusal } {
  const bad = (error: CaptureRefusal["error"], message: string) => ({ ok: false as const, refusal: { error, message } });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad("invalid", "That isn't something Nova can keep.");
  const b = raw as Record<string, unknown>;

  const key = typeof b.key === "string" && b.key.length >= 8 && b.key.length <= CAPTURE_KEY_MAX ? b.key : null;
  const address = b.url === undefined || b.url === null || b.url === "" ? null : normalizeResourceUrl(b.url);
  if ((b.url !== undefined && b.url !== null && b.url !== "") && !address) return bad("invalid", "Nova can only keep passages from an ordinary web page.");

  if (typeof b.text === "string" && b.text.length > CAPTURE_TEXT_MAX * 2) return bad("too_long", `Select a shorter passage: a draft keeps up to ${CAPTURE_TEXT_MAX.toLocaleString("en-US")} characters at a time.`);
  const text = typeof b.text === "string" ? cleanText(b.text) : "";
  if (text.length > CAPTURE_TEXT_MAX) return bad("too_long", `Select a shorter passage: a draft keeps up to ${CAPTURE_TEXT_MAX.toLocaleString("en-US")} characters at a time.`);
  const note = typeof b.note === "string" ? cleanText(b.note).slice(0, CAPTURE_NOTE_MAX) : "";
  if (!text && !address && !note) return bad("empty", "Select a passage first.");

  const title = typeof b.title === "string" ? oneLine(b.title.slice(0, CAPTURE_TITLE_MAX * 2)).slice(0, CAPTURE_TITLE_MAX) : "";
  const context = typeof b.context === "string" && b.context.trim() ? oneLine(b.context).slice(0, CAPTURE_CONTEXT_MAX) : null;
  return {
    ok: true,
    input: {
      key, url: address?.url ?? null, site: address ? siteOf(address.domain) : null,
      title: title || (address ? siteOf(address.domain) : ""), text, context, note, fresh: b.newDraft === true,
    },
  };
}

export const siteOf = (domain: string) => (domain.toLowerCase().startsWith("www.") ? domain.slice(4) : domain).toLowerCase();

// ── Which draft a capture goes in ────────────────────────────────────────────

// Whether a capture made now belongs in this open draft: the same reading
// session (its last capture recent enough) and room for one more.
export function joinsDraft(draft: { lastCaptureAt: Date; passages: number }, now: Date): boolean {
  return now.getTime() - draft.lastCaptureAt.getTime() <= SESSION_GAP_MS && draft.passages < DRAFT_ITEMS_MAX;
}

// The same passage from the same page is already in the draft.
export function alreadyIn(items: CaptureItem[], c: { url: string | null; text: string; key: string | null }): CaptureItem | null {
  if (c.key) { const byKey = items.find(i => i.key === c.key); if (byKey) return byKey }
  return items.find(i => i.url === c.url && i.text === c.text && (c.text !== "" || i.note === "")) ?? null;
}

// ── What a draft is called, and its sources ──────────────────────────────────

export function sourceGroups(items: CaptureItem[]): SourceGroup[] {
  const groups: SourceGroup[] = [];
  for (const item of items) {
    const found = groups.find(g => g.url === item.url);
    if (found) { found.items.push(item); continue }
    groups.push({ url: item.url, title: item.title || item.site || "Your own words", site: item.site, items: [item] });
  }
  return groups;
}

export function draftTitle(title: string | null, items: CaptureItem[]): string {
  if (title && title.trim()) return title.trim();
  const groups = sourceGroups(items).filter(g => g.url);
  if (!groups.length) return "Untitled draft";
  const first = groups[0]!.title;
  return groups.length === 1 ? first : `${first} and ${groups.length - 1} more`;
}

export function summarise(row: {
  id: string; title: string | null; status: string; items: CaptureItem[];
  lastCaptureAt: Date; createdAt: Date; mergedNoteId: string | null;
}): DraftSummary {
  const groups = sourceGroups(row.items);
  return {
    id: row.id, title: draftTitle(row.title, row.items), named: Boolean(row.title && row.title.trim()),
    status: (row.status === "merged" || row.status === "discarded" ? row.status : "open"),
    passages: row.items.length, sources: groups.filter(g => g.url).length,
    lastCaptureAt: row.lastCaptureAt.toISOString(), createdAt: row.createdAt.toISOString(),
    mergedNoteId: row.mergedNoteId,
    sourceTitles: groups.filter(g => g.url).slice(0, 3).map(g => g.title),
  };
}

// Items as stored (Json), read defensively: anything malformed is left out.
export function readItems(raw: unknown): CaptureItem[] {
  if (!Array.isArray(raw)) return [];
  const out: CaptureItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const i = r as Record<string, unknown>;
    if (typeof i.id !== "string" || typeof i.capturedAt !== "string") continue;
    out.push({
      id: i.id, key: typeof i.key === "string" ? i.key : null,
      url: typeof i.url === "string" ? i.url : null, title: typeof i.title === "string" ? i.title : "",
      site: typeof i.site === "string" ? i.site : null, text: typeof i.text === "string" ? i.text : "",
      context: typeof i.context === "string" ? i.context : null, note: typeof i.note === "string" ? i.note : "",
      capturedAt: i.capturedAt,
    });
  }
  return out;
}

// ── Edits from the review page ───────────────────────────────────────────────

export type DraftEdit =
  | { op: "edit"; id: string; text?: string; note?: string }
  | { op: "remove"; id: string }
  | { op: "move"; id: string; to: number }
  | { op: "rename"; title: string | null };

export function parseEdits(raw: unknown): DraftEdit[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 50) return null;
  const out: DraftEdit[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") return null;
    const e = r as Record<string, unknown>;
    if (e.op === "rename") {
      if (e.title !== null && typeof e.title !== "string") return null;
      out.push({ op: "rename", title: typeof e.title === "string" ? oneLine(e.title).slice(0, DRAFT_TITLE_MAX) || null : null });
      continue;
    }
    if (typeof e.id !== "string" || !e.id) return null;
    if (e.op === "remove") { out.push({ op: "remove", id: e.id }); continue }
    if (e.op === "move") { if (typeof e.to !== "number" || !Number.isInteger(e.to)) return null; out.push({ op: "move", id: e.id, to: e.to }); continue }
    if (e.op === "edit") {
      if (e.text !== undefined && typeof e.text !== "string") return null;
      if (e.note !== undefined && typeof e.note !== "string") return null;
      if (typeof e.text === "string" && e.text.length > CAPTURE_TEXT_MAX) return null;
      if (typeof e.note === "string" && e.note.length > CAPTURE_NOTE_MAX) return null;
      out.push({ op: "edit", id: e.id, ...(typeof e.text === "string" ? { text: cleanText(e.text) } : {}), ...(typeof e.note === "string" ? { note: cleanText(e.note) } : {}) });
      continue;
    }
    return null;
  }
  return out;
}

// The edits played in order. An edit naming a passage that is not there
// changes nothing (it was removed in another tab): the rest still apply.
export function applyEdits(state: { title: string | null; items: CaptureItem[] }, edits: DraftEdit[]): { title: string | null; items: CaptureItem[] } {
  let title = state.title;
  let items = state.items.slice();
  for (const e of edits) {
    if (e.op === "rename") { title = e.title; continue }
    const at = items.findIndex(i => i.id === e.id);
    if (at === -1) continue;
    if (e.op === "remove") { items.splice(at, 1); continue }
    if (e.op === "move") {
      const [moved] = items.splice(at, 1);
      items.splice(Math.max(0, Math.min(items.length, e.to)), 0, moved!);
      continue;
    }
    items[at] = { ...items[at]!, ...(e.text !== undefined ? { text: e.text } : {}), ...(e.note !== undefined ? { note: e.note } : {}) };
  }
  // A passage emptied of both its words and the learner's own is gone.
  items = items.filter(i => i.text || i.note || i.url);
  return { title, items };
}

// ── Into a note ──────────────────────────────────────────────────────────────

const quote = (text: string) => unifyLines(text).split("\n").map(l => (l.trim() ? `> ${l}` : ">")).join("\n");
// An address inside Markdown's (…): brackets and spaces encoded, which is the
// same address.
export const linkTarget = (url: string) => url.split(" ").join("%20").split("(").join("%28").split(")").join("%29");
const sourceLine = (g: SourceGroup) => `[View source](${linkTarget(g.url!)})${g.site ? ` · ${g.site}` : ""}`;
const headingText = (g: SourceGroup) => oneLine(g.title).slice(0, 160) || g.site || "Source";

// A passage, then the learner's own words about it.
function passageMarkdown(item: CaptureItem): string {
  const parts: string[] = [];
  if (item.text) parts.push(quote(item.text));
  if (item.note) parts.push(item.note);
  return parts.join("\n\n");
}

function groupMarkdown(g: SourceGroup, level: 2 | 3): string {
  const head = g.url ? [`${"#".repeat(level)} ${headingText(g)}`, sourceLine(g)] : [`${"#".repeat(level)} My own notes`];
  const body = g.items.map(passageMarkdown).filter(Boolean);
  return [head.join("\n"), ...body].join("\n\n");
}

// A draft as the text of a new note: each source once, its passages under it.
export function draftMarkdown(items: CaptureItem[]): string {
  return sourceGroups(items).map(g => groupMarkdown(g, 2)).join("\n\n");
}

export interface MergePlan {
  body: string;
  // What it adds, for the preview: the sections added at the end, and the
  // sources whose passages joined a section the note already has.
  added: string;
  joined: string[];
}

// Adds a draft to a note's text without changing what is there. A source the
// note already cites (its `[View source](address)` line) gets the passages at
// the end of that section, under no second heading; the rest go at the end
// under a divider, as a new section each. null: over what a note can hold.
export function mergeIntoBody(existing: string, items: CaptureItem[], day: string): MergePlan | null {
  let lines = unifyLines(existing).trimEnd().split("\n");
  if (lines.length === 1 && lines[0] === "") lines = [];
  const joined: string[] = [];
  const fresh: SourceGroup[] = [];

  for (const g of sourceGroups(items)) {
    const at = g.url ? lines.findIndex(l => l.includes(`](${linkTarget(g.url!)})`)) : -1;
    if (at === -1) { fresh.push(g); continue }
    // The section ends at the next heading or divider.
    let end = at + 1;
    while (end < lines.length && !lines[end]!.startsWith("#") && lines[end]!.trim() !== "---") end++;
    while (end > at + 1 && lines[end - 1]!.trim() === "") end--;
    const addition = g.items.map(passageMarkdown).filter(Boolean).join("\n\n");
    if (!addition) continue;
    lines.splice(end, 0, "", ...addition.split("\n"));
    joined.push(g.title);
  }

  const added = fresh.map(g => groupMarkdown(g, 3)).join("\n\n");
  let body = lines.join("\n");
  if (added) body = body ? `${body}\n\n---\n\n*Added ${day}*\n\n${added}` : added;
  return body.length > NOTE_BODY_MAX ? null : { body, added, joined };
}
