'use client'

import Link from 'next/link'
import { ArrowRight, Bookmark, FileText, FolderOpen, Hash, Link2, Plus } from 'lucide-react'
import type { MapNode, NovaKnowledgeMapReady } from '@repo/api/nova/product/knowledge-map.types'
import type { KnowledgeSubject } from '@repo/api/nova/product/knowledge.types'
import { cn } from '@/lib/utils'
import { relativeDay } from '../format'
import { LEVEL_LABEL, LEVEL_TONE, reviewLabel } from './labels'
import { subjectBoard, type Item } from './subject-board'

// A subject laid out as a board: one tile per topic, holding the notes and
// saved pages filed under it, a tile for what is filed under the subject
// alone, and the [[links]] the learner wrote. Everything on it is an edge the
// Knowledge Map returned; a topic with nothing filed under it says so.

function ItemLine({ item }: { item: Item }) {
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
    <li>
      {item.href
        ? <Link href={item.href} className="group -mx-1.5 flex items-start gap-2 rounded-md px-1.5 py-1 hover:bg-white/4">{body}</Link>
        : <span className="-mx-1.5 flex items-start gap-2 px-1.5 py-1">{body}</span>}
    </li>
  )
}

const nodeIcon = (n: MapNode) => n.type === 'note' ? FileText : n.type === 'resource' ? Bookmark : n.type === 'topic' ? Hash : FolderOpen

function NodeName({ node }: { node: MapNode }) {
  const Icon = nodeIcon(node)
  const body = <><Icon aria-hidden className="size-3 shrink-0 text-foreground/45" /><span className="truncate">{node.label}</span></>
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

  if (board.topics.length === 0 && board.loose.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-white/12 px-4 py-6 text-sm text-foreground/60" data-empty="board">
        Nothing on record under {subject.subjectName} yet. <Link href={newNote()} className="font-medium text-keppel-300 hover:text-keppel-200">Write a note</Link> filed here, or save a page under it.
      </p>
    )
  }

  return (
    <div data-board={subject.subjectName}>
      <p className="text-xs text-foreground/60">
        {filed === 0 ? 'No notes or saved pages are filed under these topics yet.' : `${filed} ${filed === 1 ? 'item is' : 'items are'} filed here.`}
        {(map.notShown.notes > 0 || map.notShown.resources > 0) && ' Only your newest notes and saved pages are on the board.'}
      </p>

      {/* The tiles sit in columns like cards on a desk; their order is the map's. */}
      <ul className="mt-3 columns-1 gap-3 sm:columns-2 2xl:columns-3 [&>li]:mb-3 [&>li]:break-inside-avoid">
        {board.topics.map(({ topic, items }) => {
          const state = stateOf.get(topic.id)
          const level = topic.sessions > 0 && topic.level ? topic.level : null
          const rawId = topic.id.slice('topic:'.length)
          return (
            <li key={topic.id} data-board-topic={topic.label}
              className={cn('rounded-xl border bg-card/60 p-3.5', level ? 'border-white/10' : 'border-dashed border-white/15')}>
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
                <ul className="mt-2.5 space-y-0.5 border-t border-white/6 pt-2">{items.map(item => <ItemLine key={item.id} item={item} />)}</ul>
              ) : (
                <Link href={newNote(topic.label)} className="mt-2.5 inline-flex items-center gap-1 text-[11px] text-foreground/55 hover:text-foreground">
                  <Plus aria-hidden className="size-3" /> Note on this topic
                </Link>
              )}
            </li>
          )
        })}

        {board.loose.length > 0 && (
          <li data-board-loose className="rounded-xl border border-white/8 bg-white/2 p-3.5">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground/85"><FolderOpen aria-hidden className="size-4 text-foreground/45" /> Filed under {subject.subjectName}</p>
            <p className="mt-0.5 text-[11px] text-foreground/55">Under the subject, not a topic.</p>
            <ul className="mt-2.5 space-y-0.5 border-t border-white/6 pt-2">{board.loose.map(item => <ItemLine key={item.id} item={item} />)}</ul>
          </li>
        )}
      </ul>

      {board.links.length > 0 && (
        <section aria-labelledby="board-links" className="mt-4 border-t border-white/8 pt-4">
          <h3 id="board-links" className="flex items-center gap-2 text-xs font-semibold text-foreground/70"><Link2 aria-hidden className="size-3.5" /> Links you wrote</h3>
          <ul className="mt-2 space-y-1.5">
            {board.links.map(link => (
              <li key={link.id} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                <NodeName node={link.from} />
                <ArrowRight aria-hidden className="size-3.5 shrink-0 text-keppel-300/70" /><span className="sr-only">links to</span>
                <NodeName node={link.to} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
