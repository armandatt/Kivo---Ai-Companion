// ─── Files in a note's text: what they are and how they are written ──────────
// Pure (no database). A file kept with a note (note-attachments.ts) is named
// in the note's text on a line of its own as [name](kivo-file:<id>), the way
// an image is ![caption](kivo-image:<id>). Shared .kivo packages (portable/)
// use the same marks with package-local refs (a1, a2…).

import { createHash } from "node:crypto";

export const NOTE_FILE_SCHEME = "kivo-file:";
export const NOTE_FILE_BYTES_MAX = 10_000_000;
export const NOTE_FILE_NAME_MAX = 160;
export type AttachmentKind = "document" | "other";

// What a file is, by its bytes. Only PDFs are kept today.
export function fileInfo(bytes: Uint8Array): { kind: "document"; mimeType: "application/pdf" } | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return { kind: "document", mimeType: "application/pdf" };
  return null;
}

/** A file name as it may be shown and downloaded: no path, no control characters, never empty. */
export function cleanFileName(raw: unknown, fallback = "document.pdf"): string {
  const s = typeof raw === "string" ? raw : "";
  const base = s.split(/[\\/]/).pop() ?? "";
  const clean = base.normalize("NFC").replace(/[\u0000-\u001f\u007f<>:"|?*[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, NOTE_FILE_NAME_MAX).trim();
  return clean && clean !== "." && clean !== ".." ? clean : fallback;
}

export const sha256Hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

export function checkFileBytes(bytes: Uint8Array): { ok: true; kind: "document"; mimeType: "application/pdf" } | { ok: false; error: "invalid" | "unsupported" | "too_large"; message: string } {
  if (bytes.length === 0) return { ok: false, error: "invalid", message: "That file is empty." };
  if (bytes.length > NOTE_FILE_BYTES_MAX) return { ok: false, error: "too_large", message: `That file is larger than ${NOTE_FILE_BYTES_MAX / 1_000_000} MB.` };
  const info = fileInfo(bytes);
  if (!info) return { ok: false, error: "unsupported", message: "Only PDF files can be kept with a note." };
  return { ok: true, ...info };
}

// "[Lecture 3.pdf](kivo-file:abc123)" on a line of its own → { name, id }.
export function fileLine(line: string): { name: string; id: string } | null {
  const m = /^\[([^\]\n]{1,200})\]\(kivo-file:([A-Za-z0-9_-]{1,64})\)$/.exec(line.trim());
  return m ? { name: m[1]!.trim(), id: m[2]! } : null;
}
export const fileMarkdown = (name: string, id: string) => `[${name.replace(/[[\]\n]/g, " ").trim() || "file"}](${NOTE_FILE_SCHEME}${id})`;

const FILE_REF = /\]\(kivo-file:([A-Za-z0-9_-]{1,64})\)/g;
/** The file ids a note's text names, once each, in order. */
export function filesInText(text: string): string[] {
  return [...new Set([...text.matchAll(FILE_REF)].map(m => m[1]!))];
}
