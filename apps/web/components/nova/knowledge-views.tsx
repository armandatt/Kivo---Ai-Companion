// One destination, two views of the same subjects and topics: the Knowledge
// Map (cards and how they connect) and Knowledge (the list, each topic's
// record). The switch sits on both pages so neither feels like a separate
// feature; the sidebar lists them side by side under the same names.

import Link from 'next/link'
import { List, Waypoints } from 'lucide-react'
import { cn } from '@/lib/utils'

export function KnowledgeViews({ current, className }: { current: 'map' | 'list'; className?: string }) {
  const item = (on: boolean) => cn('inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors', on ? 'bg-white/10 font-medium text-foreground' : 'text-foreground/60 hover:text-foreground')
  return (
    <nav aria-label="Knowledge views" className={cn('inline-flex rounded-lg border border-white/10 p-0.5', className)} data-knowledge-views>
      <Link href="/map" aria-current={current === 'map' ? 'page' : undefined} className={item(current === 'map')}><Waypoints aria-hidden className="size-3.5" /> Map</Link>
      <Link href="/knowledge" aria-current={current === 'list' ? 'page' : undefined} className={item(current === 'list')}><List aria-hidden className="size-3.5" /> List</Link>
    </nav>
  )
}
