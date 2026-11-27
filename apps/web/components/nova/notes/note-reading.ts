// How a note reads (bug batch 28 Nov, item 10): a font (sans, serif or mono)
// and a size (S, M, L), saved on the learner's profile
// (GET/PUT /api/nova/notes/reading) and remembered in this browser so the
// first paint is right. Pure classes here; note-body.tsx applies them.
//
// The reading measure: system-ui (Inter where installed), 16.5px at M, line
// height 1.65, at most about 70 characters a line. Serif and mono keep the
// same measure and rhythm.

export type ReadingFont = 'sans' | 'serif' | 'mono'
export type ReadingSize = 's' | 'm' | 'l'
export type Reading = { font: ReadingFont; size: ReadingSize }
export const DEFAULT_READING: Reading = { font: 'sans', size: 'm' }

export const FONT_LABEL: Record<ReadingFont, string> = { sans: 'Sans', serif: 'Serif', mono: 'Mono' }
export const SIZE_LABEL: Record<ReadingSize, string> = { s: 'S', m: 'M', l: 'L' }

const SIZE_PX: Record<ReadingSize, string> = { s: 'text-[15px]', m: 'text-[16.5px]', l: 'text-[18px]' }
const FONT_CLASS: Record<ReadingFont, string> = {
  sans: 'note-read-sans',
  serif: 'font-serif',
  // Mono-friendly: a monospace face, a touch smaller, the same line height.
  mono: 'font-mono tracking-[-0.01em]',
}

export function parseReading(raw: unknown): Reading | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const font = (['sans', 'serif', 'mono'] as const).find(f => f === r.font)
  const size = (['s', 'm', 'l'] as const).find(s => s === r.size)
  return font && size ? { font, size } : null
}

// The classes for a full note (not the compact previews).
export function readingClasses(r: Reading): string {
  const size = r.font === 'mono' ? { s: 'text-[14px]', m: 'text-[15px]', l: 'text-[16.5px]' }[r.size] : SIZE_PX[r.size]
  return `${FONT_CLASS[r.font]} ${size} leading-[1.65] max-w-[70ch] [&_p]:my-3.5`
}

const KEY = 'kivo-note-reading'
export function rememberedReading(): Reading | null {
  try { return parseReading(JSON.parse(window.localStorage.getItem(KEY) ?? 'null')) } catch { return null }
}
export function rememberReading(r: Reading) { try { window.localStorage.setItem(KEY, JSON.stringify(r)) } catch { /* storage off */ } }

export async function loadReading(): Promise<Reading | null> {
  try { const b = await (await fetch('/api/nova/notes/reading', { cache: 'no-store' })).json() as { ok?: boolean; reading?: unknown }; return b.ok ? parseReading(b.reading) : null } catch { return null }
}
export async function saveReading(r: Reading): Promise<boolean> {
  try { const res = await fetch('/api/nova/notes/reading', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r) }); return res.ok } catch { return false }
}
