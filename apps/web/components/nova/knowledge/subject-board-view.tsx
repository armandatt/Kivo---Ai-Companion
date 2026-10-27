'use client'

import { useId, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Bookmark, FileText, FolderOpen, Hash, Link2, Plus } from 'lucide-react'
import type { MapNode, NovaKnowledgeMapReady } from '@repo/api/nova/product/knowledge-map.types'
import type { KnowledgeSubject, KnowledgeTopic } from '@repo/api/nova/product/knowledge.types'
import { cn } from '@/lib/utils'
import { relativeDay } from '../format'
import { subjectColor, toneStyle } from '../subject-color'
import { BUTTON_QUIET } from '../workspace/ui'
import { LEVEL_LABEL, LEVEL_TONE, reviewLabel } from './labels'
import { boardNeighbourhood, nodeSubject, subjectBoard, type BoardTopic, type Item } from './subject-board'

// A subject laid out as a board: a tile for each topic at the top of the
// subject, the topics inside it listed within it (to any depth, indented),
// each with the notes and saved pages filed under it, a tile for what is
// filed under the subject alone, and the [[links]] the learner wrote drawn as
// lines between what they join, in the colours of the subjects at either
// end: solid to a topic, dashed to a note. Pointing at anything (or tabbing
// to it) lights what is joined to it and dims the rest; choosing a topic
// opens it. Everything on it is an edge the Knowledge Map returned; the
// arrangement is the record's order and is not saved.

type Line = { id: string; from: string; to: string; d: string; ax: number; ay: number; bx: number; by: number; fromHue: number; toHue: number; toNote: boolean }

const sel = (id: string) => `[data-node="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id}"]`
const tone = (hue: number) => `oklch(var(--tone-l) var(--tone-c) ${hue})`
const hueOf = (node: MapNode) => subjectColor(nodeSubject(node)).hue
const LEVEL_STEPS = { weak: 1, developing: 2, solid: 3 } as const
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const rawId = (nodeId: string) => nodeId.slice('topic:'.length)

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

function ItemLine({ item, dim, onPoint, onLeave }: { item: Item; dim: boolean; onPoint: () => void; onLeave: () => void }) {
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
      className={cn('rounded-lg transition-opacity', dim && 'opacity-35')}>
      {item.href
        ? <Link href={item.href} className="group flex items-start gap-2 rounded-lg px-1.5 py-1 hover:bg-white/4 focus-visible:outline-2 focus-visible:outline-keppel-400">{body}</Link>
        : item.type === 'resource'
          ? <a href={item.url} target="_blank" rel="noreferrer noopener" className="group flex items-start gap-2 rounded-lg px-1.5 py-1 hover:bg-white/4 focus-visible:outline-2 focus-visible:outline-keppel-400">{body}</a>
          : <span className="flex items-start gap-2 px-1.5 py-1">{body}</span>}
    </li>
  )
}

function NodeName({ node, here }: { node: MapNode; here: boolean }) {
  const subject = nodeSubject(node)
  const elsewhere = !here && subject ? ` · ${subject}` : ''
  const body = <span className="truncate">{node.label}{elsewhere && <span className="text-foreground/50">{elsewhere}</span>}</span>
  return node.href
    ? <Link href={node.href} className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-foreground/85 hover:underline">{body}</Link>
    : <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-foreground/85">{body}</span>
}

// How a topic stands, in one short line: its level and review for a studied
// topic, else how many studied topics are inside it.
function Standing({ topic, state, inside }: { topic: BoardTopic['topic']; state: KnowledgeTopic | undefined; inside: { topics: number; due: number } }) {
  if (state) {
    const level = topic.sessions > 0 && topic.level ? topic.level : null
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-foreground/60">
        <LevelMeter level={level} />
        <span>{level ? LEVEL_LABEL[level] : LEVEL_LABEL.unverified}</span>
        {state.reviewState === 'due'
          ? <span className="font-semibold text-amber-300">Due</span>
          : state.reviewState !== 'unscheduled' && <span className="text-foreground/50">{reviewLabel(state)}</span>}
      </span>
    )
  }
  if (inside.topics === 0) return null
  return (
    <span className="text-[11px] text-foreground/55">
      {plural(inside.topics, 'topic', 'topics')} inside{inside.due > 0 && <> · <span className="font-semibold text-amber-300">{inside.due} due</span></>}
    </span>
  )
}

export function SubjectBoardView({ map, subject, onOpenTopic }: {
  map:         NovaKnowledgeMapReady
  subject:     KnowledgeSubject
  // Opens the topic's own page.
  onOpenTopic: (topicId: string) => void
}) {
  const board = subjectBoard(map, subject.subjectId)
  // The Knowledge view has each studied topic's state; the map has what is filed under it.
  const stateOf = new Map(subject.topics.map(t => [`topic:${t.id}`, t]))
  const newNote = () => `/notes/new?subjectId=${encodeURIComponent(subject.subjectId)}`

  // Tiles: each topic at the top of the subject, with the topics inside it.
  const tiles: Array<{ top: BoardTopic; inner: BoardTopic[] }> = []
  for (const t of board.topics) {
    if (t.depth === 0 || tiles.length === 0) tiles.push({ top: t, inner: [] })
    else tiles[tiles.length - 1].inner.push(t)
  }
  // Studied topics inside a topic, and how many are due, from the subject's own state.
  const insideOf = (id: string) => {
    const below: BoardTopic[] = []
    const start = board.topics.findIndex(t => t.topic.id === id)
    const depth = board.topics[start]?.depth ?? 0
    for (let i = start + 1; i < board.topics.length && board.topics[i].depth > depth; i++) below.push(board.topics[i])
    const studied = below.map(b => stateOf.get(b.topic.id)).filter((x): x is KnowledgeTopic => x !== undefined)
    return { topics: studied.length, due: studied.filter(x => x.reviewState === 'due').length }
  }

  const gid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const canvas = useRef<HTMLDivElement>(null)
  const [lines, setLines]   = useState<Line[]>([])
  const [active, setActive] = useState<string | null>(null)
  const near = active ? boardNeighbourhood(board, active) : null
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

  if (board.topics.length === 0 && board.loose.length === 0) {
    return (
      <div className="subject-tone nova-canvas relative overflow-hidden rounded-2xl border border-dashed border-[var(--sc-edge)] bg-[var(--sc-faint)] px-6 py-12 text-center" style={toneStyle(subject.subjectName)} data-empty="board">
        <span aria-hidden className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-[var(--sc-soft)] text-[var(--sc-ink)]"><Hash className="size-5" /></span>
        <p className="mt-4 text-base font-semibold text-foreground">No topics in {subject.subjectName} yet</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-foreground/60">Its topics, and the notes and pages filed under them, appear here once they are on record.</p>
        <Link href={newNote()} className={cn(BUTTON_QUIET, 'mt-5 bg-card')}><Plus aria-hidden className="size-3.5" /> Write a note filed here</Link>
      </div>
    )
  }

  const dimmed = (ids: string[]) => near !== null && !ids.some(id => near.has(id))
  const point = (id: string) => () => setActive(id)

  // A topic's name: opens it.
  const topicButton = (t: BoardTopic, big = false) => (
    <button type="button" onClick={() => onOpenTopic(rawId(t.topic.id))} onFocus={point(t.topic.id)}
      className={cn('min-w-0 text-left leading-snug tracking-tight text-foreground hover:text-[var(--sc-ink)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-keppel-400',
        big ? 'text-[15px] font-semibold' : 'text-[13px] font-medium')}
      data-open-topic={t.topic.label}>
      {t.topic.label}
    </button>
  )

  return (
    <div data-board={subject.subjectName}>
      <div ref={canvas} style={toneStyle(subject.subjectName)}
        className="subject-tone nova-canvas relative min-w-0 rounded-2xl border border-white/8 bg-[var(--sc-faint)] p-3 sm:p-5"
        onMouseLeave={() => setActive(null)}>
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
              <g key={line.id} className="transition-opacity duration-200" style={{ opacity: near === null ? 0.6 : lit ? 1 : 0.08 }}>
                {lit && <path d={line.d} fill="none" stroke={stroke} strokeWidth={8} strokeLinecap="round" opacity={0.18} />}
                <path d={line.d} fill="none" stroke={stroke} strokeWidth={lit ? 2.5 : 1.5} strokeLinecap="round"
                  strokeDasharray={line.toNote ? '6 5' : undefined} className={lit && line.toNote ? 'nova-flow' : undefined} />
                <circle cx={line.ax} cy={line.ay} r={3} style={{ fill: 'var(--card)', stroke: tone(line.fromHue) }} strokeWidth={1.75} />
                <circle cx={line.bx} cy={line.by} r={lit ? 4.5 : 3.5} style={{ fill: tone(line.toHue) }} />
              </g>
            )
          })}
        </svg>

        <ul className="columns-1 gap-4 sm:columns-2 2xl:columns-3 [&>li]:mb-4 [&>li]:break-inside-avoid">
          {tiles.map(({ top, inner }) => {
            const state = stateOf.get(top.topic.id)
            const lit = near !== null && near.has(top.topic.id)
            const all = [top, ...inner]
            return (
              <li key={top.topic.id} data-node={top.topic.id} data-board-topic={top.topic.label}
                onMouseEnter={point(top.topic.id)}
                className={cn('relative overflow-hidden rounded-2xl border bg-card transition-[opacity,box-shadow,filter] duration-200',
                  state && !(top.topic.sessions > 0) ? 'border-dashed border-white/20' : 'border-white/10',
                  lit ? 'shadow-soft ring-1 ring-[var(--sc-edge)]' : 'shadow-sm shadow-black/5',
                  dimmed(all.flatMap(t => [t.topic.id, ...t.items.map(i => i.id)])) && 'opacity-35 saturate-50')}>
                <div className="bg-linear-to-br from-[var(--sc-soft)] via-[var(--sc-faint)] to-transparent px-3.5 pb-3 pt-3.5">
                  {topicButton(top, true)}
                  <p className="mt-1.5"><Standing topic={top.topic} state={state} inside={insideOf(top.topic.id)} /></p>
                </div>
                {top.items.length > 0 && (
                  <ul className="space-y-0.5 border-t border-white/6 px-2 py-2">
                    {top.items.map(item => <ItemLine key={item.id} item={item} dim={near !== null && !near.has(item.id)} onPoint={point(item.id)} onLeave={point(top.topic.id)} />)}
                  </ul>
                )}
                {inner.length > 0 && (
                  <ul className="border-t border-white/6 py-1.5" data-inside={top.topic.label}>
                    {inner.map(t => {
                      const s = stateOf.get(t.topic.id)
                      return (
                        <li key={t.topic.id} data-node={t.topic.id} data-board-topic={t.topic.label} onMouseEnter={point(t.topic.id)}
                          className={cn('relative py-1 pr-3 transition-opacity', near !== null && !near.has(t.topic.id) && !t.items.some(i => near.has(i.id)) && 'opacity-40')}
                          style={{ paddingLeft: 14 + (t.depth - 1) * 14 }}>
                          {t.depth > 1 && <span aria-hidden className="absolute inset-y-0 w-px bg-white/8" style={{ left: 14 + (t.depth - 2) * 14 + 4 }} />}
                          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                            {topicButton(t)}
                            <Standing topic={t.topic} state={s} inside={insideOf(t.topic.id)} />
                          </div>
                          {t.items.length > 0 && (
                            <ul className="mt-0.5 space-y-0.5">
                              {t.items.map(item => <ItemLine key={item.id} item={item} dim={near !== null && !near.has(item.id)} onPoint={point(item.id)} onLeave={point(t.topic.id)} />)}
                            </ul>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            )
          })}

          {board.loose.length > 0 && (
            <li data-board-loose className={cn('rounded-2xl border border-white/8 bg-card/85 p-3.5 transition-opacity', dimmed(board.loose.map(i => i.id)) && 'opacity-35')}>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground/85"><FolderOpen aria-hidden className="size-4 text-[var(--sc-ink)]" /> Filed under {subject.subjectName}</p>
              <ul className="mt-2 space-y-0.5 border-t border-white/6 pt-2">
                {board.loose.map(item => <ItemLine key={item.id} item={item} dim={near !== null && !near.has(item.id)} onPoint={point(item.id)} onLeave={() => setActive(null)} />)}
              </ul>
            </li>
          )}
        </ul>
      </div>

      {(map.notShown.notes > 0 || map.notShown.resources > 0) && (
        <p className="mt-2 text-[11px] text-foreground/50">Only your newest notes and saved pages are on the board.</p>
      )}

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
