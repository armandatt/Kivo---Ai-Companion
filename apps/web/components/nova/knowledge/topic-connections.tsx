'use client'

import Link from 'next/link'
import { ArrowUpRight, Bookmark, FileText, Waypoints } from 'lucide-react'
import type { NovaKnowledgeMapReady } from '@repo/api/nova/product/knowledge-map.types'
import { cn } from '@/lib/utils'
import { subjectColor, toneStyle } from '../subject-color'
import { TEXT_LINK } from '../workspace/ui'
import { RELATION_WORDS, topicConnections } from './connections'

// What else on the learner's record is joined to this topic, from the
// Knowledge Map's stored edges: saved pages filed under it, notes whose
// [[links]] name it, and other topics reached through one of their notes,
// each with that note named. The notes filed under the topic are listed by
// TopicNotes beside this, so they are not repeated.
export function TopicConnections({ map, topicId, topicName, onOpenTopic }: {
  map:         NovaKnowledgeMapReady | null
  topicId:     string
  topicName:   string
  onOpenTopic: (topicId: string) => void
}) {
  const nodeId = `topic:${topicId}`
  const mapLink = <Link href={`/map?focus=${encodeURIComponent(nodeId)}`} className={TEXT_LINK}><Waypoints aria-hidden className="size-3.5" /> Open on the map</Link>

  if (!map) {
    return <div className="mt-4 flex items-center justify-between gap-3"><p className="text-xs text-foreground/50">Connections load with the map.</p>{mapLink}</div>
  }

  const { filed, mentionedIn, related } = topicConnections(map, nodeId)
  const pages = filed.filter(n => n.type === 'resource')
  const nothing = pages.length === 0 && mentionedIn.length === 0 && related.length === 0

  return (
    <div className="mt-4 border-t border-white/6 pt-4" data-topic-connections={topicName}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-foreground/70">Connections</p>
        {mapLink}
      </div>

      {nothing ? (
        <p className="mt-2 text-sm text-foreground/55">
          Nothing else on record links here yet. Write <code className="rounded bg-white/6 px-1 text-[12px]">[[{topicName}]]</code> in a note to connect it.
        </p>
      ) : (
        <div className="mt-2 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {related.length > 0 && (
            <div className="sm:col-span-2">
              <p className="text-[11px] font-medium text-foreground/55">Related topics</p>
              <ul className="mt-1.5 flex flex-wrap gap-2">
                {related.map(r => {
                  const color = subjectColor(r.topic.subjectName)
                  return (
                    <li key={r.topic.id} className="max-w-full">
                      <button type="button" onClick={() => onOpenTopic(r.topic.id.slice('topic:'.length))}
                        title={RELATION_WORDS[r.relation](r.via.label)} style={toneStyle(r.topic.subjectName)}
                        className={cn('subject-tone flex max-w-full flex-col items-start rounded-xl border bg-[var(--sc-faint)] px-3 py-2 text-left transition-[background-color,box-shadow,transform] hover:-translate-y-px hover:bg-[var(--sc-soft)] hover:shadow-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-keppel-400', color.border)}>
                        <span className="flex max-w-full items-center gap-1.5 text-sm font-medium text-foreground/90">
                          <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', color.dot)} />
                          <span className="truncate">{r.topic.label}</span>
                          <span className="shrink-0 text-xs font-normal text-foreground/50">{r.topic.subjectName}</span>
                        </span>
                        <span className="max-w-full truncate text-[11px] text-foreground/55">{RELATION_WORDS[r.relation](r.via.label)}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          {mentionedIn.length > 0 && (
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-foreground/55">Notes that link here</p>
              <ul className="mt-1 space-y-1">
                {mentionedIn.map(n => (
                  <li key={n.id} className="flex min-w-0 items-center gap-1.5 text-sm">
                    <FileText aria-hidden className="size-3.5 shrink-0 text-foreground/45" />
                    {n.href ? <Link href={n.href} className="truncate text-foreground/85 hover:underline">{n.label}</Link> : <span className="truncate text-foreground/85">{n.label}</span>}
                    {n.subjectName && <span className="shrink-0 text-xs text-foreground/45">{n.subjectName}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {pages.length > 0 && (
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-foreground/55">Saved pages filed here</p>
              <ul className="mt-1 space-y-1">
                {pages.map(p => (
                  <li key={p.id} className="flex min-w-0 items-center gap-1.5 text-sm">
                    <Bookmark aria-hidden className="size-3.5 shrink-0 text-foreground/45" />
                    {p.href ? <Link href={p.href} className="truncate text-foreground/85 hover:underline">{p.label}</Link> : <span className="truncate text-foreground/85">{p.label}</span>}
                    {p.type === 'resource' && <a href={p.url} target="_blank" rel="noreferrer noopener" aria-label={`Open ${p.domain} in a new tab`} className="shrink-0 text-foreground/45 hover:text-foreground"><ArrowUpRight aria-hidden className="size-3.5" /></a>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
