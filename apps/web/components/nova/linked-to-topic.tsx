'use client'

import Link from 'next/link'
import { ArrowRight, Bookmark, FolderClosed, ListChecks, NotebookPen, Waypoints } from 'lucide-react'
import type { MapNode, NovaKnowledgeMapView } from '@repo/api/nova/product/knowledge-map.types'
import type { NovaFocusContextReady } from '@repo/api/nova/product/focus-context.types'
import { cn } from '@/lib/utils'
import { FocusContext, hasFocusContext } from './focus-context'
import { localGraph, type LocalGraph, type LocalNeighbour } from './local-graph'
import { SectionHeading, Skeleton, TEXT_LINK } from './workspace/ui'

// Everything on record that is linked to the topic Today recommends: the
// learner's tasks, notes, saved pages and last note (Focus context, from the
// server), and the stored links around the topic on the Knowledge Map. The map
// is an extra: while it loads or if it fails, the rest of the panel and of the
// page work without it.

type MapState = { view: NovaKnowledgeMapView | null; loading: boolean; error: boolean; refresh: () => void }

const ICON: Record<MapNode['type'], typeof NotebookPen> = { subject: FolderClosed, topic: FolderClosed, note: NotebookPen, resource: Bookmark, task: ListChecks }
const KIND_WORD = (n: LocalNeighbour) =>
  n.node.type === 'subject' ? 'Subject'
  : n.kind === 'links_to' ? 'Note that links here'
  : n.node.type === 'note' ? 'Note'
  : 'Saved page'

export function LinkedToTopic({ topicName, subjectName, context, map }: {
  topicName:   string
  subjectName: string
  context:     NovaFocusContextReady | null
  map:         MapState
}) {
  const mapReady = map.view?.status === 'ready' ? map.view : null
  const graph    = mapReady ? localGraph(mapReady, { subjectName, topicName }) : null
  // Only the subject on its own is not worth a picture: the recommendation
  // already names it.
  const drawable = graph && graph.neighbours.some(n => n.node.type !== 'subject') ? graph : null
  const hasContext = hasFocusContext(context)

  if (!hasContext && !drawable) return null

  return (
    <section aria-labelledby="linked-to-topic" data-section="linked-to-topic">
      <SectionHeading id="linked-to-topic" icon={Waypoints} aside={<Link href="/map" className={TEXT_LINK}>Knowledge Map <ArrowRight aria-hidden className="size-3" /></Link>}>
        Linked to {topicName}
      </SectionHeading>

      <div className={cn('mt-4 grid gap-6', hasContext && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]')}>
        {drawable ? <TopicGraph graph={drawable} />
          : !mapReady && map.loading ? <div aria-busy="true" aria-label="Loading linked items"><Skeleton className="h-44 rounded-xl" /></div>
          : !mapReady && map.error ? (
            <p role="status" className="text-xs text-foreground/60">
              The map of what is linked here didn&apos;t load.{' '}
              <button type="button" onClick={() => map.refresh()} className="underline decoration-white/20 underline-offset-4 hover:text-foreground">Try again</button>
            </p>
          ) : null}
        {hasContext && <FocusContext view={context} className="border-0 bg-transparent p-0" />}
      </div>
    </section>
  )
}

// The topic in the middle, what is linked to it around it. Every line is an
// edge the server returned. Below 640px the same items are a list.
function TopicGraph({ graph }: { graph: LocalGraph }) {
  const subject = graph.neighbours.find(n => n.node.type === 'subject')
  const ring    = graph.neighbours.filter(n => n.node.type !== 'subject')
  // The subject sits above; the rest share the circle below it, evenly.
  const place = (i: number) => {
    const angle = (Math.PI / 6) + (i + 0.5) * ((Math.PI * 5 / 3) / ring.length)   // 30° to 330°, measured from the top
    return { x: 50 + 38 * Math.sin(angle), y: 50 - 36 * Math.cos(angle) }
  }
  const points = [
    ...(subject ? [{ n: subject, x: 50, y: 12 }] : []),
    ...ring.map((n, i) => ({ n, ...place(i) })),
  ]

  return (
    <figure aria-label={`What is linked to ${graph.topic.label}`} data-graph="local">
      <div className="relative hidden h-56 sm:block">
        <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full">
          {points.map(p => (
            <line key={p.n.node.id} x1={50} y1={50} x2={p.x} y2={p.y}
              stroke="currentColor" vectorEffect="non-scaling-stroke"
              className={cn('text-foreground/20', p.n.kind === 'links_to' && 'text-keppel-400/50')}
              strokeDasharray={p.n.kind === 'links_to' ? '3 3' : undefined} />
          ))}
        </svg>
        <GraphNode node={graph.topic} centre style={{ left: '50%', top: '50%' }} />
        {points.map(p => <GraphNode key={p.n.node.id} node={p.n.node} title={KIND_WORD(p.n)} style={{ left: `${p.x}%`, top: `${p.y}%` }} />)}
      </div>

      <ul className="space-y-1.5 sm:hidden">
        {graph.neighbours.map(n => {
          const Icon = ICON[n.node.type]
          return (
            <li key={n.node.id} className="flex items-center gap-2 text-sm">
              <Icon aria-hidden className="size-3.5 shrink-0 text-foreground/40" />
              {n.node.href
                ? <Link href={n.node.href} className="min-w-0 truncate text-foreground/85 underline decoration-white/20 underline-offset-4 hover:decoration-white/60">{n.node.label}</Link>
                : <span className="min-w-0 truncate text-foreground/85">{n.node.label}</span>}
              <span className="shrink-0 text-xs text-foreground/55">{KIND_WORD(n)}</span>
            </li>
          )
        })}
      </ul>

      {graph.hidden > 0 && (
        <figcaption className="mt-2 text-xs text-foreground/55">
          {graph.hidden} more linked {graph.hidden === 1 ? 'item is' : 'items are'} on the <Link href="/map" className="underline decoration-white/20 underline-offset-4 hover:text-foreground">Knowledge Map</Link>.
        </figcaption>
      )}
    </figure>
  )
}

function GraphNode({ node, centre = false, title, style }: { node: MapNode; centre?: boolean; title?: string; style: React.CSSProperties }) {
  const Icon = ICON[node.type]
  const body = (
    <>
      {!centre && <Icon aria-hidden className="size-3 shrink-0 text-foreground/45" />}
      <span className="truncate">{node.label}</span>
    </>
  )
  const className = cn(
    'absolute flex max-w-[9.5rem] -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs',
    centre ? 'border-keppel-400/40 bg-keppel-400/10 font-medium text-foreground' : 'border-white/12 bg-card text-foreground/85 transition-colors hover:border-white/30 hover:text-foreground',
  )
  const label = title ? `${title}: ${node.label}` : node.label
  return node.href
    ? <Link href={node.href} className={className} style={style} aria-label={label} title={label}>{body}</Link>
    : <span className={className} style={style} title={label}>{body}</span>
}
