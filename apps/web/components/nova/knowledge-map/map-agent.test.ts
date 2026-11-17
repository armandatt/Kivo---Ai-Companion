// Nova's requests to the Knowledge Map (map-agent.ts), against a stand-in map.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MapEdge, MapNode } from '@repo/api/nova/product/knowledge-map.types'
import { connectionsOf, runMapRequest, type MapAgentContext } from './map-agent'

const n = (id: string, type: MapNode['type'], label: string, extra: object = {}) => ({ id, type, label, href: null, subjectId: 's1', ...extra }) as unknown as MapNode
const NODES = [n('subject:s1', 'subject', 'Artificial Intelligence'), n('topic:t1', 'topic', 'Vector Databases', { subjectName: 'Artificial Intelligence' }), n('topic:t2', 'topic', 'HNSW', { subjectName: 'Artificial Intelligence', parentId: 'topic:t1' }), n('note:n1', 'note', 'Layered graphs')]
const EDGES: MapEdge[] = [{ id: 'e1', from: 'subject:s1', to: 'topic:t1', kind: 'has_topic' }, { id: 'e2', from: 'topic:t1', to: 'topic:t2', kind: 'subtopic' }, { id: 'e3', from: 'topic:t2', to: 'note:n1', kind: 'about_topic' }]
const tree = { parent: new Map([['topic:t1', 'subject:s1'], ['topic:t2', 'topic:t1'], ['note:n1', 'topic:t2']]), children: new Map([['subject:s1', ['topic:t1']], ['topic:t1', ['topic:t2']], ['topic:t2', ['note:n1']]]) }
function ctx(over: Partial<MapAgentContext> = {}) {
  const calls: string[] = []
  const c: MapAgentContext = {
    nodes: NODES, edges: EDGES, tree, selected: null, focus: null, drawn: new Set(['subject:s1', 'topic:t1']), zoom: 1,
    pick: id => calls.push(`pick ${id}`), explore: id => calls.push(`explore ${id}`), canExplore: id => (tree.children.get(id)?.length ?? 0) > 0,
    goUp: () => calls.push('up'), goWhole: () => calls.push('whole'), zoomBy: f => calls.push(`zoom ${f}`), panBy: (x, y) => calls.push(`pan ${x} ${y}`),
    connect: async () => { calls.push('connect'); return { ok: true, said: 'Linked.' } }, ...over,
  }
  return { c, calls }
}

test('the map is asked by stable ids and answers with its own actions, never positions', () => {
  const { c, calls } = ctx()
  assert.match(runMapRequest({ op: 'describe', query: 'hnsw' }, c).result, /1 card match/)
  assert.deepEqual(runMapRequest({ op: 'describe', query: 'hnsw' }, c).nodes, [{ id: 'topic:t2', type: 'topic', label: 'HNSW', parent: 'topic:t1', inside: 1 }])
  assert.equal(runMapRequest({ op: 'open', id: 'topic:t1' }, c).ok, true)
  assert.equal(runMapRequest({ op: 'open', id: 'note:n1' }, c).result.includes('nothing inside'), true)
  assert.match(runMapRequest({ op: 'parent', id: 'topic:t2' }, c).result, /Moved to "Vector Databases"/)
  assert.deepEqual(calls, ['explore topic:t1', 'pick note:n1', 'pick topic:t1'])
  assert.equal(runMapRequest({ op: 'select', id: 'topic:nope' }, c).ok, false)
})

test('related lists every connection as a relationship; follow moves along a real edge only', () => {
  const { c, calls } = ctx()
  assert.deepEqual(connectionsOf(c, 'topic:t2').map(x => `${x.relation} ${x.id}`), ['is a subtopic of topic:t1', 'has filed note:n1'])
  assert.match(runMapRequest({ op: 'follow', id: 'topic:t2', to: 'note:n1' }, c).result, /"HNSW" has filed "Layered graphs"/)
  assert.equal(runMapRequest({ op: 'follow', id: 'subject:s1', to: 'note:n1' }, c).ok, false, 'not directly connected')
  assert.deepEqual(calls, ['pick note:n1'])
})

test('zoom and pan are bounded; the whole map is one step away', () => {
  const { c, calls } = ctx()
  runMapRequest({ op: 'zoom', factor: 10 }, c); runMapRequest({ op: 'pan', dx: 5000, dy: -20 }, c); runMapRequest({ op: 'whole' }, c)
  assert.deepEqual(calls, ['zoom 2', 'pan 800 -20', 'whole'])
})

test('connect goes through the Connect panel\'s own request, and only for a connection the map allows', async () => {
  const { c, calls } = ctx()
  const no = runMapRequest({ op: 'connect', id: 'note:n1', to: 'topic:t1' }, c)
  assert.equal(no.ok, false, 'a note connects nothing from its own side')
  const preview = runMapRequest({ op: 'connect', id: 'topic:t1', to: 'note:n1', preview: true }, c)
  assert.equal(preview.pending, undefined, 'a preview changes nothing')
  assert.deepEqual(calls, [])
  const yes = runMapRequest({ op: 'connect', id: 'topic:t1', to: 'note:n1' }, c)
  if (yes.ok) { assert.ok(yes.pending); await yes.pending; assert.deepEqual(calls, ['connect']) } else assert.ok(yes.options?.length || /can't/.test(yes.result))
})
