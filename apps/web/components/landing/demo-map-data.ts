import type { MapEdge, MapNode } from '@repo/api/nova/product/knowledge-map.types'

// A sample learner's Knowledge Map, in the shapes the map's own API returns
// (knowledge-map.types.ts), for the landing page's preview. Read only and
// local: nothing here is anyone's data, and nothing is sent anywhere. Three
// subjects, one of them inside another, topics with topics inside them, a
// note that links to a topic, a saved page and a task, so the preview shows
// every kind of card and link the real map draws.

const NOW = '2026-10-20T10:00:00Z'
const base = { href: null }

const subject = (id: string, label: string, counts: { topics: number; notes?: number; resources?: number }, parentId?: string): MapNode => ({
  ...base, id: `subject:${id}`, type: 'subject', label, subjectId: id, topics: counts.topics, notes: counts.notes ?? 0, resources: counts.resources ?? 0, ...(parentId ? { parentId } : {}),
})
const topic = (id: string, label: string, subjectId: string, subjectName: string, o: { level?: 'weak' | 'developing' | 'solid'; pct?: number; sessions?: number; notes?: number; resources?: number; parentId?: string; organises?: boolean } = {}): MapNode => ({
  ...base, id: `topic:${id}`, type: 'topic', label, subjectId, subjectName, sessions: o.sessions ?? 0,
  level: o.level ?? null, masteryPercent: o.pct ?? null, notes: o.notes ?? 0, resources: o.resources ?? 0,
  ...(o.parentId ? { parentId: o.parentId } : {}), ...(o.organises ? { studied: false } : {}),
})

export const DEMO_NODES: MapNode[] = [
  subject('ml', 'Machine Learning', { topics: 3, resources: 1 }),
  subject('dl', 'Deep Learning', { topics: 4, notes: 1 }, 'ml'),
  subject('os', 'Operating Systems', { topics: 5, notes: 1 }),
  subject('fin', 'Corporate Finance', { topics: 3 }),

  topic('linreg', 'Linear regression', 'ml', 'Machine Learning', { level: 'solid', pct: 82, sessions: 6 }),
  topic('gd', 'Gradient descent', 'ml', 'Machine Learning', { level: 'developing', pct: 48, sessions: 3, resources: 1 }),
  topic('reg', 'Regularization', 'ml', 'Machine Learning'),

  topic('nn', 'Neural networks', 'dl', 'Deep Learning', { organises: true }),
  topic('backprop', 'Backpropagation', 'dl', 'Deep Learning', { level: 'developing', pct: 41, sessions: 2, parentId: 'topic:nn' }),
  topic('act', 'Activation functions', 'dl', 'Deep Learning', { parentId: 'topic:nn' }),
  topic('tf', 'Transformers', 'dl', 'Deep Learning', { level: 'weak', pct: 22, sessions: 1, notes: 1 }),

  topic('proc', 'Processes', 'os', 'Operating Systems', { organises: true }),
  topic('sched', 'CPU scheduling', 'os', 'Operating Systems', { level: 'solid', pct: 76, sessions: 4, parentId: 'topic:proc' }),
  topic('threads', 'Threads', 'os', 'Operating Systems', { level: 'developing', pct: 55, sessions: 2, parentId: 'topic:proc' }),
  topic('dead', 'Deadlocks', 'os', 'Operating Systems', { level: 'weak', pct: 30, sessions: 2, notes: 1 }),
  topic('mem', 'Virtual memory', 'os', 'Operating Systems'),

  topic('tvm', 'Time value of money', 'fin', 'Corporate Finance', { level: 'solid', pct: 71, sessions: 3 }),
  topic('wacc', 'WACC', 'fin', 'Corporate Finance', { level: 'developing', pct: 38, sessions: 1 }),
  topic('capb', 'Capital budgeting', 'fin', 'Corporate Finance'),

  { ...base, id: 'note:attention', type: 'note', label: 'Attention Is All You Need', subjectId: 'dl', subjectName: 'Deep Learning', topicName: 'Transformers', topicLinked: true, updatedAt: NOW },
  { ...base, id: 'note:bankers', type: 'note', label: 'Banker’s algorithm', subjectId: 'os', subjectName: 'Operating Systems', topicName: 'Deadlocks', topicLinked: true, updatedAt: NOW },
  { ...base, id: 'resource:gd', type: 'resource', label: 'Gradient descent, visually', subjectId: 'ml', subjectName: 'Machine Learning', topicName: 'Gradient descent', topicLinked: true, url: 'https://example.org/gd', domain: 'example.org', savedAt: NOW, kind: 'saved', filedBy: 'learner' },
  { ...base, id: 'task:ps3', type: 'task', label: 'Problem set 3', subjectId: 'os', subjectName: 'Operating Systems', topicName: 'Deadlocks', status: 'todo', priority: 'high', dueDay: '2026-10-24', estimatedMinutes: 60, order: 0, waitsOn: 0 },
]

const e = (from: string, to: string, kind: MapEdge['kind']): MapEdge => ({ id: `${kind}:${from}>${to}`, from, to, kind })

export const DEMO_EDGES: MapEdge[] = [
  e('subject:ml', 'subject:dl', 'contains'),
  e('subject:ml', 'topic:linreg', 'has_topic'), e('subject:ml', 'topic:gd', 'has_topic'), e('subject:ml', 'topic:reg', 'has_topic'),
  e('subject:dl', 'topic:nn', 'has_topic'), e('subject:dl', 'topic:tf', 'has_topic'),
  e('topic:nn', 'topic:backprop', 'subtopic'), e('topic:nn', 'topic:act', 'subtopic'),
  e('subject:os', 'topic:proc', 'has_topic'), e('subject:os', 'topic:dead', 'has_topic'), e('subject:os', 'topic:mem', 'has_topic'),
  e('topic:proc', 'topic:sched', 'subtopic'), e('topic:proc', 'topic:threads', 'subtopic'),
  e('subject:fin', 'topic:tvm', 'has_topic'), e('subject:fin', 'topic:wacc', 'has_topic'), e('subject:fin', 'topic:capb', 'has_topic'),
  e('topic:tf', 'note:attention', 'about_topic'),
  e('topic:dead', 'note:bankers', 'about_topic'),
  e('topic:gd', 'resource:gd', 'about_topic'),
  e('topic:dead', 'task:ps3', 'has_task'),
  // A [[link]] written in a note: drawn, never laid out.
  e('note:bankers', 'topic:threads', 'links_to'),
  e('note:attention', 'topic:backprop', 'links_to'),
]
