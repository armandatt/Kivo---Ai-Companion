// ─── Bringing material into a note: captures and imports ──────────────────────
// Pure, shared with the browser. A capture (a passage and the page it came
// from) or an imported file becomes an ordinary note through the ordinary
// notes route, written by the learner's Save: there is no second notes
// system, and the browser extension, the bookmarklet and the capture page all
// end in /api/nova/notes.
//
// What arrives is kept as it arrived. A passage is quoted under its source;
// a text or Markdown file is kept verbatim under one line saying where it
// came from; a transcription says it is Nova's reading of the file. Adding
// to a note that exists appends under a divider and never rewrites what is
// there. The source is the note's "Source:" line, which the notes page
// already reads (note-blocks sourceOf) to open the page beside the note.
//
// No regex, and nothing but the resource-link helpers (pure, no imports).

import { normalizeResourceUrl } from "./resource-link";

export const NOTE_CAPTURE_PATH = "/notes/capture";
export const CAPTURE_TEXT_MAX = 20_000;
// What a bookmarklet sends in an address: Safari on an iPad copes with this.
export const BOOKMARKLET_TEXT_MAX = 6_000;
const TITLE_MAX = 200;
const BODY_MAX = 50_000;   // NOTE_BODY_MAX

export type CaptureVia = "extension" | "bookmarklet" | "paste" | "file";

export interface NoteCapture { url: string | null; title: string; text: string; via: CaptureVia }

const oneLine = (s: string) => [...s].map(ch => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch)).join("").split(" ").filter(Boolean).join(" ");
const unifyLines = (s: string) => s.split("\r\n").join("\n").split("\r").join("\n");

// A capture from the address's fragment (#url=…&title=…&text=…&via=…). The
// fragment never reaches a server. null: nothing usable in it.
export function readNoteCapture(fragment: string): NoteCapture | null {
  const raw = typeof fragment === "string" ? fragment : "";
  if (!raw || raw.length > CAPTURE_TEXT_MAX * 12) return null;
  let params: URLSearchParams;
  try { params = new URLSearchParams(raw.startsWith("#") ? raw.slice(1) : raw); } catch { return null; }
  const address = normalizeResourceUrl(params.get("url") ?? "");
  const text = unifyLines(params.get("text") ?? "").trim().slice(0, CAPTURE_TEXT_MAX);
  if (!address && !text) return null;
  const via = params.get("via") === "extension" ? "extension" : params.get("via") === "bookmarklet" ? "bookmarklet" : "paste";
  return { url: address ? address.url : null, title: oneLine(params.get("title") ?? "").slice(0, TITLE_MAX), text, via };
}

// The fragment the extension or another page opens the capture page with.
export function noteCaptureFragment(c: { url?: string | null; title?: string; text?: string; via: CaptureVia }): string {
  const p = new URLSearchParams();
  if (c.url) p.set("url", c.url);
  if (c.title) p.set("title", c.title.slice(0, TITLE_MAX));
  if (c.text) p.set("text", c.text.slice(0, CAPTURE_TEXT_MAX));
  p.set("via", c.via);
  return `#${p.toString()}`;
}

// The bookmark's address for a Kivo web app at `origin`: it opens the
// capture page with the tab's address, title and selected text. It works in
// any browser that runs bookmarklets, Safari on iPad and iPhone included.
// null: not an origin a bookmarklet should be made for.
export function noteCaptureBookmarklet(origin: string): string | null {
  let app: URL;
  try { app = new URL(origin); } catch { return null; }
  const local = app.hostname === "localhost" || app.hostname === "127.0.0.1";
  if (app.protocol !== "https:" && !(app.protocol === "http:" && local)) return null;
  if (![...app.host].every(ch => "abcdefghijklmnopqrstuvwxyz0123456789.-:".includes(ch))) return null;
  const target = JSON.stringify(`${app.origin}${NOTE_CAPTURE_PATH}#`);
  return `javascript:(function(){var s='';try{s=String(window.getSelection()).slice(0,${BOOKMARKLET_TEXT_MAX})}catch(e){}var u=${target}+'url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title)+'&text='+encodeURIComponent(s)+'&via=bookmarklet';var w=window.open(u,'_blank');if(!w){location.href=u}})();`;
}

const siteOf = (url: string) => { try { const h = new URL(url).hostname; return h.startsWith("www.") ? h.slice(4) : h; } catch { return ""; } };
const quote = (text: string) => unifyLines(text).split("\n").map(l => (l.trim() ? `> ${l}` : ">")).join("\n");

// A title for a new note: the page's, else the first heading or line of the
// text, else the file's name without its extension.
export function captureTitle(c: { title?: string; text?: string; fileName?: string; url?: string | null }): string {
  if (c.title && oneLine(c.title)) return oneLine(c.title).slice(0, TITLE_MAX);
  for (const line of unifyLines(c.text ?? "").split("\n")) {
    let t = line.trim();
    // A page marker of a transcription, or a divider, is not a title.
    if (t.startsWith("--- Page") || (t.length >= 3 && [...t].every(ch => ch === "-"))) continue;
    while (t.startsWith("#") || t.startsWith(">") || t.startsWith("-")) t = t.slice(1).trim();
    if (t) return oneLine(t).slice(0, 80);
  }
  if (c.fileName) {
    const dot = c.fileName.lastIndexOf(".");
    return oneLine(dot > 0 ? c.fileName.slice(0, dot) : c.fileName).slice(0, TITLE_MAX) || "Imported note";
  }
  return c.url ? siteOf(c.url) || "Captured page" : "Captured note";
}

// The text a capture adds: where it came from, then the passage as it was.
// `day` is the learner's own day (YYYY-MM-DD), given by the page.
export function captureBody(c: NoteCapture, day: string): string {
  const lines: string[] = [];
  if (c.url) lines.push(`Source: ${c.title ? `${c.title} ` : ""}${c.url}`);
  const how = c.via === "extension" ? "with the Nova extension" : c.via === "bookmarklet" ? "with the Kivo bookmarklet" : "by pasting";
  lines.push(`Captured ${day}${c.url ? ` from ${siteOf(c.url)}` : ""} ${how}.`);
  if (c.text) lines.push("", "> [!quote] From the source", quote(c.text));
  else lines.push("", "Only the page's address and title were captured. Select a passage before capturing to bring its text.");
  return lines.join("\n");
}

export interface ImportedFile {
  fileName: string;
  text:     string;
  // A transcription Nova made of a PDF or image, with what it said about it.
  transcription?: { pages: number | null; quality: "clear" | "mixed" | "poor"; complete: boolean; illegible: number };
}

export function importBody(f: ImportedFile, day: string): string {
  const text = unifyLines(f.text);
  if (!f.transcription) return `Imported from ${oneLine(f.fileName)} on ${day}.\n\n---\n\n${text}`;
  const t = f.transcription;
  const quality = t.quality === "clear" ? "read clearly" : t.quality === "mixed" ? "some places uncertain" : "much of it uncertain";
  const facts = [t.pages ? `${t.pages} page${t.pages === 1 ? "" : "s"}` : null, quality, t.illegible ? `${t.illegible} place${t.illegible === 1 ? "" : "s"} marked [illegible]` : null].filter(Boolean).join(" · ");
  const head = [
    `> [!note] Transcribed by Nova from ${oneLine(f.fileName)} on ${day}`,
    `> ${facts}. This is Nova's reading of the file, not the file: check it against your original, especially handwriting, diagrams and equations. Kivo does not keep the file.`,
  ];
  if (!t.complete) head.push("", "> [!warning] Incomplete", "> The transcription stops before the end of the file. Import the rest separately, or add it by hand.");
  return `${head.join("\n")}\n\n${text}`;
}

// Adds to a note's text without changing what is there. null: the result
// would be longer than a note may be.
export function appendToBody(existing: string, addition: string, day: string): string | null {
  const before = unifyLines(existing).trimEnd();
  const next = before ? `${before}\n\n---\n\n*Added ${day}*\n\n${addition}` : addition;
  return next.length > BODY_MAX ? null : next;
}
