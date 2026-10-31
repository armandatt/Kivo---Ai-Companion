// What the "add to an existing note" picker works out. Pure.

/**
 * Subjects in their tree order, each with its depth, so a subject inside a
 * subject reads as being inside it. A subject whose parent isn't in the list
 * (or a loop) is listed at the top rather than lost.
 * @param {Array<{ id: string, name: string, parentId?: string | null, topics?: string[] }>} subjects
 */
export function nestedSubjects(subjects) {
  const ids = new Set(subjects.map(s => s.id))
  const kids = new Map()
  for (const s of subjects) {
    const parent = s.parentId && ids.has(s.parentId) && s.parentId !== s.id ? s.parentId : null
    if (!kids.has(parent)) kids.set(parent, [])
    kids.get(parent).push(s)
  }
  const out = [], seen = new Set()
  const walk = (parent, depth) => {
    for (const s of kids.get(parent) ?? []) {
      if (seen.has(s.id)) continue
      seen.add(s.id)
      out.push({ ...s, depth })
      walk(s.id, depth + 1)
    }
  }
  walk(null, 0)
  for (const s of subjects) if (!seen.has(s.id)) { seen.add(s.id); out.push({ ...s, depth: 0 }); walk(s.id, 1) }
  return out
}

/** A subject's name in a select: indented by its depth. */
export const subjectLabel = s => `${'  '.repeat(s.depth)}${s.depth ? '↳ ' : ''}${s.name}`

export function chosenWords(result) {
  if (result.action === 'already_in_note') return { heading: `That passage is already in ${result.note.title}.`, body: 'Nothing was added, so it is there once.' }
  if (result.action === 'created') return { heading: `New note: ${result.note.title}.`, body: 'The passage and where it came from are in it.' }
  return { heading: `Added to ${result.note.title}.`, body: 'A new section at the end, with where it came from. What was already there is as it was.' }
}
