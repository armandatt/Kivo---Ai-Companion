import type { MapLevel, NovaKnowledgeMapReady } from '@repo/api/nova/product/knowledge-map.types'
import type { NovaTaskItem } from '@repo/api/nova/product/tasks.types'
import { topicNode } from './local-graph'

// Where today's work sits on the learner's record: for a plan block or a task
// that names a subject and a topic, that topic's node on the Knowledge Map
// (its level and sessions as the map reports them, the notes and saved pages
// filed under it) and the learner's open tasks on the same topic. Matched by
// subject and name the way the map matches them; a topic the map does not
// have gets nothing. Pure, so it is tested without a page.

export interface TopicRecord {
  // The topic's own place in the Knowledge Space, and on the map.
  knowledgeHref: string | null
  mapHref:       string
  // null: no session stands behind it yet.
  level:         MapLevel | null
  sessions:      number
  notes:         number
  resources:     number
  openTasks:     number
}

const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

export function topicRecord(
  map: Pick<NovaKnowledgeMapReady, 'nodes'>,
  tasks: readonly NovaTaskItem[],
  where: { subjectName: string; topicName: string },
): TopicRecord | null {
  const topic = topicNode(map, where)
  if (!topic) return null
  const openTasks = tasks.filter(t => t.status !== 'done' && norm(t.subjectName) === norm(where.subjectName) && norm(t.topicName) === norm(where.topicName)).length
  return {
    knowledgeHref: topic.href,
    mapHref:       `/map?focus=${encodeURIComponent(topic.id)}`,
    level:         topic.sessions > 0 ? topic.level : null,
    sessions:      topic.sessions,
    notes:         topic.notes,
    resources:     topic.resources,
    openTasks,
  }
}

// The Knowledge Space address of the topic a task names, if the map has it.
export function taskTopicHref(map: Pick<NovaKnowledgeMapReady, 'nodes'> | null, task: Pick<NovaTaskItem, 'subjectName' | 'topicName'>): string | null {
  if (!map || !task.subjectName || !task.topicName) return null
  return topicNode(map, { subjectName: task.subjectName, topicName: task.topicName })?.href ?? null
}
