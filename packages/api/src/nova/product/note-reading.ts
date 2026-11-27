// How a learner reads notes (bug batch 28 Nov, item 10): a font and a size,
// kept on their profile so it follows them to every device.

import { prisma } from "@repo/db/client";

export const READING_FONTS = ["sans", "serif", "mono"] as const;
export const READING_SIZES = ["s", "m", "l"] as const;
export type NoteReading = { font: typeof READING_FONTS[number]; size: typeof READING_SIZES[number] };
export const DEFAULT_READING: NoteReading = { font: "sans", size: "m" };

export function parseReading(raw: unknown): NoteReading | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const font = READING_FONTS.find(f => f === r.font), size = READING_SIZES.find(s => s === r.size);
  return font && size ? { font, size } : null;
}
const fromStored = (s: string | null | undefined): NoteReading => {
  const [font, size] = (s ?? "").split(":");
  return parseReading({ font, size }) ?? DEFAULT_READING;
};

export async function loadNoteReading(profileId: string): Promise<NoteReading> {
  const p = await prisma.novaAcademicProfile.findUnique({ where: { id: profileId }, select: { noteReading: true } });
  return fromStored(p?.noteReading);
}

export async function saveNoteReading(profileId: string, raw: unknown): Promise<NoteReading | null> {
  const r = parseReading(raw);
  if (!r) return null;
  await prisma.novaAcademicProfile.update({ where: { id: profileId }, data: { noteReading: `${r.font}:${r.size}` } });
  return r;
}
