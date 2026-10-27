'use client'

// The Knowledge Map, on the landing page. Laid out by the map's own engine
// (knowledge-map/layout.ts), explored with its own rules (explore.ts) and
// drawn with its own cards (card-face.tsx), from a sample map in the map's
// data shapes (demo-map-data.ts). What it lets a visitor do is what the map
// does: select a card to light what it is joined to, explore inside a card
// with something in it and come back up, find a card by name, and fit the
// view. It reads and writes nothing.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, useInView, useReducedMotion } from 'framer-motion'
import { ChevronRight, Maximize2, Search, X } from 'lucide-react'
import type { MapNode } from '@repo/api/nova/product/knowledge-map.types'
import { CARD, TREE_EDGES, layoutMap, treeOf } from '@/components/nova/knowledge-map/layout'
import { canExplore, insideOf, pathTo } from '@/components/nova/knowledge-map/explore'
import { CardFace, LEVEL_TEXT, plural } from '@/components/nova/knowledge-map/card-face'
import { toneStyle } from '@/components/nova/subject-color'
import { cn } from '@/lib/utils'
import { DEMO_EDGES, DEMO_NODES } from './demo-map-data'
import { AppWindow } from './frame'

const PAD = 40
const TYPE: Record<MapNode['type'], string> = { subject: 'Subject', topic: 'Topic', task: 'Task', note: 'Note', resource: 'Saved page' }

function factsOf(n: MapNode): string {
  if (n.type === 'subject') return [plural(n.topics, 'topic'), plural(n.notes, 'note'), plural(n.resources, 'saved page')].join(' · ')
  if (n.type === 'topic') return n.studied === false ? 'Organises the topics inside it' : n.level && n.masteryPercent !== null ? `${LEVEL_TEXT[n.level]} · ${n.masteryPercent}% · ${plural(n.sessions, 'session')}` : 'No session yet'
  if (n.type === 'task') return `To do · ${n.estimatedMinutes ?? 0} min`
  if (n.type === 'note') return `A note in ${n.subjectName}`
  return `Saved from ${n.domain}`
}

export function MapDemo() {
  const box = useRef<HTMLDivElement>(null)
  const inView = useInView(box, { once: true, amount: 0.25 })
  const reduced = useReducedMotion()
  const [portrait, setPortrait] = useState(false)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setPortrait((e?.contentRect.width ?? 900) < 560))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const tree = useMemo(() => treeOf(DEMO_NODES, DEMO_EDGES), [])
  const layout = useMemo(() => layoutMap(DEMO_NODES, DEMO_EDGES.filter(e => TREE_EDGES.has(e.kind)), { portrait }), [portrait])
  const byId = useMemo(() => new Map(DEMO_NODES.map(n => [n.id, n])), [])

  const [focus, setFocus] = useState<string | null>(null)       // the card explored, or the whole map
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const shown = useMemo(() => (focus ? insideOf(tree, focus) : new Set(DEMO_NODES.map(n => n.id))), [focus, tree])
  const edges = useMemo(() => DEMO_EDGES.filter(e => shown.has(e.from) && shown.has(e.to)), [shown])
  const neighbours = useMemo(() => {
    if (!selected) return null
    const ids = new Set([selected])
    for (const e of DEMO_EDGES) { if (e.from === selected) ids.add(e.to); if (e.to === selected) ids.add(e.from) }
    return ids
  }, [selected])

  // The view: the whole map, or the explored card and what is inside it.
  const viewBox = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const id of shown) {
      const p = layout.at.get(id), n = byId.get(id)
      if (!p || !n) continue
      const { w, h } = CARD[n.type]
      minX = Math.min(minX, p.x - w / 2); maxX = Math.max(maxX, p.x + w / 2); minY = Math.min(minY, p.y - h / 2); maxY = Math.max(maxY, p.y + h / 2)
    }
    return `${minX - PAD} ${minY - PAD} ${maxX - minX + PAD * 2} ${maxY - minY + PAD * 2}`
  }, [shown, layout, byId])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? DEMO_NODES.filter(n => n.label.toLowerCase().includes(q)).slice(0, 6) : []
  }, [query])

  const explore = useCallback((id: string) => { if (canExplore(tree, id)) { setFocus(id); setSelected(null) } }, [tree])
  const goUp = useCallback(() => {
    if (!focus) return
    const path = pathTo(tree, focus)
    setSelected(focus)
    setFocus(path.length > 1 ? path[path.length - 2]! : null)
  }, [focus, tree])
  const fit = () => { setFocus(null); setSelected(null); setQuery('') }
  const find = (id: string) => {
    // Shown where it sits: inside the card explored, or on the whole map.
    if (focus && !insideOf(tree, focus).has(id)) setFocus(null)
    setSelected(id); setQuery('')
    window.setTimeout(() => (box.current?.querySelector(`[data-demo-node="${CSS.escape(id)}"]`) as HTMLElement | null)?.focus(), 30)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    if (e.key === 'u' || e.key === 'U') { e.preventDefault(); goUp() }
    else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); fit() }
    else if (e.key === '/') { e.preventDefault(); box.current?.querySelector<HTMLInputElement>('input[type=search]')?.focus() }
    else if (e.key === 'Escape') setSelected(null)
  }

  const crumbs = focus ? pathTo(tree, focus) : []
  const sel = selected ? byId.get(selected) ?? null : null
  const depth = (id: string) => pathTo(tree, id).length
  const animate = inView && !reduced

  return (
    <AppWindow label="Kio · Knowledge Map" className="h-[34rem] sm:h-[40rem]"
      bar={<span className="mr-2 hidden text-[11px] text-foreground/45 sm:inline">Click a card · Enter or double-click to explore · U up · F fit</span>}>
      <div ref={box} className="relative flex h-full flex-col" onKeyDown={onKey} data-map-demo>
        {/* Find, where you are, fit */}
        <div className="flex flex-wrap items-center gap-2 border-b border-white/6 px-3 py-2">
          <label className="relative w-full max-w-[15rem] sm:w-56">
            <span className="sr-only">Find a card on the map</span>
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-foreground/40" />
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find on the map ( / )"
              onKeyDown={e => { if (e.key === 'Enter' && matches[0]) find(matches[0].id) }}
              className="h-8 w-full rounded-lg border border-white/10 bg-transparent pl-8 pr-2 text-xs text-foreground placeholder:text-foreground/40 focus:border-[var(--action)] focus:outline-none" data-map-demo-search />
            {matches.length > 0 && (
              <ul className="absolute left-0 top-9 z-20 w-64 rounded-xl border border-white/10 bg-popover p-1 shadow-float" role="listbox" aria-label="Cards that match">
                {matches.map(m => (
                  <li key={m.id}><button type="button" role="option" aria-selected={false} onClick={() => find(m.id)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-foreground/85 hover:bg-white/6">
                    <span className="truncate">{m.label}</span><span className="shrink-0 text-[10px] text-subtle">{TYPE[m.type]}</span></button></li>
                ))}
              </ul>
            )}
          </label>
          <nav aria-label="Where you are on the map" className="flex min-w-0 flex-1 items-center gap-1 text-xs">
            <button type="button" onClick={fit} className={cn('rounded-md px-1.5 py-1', focus ? 'text-[var(--action-ink)] hover:underline' : 'font-medium text-foreground')}>Whole map</button>
            {crumbs.map((id, i) => (
              <span key={id} className="flex min-w-0 items-center gap-1">
                <ChevronRight aria-hidden className="size-3 shrink-0 text-foreground/30" />
                <button type="button" onClick={() => (i < crumbs.length - 1 ? setFocus(id) : undefined)} aria-current={i === crumbs.length - 1 ? 'location' : undefined}
                  className={cn('truncate rounded-md px-1.5 py-1', i === crumbs.length - 1 ? 'font-medium text-foreground' : 'text-[var(--action-ink)] hover:underline')}>{byId.get(id)?.label}</button>
              </span>
            ))}
          </nav>
          <button type="button" onClick={fit} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-xs text-foreground/75 hover:bg-white/5" data-map-demo-fit>
            <Maximize2 aria-hidden className="size-3.5" /> Fit
          </button>
        </div>

        {/* The map */}
        {/* On a phone the map is the real map's outline layout, drawn at its
            width and scrolled, so the cards stay readable. */}
        <div className={cn('relative min-h-0 flex-1', portrait && 'overflow-y-auto')} style={{ background: 'radial-gradient(70% 60% at 50% 40%, oklch(70.64% 0.1 179.4 / 0.06), transparent 70%)' }} data-map-demo-canvas>
          <motion.svg className={portrait ? 'block h-auto w-full' : 'absolute inset-0 h-full w-full'} initial={false} animate={{ viewBox } as never} transition={{ duration: reduced ? 0 : 0.7, ease: [0.22, 1, 0.36, 1] }}
            viewBox={viewBox} preserveAspectRatio={portrait ? 'xMidYMin meet' : 'xMidYMid meet'} role="group" aria-label={focus ? `Inside ${byId.get(focus)?.label}` : 'The whole sample map'} data-map-demo-svg>
            <g>
              {edges.map((e, i) => {
                const a = layout.at.get(e.from), b = layout.at.get(e.to)
                if (!a || !b) return null
                const lit = selected !== null && (e.from === selected || e.to === selected)
                const dim = selected !== null && !lit
                const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y
                const lane = layout.lanes?.get(e.to)
                const d = e.kind === 'links_to' ? `M ${a.x} ${a.y} Q ${mx - dy * 0.18} ${my + dx * 0.18} ${b.x} ${b.y}`
                  : lane && lane.x === b.x && lane.y === b.y ? `M ${a.x} ${a.y} H ${lane.trunkX} V ${lane.laneY} H ${b.x} V ${b.y}`
                  : `M ${a.x} ${a.y} L ${b.x} ${b.y}`
                return (
                  <motion.path key={e.id} d={d} fill="none" data-edge={e.kind}
                    stroke={lit ? 'var(--action)' : e.kind === 'links_to' ? 'var(--map-line-strong)' : 'var(--map-line)'}
                    strokeWidth={lit ? 2.2 : e.kind === 'contains' ? 2 : e.kind === 'has_topic' || e.kind === 'subtopic' ? 1.5 : 1.1}
                    strokeDasharray={e.kind === 'filed_under' ? '5 4' : undefined} strokeLinejoin="round" vectorEffect="non-scaling-stroke"
                    initial={animate ? { pathLength: 0, opacity: 0 } : false}
                    animate={inView ? { pathLength: 1, opacity: dim ? 0.25 : 1 } : undefined}
                    transition={{ duration: reduced ? 0 : 0.8, delay: reduced ? 0 : 0.25 + (i % 12) * 0.04 }} />
                )
              })}
              {DEMO_NODES.filter(n => shown.has(n.id)).map(n => {
                const p = layout.at.get(n.id)
                if (!p) return null
                const { w, h } = CARD[n.type]
                const on = selected === n.id
                const dim = neighbours !== null && !neighbours.has(n.id)
                const kids = tree.children.get(n.id)?.length ?? 0
                const tone = n.type === 'subject' ? n.label : 'subjectName' in n ? n.subjectName : null
                return (
                  <g key={n.id} transform={`translate(${p.x} ${p.y})`} className="subject-tone cursor-pointer outline-none [&:focus-visible_.map-focus]:opacity-100" style={toneStyle(tone)}
                    role="button" tabIndex={0} aria-pressed={on} data-demo-node={n.id}
                    aria-label={`${TYPE[n.type]}: ${n.label}${kids ? `, ${kids} inside` : ''}`}
                    onClick={() => setSelected(s => (s === n.id ? null : n.id))}
                    onDoubleClick={() => explore(n.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (kids) explore(n.id); else setSelected(n.id) }
                      else if (e.key === ' ') { e.preventDefault(); setSelected(s => (s === n.id ? null : n.id)) }
                    }}>
                    <motion.g initial={animate ? { opacity: 0, scale: 0.92 } : false}
                      animate={inView ? { opacity: dim ? 0.38 : 1, scale: 1 } : undefined}
                      transition={{ duration: reduced ? 0 : 0.45, delay: reduced ? 0 : Math.min(depth(n.id), 4) * 0.12 }}>
                    {on && <rect x={-w / 2 - 5} y={-h / 2 - 5} width={w + 10} height={h + 10} rx={18} fill="color-mix(in oklch, var(--action) 9%, transparent)" stroke="var(--action)" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
                    <rect className="map-focus opacity-0" x={-w / 2 - 5} y={-h / 2 - 5} width={w + 10} height={h + 10} rx={18} fill="none" stroke="var(--ring)" strokeWidth={2.5} strokeDasharray="5 3" vectorEffect="non-scaling-stroke" />
                    <CardFace n={n} detail={2} />
                    {kids > 0 && (
                      <g transform={`translate(${w / 2} 0)`} aria-hidden>
                        <circle r={9} fill="var(--card)" stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                        <text textAnchor="middle" y={3.5} fontSize={9.5} fontWeight={600} className="fill-foreground">{insideOf(tree, n.id).size - 1}</text>
                      </g>
                    )}
                    </motion.g>
                  </g>
                )
              })}
            </g>
          </motion.svg>

          {/* What the selected card is, and what it is joined to */}
          {sel && (
            <div className={cn('subject-tone z-10 rounded-2xl border border-white/10 bg-card/95 p-4 shadow-float backdrop-blur', portrait ? 'sticky bottom-3 mx-3' : 'absolute bottom-3 right-3 w-72')}
              style={toneStyle(sel.type === 'subject' ? sel.label : 'subjectName' in sel ? sel.subjectName : null)} role="region" aria-label={`${sel.label}, selected`} data-map-demo-detail>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-subtle">{TYPE[sel.type]}</p>
                  <p className="mt-0.5 truncate text-sm font-semibold text-foreground">{sel.label}</p>
                  <p className="mt-1 text-xs text-foreground/65">{factsOf(sel)}</p>
                </div>
                <button type="button" onClick={() => setSelected(null)} aria-label="Clear the selection" className="rounded-md p-1 text-subtle hover:text-foreground"><X className="size-3.5" /></button>
              </div>
              <p className="mt-3 text-[11px] text-foreground/55">Joined to {plural((neighbours?.size ?? 1) - 1, 'card')}, lit on the map.</p>
              {canExplore(tree, sel.id) && focus !== sel.id && (
                <button type="button" onClick={() => explore(sel.id)} className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-action px-3 text-xs font-semibold text-action-foreground hover:bg-action-hover" data-map-demo-explore>
                  Explore inside <ChevronRight aria-hidden className="size-3.5" />
                </button>
              )}
            </div>
          )}
          {focus && !sel && (
            <button type="button" onClick={goUp} className={cn('z-10 inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-card/90 px-3 text-xs text-foreground/80 backdrop-blur hover:bg-card', portrait ? 'sticky bottom-3 mb-3 ml-3' : 'absolute bottom-3 left-3')} data-map-demo-up>
              Up one level (U)
            </button>
          )}
        </div>
      </div>
    </AppWindow>
  )
}
