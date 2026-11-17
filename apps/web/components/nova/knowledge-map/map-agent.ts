// What Nova's browser agent may ask of the Knowledge Map, and how the map
// answers: by its own graph (stable node ids such as "topic:…", the edges
// between them, the tree of what sits inside what) and its own actions (the
// same select, explore, step out, zoom and connect a person uses), never by
// screen positions, which change with every zoom, pan and layout.
//
// The extension reaches it through one hidden element on the map page,
// [data-kivo-map-bridge]: it sends a request as a JSON string in a
// "kivo-map:request" event, the map runs it at once (events are synchronous)
// and writes the answer, as JSON, to the element's data-response. Text in,
// text out: nothing else of the page is shared, and the extension's own
// script never runs the map's code. The extension then moves its visible
// pointer to the node's own element ([data-node-id]) and checks the result.
//
// Connecting two cards changes the learner's Kivo, so the extension asks
// them first (agent-tools.js needsConfirmation), and the change goes through
// the same request the map's Connect panel sends (map-connect.ts,
// map-structure-api.ts sendConnect).

import type { MapEdge, MapNode } from '@repo/api/nova/product/knowledge-map.types'
import { connectOptions, type ConnectRequest } from './map-connect'

export type MapAgentOp = 'describe' | 'select' | 'open' | 'related' | 'parent' | 'follow' | 'zoom' | 'pan' | 'whole' | 'connect'
// preview (connect only): say what the connection would do, change nothing (the approval card shows it).
export interface MapAgentRequest { op: MapAgentOp; id?: string; to?: string; query?: string; factor?: number; dx?: number; dy?: number; option?: string; preview?: boolean }
export interface MapAgentAnswer { ok: boolean; result: string; node?: string | null; nodes?: Array<Record<string, unknown>>; edges?: Array<Record<string, unknown>>; options?: Array<{ key: string; label: string; detail: string }>; pending?: Promise<unknown> }

type Tree = { children: ReadonlyMap<string, readonly string[]>; parent: ReadonlyMap<string, string> }

export interface MapAgentContext {
  nodes: readonly MapNode[]
  edges: readonly MapEdge[]
  tree: Tree
  selected: string | null
  focus: string | null           // the card being explored, null on the whole map
  drawn: ReadonlySet<string>     // the cards drawn in the view now
  zoom: number
  pick: (id: string) => void     // select, reveal and bring into view (the map's own search does this)
  explore: (id: string) => void
  canExplore: (id: string) => boolean
  goUp: () => void
  goWhole: () => void
  zoomBy: (factor: number) => void
  panBy: (dx: number, dy: number) => void
  connect: (request: ConnectRequest, label: string) => Promise<{ ok: boolean; said: string }>
}

const RELATION: Record<MapEdge['kind'], [string, string]> = {
  contains: ['contains subject', 'is inside subject'], has_topic: ['has topic', 'is a topic of'], subtopic: ['has subtopic', 'is a subtopic of'],
  has_task: ['has task', 'is a task under'], step: ['has step', 'is a step of'], depends_on: ['waits on', 'is waited on by'],
  about_topic: ['has filed', 'is filed under topic'], filed_under: ['has filed', 'is filed under subject'], links_to: ['links to', 'is linked from'],
}

const words = (s: string) => s.toLowerCase().split(' ').map(w => w.trim()).filter(w => w.length > 1)
const summary = (n: MapNode, ctx: MapAgentContext) => ({
  id: n.id, type: n.type, label: n.label,
  parent: ctx.tree.parent.get(n.id) ?? null,
  inside: ctx.tree.children.get(n.id)?.length ?? 0,
  ...(ctx.selected === n.id ? { selected: true } : {}),
  ...(ctx.drawn.has(n.id) ? { drawn: true } : {}),
})

/** One node's connections, as relationships. */
export function connectionsOf(ctx: Pick<MapAgentContext, 'nodes' | 'edges'>, id: string): Array<{ id: string; label: string; type: string; relation: string; edge: string }> {
  const byId = new Map(ctx.nodes.map(n => [n.id, n]))
  const out = []
  for (const e of ctx.edges) {
    const other = e.from === id ? e.to : e.to === id ? e.from : null
    const n = other ? byId.get(other) : null
    if (n) out.push({ id: n.id, label: n.label, type: n.type, relation: RELATION[e.kind][e.from === id ? 0 : 1], edge: e.id })
  }
  return out
}

/** Runs one request on the map. Never throws; an unknown id says so. */
export function runMapRequest(req: MapAgentRequest, ctx: MapAgentContext): MapAgentAnswer {
  const byId = new Map(ctx.nodes.map(n => [n.id, n]))
  const need = (id: string | undefined): MapNode | null => (id ? byId.get(id) ?? null : null)
  const missing = (id: string | undefined): MapAgentAnswer => ({ ok: false, result: `No card "${id ?? ''}" is on the map. Use describe with words from its name to find its id.` })

  switch (req.op) {
    case 'describe': {
      const q = words(req.query ?? '')
      const pool = q.length
        ? ctx.nodes.filter(n => { const l = n.label.toLowerCase(); return q.every(w => l.includes(w)) }).slice(0, 25)
        : [...ctx.nodes.filter(n => n.id === ctx.selected), ...ctx.nodes.filter(n => ctx.drawn.has(n.id) && n.id !== ctx.selected)].slice(0, 60)
      const ids = new Set(pool.map(n => n.id))
      const edges = ctx.edges.filter(e => ids.has(e.from) || ids.has(e.to)).slice(0, 80).map(e => ({ id: e.id, from: e.from, to: e.to, kind: e.kind }))
      const where = ctx.focus ? `exploring inside "${byId.get(ctx.focus)?.label ?? ctx.focus}"` : 'on the whole map'
      return { ok: true, result: `${q.length ? `${pool.length} card${pool.length === 1 ? '' : 's'} match` : `${pool.length} card${pool.length === 1 ? '' : 's'} in view`}; ${where}; zoom ${Math.round(ctx.zoom * 100)}%${ctx.selected ? `; selected "${byId.get(ctx.selected)?.label}"` : ''}.`, nodes: pool.map(n => summary(n, ctx)), edges }
    }
    case 'select': {
      const n = need(req.id); if (!n) return missing(req.id)
      ctx.pick(n.id)
      return { ok: true, result: `Selected "${n.label}" and brought it into view.`, node: n.id }
    }
    case 'open': {
      const n = need(req.id); if (!n) return missing(req.id)
      if (ctx.canExplore(n.id)) { ctx.explore(n.id); return { ok: true, result: `Opened "${n.label}": the map now shows what is inside it.`, node: n.id } }
      ctx.pick(n.id)
      return { ok: true, result: `"${n.label}" has nothing inside to open, so it is selected with its details shown.`, node: n.id }
    }
    case 'related': {
      const n = need(req.id); if (!n) return missing(req.id)
      ctx.pick(n.id)
      const all = connectionsOf(ctx, n.id)
      return { ok: true, result: all.length ? `"${n.label}" is connected to ${all.length} card${all.length === 1 ? '' : 's'}: ${all.slice(0, 20).map(c => `${c.relation} ${c.type} "${c.label}" (${c.id})`).join('; ')}.` : `Nothing is connected to "${n.label}".`, node: n.id, nodes: all.map(c => ({ ...c })) }
    }
    case 'parent': {
      const id = req.id ?? ctx.selected ?? ctx.focus
      const n = need(id ?? undefined)
      if (!n) { if (ctx.focus) { ctx.goUp(); return { ok: true, result: 'Stepped out one level.' } } return { ok: false, result: 'Select a card first, or name one by its id.' } }
      const p = ctx.tree.parent.get(n.id)
      if (!p || !byId.has(p)) return { ok: false, result: `"${n.label}" sits at the top: it has no parent.`, node: n.id }
      ctx.pick(p)
      return { ok: true, result: `Moved to "${byId.get(p)!.label}", which "${n.label}" sits inside.`, node: p }
    }
    case 'follow': {
      const a = need(req.id), b = need(req.to)
      if (!a) return missing(req.id)
      if (!b) return missing(req.to)
      const e = ctx.edges.find(x => (x.from === a.id && x.to === b.id) || (x.from === b.id && x.to === a.id))
      if (!e) return { ok: false, result: `"${a.label}" and "${b.label}" are not directly connected. Use related on one of them to see its connections.`, node: a.id }
      ctx.pick(b.id)
      return { ok: true, result: `Followed the connection: "${a.label}" ${RELATION[e.kind][e.from === a.id ? 0 : 1]} "${b.label}"; now on "${b.label}".`, node: b.id }
    }
    case 'zoom': {
      const f = Math.min(2, Math.max(0.5, Number(req.factor) || 1))
      ctx.zoomBy(f)
      return { ok: true, result: `Zoomed ${f > 1 ? 'in' : 'out'} (now about ${Math.round(ctx.zoom * f * 100)}%).` }
    }
    case 'pan': {
      const dx = Math.max(-800, Math.min(800, Number(req.dx) || 0)), dy = Math.max(-800, Math.min(800, Number(req.dy) || 0))
      ctx.panBy(dx, dy)
      return { ok: true, result: `Moved the view by ${dx}, ${dy}.` }
    }
    case 'whole': {
      ctx.goWhole()
      return { ok: true, result: 'Back to the whole map.' }
    }
    case 'connect': {
      const a = need(req.id), b = need(req.to)
      if (!a) return missing(req.id)
      if (!b) return missing(req.to)
      const options = connectOptions(a, b, { nodes: ctx.nodes, edges: ctx.edges, tree: ctx.tree })
      const usable = options.filter(o => !o.blocked && o.request)
      if (!usable.length) return { ok: false, result: options[0]?.blocked ? `They can't be connected: ${options[0].blocked}` : `"${a.label}" can't be connected to "${b.label}" (from a ${a.type} to a ${b.type}).` }
      const chosen = req.option ? usable.find(o => o.key === req.option) : usable.length === 1 ? usable[0] : null
      if (!chosen) return { ok: false, result: `There is more than one way to connect them; choose one by its key.`, options: usable.map(o => ({ key: o.key, label: o.label, detail: o.detail })) }
      const end = (t: string) => (t.trim().endsWith('.') ? t.trim() : `${t.trim()}.`)
      if (req.preview) return { ok: true, result: `“${a.label}” and “${b.label}”: ${end(chosen.detail)}${chosen.moves ? ` This moves it: ${end(chosen.moves)}` : ''}`, node: b.id }
      const pending = ctx.connect(chosen.request!, chosen.request!.route === 'file' ? a.label : b.label)
      return { ok: true, result: `Connecting "${a.label}" and "${b.label}": ${chosen.detail}${chosen.moves ? ` (${chosen.moves})` : ''}.`, node: b.id, pending }
    }
    default: return { ok: false, result: 'The map does not do that.' }
  }
}
