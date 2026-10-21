// The words, hints, version differences and message blocks of Build with
// Nova. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { WorkspacePlan } from '@repo/api/nova/product/workspace-plan'
import { diffSummary, familyOf, hintFor, ids, messageBlocks, planDiff, wordsFor } from './builder-view'
import { viewsFor } from './plan-edit'

const plan = (): WorkspacePlan => ({
  version: 1, kind: 'custom', templateId: null, templateVersion: null, category: null,
  title: 'TrackerX', summary: '', prerequisites: [], resources: [], sources: [], assumptions: [],
  subjects: [{ name: 'TrackerX', topics: [{ name: 'Dashboard', explanation: null, sources: [] }] }],
  phases: [{ name: 'Dashboard', subject: 'TrackerX', weeks: null, hoursPerWeek: null, goals: [], exercises: [], project: null, completion: null, resources: [] }],
  tasks: [
    { key: 'a', title: 'Widgets', priority: null, subject: 'TrackerX', topic: 'Dashboard', dueDay: null, estimatedMinutes: null, after: null },
    { key: 'b', title: 'Wire API', priority: null, subject: 'TrackerX', topic: 'Dashboard', dueDay: null, estimatedMinutes: null, after: null },
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
    tasks: [{ ...v1.tasks[0]!, title: 'Finish widgets' }, { key: 'c', title: 'Write tests', priority: 'high', subject: 'TrackerX', topic: 'Dashboard', dueDay: null, estimatedMinutes: null, after: null }],
    dates: [{ ...v1.dates[0]!, day: '2026-12-08' }],
  }
  const d = planDiff(v1, v2)
  assert.deepEqual([...d.fresh], [ids.task('c')])
  assert.deepEqual([...d.changed].sort(), [ids.date('Launch'), ids.task('a')].sort())
  assert.deepEqual(d.removed, ['Wire API'])
  assert.equal(diffSummary(d), '1 new, 2 changed, 1 removed')
  assert.equal(diffSummary(planDiff(v1, v1)), null)
  // A name differing only in case or spacing is the same item.
  assert.equal(planDiff(v1, { ...v1, phases: [{ ...v1.phases[0]!, name: ' dashboard' }] }).fresh.size, 0)
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
