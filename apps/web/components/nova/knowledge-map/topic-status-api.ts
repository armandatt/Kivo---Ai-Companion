// Where a topic stands, set from the map (bug batch 28 Nov, item 7):
// POST /api/nova/topics/status. The map page writes nothing itself.
export type TopicStatusValue = 'not_started' | 'in_progress' | 'completed'

export async function setTopicStatusOnMap(topicId: string, status: TopicStatusValue): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const r = await fetch('/api/nova/topics/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topicId, status }) })
    const b = await r.json().catch(() => null) as { ok?: boolean; message?: string } | null
    return b?.ok ? { ok: true } : { ok: false, message: b?.message ?? 'That didn’t save. Try again.' }
  } catch { return { ok: false, message: 'That didn’t save. Try again.' } }
}
