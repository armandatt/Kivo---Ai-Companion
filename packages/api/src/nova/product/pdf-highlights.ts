// ─── Highlights on a PDF in the reader ────────────────────────────────────────
// The learner's marks on a paper they read beside a note. The only reader and
// writer of NovaPdfHighlight. A highlight names the document by its address
// (Kivo stores no copy of a PDF), a page, and where on the page as fractions
// of its width and height, so it sits on the same words at any zoom. Removing
// one changes nothing in the document. Nothing here is evidence of study:
// no engine, brain or consolidation reads it.

import { prisma } from "@repo/db/client";

export const HIGHLIGHT_TEXT_MAX = 4_000;
export const HIGHLIGHT_RECTS_MAX = 80;
export const HIGHLIGHTS_PER_DOCUMENT_MAX = 2_000;
export const HIGHLIGHT_REQUESTS_PER_MINUTE = 60;
export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export interface HighlightRect { x: number; y: number; w: number; h: number }
export interface PdfHighlight { id: string; page: number; rects: HighlightRect[]; text: string; color: HighlightColor; createdAt: string }

// The document's address as a key: http(s) only, no credentials, no fragment
// (#page=3 is the same file). null for anything else.
export function documentKey(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 2_000) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    u.hash = ""; u.username = ""; u.password = "";
    return u.toString();
  } catch { return null; }
}

// A client's key for one click: letters, digits, _ : and -, 8 to 80 of them.
// Checked character by character (this module reads no pattern).
const KEY_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_:-";
export const isClientKey = (v: unknown): v is string =>
  typeof v === "string" && v.length >= 8 && v.length <= 80 && [...v].every(c => KEY_CHARS.includes(c));
// Runs of spaces, tabs and line breaks made one space.
export function oneLine(text: string): string {
  let out = "", gap = false;
  for (const c of text) {
    if (c === " " || c === "\n" || c === "\t" || c === "\r") { gap = out.length > 0; continue; }
    if (gap) { out += " "; gap = false; }
    out += c;
  }
  return out;
}

const fraction = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

export type HighlightInput = { docUrl: string; page: number; rects: HighlightRect[]; text: string; color: HighlightColor; clientKey: string };

export function parseHighlight(raw: unknown): { ok: true; input: HighlightInput } | { ok: false; message: string } {
  const bad = (message: string) => ({ ok: false as const, message });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad("That isn't a highlight.");
  const r = raw as Record<string, unknown>;
  const docUrl = documentKey(r.docUrl);
  if (!docUrl) return bad("That highlight doesn't name a document.");
  const page = r.page;
  if (typeof page !== "number" || !Number.isInteger(page) || page < 1 || page > 10_000) return bad("That highlight doesn't name a page.");
  if (!Array.isArray(r.rects) || r.rects.length === 0 || r.rects.length > HIGHLIGHT_RECTS_MAX) return bad("That highlight has no place on the page.");
  const rects: HighlightRect[] = [];
  for (const x of r.rects) {
    const q = x as Record<string, unknown> | null;
    if (!q || !fraction(q.x) || !fraction(q.y) || !fraction(q.w) || !fraction(q.h) || (q.w as number) <= 0 || (q.h as number) <= 0) return bad("That highlight is outside the page.");
    rects.push({ x: q.x as number, y: q.y as number, w: q.w as number, h: q.h as number });
  }
  const text = typeof r.text === "string" ? oneLine(r.text).slice(0, HIGHLIGHT_TEXT_MAX) : "";
  const color = HIGHLIGHT_COLORS.find(c => c === r.color) ?? "yellow";
  const clientKey = isClientKey(r.clientKey) ? r.clientKey : null;
  if (!clientKey) return bad("That highlight can't be saved.");
  return { ok: true, input: { docUrl, page, rects, text, color, clientKey } };
}

type Row = { id: string; page: number; rects: unknown; text: string; color: string; createdAt: Date };
const view = (h: Row): PdfHighlight => ({
  id: h.id, page: h.page, rects: Array.isArray(h.rects) ? h.rects as HighlightRect[] : [], text: h.text,
  color: HIGHLIGHT_COLORS.find(c => c === h.color) ?? "yellow", createdAt: h.createdAt.toISOString(),
});

export async function listHighlights(profileId: string, rawUrl: unknown): Promise<PdfHighlight[] | null> {
  const docUrl = documentKey(rawUrl);
  if (!docUrl) return null;
  const rows = await prisma.novaPdfHighlight.findMany({
    where: { profileId, docUrl }, orderBy: [{ page: "asc" }, { createdAt: "asc" }], take: HIGHLIGHTS_PER_DOCUMENT_MAX,
    select: { id: true, page: true, rects: true, text: true, color: true, createdAt: true },
  });
  return rows.map(view);
}

// Made once per clientKey: a retry or a second click returns the one made.
export async function addHighlight(profileId: string, raw: unknown): Promise<{ ok: true; highlight: PdfHighlight } | { ok: false; error: "invalid" | "too_many"; message: string }> {
  const parsed = parseHighlight(raw);
  if (!parsed.ok) return { ok: false, error: "invalid", message: parsed.message };
  const { docUrl, page, rects, text, color, clientKey } = parsed.input;
  const select = { id: true, page: true, rects: true, text: true, color: true, createdAt: true } as const;
  const existing = await prisma.novaPdfHighlight.findUnique({ where: { profileId_clientKey: { profileId, clientKey } }, select });
  if (existing) return { ok: true, highlight: view(existing) };
  const count = await prisma.novaPdfHighlight.count({ where: { profileId, docUrl } });
  if (count >= HIGHLIGHTS_PER_DOCUMENT_MAX) return { ok: false, error: "too_many", message: "This document has as many highlights as it can hold." };
  try {
    const made = await prisma.novaPdfHighlight.create({ data: { profileId, docUrl, page, rects: rects as unknown as object, text, color, clientKey }, select });
    return { ok: true, highlight: view(made) };
  } catch (err) {
    // Two of the same request at once: the other one made it.
    const again = await prisma.novaPdfHighlight.findUnique({ where: { profileId_clientKey: { profileId, clientKey } }, select });
    if (again) return { ok: true, highlight: view(again) };
    throw err;
  }
}

// Only the learner's own; one already gone is not an error.
export async function removeHighlight(profileId: string, id: string): Promise<{ removed: boolean }> {
  if (typeof id !== "string" || id.length > 40) return { removed: false };
  const r = await prisma.novaPdfHighlight.deleteMany({ where: { id, profileId } });
  return { removed: r.count > 0 };
}
