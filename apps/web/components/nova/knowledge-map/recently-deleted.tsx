'use client'

// What the learner deleted from the Knowledge Map, kept for 30 days, and one
// press to bring each back (GET/POST /api/nova/knowledge-map/trash). A restored
// map is active knowledge again: on the map, in Knowledge, and in what Nova reads.

import { useCallback, useEffect, useState } from 'react'
import { History, Loader2, RotateCcw, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { relativeDay } from '../format'

type Item = { id: string; kind: 'subject' | 'workspace'; title: string; deletedAt: string; expiresAt: string; holds: { subjects: number; topics: number; dates: number } }
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`

export function RecentlyDeleted({ onClose, onRestored, className }: { onClose: () => void; onRestored: (said: string) => void; className?: string }) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/nova/knowledge-map/trash', { cache: 'no-store' })
      const data = await res.json() as { ok?: boolean; items?: Item[]; message?: string }
      if (data.ok && data.items) setItems(data.items); else setError(data.message ?? 'Recently deleted didn’t load.')
    } catch { setError('Could not reach the server. Check your connection and try again.') }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])

  async function restore(item: Item) {
    if (busy) return
    setBusy(item.id); setError(null)
    try {
      const res = await fetch('/api/nova/knowledge-map/trash', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restore: item.id }) })
      const data = await res.json() as { ok?: boolean; title?: string; renamed?: string[]; message?: string }
      if (data.ok) {
        setItems(list => (list ?? []).filter(x => x.id !== item.id))
        onRestored(`Restored “${item.title}”.${data.renamed?.length ? ` A subject with that name already existed, so it came back as “${data.renamed[0]}”.` : ''}`)
      } else { setError(data.message ?? 'Nothing was restored.'); void load() }
    } catch { setError('Could not reach the server. Nothing was restored.') }
    setBusy(null)
  }

  return (
    <div role="dialog" aria-label="Recently deleted" className={cn('w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-popover p-4 text-sm text-popover-foreground shadow-float', className)} data-recently-deleted onPointerDown={e => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold text-foreground"><History aria-hidden className="size-4 text-nova-ink" /> Recently deleted</p>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-subtle hover:text-foreground"><X className="size-4" /></button>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-foreground/60">Subjects and maps you deleted, kept for 30 days. Nova can’t see them until you restore them.</p>
      <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
        {items === null && !error && <p role="status" className="flex items-center gap-2 text-xs text-subtle"><Loader2 aria-hidden className="size-3.5 animate-spin" /> Loading…</p>}
        {items?.length === 0 && <p className="rounded-xl border border-dashed border-white/12 px-3 py-4 text-center text-xs text-subtle" data-trash-empty>Nothing deleted in the last 30 days.</p>}
        {items?.map(item => (
          <div key={item.id} className="flex items-center gap-3 rounded-xl border border-white/8 px-3 py-2.5" data-trash-item={item.id}>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-foreground" title={item.title}>{item.title}</p>
              <p className="text-xs text-subtle">{item.kind === 'workspace' ? 'Map' : 'Subject'} · {[item.holds.subjects && plural(item.holds.subjects, 'subject'), item.holds.topics && plural(item.holds.topics, 'topic')].filter(Boolean).join(', ') || 'empty'} · deleted {relativeDay(item.deletedAt)}</p>
            </div>
            <button type="button" onClick={() => void restore(item)} disabled={busy !== null} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-white/12 px-2.5 text-xs font-medium text-foreground hover:bg-white/5 disabled:opacity-50" data-trash-restore>
              {busy === item.id ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <RotateCcw aria-hidden className="size-3.5" />} Restore
            </button>
          </div>
        ))}
        {error && <p role="alert" className="text-xs text-red-400" data-trash-error>{error} <button type="button" onClick={() => void load()} className="underline">Try again</button></p>}
      </div>
    </div>
  )
}
