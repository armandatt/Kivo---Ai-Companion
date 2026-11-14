// ─── A note's opening words, for the map's inspector ─────────────────────────
// Read through the ordinary note route (GET /api/nova/notes/:id, the learner's
// own note only) when a note card is opened, and shown as plain text. The map
// stores nothing and sends no note text anywhere.

// The first words of a Markdown body as plain text: no headings' marks, no
// list or quote marks, no links' addresses, no images, no code fences.
export function previewText(body: string, max = 220): string {
  const text = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, t: string, shown?: string) => shown ?? t)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\{[^}]*\}/g, '$1')
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?(\[![a-z]+\]\s*)?|[-*+]\s+(\[[ x]\]\s+)?|\d+\.\s+)/gim, '')
    .replace(/(\*\*|__|==|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

export async function loadNotePreview(id: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/nova/notes/${encodeURIComponent(id)}`, { cache: 'no-store' })
    if (!res.ok) return null
    const json = await res.json() as { ok?: boolean; note?: { body?: string } }
    return json.ok && typeof json.note?.body === 'string' ? previewText(json.note.body) : null
  } catch { return null }
}
