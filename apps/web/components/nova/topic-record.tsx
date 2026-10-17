'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Waypoints } from 'lucide-react'
import type { NovaKnowledgeMapView } from '@repo/api/nova/product/knowledge-map.types'
import { cn } from '@/lib/utils'
import { LEVEL_LABEL } from './knowledge/labels'
import { topicRecord, type TopicRecord } from './today-links'
import { TEXT_LINK } from './workspace/ui'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// What the learner already has on this topic, as the Knowledge Map reports
// it, and the ways to it. Nothing when the map does not have the topic.
export function RecordLine({ record, className }: { record: TopicRecord | null; className?: string }) {
  if (!record) return null
  const facts = [
    record.level ? `${LEVEL_LABEL[record.level]} · ${plural(record.sessions, 'session', 'sessions')}` : LEVEL_LABEL.unverified,
    record.notes > 0 ? plural(record.notes, 'note', 'notes') : null,
    record.resources > 0 ? plural(record.resources, 'saved page', 'saved pages') : null,
    record.openTasks > 0 ? plural(record.openTasks, 'open task', 'open tasks') : null,
  ].filter(Boolean)
  return (
    <p className={cn('mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-foreground/60', className)} data-record>
      <span>{facts.join(' · ')}</span>
      {record.knowledgeHref && <Link href={record.knowledgeHref} className={TEXT_LINK}>In Knowledge</Link>}
      <Link href={record.mapHref} className={TEXT_LINK}><Waypoints aria-hidden className="size-3" /> On the map</Link>
    </p>
  )
}

// The record of one topic, read once from the Knowledge Map while `enabled`
// (and again when `refresh` changes). An extra: if it does not load, nothing
// is shown and the page works without it.
export function useTopicRecord(where: { subjectName: string | null; topicName: string | null }, refresh: string | null, enabled: boolean): TopicRecord | null {
  const [record, setRecord] = useState<TopicRecord | null>(null)
  const { subjectName, topicName } = where
  useEffect(() => {
    if (!enabled || !subjectName || !topicName) { setRecord(null); return }
    let live = true
    fetch('/api/nova/knowledge-map', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((map: NovaKnowledgeMapView | null) => {
        if (live) setRecord(map?.status === 'ready' ? topicRecord(map, [], { subjectName, topicName }) : null)
      })
      .catch(() => { if (live) setRecord(null) })
    return () => { live = false }
  }, [subjectName, topicName, refresh, enabled])
  return record
}
