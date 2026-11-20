// ─── A map's own colour ──────────────────────────────────────────────────────
// Each dedicated map has one colour, the same every visit, on every device:
// a subject's map is its subject's colour (subject-color.ts, so the map and
// its cards agree); a workspace's map is chosen from the same palette by its
// id (so renaming it never changes it); Everything has none. The palette is
// the subjects' (tuned for contrast in both themes); the colour marks the
// map's toolbar and its name, and is never the only way the map is named.
// Pure, no imports beyond the palette. Held by map-color.test.ts.

import { subjectColor, type SubjectColor } from '../subject-color'

export interface MapRef { id: string; title: string; kind?: 'workspace' | 'subject' }

export function mapColor(map: MapRef | null | undefined): SubjectColor | null {
  if (!map) return null
  // A subject's map: its subject's colour, by name, as on every other page.
  if (map.kind === 'subject' || map.id.startsWith('subject:')) return subjectColor(map.title)
  // A workspace's map: by its id, which nothing renames.
  return subjectColor(`workspace ${map.id}`)
}
