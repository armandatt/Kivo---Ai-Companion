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
import { LEVEL_LABEL, LEVEL_TONE } from './labels'
import { nodeSubject, subjectBoard, type BoardTopic, type Item } from './subject-board'

// A subject laid out as a board: a card for each topic at the top of the
// subject, the topics inside it listed within it (to any depth, indented),
// with the notes and saved pages filed under them, a card for what is filed
// under the subject alone, and the [[links]] the learner wrote drawn as lines
// between what they join. Everything on it is an edge the Knowledge Map
// returned; the arrangement is the record's order.
//
// Hover is CSS only: a card's border and surface brighten, nothing moves or
// fades. The one thing the pointer drives is which card's links are lit, and
// that is set once when the pointer enters a card, never by what is inside it,
// so moving within or between cards does not re-render the board or dim
// anything.

type Line = { id: string; from: string; to: string; d: string; ax: number; ay: number; bx: number; by: number; fromHue: number; toHue: number; toNote: boolean }

const sel = (id: string) => `[data-node="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id}"]`
const tone = (hue: number) => `oklch(var(--tone-l) var(--tone-c) ${hue})`
const hueOf = (node: MapNode) => subjectColor(nodeSubject(node)).hue
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const rawId = (nodeId: string) => nodeId.slice('topic:'.length)
// Rows shown inside a card, and items under it, before "more".
const ROWS_SHOWN  = 6
const ITEMS_SHOWN = 3

const NOTE_CHIP = 'bg-[color-mix(in_oklch,var(--map-note)_18%,transparent)] text-[var(--map-note)]'
const PAGE_CHIP = 'bg-[color-mix(in_oklch,var(--map-resource)_18%,transparent)] text-[var(--map-resource)]'

// A studied topic's level as a dot; hollow with no session behind it.
function LevelDot({ state }: { state: KnowledgeTopic | undefined }) {
  if (state && state.level !== 'unverified') return <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', LEVEL_TONE[state.level])} />
  return <span aria-hidden className="size-1.5 shrink-0 rounded-full border border-foreground/35" />
}

// What a row says on its right: due, the level, or how much is inside.
function RowStatus({ state, inside }: { state: KnowledgeTopic | undefined; inside: { topics: number; due: number } }) {
  if (state) {
    if (state.reviewState === 'due') return <span className="shrink-0 text-[11px] font-semibold text-amber-300">Due</span>
    return <span className="shrink-0 text-[11px] text-foreground/50">{state.level === 'unverified' ? 'Not yet' : LEVEL_LABEL[state.level]}</span>
  }
  if (inside.topics === 0) return null
  return <span className={cn('shrink-0 text-[11px] tabular-nums', inside.due ? 'font-semibold text-amber-300' : 'text-foreground/50')}>{inside.due ? `${inside.due} due` : inside.topics}</span>
}

function ItemLine({ item, compact }: { item: Item; compact?: boolean }) {
  const note = item.type === 'note'
  const Icon = note ? FileText : Bookmark
  const body = (
    <>
      <span aria-hidden className={cn('flex shrink-0 items-center justify-center rounded', compact ? 'size-4' : 'size-5', note ? NOTE_CHIP : PAGE_CHIP)}>
        <Icon className={compact ? 'size-2.5' : 'size-3'} />
      </span>
      <span className="min-w-0 truncate group-hover/item:underline">{item.label}</span>
      {!compact && <span className="ml-auto shrink-0 text-[11px] text-foreground/45">{note ? relativeDay(item.updatedAt) : item.domain}</span>}
    </>
  )
  const cls = cn('group/item flex min-w-0 items-center gap-2 rounded-md px-1.5 text-foreground/80 hover:bg-white/4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-keppel-400', compact ? 'py-0.5 text-[12px]' : 'py-1 text-[13px]')
  return (
    <li data-node={item.id} title={item.label} className="min-w-0">
      {item.href ? <Link href={item.href} className={cls}>{body}</Link>
        : item.type === 'resource' ? <a href={item.url} target="_blank" rel="noreferrer noopener" className={cls}>{body}</a>
        : <span className={cls}>{body}</span>}
    </li>
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

  // Cards: each topic at the top of the subject, with the topics inside it.
  const cards: Array<{ top: BoardTopic; inner: BoardTopic[] }> = []
  for (const t of board.topics) {
    if (t.depth === 0 || cards.length === 0) cards.push({ top: t, inner: [] })
    else cards[cards.length - 1].inner.push(t)
  }
  // Studied topics inside a topic, and how many are due.
  const insideOf = (id: string) => {
    const start = board.topics.findIndex(t => t.topic.id === id)
    const depth = board.topics[start]?.depth ?? 0
    const studied: KnowledgeTopic[] = []
    for (let i = start + 1; i < board.topics.length && board.topics[i].depth > depth; i++) {
      const s = stateOf.get(board.topics[i].topic.id)
      if (s) studied.push(s)
    }
    return { topics: studied.length, due: studied.filter(x => x.reviewState === 'due').length }
  }

  const gid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const canvas = useRef<HTMLDivElement>(null)
  const [lines, setLines] = useState<Line[]>([])
  // The card under the pointer (its top topic's id): its links are lit.
  const [hovered, setHovered] = useState<string | null>(null)
  const cardIds = new Map(cards.map(c => [c.top.topic.id, new Set([c.top, ...c.inner].flatMap(t => [t.topic.id, ...t.items.map(i => i.id)]))]))
  const litIds = hovered ? cardIds.get(hovered) ?? null : null
  const onBoard = new Set([...board.topics.flatMap(t => [t.topic.id, ...t.items.map(i => i.id)]), ...board.loose.map(i => i.id)])
  const linkKey = board.links.map(l => l.id).join('|')

  // The lines are measured from where the cards were drawn, and drawn again
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
        const ay = ra.top + Math.min(ra.height / 2, 18) - box.top
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
      <div className="rounded-2xl border border-dashed border-white/12 px-6 py-14 text-center" data-empty="board">
        <span aria-hidden className="mx-auto flex size-10 items-center justify-center rounded-xl bg-white/5 text-foreground/60"><Hash className="size-4" /></span>
        <p className="mt-4 text-[15px] font-semibold text-foreground">No topics in {subject.subjectName} yet</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-foreground/60">Its topics, and the notes and pages filed under them, appear here once they are on record.</p>
        <Link href={`/notes/new?subjectId=${encodeURIComponent(subject.subjectId)}`} className={cn(BUTTON_QUIET, 'mt-5')}><Plus aria-hidden className="size-3.5" /> Write a note filed here</Link>
      </div>
    )
  }

  const CARD = 'relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-white/8 bg-card/70 transition-colors duration-150 hover:border-white/16 hover:bg-card'

  return (
    <div data-board={subject.subjectName}>
      <div ref={canvas} className="relative" style={toneStyle(subject.subjectName)} onPointerLeave={() => setHovered(null)}>
        {/* The links, drawn over the cards; they take no clicks. Only their opacity follows the pointer. */}
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
            const lit = litIds !== null && (litIds.has(line.from) || litIds.has(line.to))
            return (
              <g key={line.id} className="transition-opacity duration-150" style={{ opacity: litIds === null ? 0.45 : lit ? 1 : 0.12 }}>
                <path d={line.d} fill="none" stroke={`url(#${gid}-l${i})`} strokeWidth={lit ? 2 : 1.5} strokeLinecap="round" strokeDasharray={line.toNote ? '6 5' : undefined} />
                <circle cx={line.ax} cy={line.ay} r={2.75} style={{ fill: 'var(--card)', stroke: tone(line.fromHue) }} strokeWidth={1.5} />
                <circle cx={line.bx} cy={line.by} r={3.25} style={{ fill: tone(line.toHue) }} />
              </g>
            )
          })}
        </svg>

        <ul className="grid items-start gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,17.5rem),1fr))]">
          {cards.map(({ top, inner }) => {
            const state = stateOf.get(top.topic.id)
            const inside = insideOf(top.topic.id)
            const shown = inner.slice(0, ROWS_SHOWN)
            const more = inner.length - shown.length
            return (
              <li key={top.topic.id} data-board-topic={top.topic.label} data-card={top.topic.id}
                onPointerEnter={() => setHovered(top.topic.id)} className={CARD}>
                <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-[var(--sc)] opacity-70" />
                <div data-node={top.topic.id} className="flex items-start justify-between gap-3 px-4 pb-2.5 pt-3.5">
                  <div className="min-w-0">
                    <button type="button" onClick={() => onOpenTopic(rawId(top.topic.id))} title={top.topic.label} data-open-topic={top.topic.label}
                      className="line-clamp-2 text-left text-[15px] font-semibold leading-snug tracking-tight text-foreground hover:text-[var(--sc-ink)] focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-keppel-400">
                      {top.topic.label}
                    </button>
                    <p className="mt-1 flex items-center gap-1.5 text-[11px] text-foreground/55">
                      {state ? (
                        <><LevelDot state={state} />{state.level === 'unverified' ? 'No session yet' : `${LEVEL_LABEL[state.level]} · ${state.masteryPercent}%`}</>
                      ) : inner.length > 0 ? (
                        plural(inner.length, 'topic', 'topics')
                      ) : 'Nothing inside yet'}
                    </p>
                  </div>
                  {(state?.reviewState === 'due' || inside.due > 0) && (
                    <span className="mt-0.5 shrink-0 rounded-full bg-amber-300/12 px-2 py-0.5 text-[10px] font-semibold text-amber-300">{state ? 'Due' : `${inside.due} due`}</span>
                  )}
                </div>

                {shown.length > 0 && (
                  <ul className="border-t border-white/6 py-1.5" data-inside={top.topic.label}>
                    {shown.map(t => {
                      const s = stateOf.get(t.topic.id)
                      const indent = 12 + (t.depth - 1) * 14
                      return (
                        <li key={t.topic.id} data-board-topic={t.topic.label} className="relative">
                          {t.depth > 1 && <span aria-hidden className="absolute inset-y-0 w-px bg-white/8" style={{ left: indent - 8 }} />}
                          <button type="button" onClick={() => onOpenTopic(rawId(t.topic.id))} title={t.topic.label} data-open-topic={t.topic.label} data-node={t.topic.id}
                            className="flex h-8 w-full min-w-0 items-center gap-2 pr-4 text-left text-[13px] text-foreground/85 transition-colors hover:bg-white/4 hover:text-foreground focus-visible:bg-white/5 focus-visible:outline-none"
                            style={{ paddingLeft: indent }}>
                            <LevelDot state={s} />
                            <span className="min-w-0 flex-1 truncate">{t.topic.label}</span>
                            <RowStatus state={s} inside={insideOf(t.topic.id)} />
                          </button>
                          {t.items.length > 0 && (
                            <ul className="pb-1 pr-3" style={{ paddingLeft: indent + 8 }}>
                              {t.items.slice(0, ITEMS_SHOWN).map(item => <ItemLine key={item.id} item={item} compact />)}
                            </ul>
                          )}
                        </li>
                      )
                    })}
                    {more > 0 && (
                      <li>
                        <button type="button" onClick={() => onOpenTopic(rawId(top.topic.id))} className="flex h-8 w-full items-center px-3 text-[12px] font-medium text-foreground/55 hover:text-foreground focus-visible:outline-none focus-visible:underline" data-more={more}>
                          +{more} more in {top.topic.label}
                        </button>
                      </li>
                    )}
                  </ul>
                )}

                {top.items.length > 0 && (
                  <ul className="space-y-0.5 border-t border-white/6 px-2.5 py-2">
                    {top.items.slice(0, ITEMS_SHOWN).map(item => <ItemLine key={item.id} item={item} />)}
                    {top.items.length > ITEMS_SHOWN && <li className="px-1.5 pt-0.5 text-[11px] text-foreground/50">+{top.items.length - ITEMS_SHOWN} more filed here</li>}
                  </ul>
                )}
              </li>
            )
          })}

          {board.loose.length > 0 && (
            <li data-board-loose onPointerEnter={() => setHovered(null)} className={CARD}>
              <p className="flex items-center gap-1.5 px-4 pb-2.5 pt-3.5 text-[13px] font-semibold text-foreground/85"><FolderOpen aria-hidden className="size-3.5 text-foreground/50" /> Filed under {subject.subjectName}</p>
              <ul className="space-y-0.5 border-t border-white/6 px-2.5 py-2">
                {board.loose.map(item => <ItemLine key={item.id} item={item} />)}
              </ul>
            </li>
          )}
        </ul>
      </div>

      {(map.notShown.notes > 0 || map.notShown.resources > 0) && (
        <p className="mt-3 text-[11px] text-foreground/50">Only your newest notes and saved pages are on the board.</p>
      )}

      {/* Where the lines are not drawn (a phone), the links as a list */}
      {board.links.length > 0 && (
        <section aria-labelledby="board-links" className="mt-5 sm:hidden">
          <h3 id="board-links" className="flex items-center gap-2 text-xs font-semibold text-foreground/70"><Link2 aria-hidden className="size-3.5" /> Links you wrote</h3>
          <ul className="mt-2 space-y-2">
            {board.links.map(link => (
              <li key={link.id} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-white/8 bg-card/70 px-3 py-2 text-sm text-foreground/85">
                <span className="truncate">{link.from.label}{!onBoard.has(link.from.id) && nodeSubject(link.from) ? <span className="text-foreground/50"> · {nodeSubject(link.from)}</span> : null}</span>
                <ArrowRight aria-hidden className="size-3.5 shrink-0 text-foreground/40" /><span className="sr-only">links to</span>
                <span className="truncate">{link.to.label}{!onBoard.has(link.to.id) && nodeSubject(link.to) ? <span className="text-foreground/50"> · {nodeSubject(link.to)}</span> : null}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
