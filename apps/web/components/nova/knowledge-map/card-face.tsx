// A card on the Knowledge Map, drawn from what the map reported and nothing
// more: its title, its subject's colour (set by the .subject-tone around it),
// a topic's own estimate or that no session stands behind it, a subject's
// counts, when a note was edited, a saved page's site. Shared by the map
// (knowledge-map.tsx) and the landing page's preview of it, so the two are
// drawn by the same code. Pure presentation: no state, no requests.

import type { MapNode, MapNodeType } from '@repo/api/nova/product/knowledge-map.types'
import { cn } from '@/lib/utils'
import { CARD } from './layout'

export const FILL: Record<MapNodeType, string> = {
  subject: 'var(--nova)', topic: 'var(--map-topic)', task: 'var(--map-task)', note: 'var(--map-note)', resource: 'var(--map-resource)',
}
export const LEVEL_TEXT = { weak: 'Weak', developing: 'Developing', solid: 'Solid' } as const

export const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)
export const shortDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export type CardDetail = 0 | 1 | 2   // shapes only; titles; titles and facts

export function CardFace({ n, detail }: { n: MapNode; detail: CardDetail }) {
  const { w, h } = CARD[n.type]
  const x0 = -w / 2, y0 = -h / 2
  const text = 'fill-foreground'
  const meta = { fontSize: 10.5, className: 'fill-[var(--subtle)]' }
  if (n.type === 'subject') {
    return (
      <>
        <rect x={x0} y={y0} width={w} height={h} rx={16} fill="var(--card)" stroke="var(--sc-edge)" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
        <rect x={x0} y={y0} width={w} height={h} rx={16} fill="var(--sc-soft)" />
        <circle cx={x0 + 20} cy={0} r={6} fill="var(--sc)" />
        {detail >= 1 && (
          <text x={x0 + 34} y={detail === 2 ? -3 : 6} className={text} style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }} fontSize={16}>{short(n.label, 19)}</text>
        )}
        {detail === 2 && (
          <text x={x0 + 34} y={17} {...meta}>{[plural(n.topics, 'topic'), plural(n.notes, 'note'), plural(n.resources, 'page')].join(' · ')}</text>
        )}
      </>
    )
  }
  if (n.type === 'task') {
    const done = n.status === 'done'
    return (
      <>
        <rect x={x0} y={y0} width={w} height={h} rx={9} fill="var(--card)" stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <rect x={x0 + 10} y={-5} width={10} height={10} rx={2.5} fill={done ? FILL.task : 'none'} stroke={FILL.task} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
        {detail >= 1 && <text x={x0 + 28} y={detail === 2 ? -4 : 4.5} className={cn(text, done && 'opacity-60')} fontSize={12.5} fontWeight={500} textDecoration={done ? 'line-through' : undefined}>{short(n.label, 21)}</text>}
        {detail === 2 && <text x={x0 + 28} y={13} {...meta}>{[n.status === 'in_progress' ? 'In progress' : done ? 'Done' : 'To do', n.dueDay ? `due ${shortDay(`${n.dueDay}T12:00:00Z`)}` : null, n.waitsOn ? `waits on ${n.waitsOn}` : null].filter(Boolean).join(' · ')}</text>}
      </>
    )
  }
  if (n.type === 'topic' && (n.kind === 'milestone' || n.studied === false)) {
    // A milestone, or a topic that organises the topics inside it: not studied on its own.
    const milestone = n.kind === 'milestone'
    return (
      <>
        <rect x={x0} y={y0} width={w} height={h} rx={milestone ? 6 : 14} fill="var(--card)" stroke={milestone ? 'var(--nova)' : 'var(--map-topic)'} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
        {n.subjectName && <rect x={x0 + 7} y={y0 + 11} width={3} height={h - 22} rx={1.5} fill="var(--sc)" />}
        {milestone && <path d={`M ${x0 + 18} ${-8} v 16 M ${x0 + 18} ${-8} h 9 l -2.5 3.5 l 2.5 3.5 h -9`} fill="none" stroke="var(--nova)" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />}
        {detail >= 1 && <text x={x0 + (milestone ? 34 : 18)} y={detail === 2 ? -7 : 5} className={text} fontSize={13} fontWeight={600}>{short(n.label, milestone ? 18 : 20)}</text>}
        {detail === 2 && <text x={x0 + (milestone ? 34 : 18)} y={10} {...meta}>{milestone ? (n.details?.weeks ? `Milestone · ≈ ${n.details.weeks} wk` : 'Milestone') : 'Its topics are studied'}</text>}
      </>
    )
  }
  if (n.type === 'topic') {
    const unstudied = n.sessions === 0
    const barW = w - 36
    return (
      <>
        <rect x={x0} y={y0} width={w} height={h} rx={14} fill="var(--card)" stroke={unstudied ? 'var(--map-topic)' : 'var(--border)'}
          strokeWidth={unstudied ? 1.4 : 1} strokeDasharray={unstudied ? '4 3' : undefined} vectorEffect="non-scaling-stroke" />
        {n.subjectName && <rect x={x0 + 7} y={y0 + 11} width={3} height={h - 22} rx={1.5} fill="var(--sc)" />}
        {detail >= 1 && <text x={x0 + 18} y={detail === 2 ? -7 : 5} className={text} fontSize={13} fontWeight={600}>{short(n.label, 20)}</text>}
        {detail === 2 && (
          <>
            <text x={x0 + 18} y={9} {...meta}>{n.level && n.masteryPercent !== null ? `${LEVEL_TEXT[n.level]} · ${n.masteryPercent}%` : 'No session yet'}</text>
            {(n.notes > 0 || n.resources > 0) && (
              <text x={-x0 - 12} y={9} textAnchor="end" {...meta}>{[n.notes > 0 && `${n.notes} ✎`, n.resources > 0 && `${n.resources} ↗`].filter(Boolean).join('  ')}</text>
            )}
            {n.masteryPercent !== null && (
              <>
                <rect x={x0 + 18} y={16} width={barW} height={3} rx={1.5} fill="var(--map-line)" />
                <rect x={x0 + 18} y={16} width={(barW * n.masteryPercent) / 100} height={3} rx={1.5} fill="var(--nova)" />
              </>
            )}
          </>
        )}
      </>
    )
  }
  const resource = n.type === 'resource'
  return (
    <>
      <rect x={x0} y={y0} width={w} height={h} rx={resource ? 6 : 11} fill="var(--card)" stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {n.subjectName && <rect x={x0 + 6} y={y0 + 10} width={3} height={h - 20} rx={1.5} fill="var(--sc)" />}
      {resource
        ? <rect x={x0 + 16} y={detail === 2 ? 5 : -3} width={7} height={7} rx={1.5} fill={FILL.resource} />
        : <circle cx={x0 + 19.5} cy={detail === 2 ? 8.5 : 0.5} r={3.5} fill={FILL.note} />}
      {detail >= 1 && <text x={x0 + (detail === 2 ? 16 : 29)} y={detail === 2 ? -5 : 4.5} className={text} fontSize={12.5} fontWeight={500}>{short(n.label, detail === 2 ? 22 : 20)}</text>}
      {detail === 2 && <text x={x0 + 29} y={12.5} {...meta}>{resource ? short(n.domain, 22) : `Edited ${shortDay(n.updatedAt)}`}</text>}
    </>
  )
}
