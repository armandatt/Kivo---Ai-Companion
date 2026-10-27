// ─── Images in a note ─────────────────────────────────────────────────────────
// A page or a region the learner captured from a PDF in the reader and put in
// one of their notes. The only reader and writer of NovaNoteImage. The note's
// text holds ![caption](kivo-image:<id>); the bytes are here, given only to
// their owner. An image belongs to the note it was made for and goes with it.
// Checked by its bytes (PNG, JPEG or WebP, and its size read from them); the
// type the browser declares is not trusted. Nothing here is evidence of study.

import { prisma } from "@repo/db/client";
import { ownsNote } from "./notes";
import { isClientKey } from "./pdf-highlights";

export const NOTE_IMAGE_BYTES_MAX = 2_500_000;
export const NOTE_IMAGE_SIDE_MAX = 8_000;
export const NOTE_IMAGE_REQUESTS_PER_MINUTE = 20;
// Base64 is a third larger, plus the few fields beside it.
export const NOTE_IMAGE_BODY_MAX = Math.ceil(NOTE_IMAGE_BYTES_MAX * 4 / 3) + 8_000;
export const NOTE_IMAGE_SCHEME = "kivo-image:";

type ImageType = "image/png" | "image/jpeg" | "image/webp";

// The type and size the bytes say, or null when they are none of the three.
export function imageInfo(b: Buffer): { type: ImageType; width: number; height: number } | null {
  if (b.length >= 24 && b[0] === 0x89 && b.subarray(1, 4).toString("latin1") === "PNG" && b.subarray(12, 16).toString("latin1") === "IHDR") {
    return { type: "image/png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    // The first start-of-frame marker holds the size.
    let at = 2;
    while (at + 9 < b.length) {
      if (b[at] !== 0xff) { at++; continue; }
      const marker = b[at + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
      const length = b.readUInt16BE(at + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: "image/jpeg", height: b.readUInt16BE(at + 5), width: b.readUInt16BE(at + 7) };
      }
      at += 2 + length;
    }
    return null;
  }
  if (b.length >= 30 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") {
    const chunk = b.subarray(12, 16).toString("latin1");
    if (chunk === "VP8X") return { type: "image/webp", width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (chunk === "VP8 ") return { type: "image/webp", width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") { const bits = b.readUInt32LE(21); return { type: "image/webp", width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) }; }
  }
  return null;
}

export interface NoteImageInput { noteId: string; data: string; clientKey: string; sourceUrl?: string | null; sourceTitle?: string | null; page?: number | null }
export type NoteImageResult =
  | { ok: true; image: { id: string; ref: string; width: number; height: number } }
  | { ok: false; error: "invalid" | "unsupported" | "too_large" | "not_found"; message: string };

const short = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export async function saveNoteImage(profileId: string, raw: unknown): Promise<NoteImageResult> {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  if (!r || typeof r.noteId !== "string" || r.noteId.length > 40 || typeof r.data !== "string") return { ok: false, error: "invalid", message: "That image couldn't be read." };
  const clientKey = isClientKey(r.clientKey) ? r.clientKey : null;
  if (!clientKey) return { ok: false, error: "invalid", message: "That image can't be saved." };
  const bytes = Buffer.from(r.data, "base64");
  if (bytes.length === 0) return { ok: false, error: "invalid", message: "That image is empty." };
  if (bytes.length > NOTE_IMAGE_BYTES_MAX) return { ok: false, error: "too_large", message: "That image is too large. Capture a smaller region." };
  const info = imageInfo(bytes);
  if (!info) return { ok: false, error: "unsupported", message: "Only PNG, JPEG or WebP images can go in a note." };
  if (info.width < 1 || info.height < 1 || info.width > NOTE_IMAGE_SIDE_MAX || info.height > NOTE_IMAGE_SIDE_MAX) return { ok: false, error: "unsupported", message: "That image's size can't be read." };
  if (!(await ownsNote(profileId, r.noteId))) return { ok: false, error: "not_found", message: "That note doesn't exist any more." };

  const select = { id: true, width: true, height: true } as const;
  const shown = (x: { id: string; width: number; height: number }) => ({ ok: true as const, image: { ...x, ref: `${NOTE_IMAGE_SCHEME}${x.id}` } });
  const existing = await prisma.novaNoteImage.findUnique({ where: { profileId_clientKey: { profileId, clientKey } }, select });
  if (existing) return shown(existing);
  const page = typeof r.page === "number" && Number.isInteger(r.page) && r.page > 0 && r.page <= 10_000 ? r.page : null;
  try {
    const made = await prisma.novaNoteImage.create({
      data: { profileId, noteId: r.noteId, mimeType: info.type, bytes, width: info.width, height: info.height, clientKey,
        sourceUrl: short(r.sourceUrl, 2_000), sourceTitle: short(r.sourceTitle, 300), page },
      select,
    });
    return shown(made);
  } catch (err) {
    const again = await prisma.novaNoteImage.findUnique({ where: { profileId_clientKey: { profileId, clientKey } }, select });
    if (again) return shown(again);
    throw err;
  }
}

// The bytes, only for their owner. Anyone else gets nothing (the route says 404).
export async function readNoteImage(profileId: string, id: string): Promise<{ mimeType: string; bytes: Buffer } | null> {
  // A row id: letters and digits only (cuid).
  if (typeof id !== "string" || id.length < 8 || id.length > 40 || [...id].some(c => !((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9")))) return null;
  const row = await prisma.novaNoteImage.findFirst({ where: { id, profileId }, select: { mimeType: true, bytes: true } });
  return row ? { mimeType: row.mimeType, bytes: Buffer.from(row.bytes) } : null;
}
