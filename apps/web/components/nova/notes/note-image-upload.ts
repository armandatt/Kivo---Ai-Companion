// ─── Screenshots into a note, and to Nova ────────────────────────────────────
// One way for every place a learner gives Kivo an image while working on a
// note: pasted, dropped or chosen into the note itself, or attached in Nova's
// tutor or editor. The image is stored on the note (POST /api/nova/notes/images,
// the server checks the bytes and the owner) and is named from then on by its
// id: in the note's text as ![caption](kivo-image:<id>), and in a request to
// Nova as an id the server reads back for the model. So a follow-up message,
// a reload or a retry still has it, and no conversation or note holds the
// bytes. A retry uses the same clientKey, so it never stores the image twice.

// The server's limit (note-images.ts NOTE_IMAGE_BYTES_MAX), copied: that file
// reads the database and is never bundled for the browser. A test holds the two equal.
export const NOTE_IMAGE_BYTES_MAX = 2_500_000

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp'
// What the browser aims for, a little under the server's limit.
const TARGET_BYTES = Math.floor(NOTE_IMAGE_BYTES_MAX * 0.94)
const SIDES = [2400, 2000, 1600, 1280]

export const isImage = (type: string) => IMAGE_TYPES.includes(type)

// The image as it will be stored: unchanged when it already fits, else drawn
// smaller and sent as JPEG, a step at a time, until it fits. A screenshot of
// a Retina screen is often 4–8 MB as PNG. null: it could not be made to fit.
export async function fitForNote(file: Blob): Promise<Blob | null> {
  if (!isImage(file.type)) return null
  if (file.size <= TARGET_BYTES) return file
  if (typeof createImageBitmap !== 'function') return null
  try {
    const bitmap = await createImageBitmap(file)
    for (const side of SIDES) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      // JPEG has no transparency: a screenshot's clear parts go white, as on the page.
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.86))
      if (blob && blob.size <= TARGET_BYTES) return blob
    }
    return null
  } catch {
    return null
  }
}

export async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export const newImageKey = (prefix: string) =>
  `${prefix}:${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}${Math.random().toString(36).slice(2)}`}`

export type StoreResult = { ok: true; id: string } | { ok: false; message: string; retry: boolean }

// Stores base64 image data on a note. `post` is a seam for the tests.
export async function storeImageData(noteId: string, data: string, clientKey: string, post: typeof fetch = fetch): Promise<StoreResult> {
  try {
    const res = await post('/api/nova/notes/images', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ noteId, data, clientKey }),
    })
    if (res.status === 401) return { ok: false, message: 'Sign in again to add images.', retry: false }
    const body = await res.json().catch(() => null) as { ok?: boolean; image?: { id: string }; error?: string; message?: string } | null
    if (res.ok && body?.ok && body.image) return { ok: true, id: body.image.id }
    // The server's own reason when it gave one; a size or type it refused won't change on a retry.
    const final = body?.error === 'unsupported' || body?.error === 'too_large' || body?.error === 'not_found' || res.status === 413
    return { ok: false, message: body?.message ?? (res.status === 413 ? 'That image is too large.' : 'The image didn’t save. Try again.'), retry: !final }
  } catch {
    return { ok: false, message: 'The image didn’t save: Kivo couldn’t be reached. Try again.', retry: true }
  }
}

// A file into a note: made to fit, then stored. The same key on a retry.
export async function storeImageFile(noteId: string, file: Blob, clientKey: string, post: typeof fetch = fetch): Promise<StoreResult> {
  if (!isImage(file.type)) return { ok: false, message: 'Only PNG, JPEG or WebP images can go in a note.', retry: false }
  const fitted = await fitForNote(file)
  if (!fitted) return { ok: false, message: 'That image is too large to add, even made smaller. Crop it and try again.', retry: false }
  return storeImageData(noteId, await base64Of(fitted), clientKey, post)
}

// The line that puts an image in a note, on a line of its own. Pure.
export function imageMarkdown(id: string, caption = 'Screenshot'): string {
  const alt = caption.split('[').join('').split(']').join('').split('\n').join(' ').trim().slice(0, 120) || 'Screenshot'
  return `![${alt}](kivo-image:${id})`
}

// The text with the lines put in at `at`, each on a line of its own, and
// where the caret goes after them. Pure.
export function insertImageLines(text: string, at: number, lines: string[]): { text: string; caret: number } {
  const pos = Math.max(0, Math.min(at, text.length))
  const before = text.slice(0, pos), after = text.slice(pos)
  const lead = before.length === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const tail = after.length === 0 || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
  const block = `${lead}${lines.join('\n\n')}${tail || '\n'}`
  return { text: `${before}${block}${after}`, caret: before.length + block.length }
}

// The images of earlier requests to send again, so a follow-up can still
// see them: newest first, never one sent now, at most `max` in all. Pure.
export function earlierImages(asks: Array<{ images?: string[] }>, now: string[], max = 4): string[] {
  const out: string[] = []
  for (const a of [...asks].reverse()) for (const id of a.images ?? []) {
    if (out.length + now.length >= max) return out
    if (!now.includes(id) && !out.includes(id)) out.push(id)
  }
  return out
}
