'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, ArrowUpRight, Bookmark, FileText, FolderOpen, Hash, Link2, MousePointerClick, Plus, Waypoints, X } from 'lucide-react'
import type { MapNode, NovaKnowledgeMapReady } from '@repo/api/nova/product/knowledge-map.types'
import type { KnowledgeSubject, KnowledgeTopic } from '@repo/api/nova/product/knowledge.types'
import { cn } from '@/lib/utils'
import { relativeDay } from '../format'
import { subjectColor, toneStyle } from '../subject-color'
import { BUTTON_QUIET, SURFACE_RAISED } from '../workspace/ui'
import { LEVEL_LABEL, LEVEL_TONE, reviewLabel } from './labels'
import { boardNeighbourhood, linksTouching, nodeSubject, subjectBoard, type BoardTopic, type Item, type SubjectBoard } from './subject-board'

// A subject laid out as a board: one tile per topic, holding the notes and
// saved pages filed under it, a tile for what is filed under the subject
// alone, and the [[links]] the learner wrote drawn as lines between what they
// join, in the colours of the subjects at either end: solid to a topic,
// dashed to a note. Pointing at anything (or tabbing to it) lights what is
// joined to it and dims the rest; choosing a topic keeps it lit and opens its
// details beside the canvas. Everything on it is an edge the Knowledge Map
// returned; the arrangement is the record's order and is not saved.

type Line = { id: string; from: string; to: string; d: string; ax: number; ay: number; bx: number; by: number; fromHue: number; toHue: number; toNote: boolean }

const sel = (id: string) => `[data-node="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id}"]`
const tone = (hue: number) => `oklch(var(--tone-l) var(--tone-c) ${hue})`
const hueOf = (node: MapNode) => subjectColor(nodeSubject(node)).hue
const LEVEL_STEPS = { weak: 1, developing: 2, solid: 3 } as const
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const nodeIcon = (n: MapNode) => n.type === 'note' ? FileText : n.type === 'resource' ? Bookmark : n.type === 'topic' ? Hash : FolderOpen
const TYPE_LABEL: Record<MapNode['type'], string> = { subject: 'Subject', topic: 'Topic', note: 'Note', resource: 'Saved page', task: 'Task' }
const NOTE_CHIP = 'bg-[color-mix(in_oklch,var(--map-note)_18%,transparent)] text-[var(--map-note)]'
const PAGE_CHIP = 'bg-[color-mix(in_oklch,var(--map-resource)_18%,transparent)] text-[var(--map-resource)]'

// A topic's level as three steps, filled up to it in its level's colour; with
// no session behind it, three empty dashed steps.
function LevelMeter({ level }: { level: keyof typeof LEVEL_STEPS | null }) {
  return (
    <span aria-hidden className="flex gap-0.5">
      {[1, 2, 3].map(step => (
        <span key={step} className={cn('h-1.5 w-4 rounded-full',
          level === null ? 'border border-dashed border-white/25' : step <= LEVEL_STEPS[level] ? LEVEL_TONE[level] : 'bg-white/10')} />
      ))}
    </span>
  )
}

function ItemLine({ item, dim, lit, onPoint, onLeave }: { item: Item; dim: boolean; lit: boolean; onPoint: () => void; onLeave: () => void }) {
  const note = item.type === 'note'
  const Icon = note ? FileText : Bookmark
  const when = note ? `edited ${relativeDay(item.updatedAt)}` : `${item.domain} · saved ${relativeDay(item.savedAt)}`
  const body = (
    <>
      <span aria-hidden className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md', note ? NOTE_CHIP : PAGE_CHIP)}>
        <Icon className="size-3" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-foreground/90 group-hover:underline">{item.label}</span>
        <span className="block truncate text-[11px] text-foreground/55">{when}</span>
      </span>
    </>
  )
  return (
    <li data-node={item.id} onMouseEnter={onPoint} onMouseLeave={onLeave} onFocus={e => { e.stopPropagation(); onPoint() }}
      className={cn('rounded-lg transition-[opacity,background-color]', dim && 'opacity-35', lit && 'bg-[var(--sc-faint)]')}>
      {item.href
        ? <Link href={item.href} className="group flex items-start gap-2 rounded-lg px-1.5 py-1 hover:bg-white/4 focus-visible:outline-2 focus-visible:outline-keppel-400">{body}</Link>
        : <span className="flex items-start gap-2 px-1.5 py-1">{body}</span>}
    </li>
  )
}

function NodeName({ node, here }: { node: MapNode; here: boolean }) {
  const Icon = nodeIcon(node)
  const subject = nodeSubject(node)
  const elsewhere = !here && subject ? ` · ${subject}` : ''
  const body = (
    <>
      <span aria-hidden className="subject-tone flex size-5 shrink-0 items-center justify-center rounded-md bg-[var(--sc-soft)] text-[var(--sc-ink)]" style={toneStyle(subject)}><Icon className="size-3" /></span>
      <span className="truncate">{node.label}{elsewhere && <span className="text-foreground/50">{elsewhere}</span>}</span>
    </>
  )
  return node.href
    ? <Link href={node.href} className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-foreground/85 hover:underline">{body}</Link>
    : <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-foreground/85">{body}</span>
}

export function SubjectBoardView({ map, subject, onOpenTopic }: {
  map:         NovaKnowledgeMapReady
  subject:     KnowledgeSubject
  // Opens the topic's own record in the list beside the board.
  onOpenTopic: (topicId: string) => void
}) {
  const board = subjectBoard(map, subject.subjectId)
  // The Knowledge view has each topic's state; the map has what is filed under it.
  const stateOf = new Map(subject.topics.map(t => [`topic:${t.id}`, t]))
  const newNote = (topic?: string) => `/notes/new?subjectId=${encodeURIComponent(subject.subjectId)}${topic ? `&topic=${encodeURIComponent(topic)}` : ''}`
  const filed = board.topics.reduce((n, t) => n + t.items.length, 0) + board.loose.length

  const gid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const canvas    = useRef<HTMLDivElement>(null)
  const inspector = useRef<HTMLDivElement>(null)
  const [lines, setLines]   = useState<Line[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  // The details keep the last thing pointed at, so the pointer can travel to
  // them; a choice stays until it is cleared.
  const [last, setLast]     = useState<string | null>(null)
  useEffect(() => { if (active) setLast(active) }, [active])
  const shown = active ?? pinned
  const near  = shown ? boardNeighbourhood(board, shown) : null
  const onBoard = new Set([...board.topics.flatMap(t => [t.topic.id, ...t.items.map(i => i.id)]), ...board.loose.map(i => i.id)])
  const linkKey = board.links.map(l => l.id).join('|')

  // The lines are measured from where the tiles were drawn, and drawn again
  // whenever the board changes size.
  useLayoutEffect(() => {
    const el = canvas.current
    if (!el) return
    const measure = () => {
      const box = el.getBoundingClientRect()
      const next: Line[] = []
      for (const link of board.links) {
        const a = el.querySelector<HTMLElement>(sel(link.from.id))
        const b = el.querySelector<HTMLElement>(sel(link.to.id))
        if (!a || !b) continue
        const ra = a.getBoundingClientRect()
        const rb = b.getBoundingClientRect()
        const ay = ra.top + ra.height / 2 - box.top
        const by = rb.top + Math.min(rb.height / 2, 18) - box.top
        let ax: number, bx: number, c1: number, c2: number
        if (rb.left >= ra.right - 4) { ax = ra.right - box.left; bx = rb.left - box.left; const k = Math.max(30, (bx - ax) / 2); c1 = ax + k; c2 = bx - k }
        else if (rb.right <= ra.left + 4) { ax = ra.left - box.left; bx = rb.right - box.left; const k = Math.max(30, (ax - bx) / 2); c1 = ax - k; c2 = bx + k }
        else { ax = ra.left - box.left; bx = rb.left - box.left; c1 = ax - 40; c2 = bx - 40 }   // same column: loop out to the left
        next.push({
          id: link.id, from: link.from.id, to: link.to.id, d: `M ${ax} ${ay} C ${c1} ${ay}, ${c2} ${by}, ${bx} ${by}`,
          ax, ay, bx, by, fromHue: hueOf(link.from), toHue: hueOf(link.to), toNote: link.to.type === 'note',
        })
      }
      setLines(next)
    }
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
    // board is rebuilt every render; its links (by id) are what the lines depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkKey, subject.subjectId, map])

  // A choice on a narrow screen opens the details below the canvas: bring them into view.
  useEffect(() => {
    if (!pinned || window.matchMedia('(min-width: 1280px)').matches) return
    inspector.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [pinned])

  // Another subject starts with nothing chosen.
  useEffect(() => { setPinned(null); setActive(null); setLast(null) }, [subject.subjectId])

  if (board.topics.length === 0 && board.loose.length === 0) {
    return (
      <div className="subject-tone nova-canvas relative overflow-hidden rounded-2xl border border-dashed border-[var(--sc-edge)] bg-[var(--sc-faint)] px-6 py-12 text-center" style={toneStyle(subject.subjectName)} data-empty="board">
        <span aria-hidden className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[var(--sc-soft)] text-[var(--sc-ink)] shadow-soft"><Hash className="size-5" /></span>
        <p className="mt-4 text-base font-semibold text-foreground">Nothing on record under {subject.subjectName} yet</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-foreground/60">Topics, the notes and pages filed under them, and the links between them appear here as you add them.</p>
        <Link href={newNote()} className={cn(BUTTON_QUIET, 'mt-5 bg-card')}><Plus aria-hidden className="size-3.5" /> Write a note filed here</Link>
      </div>
    )
  }

  const dimmed = (ids: string[]) => near !== null && !ids.some(id => near.has(id))
  const linkCount = (tile: BoardTopic) => linksTouching(board, new Set([tile.topic.id, ...tile.items.map(i => i.id)])).length

  return (
    <div data-board={subject.subjectName} onKeyDown={e => { if (e.key === 'Escape' && (pinned || last)) { setPinned(null); setLast(null); e.stopPropagation() } }}>
      <p className="text-xs leading-relaxed text-foreground/60">
        {filed === 0 ? 'No notes or saved pages are filed under these topics yet.' : `${filed} ${filed === 1 ? 'item is' : 'items are'} filed here.`}
        {' '}Lines are the [[links]] in your notes; point at anything to see what it joins, or choose a topic to keep it lit. Tiles follow your record&apos;s order and can&apos;t be moved.
        {(map.notShown.notes > 0 || map.notShown.resources > 0) && ' Only your newest notes and saved pages are on the board.'}
      </p>

      <div className="mt-3 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div ref={canvas} style={toneStyle(subject.subjectName)}
          className="subject-tone nova-canvas relative min-w-0 rounded-2xl border border-white/8 bg-[var(--sc-faint)] p-3 sm:p-5"
          onMouseLeave={() => setActive(null)}
          onClick={e => { if (e.target === e.currentTarget) { setPinned(null); setLast(null) } }}>
          {/* The links, drawn over the tiles (they start and end inside them); they take no clicks */}
          <svg aria-hidden className="pointer-events-none absolute inset-0 z-10 hidden size-full overflow-visible sm:block">
            <defs>
              {lines.map((line, i) => (
                <linearGradient key={line.id} id={`${gid}-l${i}`} gradientUnits="userSpaceOnUse" x1={line.ax} y1={line.ay} x2={line.bx} y2={line.by}>
                  <stop offset="0" style={{ stopColor: tone(line.fromHue) }} />
                  <stop offset="1" style={{ stopColor: tone(line.toHue) }} />
                </linearGradient>
              ))}
            </defs>
            {lines.map((line, i) => {
              const lit = near !== null && near.has(line.from) && near.has(line.to)
              const stroke = `url(#${gid}-l${i})`
              return (
                <g key={line.id} className="transition-opacity duration-200" style={{ opacity: near === null ? 0.7 : lit ? 1 : 0.08 }}>
                  {lit && <path d={line.d} fill="none" stroke={stroke} strokeWidth={8} strokeLinecap="round" opacity={0.18} />}
                  <path d={line.d} fill="none" stroke={stroke} strokeWidth={lit ? 2.5 : 1.75} strokeLinecap="round"
                    strokeDasharray={line.toNote ? '6 5' : undefined} className={lit && line.toNote ? 'nova-flow' : undefined} />
                  <circle cx={line.ax} cy={line.ay} r={3} style={{ fill: 'var(--card)', stroke: tone(line.fromHue) }} strokeWidth={1.75} />
                  <circle cx={line.bx} cy={line.by} r={lit ? 4.5 : 3.5} style={{ fill: tone(line.toHue) }} />
                </g>
              )
            })}
          </svg>

          <ul className="columns-1 gap-4 sm:columns-2 2xl:columns-3 [&>li]:mb-4 [&>li]:break-inside-avoid">
            {board.topics.map(tile => {
              const { topic, items } = tile
              const state = stateOf.get(topic.id)
              const level = topic.sessions > 0 && topic.level ? topic.level : null
              const isPinned = pinned === topic.id
              const lit = near !== null && near.has(topic.id) && !isPinned
              const links = linkCount(tile)
              return (
                <li key={topic.id} data-node={topic.id} data-board-topic={topic.label}
                  onMouseEnter={() => setActive(topic.id)} onFocus={() => setActive(topic.id)} onBlur={() => setActive(null)}
                  className={cn('relative overflow-hidden rounded-2xl border bg-card transition-[opacity,box-shadow,transform,filter] duration-200',
                    level ? 'border-white/10' : 'border-dashed border-white/20',
                    isPinned ? '-translate-y-0.5 shadow-float ring-2 ring-[var(--sc)]' : lit ? 'shadow-soft ring-1 ring-[var(--sc-edge)]' : 'shadow-sm shadow-black/5',
                    dimmed([topic.id, ...items.map(i => i.id)]) && 'opacity-35 saturate-50')}>
                  <div className="bg-linear-to-br from-[var(--sc-soft)] via-[var(--sc-faint)] to-transparent px-3.5 pb-3 pt-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <button type="button" aria-pressed={isPinned} onClick={() => setPinned(isPinned ? null : topic.id)}
                        className="min-w-0 text-left text-[15px] font-semibold leading-snug tracking-tight text-foreground hover:text-[var(--sc-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-keppel-400">
                        {topic.label}
                      </button>
                      {state?.reviewState === 'due' && <span className="shrink-0 rounded-full bg-amber-300/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">Due</span>}
                    </div>
                    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-foreground/60">
                      <LevelMeter level={level} />
                      <span>{level ? `${LEVEL_LABEL[level]} · ${plural(topic.sessions, 'session', 'sessions')}` : LEVEL_LABEL.unverified}</span>
                      {state && state.reviewState !== 'unscheduled' && <span className="text-foreground/50">{reviewLabel(state)}</span>}
                    </p>
                    {links > 0 && (
                      <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-card/80 px-2 py-0.5 text-[10px] font-semibold text-[var(--sc-ink)]">
                        <Link2 aria-hidden className="size-3" /> {plural(links, 'link', 'links')}
                      </p>
                    )}
                  </div>
                  {items.length > 0 ? (
                    <ul className="space-y-0.5 border-t border-white/6 px-2 py-2">
                      {items.map(item => (
                        <ItemLine key={item.id} item={item} dim={near !== null && !near.has(item.id)} lit={shown === item.id}
                          onPoint={() => setActive(item.id)} onLeave={() => setActive(topic.id)} />
                      ))}
                    </ul>
                  ) : (
                    <Link href={newNote(topic.label)} className="mx-3.5 my-2.5 inline-flex items-center gap-1 text-[11px] text-foreground/55 hover:text-foreground">
                      <Plus aria-hidden className="size-3" /> Note on this topic
                    </Link>
                  )}
                  <div className="flex items-center gap-3 border-t border-white/6 px-3.5 py-2 text-[11px]">
                    <button type="button" onClick={() => onOpenTopic(topic.id.slice('topic:'.length))} className="font-medium text-foreground/60 hover:text-foreground">Open topic</button>
                    <Link href={`/map?focus=${encodeURIComponent(topic.id)}`} className="inline-flex items-center gap-1 font-medium text-foreground/60 hover:text-foreground">
                      <Waypoints aria-hidden className="size-3" /> Map
                    </Link>
                  </div>
                </li>
              )
            })}

            {board.loose.length > 0 && (
              <li data-board-loose className={cn('rounded-2xl border border-white/8 bg-card/85 p-3.5 transition-opacity', dimmed(board.loose.map(i => i.id)) && 'opacity-35')}>
                <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground/85"><FolderOpen aria-hidden className="size-4 text-[var(--sc-ink)]" /> Filed under {subject.subjectName}</p>
                <p className="mt-0.5 text-[11px] text-foreground/55">Under the subject, not a topic.</p>
                <ul className="mt-2.5 space-y-0.5 border-t border-white/6 pt-2">
                  {board.loose.map(item => (
                    <ItemLine key={item.id} item={item} dim={near !== null && !near.has(item.id)} lit={shown === item.id}
                      onPoint={() => setActive(item.id)} onLeave={() => setActive(null)} />
                  ))}
                </ul>
              </li>
            )}
          </ul>
        </div>

        <div ref={inspector} className="min-w-0 xl:sticky xl:top-4 xl:self-start">
          <BoardDetails board={board} subject={subject} stateOf={stateOf} shown={pinned ?? last} pinned={pinned}
            onClear={() => { setPinned(null); setLast(null) }} onOpenTopic={onOpenTopic} newNote={newNote} />
        </div>
      </div>

      {/* Where the lines are not drawn (a phone), the links as a list */}
      {board.links.length > 0 && (
        <section aria-labelledby="board-links" className="mt-5 sm:hidden">
          <h3 id="board-links" className="flex items-center gap-2 text-xs font-semibold text-foreground/70"><Link2 aria-hidden className="size-3.5" /> Links you wrote</h3>
          <ul className="mt-2 space-y-2">
            {board.links.map(link => (
              <li key={link.id} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-white/8 bg-card/70 px-3 py-2 text-sm">
                <NodeName node={link.from} here={onBoard.has(link.from.id)} />
                <ArrowRight aria-hidden className="size-3.5 shrink-0 text-foreground/40" /><span className="sr-only">links to</span>
                <NodeName node={link.to} here={onBoard.has(link.to.id)} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

// Beside the canvas: what is under the pointer, else what was chosen, with
// what it joins; with nothing, how to read the board. Everything here is on
// the board already.
function BoardDetails({ board, subject, stateOf, shown, pinned, onClear, onOpenTopic, newNote }: {
  board: SubjectBoard; subject: KnowledgeSubject; stateOf: Map<string, KnowledgeTopic>
  shown: string | null; pinned: string | null
  onClear: () => void; onOpenTopic: (topicId: string) => void; newNote: (topic?: string) => string
}) {
  const tile  = shown ? board.topics.find(t => t.topic.id === shown) : undefined
  const item  = shown && !tile ? [...board.topics.flatMap(t => t.items), ...board.loose].find(i => i.id === shown) : undefined
  const owner = item ? board.topics.find(t => t.items.some(i => i.id === item.id)) : undefined

  if (!tile && !item) {
    return (
      <aside aria-label="Board details" className={cn(SURFACE_RAISED, 'subject-tone p-4')} style={toneStyle(subject.subjectName)}>
        <p className="flex items-center gap-2 text-[13px] font-semibold text-foreground"><MousePointerClick aria-hidden className="size-4 text-[var(--sc-ink)]" /> Explore the board</p>
        <p className="mt-1 text-xs leading-relaxed text-foreground/60">Point at a tile or an item to light what it joins. Choose a topic&apos;s name to keep it here.</p>
        <dl className="mt-4 space-y-2.5 text-xs text-foreground/70">
          <div className="flex items-center gap-2.5"><span aria-hidden className="h-4 w-6 rounded-md border border-white/10 bg-linear-to-br from-[var(--sc-soft)] to-transparent" /><dt>Topic</dt><dd className="ml-auto text-foreground/50">{board.topics.length}</dd></div>
          <div className="flex items-center gap-2.5"><span aria-hidden className={cn('flex h-4 w-6 items-center justify-center rounded-md', NOTE_CHIP)}><FileText className="size-3" /></span><dt>Note</dt></div>
          <div className="flex items-center gap-2.5"><span aria-hidden className={cn('flex h-4 w-6 items-center justify-center rounded-md', PAGE_CHIP)}><Bookmark className="size-3" /></span><dt>Saved page</dt></div>
          <div className="flex items-center gap-2.5"><svg aria-hidden width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" stroke="var(--sc)" strokeWidth="2" /></svg><dt>A note links to a topic</dt></div>
          <div className="flex items-center gap-2.5"><svg aria-hidden width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" stroke="var(--sc)" strokeWidth="2" strokeDasharray="5 4" /></svg><dt>A note links to a note</dt><dd className="ml-auto text-foreground/50">{plural(board.links.length, 'link', 'links')}</dd></div>
        </dl>
        <p className="mt-4 border-t border-white/8 pt-3 text-[11px] leading-relaxed text-foreground/50">
          A line&apos;s colour runs from the subject it starts in to the one it ends in.
          <span className="sm:hidden"> On a phone the links are listed under the board.</span>
        </p>
      </aside>
    )
  }

  const node: MapNode = tile ? tile.topic : item!
  const Icon = nodeIcon(node)
  const around = linksTouching(board, new Set(tile ? [tile.topic.id, ...tile.items.map(i => i.id)] : [node.id]))
  const state = tile ? stateOf.get(tile.topic.id) : undefined
  const level = tile && tile.topic.sessions > 0 && tile.topic.level ? tile.topic.level : null
  const notes = tile ? tile.items.filter(i => i.type === 'note').length : 0
  const pages = tile ? tile.items.length - notes : 0

  return (
    <aside key={node.id} aria-label="Board details" className={cn(SURFACE_RAISED, 'subject-tone nova-rise relative overflow-hidden')} style={toneStyle(nodeSubject(node))}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-linear-to-b from-[var(--sc-soft)] to-transparent" />
      <div className="relative p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--sc-ink)]">
            <Icon aria-hidden className="size-3" /> {TYPE_LABEL[node.type]}{pinned === node.id ? ' · chosen' : ''}
          </p>
          <button type="button" onClick={onClear} aria-label="Close the details" className="-m-1 rounded-md p-1 text-foreground/50 hover:bg-white/6 hover:text-foreground"><X aria-hidden className="size-3.5" /></button>
        </div>
        <h3 className="mt-1.5 text-lg font-semibold leading-snug tracking-tight text-foreground">{node.label}</h3>

        {tile ? (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground/60">
            <LevelMeter level={level} />
            {level ? `${LEVEL_LABEL[level]} · ${plural(tile.topic.sessions, 'session', 'sessions')}` : LEVEL_LABEL.unverified}
          </p>
        ) : item && (
          <p className="mt-1 text-xs leading-relaxed text-foreground/60">
            {item.type === 'note' ? `Edited ${relativeDay(item.updatedAt)}` : `${item.domain} · saved ${relativeDay(item.savedAt)}`}
            {' · '}{owner ? <>filed under <span className="font-medium text-foreground/80">{owner.topic.label}</span></> : `filed under ${subject.subjectName}`}
          </p>
        )}
        {state && state.reviewState !== 'unscheduled' && <p className={cn('mt-1 text-xs', state.reviewState === 'due' ? 'font-medium text-amber-300' : 'text-foreground/55')}>{reviewLabel(state)}</p>}
        {tile && tile.items.length > 0 && (
          <p className="mt-3 text-xs text-foreground/65">{plural(notes, 'note', 'notes')} · {plural(pages, 'saved page', 'saved pages')} filed here</p>
        )}

        <div className="mt-4 border-t border-white/8 pt-3">
          <p className="text-[11px] font-semibold text-foreground/70">{around.length === 0 ? 'No links yet' : `Links (${around.length})`}</p>
          {around.length === 0 ? (
            <p className="mt-1 text-xs leading-relaxed text-foreground/55">
              {tile ? <>Write <code className="rounded bg-white/6 px-1 text-[11px]">[[{tile.topic.label}]]</code> in a note to link it here.</> : 'Nothing this links to, or that links to it, is on record.'}
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {around.map(({ link, other, outward }) => {
                const OtherIcon = nodeIcon(other)
                const Arrow = outward ? ArrowRight : ArrowLeft
                return (
                  <li key={link.id} className="flex min-w-0 items-center gap-2 text-[13px]">
                    <Arrow aria-hidden className="size-3 shrink-0 text-foreground/40" />
                    <span className="sr-only">{outward ? 'Links to' : 'Linked from'}</span>
                    <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', subjectColor(nodeSubject(other)).dot)} />
                    <OtherIcon aria-hidden className="size-3 shrink-0 text-foreground/45" />
                    {other.href ? <Link href={other.href} className="truncate text-foreground/85 hover:underline">{other.label}</Link> : <span className="truncate text-foreground/85">{other.label}</span>}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {tile && <button type="button" onClick={() => onOpenTopic(tile.topic.id.slice('topic:'.length))} className={BUTTON_QUIET}>Open topic</button>}
          {tile && <Link href={newNote(tile.topic.label)} className={BUTTON_QUIET}><Plus aria-hidden className="size-3.5" /> Note</Link>}
          {item?.href && <Link href={item.href} className={BUTTON_QUIET}>Open {item.type === 'note' ? 'note' : 'in Saved'}</Link>}
          {item?.type === 'resource' && <a href={item.url} target="_blank" rel="noreferrer noopener" className={BUTTON_QUIET}>{item.domain} <ArrowUpRight aria-hidden className="size-3.5" /></a>}
          <Link href={`/map?focus=${encodeURIComponent(node.id)}`} className={BUTTON_QUIET}><Waypoints aria-hidden className="size-3.5" /> Map</Link>
        </div>
      </div>
    </aside>
  )
}
