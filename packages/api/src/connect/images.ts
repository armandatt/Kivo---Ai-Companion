// ─── Kivo Connect: images an assistant puts in, or reads from, a note ────────
// No storage of its own: images are Kivo's note images (nova/product/
// note-images.ts, NovaNoteImage; bytes served only to their owner), and a
// note shows one as ![caption](kivo-image:<id>) in its text, as the web
// editor writes them.
//
// In: an assistant can give an image three ways, because clients differ:
//   data   base64 bytes (MCP Inspector, Claude Code, any client holding bytes)
//   url    a public https:// address (fetched through paper-fetch's safeGet:
//          public addresses only, checked at connect time, size-capped)
//   files  ChatGPT's file parameters (openai/fileParams): { download_url,
//          file_id }, fetched the same way, at once (the URL is temporary)
// Every image is fetched and checked by its bytes BEFORE anything is stored,
// so a bad one changes nothing. Each is stored under a key made from the
// note and the image's own hash: a retry finds the image already there.
//
// Out: get_note lists a note's images (order, caption, size) without bytes;
// asked for, the bytes go back as MCP image content (see apps/api/lib/
// connect/mcp.ts), a few per call.

import { createHash } from "node:crypto";
import { z } from "zod";
import { checkImageBytes, NOTE_IMAGE_BYTES_MAX, NOTE_IMAGE_SCHEME } from "../nova/product/note-images";
import { FetchRefused, safeGet, type Get } from "../nova/product/paper-fetch";

export const IMAGES_PER_WRITE = 6;
export const IMAGES_PER_READ = 3;
// Raw bytes per read, together (about 6.7 MB as base64 in the response).
export const IMAGE_READ_BYTES = 5_000_000;
const CAPTION_MAX = 200;
const FETCH_TIMEOUT_MS = 12_000;

export const ImageInputSchema = z.object({
  data: z.string().max(Math.ceil(NOTE_IMAGE_BYTES_MAX * 4 / 3) + 100).optional().describe("The image's bytes, base64 (a data:image/…;base64, prefix is fine). PNG, JPEG or WebP, up to 2.5 MB."),
  url: z.string().max(2_000).optional().describe("Or a public https:// address of the image. Kivo fetches it once."),
  mimeType: z.string().max(60).optional().describe("Optional; Kivo reads the type from the bytes."),
  caption: z.string().max(500).optional().describe("A short caption shown under the image."),
});
export type ImageInput = z.infer<typeof ImageInputSchema>;

// ChatGPT's file object (Apps SDK, openai/fileParams): exactly these four,
// download_url and file_id required, nothing else.
export const ChatGptFileSchema = z.object({
  download_url: z.string().max(4_000),
  file_id: z.string().max(300),
  mime_type: z.string().max(100).optional(),
  file_name: z.string().max(300).optional(),
}).strict();
export type ChatGptFile = z.infer<typeof ChatGptFileSchema>;

export const imagesArg = z.array(ImageInputSchema).max(IMAGES_PER_WRITE).optional()
  .describe(`Images to put in the note (screenshots, diagrams), in order: each { data (base64) | url (public https), caption? }. Up to ${IMAGES_PER_WRITE}, PNG/JPEG/WebP, 2.5 MB each.`);
export const filesArg = z.array(ChatGptFileSchema).max(IMAGES_PER_WRITE).optional()
  .describe("ChatGPT only: image files the learner attached in this chat. They go after `images`.");
export const fileCaptionsArg = z.array(z.string().max(500)).max(IMAGES_PER_WRITE).optional()
  .describe("Captions for `files`, in the same order.");

export interface ReadyImage { bytes: Buffer; type: string; width: number; height: number; caption: string; hash: string; from: "data" | "url" | "file" }
export type ReadyResult = { ok: true; images: ReadyImage[] } | { ok: false; index: number; message: string };

// A caption that keeps the image's Markdown whole: one line, no brackets.
export function cleanCaption(raw: string | undefined): string {
  let out = "";
  for (const c of raw ?? "") out += c === "[" || c === "]" ? "" : c === "\n" || c === "\r" || c === "\t" ? " " : c;
  return out.split(" ").filter(Boolean).join(" ").slice(0, CAPTION_MAX);
}

function base64Of(data: string): string {
  const comma = data.startsWith("data:") ? data.indexOf(",") : -1;
  return comma === -1 ? data : data.slice(comma + 1);
}

async function fetched(url: string, get: Get): Promise<{ ok: true; bytes: Buffer } | { ok: false; message: string }> {
  try {
    const r = await get(url, { accept: "image/png,image/jpeg,image/webp,image/*;q=0.8", maxBytes: NOTE_IMAGE_BYTES_MAX, timeoutMs: FETCH_TIMEOUT_MS });
    if (r.status !== 200) return { ok: false, message: `The image address answered ${r.status}.` };
    return { ok: true, bytes: r.body };
  } catch (err) {
    if (err instanceof FetchRefused) return { ok: false, message: err.reason === "too_large" ? "That image is larger than 2.5 MB. Send a smaller one or crop it." : err.message };
    return { ok: false, message: "The image couldn't be fetched." };
  }
}

// Every image fetched and checked, in order (images, then files), or the
// first one that can't be used. Nothing is stored here.
export async function readyImages(images: ImageInput[] = [], files: ChatGptFile[] = [], fileCaptions: string[] = [], get: Get = safeGet): Promise<ReadyResult> {
  const all: Array<{ data?: string; url?: string; caption?: string; from: ReadyImage["from"] }> = [
    ...images.map(i => ({ data: i.data, url: i.url, caption: i.caption, from: (i.data ? "data" : "url") as ReadyImage["from"] })),
    ...files.map((f, n) => ({ url: f.download_url, caption: fileCaptions[n], from: "file" as const })),
  ];
  if (all.length > IMAGES_PER_WRITE) return { ok: false, index: IMAGES_PER_WRITE, message: `At most ${IMAGES_PER_WRITE} images at a time.` };
  for (const [index, i] of all.entries()) {
    if (!i.data === !i.url) return { ok: false, index, message: `Image ${index + 1}: give either data (base64) or url, not both or neither.` };
  }
  const got = await Promise.all(all.map(async (i) => {
    if (i.data) return { ok: true as const, bytes: Buffer.from(base64Of(i.data), "base64") };
    return fetched(i.url!, get);
  }));
  const ready: ReadyImage[] = [];
  for (const [index, g] of got.entries()) {
    if (!g.ok) return { ok: false, index, message: `Image ${index + 1}: ${g.message}` };
    const info = checkImageBytes(g.bytes);
    if (!info.ok) return { ok: false, index, message: `Image ${index + 1}: ${info.error === "too_large" ? "larger than 2.5 MB. Send a smaller one or crop it." : info.message}` };
    ready.push({ bytes: g.bytes, type: info.type, width: info.width, height: info.height, caption: cleanCaption(all[index]!.caption), hash: createHash("sha256").update(g.bytes).digest("hex"), from: all[index]!.from });
  }
  return { ok: true, images: ready };
}

// The image's key on a note: the same bytes on the same note are one image,
// however often a call is retried. (note-images clientKey: 8–80 of a-z A-Z 0-9 _ : -)
export const imageKey = (noteId: string, hash: string) => `mcp:${createHash("sha256").update(`${noteId}:${hash}`).digest("hex").slice(0, 48)}`;

// The Markdown that shows stored images in a note, one per paragraph.
export function imagesMarkdown(images: Array<{ id: string; caption: string }>): string {
  return images.map(i => `![${i.caption}](${NOTE_IMAGE_SCHEME}${i.id})`).join("\n\n");
}

const words = (s: string) => s.split("\t").join(" ").split(" ").filter(Boolean).join(" ").toLowerCase();

// Where a heading's section ends in a note: the start of the next heading at
// the same or a higher level, or the end; `at` is null when no heading
// matches. Headings are "#…" lines outside ``` code, matched by their words,
// case-insensitively; `headings` lists them all. Pure.
export function sectionEnd(body: string, heading: string): { at: number | null; headings: string[] } {
  const want = words(heading.split("#").join(""));
  const headings: string[] = [];
  let inCode = false, offset = 0, level = 0, at: number | null = null, found = false;
  for (const line of body.split("\n")) {
    const t = line.trimStart();
    if (t.startsWith("```")) inCode = !inCode;
    else if (!inCode && t.startsWith("#")) {
      let n = 0;
      while (t[n] === "#") n++;
      if (n <= 6 && (t[n] === " " || t.length === n)) {
        const title = t.slice(n).trim();
        if (found && at === null && n <= level) at = offset;
        headings.push(title);
        if (!found && words(title) === want) { found = true; level = n; }
      }
    }
    offset += line.length + 1;
  }
  return { at: found ? (at ?? body.length) : null, headings };
}

// The text put in at that place, as its own paragraph(s). Pure.
export function insertAt(body: string, at: number, text: string): string {
  const before = body.slice(0, at).trimEnd(), after = body.slice(at).trimStart();
  return `${before ? `${before}\n\n` : ""}${text}${after ? `\n\n${after}` : ""}`;
}
