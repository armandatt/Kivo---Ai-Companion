// The words, hints, version differences and message blocks of Build with
// Nova. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { WorkspacePlan } from '@repo/api/nova/product/workspace-plan'
import { changeMarks, diffSummary, familyOf, hintFor, ids, mapDestinations, messageBlocks, nestRows, planDiff, planSubjects, subjectOutline, topicOutline, touchedSubjects, wordsFor } from './builder-view'
import type { ChangeSet, DraftView, WorkspaceDetail } from '@repo/api/nova/product/builder.types'
import { viewsFor } from './plan-edit'

const plan = (): WorkspacePlan => ({
  version: 2, kind: 'custom', templateId: null, templateVersion: null, category: null,
  title: 'TrackerX', summary: '', prerequisites: [], resources: [], sources: [], assumptions: [],
  subjects: [{ name: 'TrackerX', topics: [{ name: 'Dashboard', explanation: null, sources: [], kind: 'milestone', milestone: { weeks: null, hoursPerWeek: null, goals: [], exercises: [], project: null, completion: null, resources: [] } }] }],
  tasks: [
    { key: 'a', title: 'Widgets', priority: null, subject: 'TrackerX', topic: 'Dashboard', dueDay: null, estimatedMinutes: null, after: [] },
    { key: 'b', title: 'Wire API', priority: null, subject: 'TrackerX', topic: 'Dashboard', dueDay: null, estimatedMinutes: null, after: [] },
  ],
  notes: [], dates: [{ title: 'Launch', subject: 'TrackerX', kind: 'project', day: '2026-12-01' }],
})

test('a project is never shown academic words, and a study plan never project ones', () => {
  const project = wordsFor('project')
  const exam = wordsFor('exam')
  const projectWords = [...Object.values(project.views), project.areas, project.topics, project.writing, project.revising, ...viewsFor(plan()).map(v => hintFor('project', v).text)].join(' ').toLowerCase()
  for (const w of ['subject', 'syllabus', 'revision', 'exam', 'study']) assert.ok(!projectWords.includes(w), `project wording says "${w}"`)
  const examWords = [...Object.values(exam.views), exam.phases, exam.writing, ...viewsFor(plan()).map(v => hintFor('semester', v).text)].join(' ').toLowerCase()
  for (const w of ['deliverable', 'release', 'action item']) assert.ok(!examWords.includes(w), `study wording says "${w}"`)
  assert.equal(exam.views.topics, 'Subjects')
  assert.equal(project.views.roadmap, 'Milestones')
  assert.equal(familyOf('career'), 'work')
  assert.equal(familyOf(null), 'general')
})

test('every view has a hint for every kind of work, and hints start a sentence without sending it', () => {
  for (const kind of ['exam', 'semester', 'project', 'skill', 'work', 'career', 'other', null] as const) {
    for (const v of ['overview', 'roadmap', 'board', 'topics', 'timeline', 'notes'] as const) {
      const h = hintFor(kind, v)
      assert.ok(h.text.startsWith('Ask Nova to '), `${kind}/${v}`)
      assert.ok(h.prefill.length > 0 && !h.prefill.trim().endsWith('.'), `${kind}/${v} prefill reads as a start`)
    }
  }
})

test('the first version is all new; a later one marks only what moved, and names what went', () => {
  const v1 = plan()
  const first = planDiff(null, v1)
  assert.ok(first.fresh.has(ids.task('a')) && first.fresh.has(ids.phase('Dashboard')) && first.fresh.has(ids.date('Launch')))
  const v2: WorkspacePlan = {
    ...v1,
    tasks: [{ ...v1.tasks[0]!, title: 'Finish widgets' }, { key: 'c', title: 'Write tests', priority: 'high', subject: 'TrackerX', topic: 'Dashboard', dueDay: null, estimatedMinutes: null, after: [] }],
    dates: [{ ...v1.dates[0]!, day: '2026-12-08' }],
  }
  const d = planDiff(v1, v2)
  assert.deepEqual([...d.fresh], [ids.task('c')])
  assert.deepEqual([...d.changed].sort(), [ids.date('Launch'), ids.task('a')].sort())
  assert.deepEqual(d.removed, ['Wire API'])
  assert.equal(diffSummary(d), '1 new, 2 changed, 1 removed')
  assert.equal(diffSummary(planDiff(v1, v1)), null)
  // A name differing only in case or spacing is the same item.
  assert.equal(planDiff(v1, { ...v1, subjects: [{ ...v1.subjects[0]!, topics: [{ ...v1.subjects[0]!.topics[0]!, name: ' dashboard' }] }] }).fresh.size, 0)
})

test("Nova's reply becomes paragraphs and lists, with bold kept as a span", () => {
  const blocks = messageBlocks('Here is the plan.\n\n- **Week 1**: auth\n- Week 2: API\n\n1. Ship\n2) Review\nThanks')
  assert.deepEqual(blocks.map(b => b.type), ['p', 'ul', 'ol', 'p'])
  assert.deepEqual(blocks[1], { type: 'ul', items: [[{ text: 'Week 1', strong: true }, { text: ': auth', strong: false }], [{ text: 'Week 2: API', strong: false }]] })
  assert.equal(blocks[2]!.type === 'ol' && blocks[2]!.items.length, 2)
  // Lines of one paragraph stay one paragraph; an unmatched ** is text.
  assert.deepEqual(messageBlocks('a\nb'), [{ type: 'p', lines: [[{ text: 'a', strong: false }], [{ text: 'b', strong: false }]] }])
  assert.deepEqual(messageBlocks('2 ** 3'), [{ type: 'p', lines: [[{ text: '2 ** 3', strong: false }]] }])
  // A year at the start of a line is not a list.
  assert.equal(messageBlocks('2027. GATE')[0]!.type, 'p')
})

test('after approval the map opens on what was stored: its workspace, or for subjects of no workspace one place each; nothing before it is saved', () => {
  const current = (subjects: Array<{ id: string; name: string }>): WorkspaceDetail => ({ workspace: null, title: 'x', subjects: subjects.map(x => ({ ...x, topics: [] })), tasks: [], notes: [], dates: [] })
  const view = (status: DraftView['status'], subjects: Array<{ id: string; name: string }>) => ({ status, current: current(subjects) })
  assert.deepEqual(mapDestinations(view('ready', [{ id: 's1', name: 'DSA' }])), [{ label: 'DSA', href: '/map?workspace=all&focus=subject%3As1' }])
  // A workspace opens as its own map, one place whatever its subjects.
  const ws = { status: 'ready' as const, current: { ...current([{ id: 's1', name: 'DSA' }, { id: 's2', name: 'OS' }]), workspace: { id: 'w1', title: 'Sem 5', kind: 'custom' as const, templateId: null, templateName: null, summary: null, createdAt: '', subjects: [] } } }
  assert.deepEqual(mapDestinations(ws), [{ label: 'Sem 5', href: '/map?workspace=w1' }])
  assert.deepEqual(mapDestinations(ws, ['s2']), [{ label: 'Sem 5', href: '/map?workspace=w1&focus=subject%3As2' }])
  assert.equal(mapDestinations(view('ready', [{ id: 's1', name: 'DSA' }, { id: 's2', name: 'OS' }])).length, 2)
  for (const status of ['awaiting_approval', 'building', 'failed'] as const) assert.deepEqual(mapDestinations(view(status, [{ id: 's1', name: 'DSA' }])), [])
  assert.deepEqual(mapDestinations({ status: 'ready', current: null }), [])
})

test('proposed changes are marked on the records they change', () => {
  const set: ChangeSet = { dropped: [], ops: [
    { op: 'add_topics', subjectId: 's1', names: ['Heaps'], id: 'c1', says: '', effect: 'add', why: null },
    { op: 'add_topics', subjectId: 's1', names: ['Tries'], id: 'c2', says: '', effect: 'add', why: null },
    { op: 'remove_topic', topicId: 't3', id: 'c3', says: '', effect: 'remove', why: null },
    { op: 'update_task', taskId: 'k1', dueDay: '2026-11-08', priority: 'high', id: 'c4', says: '', effect: 'change', why: null },
    { op: 'order_tasks', taskIds: ['k3', 'k1'], id: 'c5', says: '', effect: 'change', why: null },
    { op: 'update_date', dateId: 'd1', day: '2026-11-27', id: 'c6', says: '', effect: 'change', why: null },
  ] }
  const m = changeMarks(set)
  assert.deepEqual(m.addedTopics.get('s1'), ['Heaps', 'Tries'])
  assert.ok(m.removedTopics.has('t3'))
  assert.equal(m.changedTasks.get('k1'), 'due 2026-11-08, high priority')
  assert.deepEqual(m.firstTasks, ['k3', 'k1'])
  assert.equal(m.movedDates.get('d1'), '2026-11-27')
  assert.equal(changeMarks(null).addedTasks.length, 0)
})

test('changes go to the map where they were made: the subjects they touch', () => {
  const current: WorkspaceDetail = {
    workspace: null, title: 'DSA',
    subjects: [{ id: 's1', name: 'Linear', topics: [{ id: 't1', name: 'Arrays' }] }, { id: 's2', name: 'Non-linear', topics: [{ id: 't2', name: 'Trees' }] }],
    tasks: [{ id: 'k1', title: 'x', status: 'todo', priority: null, dueDay: null, subjectId: 's2', topicName: null, estimatedMinutes: null, parentId: null }], notes: [], dates: [],
  }
  const changes: ChangeSet = { dropped: [], ops: [
    { op: 'add_topics', subjectId: 's2', names: ['Dynamic programming'], id: 'c1', says: '', effect: 'add', why: null },
    { op: 'update_task', taskId: 'k1', priority: 'high', id: 'c2', says: '', effect: 'change', why: null },
  ] }
  const touched = touchedSubjects({ changes, current })
  assert.deepEqual(touched, ['s2'])
  assert.deepEqual(mapDestinations({ status: 'ready', current }, touched), [{ label: 'Non-linear', href: '/map?workspace=all&focus=subject%3As2' }])
  // A new workspace of several subjects: each is offered.
  assert.equal(mapDestinations({ status: 'ready', current }).length, 2)
})

test('Semester Five: a proposed regroup is drawn as it will be, each subject under the group and marked as moving', () => {
  const names = ['Automata', 'NLP', 'SPM']
  const detail: WorkspaceDetail = { workspace: null, title: 'Semester', subjects: names.map(n => ({ id: n, name: n, parentId: null, topics: [{ id: `${n}-t`, name: 't' }] })), tasks: [], notes: [], dates: [] }
  const op = <T extends object>(o: T, i: number) => ({ ...o, id: `c${i}`, says: '', effect: 'change' as const, why: null })
  const set: ChangeSet = { dropped: [], ops: [
    { ...op({ op: 'add_subject' as const, name: 'Semester Five', topics: [], key: 'sem5' }, 1), effect: 'add' },
    ...names.map((n, i) => op({ op: 'move_subject' as const, subjectId: n, parentKey: 'sem5' }, i + 2)),
  ] }
  const rows = subjectOutline(detail, changeMarks(set))
  assert.deepEqual(rows.map(r => [r.name, r.depth, r.proposed, r.moved, r.under, r.inside]), [
    ['Semester Five', 0, true, false, null, 3],
    ['Automata', 1, false, true, 'Semester Five', 0],
    ['NLP', 1, false, true, 'Semester Five', 0],
    ['SPM', 1, false, true, 'Semester Five', 0],
  ])
  // Nothing proposed: the records as they stand, a subject under the one it is inside.
  detail.subjects[2]!.parentId = 'Automata'
  assert.deepEqual(subjectOutline(detail, changeMarks(null)).map(r => [r.name, r.depth]), [['Automata', 0], ['SPM', 1], ['NLP', 0]])
})

test('a plan lists a subject right under the one it is inside; the map opens on the group, which shows what is inside it', () => {
  const p = plan()
  p.subjects = [{ name: 'NLP', topics: [], parent: 'Semester Five' }, { name: 'Semester Five', topics: [] }, { name: 'Automata', topics: [], parent: 'Semester Five' }]
  assert.deepEqual(planSubjects(p), [{ index: 1, depth: 0, inside: 2 }, { index: 0, depth: 1, inside: 0 }, { index: 2, depth: 1, inside: 0 }])
  const current: WorkspaceDetail = { workspace: null, title: 'x', tasks: [], notes: [], dates: [], subjects: [
    { id: 'g', name: 'Semester Five', parentId: null, topics: [] }, { id: 'a', name: 'Automata', parentId: 'g', topics: [] }, { id: 'n', name: 'NLP', parentId: 'g', topics: [] },
  ] }
  assert.deepEqual(mapDestinations({ status: 'ready', current }), [{ label: 'Semester Five', href: '/map?workspace=all&focus=subject%3Ag' }])
  assert.deepEqual(mapDestinations({ status: 'ready', current }, ['a']), [{ label: 'Semester Five', href: '/map?workspace=all&focus=subject%3Ag' }])
})

test('a parent is drawn holding what sits inside it: Finance with its four phases (Scenario D)', () => {
  const p = { subjects: [{ name: 'Phase 1', parent: 'Finance', topics: [] }, { name: 'Finance', topics: [] }, { name: 'Phase 2', parent: 'Finance', topics: [] }, { name: 'Cooking', topics: [] }] }
  const tree = nestRows(planSubjects(p))
  assert.deepEqual(tree.map(n => p.subjects[n.row.index]!.name), ['Finance', 'Cooking'])
  assert.deepEqual(tree[0]!.inside.map(n => p.subjects[n.row.index]!.name), ['Phase 1', 'Phase 2'])
  // Deeper levels nest too; a row after a deeper one goes back up.
  const rows = [{ name: 'A', depth: 0 }, { name: 'B', depth: 1 }, { name: 'C', depth: 2 }, { name: 'D', depth: 1 }, { name: 'E', depth: 0 }]
  const nested = nestRows(rows)
  assert.deepEqual(nested.map(n => n.row.name), ['A', 'E'])
  assert.deepEqual(nested[0]!.inside.map(n => n.row.name), ['B', 'D'])
  assert.deepEqual(nested[0]!.inside[0]!.inside.map(n => n.row.name), ['C'])
})

test('proposed topic changes are drawn where they go: four phases moved inside Finance, new topics inside a new one', () => {
  const subject = { id: 's', topics: [
    { id: 'fin', name: 'Finance', parentId: null }, { id: 'p1', name: 'Phase 1', parentId: null }, { id: 'p2', name: 'Phase 2', parentId: null },
    { id: 'bud', name: 'Budgeting', parentId: 'p1' }, { id: 'old', name: 'Old notes', parentId: null },
  ] }
  const set = { dropped: [], ops: [
    { id: 'c1', op: 'move_topic', topicId: 'p1', parentId: 'fin', says: '', effect: 'change', why: null },
    { id: 'c2', op: 'move_topic', topicId: 'p2', parentId: 'fin', says: '', effect: 'change', why: null },
    { id: 'c3', op: 'add_topics', subjectId: 's', names: ['Phase 3'], keys: ['p3'], parentId: 'fin', kind: 'milestone', says: '', effect: 'add', why: null },
    { id: 'c4', op: 'add_topics', subjectId: 's', names: ['Index funds'], parentKey: 'p3', says: '', effect: 'add', why: null },
    { id: 'c5', op: 'add_topics', subjectId: 'other', names: ['Elsewhere'], says: '', effect: 'add', why: null },
    { id: 'c6', op: 'remove_topic', topicId: 'old', says: '', effect: 'remove', why: null },
  ] } as unknown as ChangeSet
  const rows = topicOutline(subject, set)
  assert.deepEqual(rows.map(r => `${'  '.repeat(r.depth)}${r.name}:${r.state}`), [
    'Finance:same', '  Phase 1:moved', '    Budgeting:same', '  Phase 2:moved', '  Phase 3:added', '    Index funds:added', 'Old notes:removed',
  ])
  const p1 = rows.find(r => r.name === 'Phase 1')!
  assert.equal(p1.under, 'Finance')
  assert.equal(p1.was, 'the top')
  assert.equal(p1.id, 'p1')
  assert.equal(rows.find(r => r.name === 'Phase 3')!.id, null)
  assert.ok(rows.find(r => r.name === 'Finance')!.holds)
  // Nothing proposed: the tree as stored.
  assert.deepEqual(topicOutline(subject, null).map(r => `${r.depth}${r.name}`), ['0Finance', '0Phase 1', '1Budgeting', '0Phase 2', '0Old notes'])
})

test('a move with a place puts the topic there among those beside it', () => {
  const subject = { id: 's', topics: [{ id: 'a', name: 'A', parentId: null }, { id: 'b', name: 'B', parentId: null }, { id: 'c', name: 'C', parentId: null }] }
  const set = { dropped: [], ops: [{ id: 'c1', op: 'move_topic', topicId: 'c', parentId: null, index: 0, says: '', effect: 'change', why: null }] } as unknown as ChangeSet
  assert.deepEqual(topicOutline(subject, set).map(r => r.name), ['C', 'A', 'B'])
})
