'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Maximize2, Minus, Plus, Search, X } from 'lucide-react'
import type { MapNode, MapNodeType, NovaKnowledgeMapReady } from '@repo/api/nova/product/knowledge-map.types'
import { layoutMap } from './layout'

const TYPES: Array<{ type: MapNodeType; label: string; plural: string }> = [
  { type: 'subject',  label: 'Subject',    plural: 'Subjects' },
  { type: 'topic',    label: 'Topic',      plural: 'Topics' },
  { type: 'note',     label: 'Note',       plural: 'Notes' },
  { type: 'resource', label: 'Saved page', plural: 'Saved pages' },
]
const TYPE_LABEL = Object.fromEntries(TYPES.map(t => [t.type, t.label])) as Record<MapNodeType, string>

// One colour per kind of thing, taken from the theme so both themes work.
const FILL: Record<MapNodeType, string> = {
  subject: 'var(--color-keppel-400)', topic: 'var(--map-topic)', note: 'var(--map-note)', resource: 'var(--map-resource)',
}
const RADIUS: Record<MapNodeType, number> = { subject: 26, topic: 15, note: 9, resource: 9 }
const LEVEL_TEXT = { weak: 'Weak', developing: 'Developing', solid: 'Solid' } as const

const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)
const day   = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

type View = { x: number; y: number; k: number }
const MIN_K = 0.25, MAX_K = 2.5

function Detail({ node, neighbours, onPick, onClose }: { node: MapNode; neighbours: MapNode[]; onPick: (id: string) => void; onClose: () => void }) {
  const facts: Array<[string, string]> = []
  if (node.type === 'subject') {
    facts.push(['Topics', String(node.topics)], ['Notes', String(node.notes)], ['Saved pages', String(node.resources)])
  } else if (node.type === 'topic') {
    facts.push(['Subject', node.subjectName])
    facts.push(['Sessions behind it', node.sessions === 0 ? 'None yet' : String(node.sessions)])
    if (node.level && node.masteryPercent !== null) facts.push(['Your own estimate', `${LEVEL_TEXT[node.level]} · ${node.masteryPercent}%`])
    facts.push(['Notes', String(node.notes)], ['Saved pages', String(node.resources)])
  } else if (node.type === 'note') {
    facts.push(['Subject', node.subjectName ?? 'Not filed under a subject'])
    if (node.topicName) facts.push(['Topic', node.topicLinked ? node.topicName : `${node.topicName} (not one of that subject's topics yet)`])
    facts.push(['Last edited', day(node.updatedAt)])
  } else {
    facts.push(['Site', node.domain])
    facts.push(['Subject', node.subjectName ?? 'Not filed under a subject'])
    if (node.topicName) facts.push(['Topic', node.topicLinked ? node.topicName : `${node.topicName} (not one of that subject's topics yet)`])
    facts.push([node.kind === 'study_requested' ? 'Asked to study' : 'Saved', day(node.savedAt)])
  }
  const open = node.type === 'note' ? 'Open note' : node.type === 'resource' ? 'Open in Saved' : 'Open in Knowledge'

  return (
    <aside aria-label="Selected item" className="flex max-h-[46vh] flex-col overflow-y-auto border-t border-white/8 bg-card p-5 lg:max-h-none lg:w-80 lg:shrink-0 lg:border-l lg:border-t-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-foreground/45">
            <span className="inline-block size-2 rounded-full" style={{ background: FILL[node.type] }} />{TYPE_LABEL[node.type]}
          </p>
          <h2 className="mt-2 break-words text-lg font-semibold leading-snug tracking-tight text-foreground">{node.label}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close details" className="rounded-lg p-1.5 text-foreground/50 transition-colors hover:bg-white/5 hover:text-foreground"><X className="size-4" /></button>
      </div>

      <dl className="mt-4 space-y-2.5 text-sm">
        {facts.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4">
            <dt className="shrink-0 text-foreground/50">{k}</dt>
            <dd className="text-right text-foreground/90">{v}</dd>
          </div>
        ))}
      </dl>
      {node.type === 'topic' && node.level && (
        <p className="mt-3 text-xs leading-relaxed text-foreground/45">The estimate comes from how you said your sessions went. It is not a test result.</p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        {node.href && (
          <Link href={node.href} className="inline-flex h-10 items-center justify-center rounded-xl bg-keppel-400 px-4 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300">{open}</Link>
        )}
        {node.type === 'resource' && (
          <a href={node.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-white/12 px-4 text-sm font-medium text-foreground/85 transition-colors hover:bg-white/5">
            Visit page <ArrowUpRight className="size-3.5" />
          </a>
        )}
      </div>

      <div className="mt-6">
        <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-foreground/45">Connected to</h3>
        {neighbours.length === 0 ? (
          <p className="mt-2 text-sm leading-relaxed text-foreground/55">
            Nothing. {node.type === 'note' || node.type === 'resource'
              ? 'It is not filed under a subject. Give it one where you edit it and it joins that subject here.'
              : node.type === 'topic' ? 'No note or saved page names this topic yet.' : 'This subject has no topics, notes or saved pages yet.'}
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {neighbours.map(n => (
              <li key={n.id}>
                <button type="button" onClick={() => onPick(n.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground/80 transition-colors hover:bg-white/5 hover:text-foreground">
                  <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: FILL[n.type] }} />
                  <span className="truncate">{n.label}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-foreground/40">{TYPE_LABEL[n.type]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}

// The learner's knowledge as a map they can move around in. Every node is a
// real item and every line a link that is stored; the server decides both.
// This component only places, filters and shows them.
export function KnowledgeMap({ view }: { view: NovaKnowledgeMapReady }) {
  const [shown, setShown]       = useState<Record<MapNodeType, boolean>>({ subject: true, topic: true, note: true, resource: true })
  const [subject, setSubject]   = useState('')
  const [query, setQuery]       = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [hover, setHover]       = useState<string | null>(null)
  const [t, setT]               = useState<View>({ x: 0, y: 0, k: 1 })
  const frame = useRef<HTMLDivElement>(null)
  const drag  = useRef<{ x: number; y: number; moved: boolean } | null>(null)

  const subjects = useMemo(() => view.nodes.filter(n => n.type === 'subject'), [view.nodes])

  // What the filters leave. A filter hides items; it never changes a link.
  const nodes = useMemo(() => view.nodes.filter(n =>
    shown[n.type] && (subject === '' || n.subjectId === subject)), [view.nodes, shown, subject])
  const ids   = useMemo(() => new Set(nodes.map(n => n.id)), [nodes])
  const edges = useMemo(() => view.edges.filter(e => ids.has(e.from) && ids.has(e.to)), [view.edges, ids])
  const layout = useMemo(() => layoutMap(nodes, edges), [nodes, edges])
  const byId   = useMemo(() => new Map(view.nodes.map(n => [n.id, n])), [view.nodes])

  const neighbourIds = useMemo(() => {
    const focus = hover ?? selected
    if (!focus) return null
    const set = new Set<string>([focus])
    for (const e of view.edges) { if (e.from === focus) set.add(e.to); if (e.to === focus) set.add(e.from) }
    return set
  }, [hover, selected, view.edges])

  const fit = useCallback(() => {
    const el = frame.current
    if (!el) return
    const { minX, minY, maxX, maxY } = layout.bounds
    const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY)
    const k = Math.max(MIN_K, Math.min(1.15, Math.min(el.clientWidth / w, el.clientHeight / h)))
    setT({ k, x: el.clientWidth / 2 - ((minX + maxX) / 2) * k, y: el.clientHeight / 2 - ((minY + maxY) / 2) * k })
  }, [layout])

  // Fitted when the data or the filters change, not on every render.
  useEffect(() => { fit() }, [fit])

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const el = frame.current
    if (!el) return
    const px = cx ?? el.clientWidth / 2, py = cy ?? el.clientHeight / 2
    setT(v => {
      const k = Math.max(MIN_K, Math.min(MAX_K, v.k * factor))
      return { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k }
    })
  }, [])

  // The wheel zooms where the pointer is. Registered by hand so it can stop
  // the page from scrolling under the map.
  useEffect(() => {
    const el = frame.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const box = el.getBoundingClientRect()
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - box.left, e.clientY - box.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  const select = useCallback((id: string | null) => {
    setSelected(id)
    const p = id ? layout.at.get(id) : null
    const el = frame.current
    // Bring a node picked from a list into view.
    if (p && el) setT(v => ({ ...v, x: el.clientWidth / 2 - p.x * v.k, y: el.clientHeight / 2 - p.y * v.k }))
  }, [layout])

  const picked = selected ? byId.get(selected) ?? null : null
  const neighbours = useMemo(() => {
    if (!picked) return []
    const out: MapNode[] = []
    for (const e of view.edges) {
      const other = e.from === picked.id ? e.to : e.to === picked.id ? e.from : null
      const node  = other ? byId.get(other) : null
      if (node) out.push(node)
    }
    return out
  }, [picked, view.edges, byId])

  const found = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? nodes.filter(n => n.label.toLowerCase().includes(q)).slice(0, 8) : []
  }, [query, nodes])

  const labelled = (n: MapNode) => n.type === 'subject' || n.type === 'topic' || t.k >= 0.8 || neighbourIds?.has(n.id)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-white/8 bg-card/50 lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Filters. Each does what it says, and none changes what is stored. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-white/8 p-3">
          {TYPES.map(({ type, plural }) => (
            <button
              key={type} type="button" aria-pressed={shown[type]}
              onClick={() => setShown(s => ({ ...s, [type]: !s[type] }))}
              className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors ${shown[type] ? 'border-white/14 bg-white/6 text-foreground' : 'border-white/8 text-foreground/40'}`}
            >
              <span className="inline-block size-2 rounded-full" style={{ background: FILL[type], opacity: shown[type] ? 1 : 0.35 }} />
              {plural} <span className="text-foreground/40">{view.counts[type]}</span>
            </button>
          ))}
          {subjects.length > 1 && (
            <select value={subject} onChange={e => setSubject(e.target.value)} aria-label="Show one subject"
              className="h-8 rounded-full border border-white/10 bg-white/4 px-3 text-xs text-foreground outline-none">
              <option value="">All subjects</option>
              {subjects.map(s => <option key={s.id} value={s.subjectId ?? ''}>{s.label}</option>)}
            </select>
          )}
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-foreground/40" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find on the map" aria-label="Find on the map"
              className="h-8 w-44 rounded-full border border-white/10 bg-white/4 pl-8 pr-3 text-xs text-foreground outline-none placeholder:text-foreground/35 focus:border-keppel-400/60" />
            {found.length > 0 && (
              <ul className="absolute right-0 top-10 z-20 w-64 overflow-hidden rounded-xl border border-white/10 bg-card shadow-xl">
                {found.map(n => (
                  <li key={n.id}>
                    <button type="button" onClick={() => { select(n.id); setQuery('') }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground/85 hover:bg-white/6">
                      <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: FILL[n.type] }} />
                      <span className="truncate">{n.label}</span>
                      <span className="ml-auto shrink-0 text-foreground/40">{TYPE_LABEL[n.type]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div
          ref={frame}
          className="relative min-h-[22rem] flex-1 touch-none select-none overflow-hidden"
          style={{ cursor: drag.current ? 'grabbing' : 'grab' }}
          onPointerDown={e => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, moved: false } }}
          onPointerMove={e => {
            const d = drag.current
            if (!d) return
            const dx = e.clientX - d.x, dy = e.clientY - d.y
            if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
            d.x = e.clientX; d.y = e.clientY
            setT(v => ({ ...v, x: v.x + dx, y: v.y + dy }))
          }}
          onPointerUp={() => { const moved = drag.current?.moved; drag.current = null; if (!moved) setSelected(null) }}
          onPointerCancel={() => { drag.current = null }}
        >
          {nodes.length === 0 ? (
            <p className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-foreground/50">Nothing matches these filters. Turn one back on to see the map.</p>
          ) : (
            <svg className="absolute inset-0 size-full" role="img" aria-label={`Knowledge map: ${nodes.length} items and ${edges.length} links`}>
              <g transform={`translate(${t.x} ${t.y}) scale(${t.k})`}>
                {layout.loose && (
                  <text x={layout.loose.x - 40} y={layout.loose.y - 44} className="fill-foreground/40" fontSize={12}>Not filed under a subject</text>
                )}
                {edges.map(e => {
                  const a = layout.at.get(e.from), b = layout.at.get(e.to)
                  if (!a || !b) return null
                  const lit = neighbourIds !== null && neighbourIds.has(e.from) && neighbourIds.has(e.to) && (e.from === (hover ?? selected) || e.to === (hover ?? selected))
                  return (
                    <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                      stroke={lit ? 'var(--color-keppel-400)' : 'var(--map-line)'}
                      strokeWidth={(e.kind === 'has_topic' ? 1.4 : 1) / Math.sqrt(t.k)}
                      strokeDasharray={e.kind === 'filed_under' ? '4 4' : undefined}
                      opacity={neighbourIds && !lit ? 0.25 : 1} />
                  )
                })}
                {nodes.map(n => {
                  const p = layout.at.get(n.id)
                  if (!p) return null
                  const r   = RADIUS[n.type]
                  const dim = neighbourIds !== null && !neighbourIds.has(n.id)
                  const on  = selected === n.id
                  const unstudied = n.type === 'topic' && n.sessions === 0
                  return (
                    <g
                      key={n.id} transform={`translate(${p.x} ${p.y})`} opacity={dim ? 0.3 : 1}
                      role="button" tabIndex={0} aria-label={`${TYPE_LABEL[n.type]}: ${n.label}`} aria-pressed={on}
                      className="cursor-pointer outline-none [&:focus-visible>circle]:stroke-[var(--color-keppel-300)]"
                      onPointerDown={e => e.stopPropagation()}
                      onClick={() => setSelected(on ? null : n.id)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(on ? null : n.id) } }}
                      onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover(null)}
                    >
                      {on && <circle r={r + 7} fill="none" stroke="var(--color-keppel-400)" strokeWidth={2} />}
                      {n.type === 'resource'
                        ? <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={3} fill={FILL.resource} />
                        : <circle r={r} fill={unstudied ? 'var(--map-surface)' : FILL[n.type]} stroke={unstudied ? FILL.topic : 'none'} strokeWidth={unstudied ? 1.6 : 0} strokeDasharray={unstudied ? '3 3' : undefined} />}
                      {labelled(n) && (
                        <text y={r + 15} textAnchor="middle" fontSize={n.type === 'subject' ? 14 : n.type === 'topic' ? 12 : 10.5}
                          fontWeight={n.type === 'subject' ? 600 : 400} className={n.type === 'subject' ? 'fill-foreground' : 'fill-foreground/75'}
                          style={{ paintOrder: 'stroke', stroke: 'var(--map-surface)', strokeWidth: 3, strokeLinejoin: 'round' }}>
                          {short(n.label, n.type === 'subject' ? 26 : 22)}
                        </text>
                      )}
                    </g>
                  )
                })}
              </g>
            </svg>
          )}

          <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-xl border border-white/10 bg-card/90 backdrop-blur" onPointerDown={e => e.stopPropagation()}>
            <button type="button" onClick={() => zoomAt(1.25)} aria-label="Zoom in" className="p-2 text-foreground/70 transition-colors hover:bg-white/6 hover:text-foreground"><Plus className="size-4" /></button>
            <button type="button" onClick={() => zoomAt(0.8)} aria-label="Zoom out" className="border-t border-white/8 p-2 text-foreground/70 transition-colors hover:bg-white/6 hover:text-foreground"><Minus className="size-4" /></button>
            <button type="button" onClick={fit} aria-label="Fit the whole map" className="border-t border-white/8 p-2 text-foreground/70 transition-colors hover:bg-white/6 hover:text-foreground"><Maximize2 className="size-4" /></button>
          </div>

          <p className="pointer-events-none absolute bottom-3 left-3 max-w-[60%] text-[11px] leading-relaxed text-foreground/40">
            Drag to move, scroll to zoom. A dashed ring is a topic with no session yet; a dashed line is filed under the subject only.
            {view.unconnected > 0 && <> {view.unconnected} {view.unconnected === 1 ? 'item is' : 'items are'} not connected to anything.</>}
            {(view.notShown.notes > 0 || view.notShown.resources > 0) && <> Older notes and pages beyond the newest 150 of each are not drawn.</>}
          </p>
        </div>
      </div>

      {picked && <Detail node={picked} neighbours={neighbours} onPick={select} onClose={() => setSelected(null)} />}
    </div>
  )
}
