'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Bookmark, FileText, FolderOpen, Hash, Link2, Plus, Waypoints } from 'lucide-react'
import type { MapNode, NovaKnowledgeMapReady } from '@repo/api/nova/product/knowledge-map.types'
import type { KnowledgeSubject } from '@repo/api/nova/product/knowledge.types'
import { cn } from '@/lib/utils'
import { relativeDay } from '../format'
import { subjectColor } from '../subject-color'
import { LEVEL_LABEL, LEVEL_TONE, reviewLabel } from './labels'
import { boardNeighbourhood, subjectBoard, type Item } from './subject-board'

// A subject laid out as a board: one tile per topic, holding the notes and
// saved pages filed under it, a tile for what is filed under the subject
// alone, and the [[links]] the learner wrote drawn as lines between what they
// join. Pointing at anything (or tabbing to it) lights what is joined to it
// and dims the rest. Everything on it is an edge the Knowledge Map returned;
// the arrangement is the record's order and is not saved.

type Line = { id: string; from: string; to: string; d: string; endX: number; endY: number }

const sel = (id: string) => `[data-node="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id}"]`

function ItemLine({ item, dim, onPoint, onLeave }: { item: Item; dim: boolean; onPoint: () => void; onLeave: () => void }) {
  const Icon = item.type === 'note' ? FileText : Bookmark
  const when = item.type === 'note' ? `edited ${relativeDay(item.updatedAt)}` : `${item.domain} · saved ${relativeDay(item.savedAt)}`
  const body = (
    <>
      <Icon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-foreground/45" />
      <span className="min-w-0">
        <span className="block truncate text-sm text-foreground/90 group-hover:underline">{item.label}</span>
        <span className="block truncate text-[11px] text-foreground/55">{when}</span>
      </span>
    </>
  )
  return (
    <li data-node={item.id} onMouseEnter={onPoint} onMouseLeave={onLeave} onFocus={e => { e.stopPropagation(); onPoint() }}
      className={cn('transition-opacity', dim && 'opacity-40')}>
      {item.href
        ? <Link href={item.href} className="group -mx-1.5 flex items-start gap-2 rounded-md px-1.5 py-1 hover:bg-white/4 focus-visible:outline-2 focus-visible:outline-keppel-400">{body}</Link>
        : <span className="-mx-1.5 flex items-start gap-2 px-1.5 py-1">{body}</span>}
    </li>
  )
}

const nodeIcon = (n: MapNode) => n.type === 'note' ? FileText : n.type === 'resource' ? Bookmark : n.type === 'topic' ? Hash : FolderOpen

function NodeName({ node, here }: { node: MapNode; here: boolean }) {
  const Icon = nodeIcon(node)
  const elsewhere = !here && 'subjectName' in node && node.subjectName ? ` · ${node.subjectName}` : ''
  const body = <><Icon aria-hidden className="size-3 shrink-0 text-foreground/45" /><span className="truncate">{node.label}{elsewhere && <span className="text-foreground/50">{elsewhere}</span>}</span></>
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
  const color = subjectColor(subject.subjectName)
  // The Knowledge view has each topic's state; the map has what is filed under it.
  const stateOf = new Map(subject.topics.map(t => [`topic:${t.id}`, t]))
  const newNote = (topic?: string) => `/notes/new?subjectId=${encodeURIComponent(subject.subjectId)}${topic ? `&topic=${encodeURIComponent(topic)}` : ''}`
  const filed = board.topics.reduce((n, t) => n + t.items.length, 0) + board.loose.length

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
        const by = rb.top + Math.min(rb.height / 2, 14) - box.top
        let ax: number, bx: number, c1: number, c2: number
        if (rb.left >= ra.right - 4) { ax = ra.right - box.left; bx = rb.left - box.left; const k = Math.max(30, (bx - ax) / 2); c1 = ax + k; c2 = bx - k }
        else if (rb.right <= ra.left + 4) { ax = ra.left - box.left; bx = rb.right - box.left; const k = Math.max(30, (ax - bx) / 2); c1 = ax - k; c2 = bx + k }
        else { ax = ra.left - box.left; bx = rb.left - box.left; c1 = ax - 36; c2 = bx - 36 }   // same column: loop out to the left
        next.push({ id: link.id, from: link.from.id, to: link.to.id, d: `M ${ax} ${ay} C ${c1} ${ay}, ${c2} ${by}, ${bx} ${by}`, endX: bx, endY: by })
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
      <p className="rounded-lg border border-dashed border-white/12 px-4 py-6 text-sm text-foreground/60" data-empty="board">
        Nothing on record under {subject.subjectName} yet. <Link href={newNote()} className="font-medium text-keppel-300 hover:text-keppel-200">Write a note</Link> filed here, or save a page under it.
      </p>
    )
  }

  const dimmed = (ids: string[]) => near !== null && !ids.some(id => near.has(id))

  return (
    <div data-board={subject.subjectName}>
      <p className="text-xs text-foreground/60">
        {filed === 0 ? 'No notes or saved pages are filed under these topics yet.' : `${filed} ${filed === 1 ? 'item is' : 'items are'} filed here.`}
        {' '}Lines are the [[links]] in your notes; point at anything to see what it joins. Tiles follow your record&apos;s order and can&apos;t be moved.
        {(map.notShown.notes > 0 || map.notShown.resources > 0) && ' Only your newest notes and saved pages are on the board.'}
      </p>

      <div ref={canvas} className={cn('relative mt-3 rounded-xl p-2 sm:p-3', color.tint)} onMouseLeave={() => setActive(null)}>
        {/* The links, drawn over the tiles (they start and end inside them); they take no clicks */}
        <svg aria-hidden className="pointer-events-none absolute inset-0 z-10 hidden size-full overflow-visible sm:block">
          {lines.map(line => {
            const lit = near !== null && near.has(line.from) && near.has(line.to)
            return (
              <g key={line.id} className={cn('text-keppel-400 transition-opacity', near === null ? 'opacity-60' : lit ? 'opacity-100' : 'opacity-10')}>
                <path d={line.d} fill="none" stroke="currentColor" strokeWidth={lit ? 2 : 1.5} strokeDasharray="5 4" />
                <circle cx={line.endX} cy={line.endY} r={3} fill="currentColor" />
              </g>
            )
          })}
        </svg>

        <ul className="columns-1 gap-4 sm:columns-2 2xl:columns-3 [&>li]:mb-4 [&>li]:break-inside-avoid">
          {board.topics.map(({ topic, items }) => {
            const state = stateOf.get(topic.id)
            const level = topic.sessions > 0 && topic.level ? topic.level : null
            const rawId = topic.id.slice('topic:'.length)
            return (
              <li key={topic.id} data-node={topic.id} data-board-topic={topic.label}
                onMouseEnter={() => setActive(topic.id)} onFocus={() => setActive(topic.id)} onBlur={() => setActive(null)}
                className={cn('relative overflow-hidden rounded-xl border bg-card p-3.5 shadow-sm shadow-black/5 transition-opacity',
                  level ? 'border-white/10' : 'border-dashed border-white/20',
                  dimmed([topic.id, ...items.map(i => i.id)]) && 'opacity-40')}>
                <span aria-hidden className={cn('absolute inset-x-0 top-0 h-0.5', color.bar)} />
                <div className="flex items-start justify-between gap-2">
                  <button type="button" onClick={() => onOpenTopic(rawId)}
                    className="min-w-0 text-left text-sm font-semibold text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-keppel-400">
                    {topic.label}
                  </button>
                  {state?.reviewState === 'due' && <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-amber-300">Due</span>}
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-[11px] text-foreground/60">
                  <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', LEVEL_TONE[level ?? 'unverified'])} />
                  {level ? `${LEVEL_LABEL[level]} · ${topic.sessions} session${topic.sessions === 1 ? '' : 's'}` : LEVEL_LABEL.unverified}
                  {state && state.reviewState !== 'unscheduled' && <> · {reviewLabel(state)}</>}
                </p>
                {items.length > 0 ? (
                  <ul className="mt-2.5 space-y-0.5 border-t border-white/6 pt-2">
                    {items.map(item => (
                      <ItemLine key={item.id} item={item} dim={near !== null && !near.has(item.id)}
                        onPoint={() => setActive(item.id)} onLeave={() => setActive(topic.id)} />
                    ))}
                  </ul>
                ) : (
                  <Link href={newNote(topic.label)} className="mt-2.5 inline-flex items-center gap-1 text-[11px] text-foreground/55 hover:text-foreground">
                    <Plus aria-hidden className="size-3" /> Note on this topic
                  </Link>
                )}
                <div className="mt-2.5 flex items-center gap-3 border-t border-white/6 pt-2 text-[11px]">
                  <button type="button" onClick={() => onOpenTopic(rawId)} className="font-medium text-foreground/60 hover:text-foreground">Details</button>
                  <Link href={`/map?focus=${encodeURIComponent(topic.id)}`} className="inline-flex items-center gap-1 font-medium text-foreground/60 hover:text-foreground">
                    <Waypoints aria-hidden className="size-3" /> Map
                  </Link>
                </div>
              </li>
            )
          })}

          {board.loose.length > 0 && (
            <li data-board-loose className={cn('rounded-xl border border-white/8 bg-card/70 p-3.5 transition-opacity', dimmed(board.loose.map(i => i.id)) && 'opacity-40')}>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground/85"><FolderOpen aria-hidden className="size-4 text-foreground/45" /> Filed under {subject.subjectName}</p>
              <p className="mt-0.5 text-[11px] text-foreground/55">Under the subject, not a topic.</p>
              <ul className="mt-2.5 space-y-0.5 border-t border-white/6 pt-2">
                {board.loose.map(item => (
                  <ItemLine key={item.id} item={item} dim={near !== null && !near.has(item.id)}
                    onPoint={() => setActive(item.id)} onLeave={() => setActive(null)} />
                ))}
              </ul>
            </li>
          )}
        </ul>
      </div>

      {board.links.length > 0 && (
        <section aria-labelledby="board-links" className="mt-4 border-t border-white/8 pt-4">
          <h3 id="board-links" className="flex items-center gap-2 text-xs font-semibold text-foreground/70"><Link2 aria-hidden className="size-3.5" /> Links you wrote</h3>
          <ul className="mt-2 space-y-1.5">
            {board.links.map(link => (
              <li key={link.id} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                <NodeName node={link.from} here={onBoard.has(link.from.id)} />
                <ArrowRight aria-hidden className="size-3.5 shrink-0 text-keppel-300/70" /><span className="sr-only">links to</span>
                <NodeName node={link.to} here={onBoard.has(link.to.id)} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
