// ─── Files kept with a note (NovaNoteAttachment) ──────────────────────────────
// The only reader and writer of NovaNoteAttachment. A file a learner keeps
// with a note, byte for byte: today a PDF (imported on its own, or carried in
// a shared .kivo note or map). It is never flattened into text: the note's
// text holds [name](kivo-file:<id>) and the bytes stay here, given only to
// their owner. Checked by its bytes (a PDF starts %PDF-); the type the browser
// declares is not trusted. Counted on the owner's storage allowance
// (billing/accounting/storage.ts); an upload is admitted before it is stored
// by the route or import that brings it. Nothing here is evidence of study.

import { prisma } from "@repo/db/client";
import { ownsNote } from "./notes";
import { isClientKey } from "./pdf-highlights";
import { checkFileBytes, cleanFileName, NOTE_FILE_SCHEME, sha256Hex, type AttachmentKind } from "./note-files";

export { NOTE_FILE_SCHEME, NOTE_FILE_BYTES_MAX, NOTE_FILE_NAME_MAX, fileInfo, cleanFileName, sha256Hex, checkFileBytes, fileLine, fileMarkdown, filesInText, type AttachmentKind } from "./note-files";

export type SavedAttachment = { id: string; ref: string; fileName: string; mimeType: string; byteSize: number; sha256: string };

// A file from bytes onto one of the learner's notes. Once per clientKey: the
// same key again (a retry, a resumed import) gives the file already stored,
// and `created` says whether this call made it.
export async function saveNoteAttachmentBytes(
  profileId: string,
  input: { noteId: string; bytes: Uint8Array; fileName: string; clientKey: string },
): Promise<({ ok: true; file: SavedAttachment; created: boolean }) | { ok: false; error: "invalid" | "unsupported" | "too_large" | "not_found"; message: string }> {
  if (!isClientKey(input.clientKey)) return { ok: false, error: "invalid", message: "That file can't be saved." };
  const info = checkFileBytes(input.bytes);
  if (!info.ok) return info;
  if (!(await ownsNote(profileId, input.noteId))) return { ok: false, error: "not_found", message: "That note doesn't exist any more." };
  const select = { id: true, fileName: true, mimeType: true, byteSize: true, sha256: true } as const;
  const shown = (x: Omit<SavedAttachment, "ref">, created: boolean) => ({ ok: true as const, created, file: { ...x, ref: `${NOTE_FILE_SCHEME}${x.id}` } });
  const where = { profileId_clientKey: { profileId, clientKey: input.clientKey } };
  const existing = await prisma.novaNoteAttachment.findUnique({ where, select });
  if (existing) return shown(existing, false);
  try {
    const made = await prisma.novaNoteAttachment.create({
      data: {
        profileId, noteId: input.noteId, kind: info.kind, fileName: cleanFileName(input.fileName), mimeType: info.mimeType,
        bytes: new Uint8Array(input.bytes), byteSize: input.bytes.length, sha256: sha256Hex(input.bytes), clientKey: input.clientKey,
      },
      select,
    });
    return shown(made, true);
  } catch (err) {
    const again = await prisma.novaNoteAttachment.findUnique({ where, select });
    if (again) return shown(again, false);
    throw err;
  }
}

/** One file, to its owner only. */
export async function readNoteAttachment(profileId: string, id: string): Promise<{ fileName: string; mimeType: string; bytes: Buffer } | null> {
  if (typeof id !== "string" || !/^[a-z0-9]{8,40}$/i.test(id)) return null;
  const row = await prisma.novaNoteAttachment.findFirst({ where: { id, profileId }, select: { fileName: true, mimeType: true, bytes: true } });
  return row ? { fileName: row.fileName, mimeType: row.mimeType, bytes: Buffer.from(row.bytes) } : null;
}

export interface AttachmentRow { id: string; noteId: string; kind: AttachmentKind; fileName: string; mimeType: string; byteSize: number; sha256: string }

/** The files on these notes of the learner's, without their bytes (for previews and counts). */
export async function attachmentsOfNotes(profileId: string, noteIds: string[]): Promise<AttachmentRow[]> {
  if (noteIds.length === 0) return [];
  const rows = await prisma.novaNoteAttachment.findMany({
    where: { profileId, noteId: { in: noteIds } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, noteId: true, kind: true, fileName: true, mimeType: true, byteSize: true, sha256: true },
  });
  return rows.map(r => ({ ...r, kind: r.kind === "other" ? "other" : "document" }));
}

/** The bytes of these files of the learner's (for an export). */
export async function attachmentBytes(profileId: string, ids: string[]): Promise<Map<string, Uint8Array>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.novaNoteAttachment.findMany({ where: { profileId, id: { in: ids } }, select: { id: true, bytes: true } });
  return new Map(rows.map(r => [r.id, new Uint8Array(r.bytes)]));
}

/** Files made by these keys (reading an import back). */
export async function attachmentsByKeys(profileId: string, clientKeys: string[]): Promise<Array<{ id: string; noteId: string; clientKey: string; byteSize: number; sha256: string }>> {
  if (clientKeys.length === 0) return [];
  return prisma.novaNoteAttachment.findMany({ where: { profileId, clientKey: { in: clientKeys } }, select: { id: true, noteId: true, clientKey: true, byteSize: true, sha256: true } });
}

/** Everything the learner keeps here, in bytes (storage accounting). */
export async function noteAttachmentBytes(profileId: string): Promise<number> {
  const r = await prisma.novaNoteAttachment.aggregate({ where: { profileId }, _sum: { byteSize: true } });
  return r._sum.byteSize ?? 0;
}

// The same, for a web account: its own learner (web:<id>) and the Telegram
// chat its profile links, read only (the billing page's usage view).
export async function noteAttachmentBytesForAccount(userId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ bytes: bigint | null }[]>`
    SELECT COALESCE(SUM(a."byteSize"), 0)::bigint AS bytes
    FROM "NovaNoteAttachment" a JOIN "NovaAcademicProfile" p ON p.id = a."profileId" JOIN "MessengerUser" m ON m.id = p."userId"
    WHERE m."platformChatId" = ${`web:${userId}`}
       OR m."platformChatId" = (SELECT "telegramChatId" FROM "UserProfile" WHERE "userId" = ${userId})`;
  return Number(rows[0]?.bytes ?? 0);
}
