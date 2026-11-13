// The body of a placement request, from the extension or the Drafts page:
// { itemId, draftId?, subjectId?, topicId? }. Ids are opaque strings checked
// later against the learner's own workspace (capture-drafts.ts); here only
// their shape. subjectId null (or absent) on a choice: "file it nowhere".

const id = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 64 ? v : null)

export function readPlaceBody(raw: unknown): { itemId: string; draftId: string | null; subjectId: string | null; topicId: string | null; topicName: string | null } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const b = raw as Record<string, unknown>
  const itemId = id(b.itemId)
  if (!itemId) return null
  const subjectId = id(b.subjectId)
  const topicName = subjectId && typeof b.topicName === "string" && b.topicName.trim() && b.topicName.length <= 200 ? b.topicName.trim() : null
  return { itemId, draftId: id(b.draftId), subjectId, topicId: subjectId ? id(b.topicId) : null, topicName }
}

export const PLACE_STATUS: Record<string, number> = { not_found: 404, busy: 409, unknown_place: 409 }
