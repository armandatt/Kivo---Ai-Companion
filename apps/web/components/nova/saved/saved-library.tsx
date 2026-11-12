'use client'

// The saved-pages library: what the learner keeps from the web, organised so
// that page 900 is as easy to find as page 9. Search, filters and sorting run
// on the server (GET /api/nova/saved) and arrive forty at a time; nothing is
// loaded that the page does not show. Collections are the learner's own
// shelves (one per page); tags are free labels; reading status says what is
// left to read. The counts beside each filter are of everything saved.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, LayoutGrid, List, Loader2, MoreHorizontal, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import type { LearningResource, LibraryFacets } from '@repo/api/nova/product/learning-events.types'
import { READING_STATUS_LABEL, RESOURCE_TYPES, RESOURCE_TYPE_LABEL, type ReadingStatus, type ResourceType } from '@repo/api/nova/product/resource-meta'
import { ResourceCard, TYPE_ICON } from './resource-card'
import { createCollection, deleteCollection, fetchLibrary, fetchResource, renameCollection, type LibraryFilter } from './saved-api'

const VIEW_KEY = 'kivo-saved-view'
const readView = (): 'list' | 'grid' => { try { return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list' } catch { return 'list' } }
// Below the desktop width the rail is a row of chips that scrolls sideways.
const rail = (on: boolean) => `flex w-full shrink-0 items-center justify-between gap-2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors max-lg:w-auto max-lg:rounded-full max-lg:border max-lg:border-white/10 max-lg:px-3 ${on ? 'bg-white/[0.07] font-medium text-foreground' : 'text-foreground/70 hover:bg-white/[0.04] hover:text-foreground'}`
const chip = (on: boolean) => `inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors ${on ? 'border-nova/50 bg-nova/10 text-foreground' : 'border-white/10 text-foreground/70 hover:border-white/20 hover:text-foreground'}`

function CollectionRow({ c, active, onPick, onChanged }: { c: { id: string; name: string; count: number }; active: boolean; onPick: () => void; onChanged: (message?: string) => void }) {
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(c.name)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    const next = name.trim()
    if (!next || next === c.name) { setEditing(false); setName(c.name); return }
    const r = await renameCollection(c.id, next)
    if (r.ok) { setEditing(false); onChanged() } else setError(r.message)
  }
  const remove = async () => {
    if (!window.confirm(`Delete the collection “${c.name}”? Its ${c.count} page${c.count === 1 ? '' : 's'} stay saved, in no collection.`)) return
    const r = await deleteCollection(c.id)
    if (r.ok) onChanged(`Deleted “${c.name}”. Its pages are still saved.`)
    else setError(r.message)
  }
  if (editing) return (
    <li className="px-1">
      <form onSubmit={e => { e.preventDefault(); void save() }} className="flex items-center gap-1">
        <input autoFocus value={name} maxLength={60} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { setEditing(false); setName(c.name) } }}
          className="h-8 min-w-0 flex-1 rounded-lg border border-white/12 bg-transparent px-2 text-sm text-foreground focus:border-nova/60 focus:outline-none" aria-label="Collection name" />
        <button type="submit" className="grid size-8 place-items-center rounded-lg hover:bg-white/5" aria-label="Save name"><Check className="size-4" /></button>
      </form>
      {error && <p className="px-1 pt-1 text-xs text-[color:var(--sem-caution-ink)]">{error}</p>}
    </li>
  )
  return (
    <li className="group relative" data-collection={c.name}>
      <button type="button" onClick={onPick} className={rail(active)} aria-pressed={active}>
        <span className="truncate">{c.name}</span><span className="text-xs text-subtle">{c.count}</span>
      </button>
      <button type="button" onClick={() => setMenu(m => !m)} aria-label={`Options for ${c.name}`} aria-expanded={menu}
        className="absolute right-8 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-subtle opacity-0 hover:bg-white/10 hover:text-foreground focus:opacity-100 group-hover:opacity-100"><MoreHorizontal className="size-4" /></button>
      {menu && (
        <div className="absolute right-0 top-9 z-20 w-40 rounded-xl border border-white/10 bg-card p-1 shadow-float" onKeyDown={e => { if (e.key === 'Escape') setMenu(false) }}>
          <button type="button" autoFocus onClick={() => { setMenu(false); setEditing(true) }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-white/5"><Pencil className="size-3.5" /> Rename</button>
          <button type="button" onClick={() => { setMenu(false); void remove() }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-[color:var(--sem-caution-ink)] hover:bg-white/5"><Trash2 className="size-3.5" /> Delete</button>
        </div>
      )}
      {error && <p className="px-2.5 pt-1 text-xs text-[color:var(--sem-caution-ink)]">{error}</p>}
    </li>
  )
}

export function SavedLibrary({ refreshKey, onItems }: { refreshKey: number; onItems?: (items: LearningResource[]) => void }) {
  const [filter, setFilter] = useState<LibraryFilter>({ sort: 'recent' })
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<LearningResource[]>([])
  const [facets, setFacets] = useState<LibraryFacets | null>(null)
  const [matched, setMatched] = useState(0)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'grid'>('list')
  const [newName, setNewName] = useState<string | null>(null)
  const [pinned, setPinned] = useState<LearningResource | null>(null)
  const [reload, setReload] = useState(0)
  useEffect(() => setView(readView()), [])
  const chooseView = (v: 'list' | 'grid') => { setView(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* storage off */ } }

  // Typing searches a moment after it stops.
  useEffect(() => {
    const t = window.setTimeout(() => setFilter(f => (f.q === (query.trim() || undefined) ? f : { ...f, q: query.trim() || undefined })), 250)
    return () => window.clearTimeout(t)
  }, [query])

  const live = useRef<AbortController | null>(null)
  useEffect(() => {
    live.current?.abort()
    const c = new AbortController(); live.current = c
    setLoading(true); setError(null)
    void fetchLibrary(filter, null, c.signal).then(r => {
      if (c.signal.aborted) return
      setLoading(false)
      if (r.status === 'error') { if (r.message) setError(r.message); return }
      if (r.status !== 'ready') return
      setItems(r.items); setFacets(r.facets); setMatched(r.matched); setCursor(r.nextCursor)
    })
    return () => c.abort()
  }, [filter, refreshKey, reload])
  useEffect(() => { onItems?.(items) }, [items, onItems])

  // A page the Knowledge Map links to (?page=<id>) is shown first, even when it is not in this page of results.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('page')
    if (!id || loading || items.some(i => i.id === id)) { if (pinned && items.some(i => i.id === pinned.id)) setPinned(null); return }
    if (pinned?.id === id) return
    void fetchResource(id).then(r => { if (r.ok) setPinned(r.resource) })
  }, [items, loading, pinned])

  async function loadMore() {
    if (!cursor || more) return
    setMore(true)
    const r = await fetchLibrary(filter, cursor)
    setMore(false)
    if (r.status === 'ready') { setItems(list => [...list, ...r.items.filter(n => !list.some(o => o.id === n.id))]); setCursor(r.nextCursor) }
    else if (r.status === 'error' && r.message) setError(r.message)
  }

  const set = (patch: LibraryFilter) => setFilter(f => ({ ...f, ...patch }))
  const replaced = useCallback((r: LearningResource) => {
    setItems(list => list.map(i => (i.id === r.id ? r : i)))
    // Counts change with what the learner organised; refreshed without moving the list.
    void fetchLibrary(filter, null).then(x => { if (x.status === 'ready') setFacets(x.facets) })
  }, [filter])
  const removed = (id: string) => { setItems(list => list.filter(i => i.id !== id)); setMatched(m => Math.max(0, m - 1)); setReload(n => n + 1) }

  async function addCollection() {
    const name = (newName ?? '').trim()
    if (!name) { setNewName(null); return }
    const r = await createCollection(name)
    if (r.ok) { setNewName(null); setReload(n => n + 1) } else setNotice(r.message)
  }

  const collections = facets?.collections ?? []
  const knownTags = useMemo(() => (facets?.tags ?? []).map(t => t.tag), [facets])
  const filtered = !!(filter.q || filter.type || filter.collection || filter.tag || filter.status || filter.domain || filter.days)
  const shown = pinned && !items.some(i => i.id === pinned.id) ? [pinned, ...items] : items

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]" data-library>
      {/* ── Where to look ─────────────────────────────────────────────── */}
      <nav aria-label="Library" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:block lg:space-y-5 lg:overflow-visible lg:px-0 lg:pb-0 lg:sticky lg:top-4 lg:self-start">
        <ul className="flex gap-1.5 lg:block lg:space-y-0.5">
          <li><button type="button" className={rail(!filter.status && !filter.collection)} onClick={() => set({ status: undefined, collection: undefined })} aria-pressed={!filter.status && !filter.collection}><span>All saved</span><span className="text-xs text-subtle">{facets?.total ?? ''}</span></button></li>
          {(Object.keys(READING_STATUS_LABEL) as ReadingStatus[]).map(s => (
            <li key={s}><button type="button" className={rail(filter.status === s)} onClick={() => set({ status: filter.status === s ? undefined : s })} aria-pressed={filter.status === s} data-status-filter={s}><span>{READING_STATUS_LABEL[s]}</span><span className="text-xs text-subtle">{facets?.statuses[s] ?? 0}</span></button></li>
          ))}
        </ul>
        <div className="flex shrink-0 items-center gap-1.5 lg:block">
          <p className="flex items-center justify-between px-2.5 text-[11px] font-medium uppercase tracking-[0.14em] text-subtle max-lg:hidden lg:mb-1.5">
            Collections
            <button type="button" onClick={() => setNewName('')} className="grid size-6 place-items-center rounded hover:bg-white/10 hover:text-foreground" aria-label="New collection" data-new-collection><Plus className="size-3.5" /></button>
          </p>
          <ul className="flex gap-1.5 lg:block lg:space-y-0.5">
            {newName !== null && (
              <li className="px-1">
                <form onSubmit={e => { e.preventDefault(); void addCollection() }}>
                  <input autoFocus value={newName} maxLength={60} placeholder="Name, e.g. System Design" onChange={e => setNewName(e.target.value)} onBlur={() => void addCollection()} onKeyDown={e => { if (e.key === 'Escape') setNewName(null) }}
                    className="h-8 w-full rounded-lg border border-white/12 bg-transparent px-2 text-sm text-foreground focus:border-nova/60 focus:outline-none" aria-label="New collection name" data-collection-name />
                </form>
              </li>
            )}
            {collections.map(c => <CollectionRow key={c.id} c={c} active={filter.collection === c.id} onPick={() => set({ collection: filter.collection === c.id ? undefined : c.id })} onChanged={m => { if (m) setNotice(m); if (filter.collection === c.id && m) set({ collection: undefined }); setReload(n => n + 1) }} />)}
            {collections.length > 0 && <li><button type="button" className={rail(filter.collection === 'none')} onClick={() => set({ collection: filter.collection === 'none' ? undefined : 'none' })} aria-pressed={filter.collection === 'none'}><span>In no collection</span><span className="text-xs text-subtle">{facets?.unfiled ?? 0}</span></button></li>}
            {newName === null && <li className="lg:hidden"><button type="button" onClick={() => setNewName('')} className={rail(false)} data-new-collection-chip><span className="inline-flex items-center gap-1"><Plus className="size-3.5" aria-hidden /> Collection</span></button></li>}
            {collections.length === 0 && newName === null && <li className="px-2.5 text-xs leading-relaxed text-subtle max-lg:hidden">Group pages your way: “Read later”, “System Design”.</li>}
          </ul>
        </div>
      </nav>

      {/* ── What is there ─────────────────────────────────────────────── */}
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[14rem] flex-1">
            <span className="sr-only">Search saved pages</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search titles, sites, tags, notes…" type="search"
              className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.03] pl-9 pr-3 text-sm text-foreground placeholder:text-foreground/40 focus:border-nova/60 focus:outline-none" data-library-search />
          </label>
          <label className="sr-only" htmlFor="library-sort">Sort</label>
          <select id="library-sort" value={filter.sort ?? 'recent'} onChange={e => set({ sort: e.target.value })} className="h-10 rounded-xl border border-white/10 bg-transparent px-3 text-sm text-foreground/85 focus:border-nova/60 focus:outline-none" data-library-sort>
            <option value="recent">Recently saved</option><option value="oldest">Oldest saved</option><option value="title">Title A–Z</option><option value="type">By kind</option>
          </select>
          <div role="group" aria-label="View" className="inline-flex rounded-xl border border-white/10 p-0.5">
            <button type="button" onClick={() => chooseView('list')} aria-pressed={view === 'list'} aria-label="List" className={`grid size-9 place-items-center rounded-lg ${view === 'list' ? 'bg-white/10 text-foreground' : 'text-subtle hover:text-foreground'}`}><List className="size-4" /></button>
            <button type="button" onClick={() => chooseView('grid')} aria-pressed={view === 'grid'} aria-label="Cards" className={`grid size-9 place-items-center rounded-lg ${view === 'grid' ? 'bg-white/10 text-foreground' : 'text-subtle hover:text-foreground'}`}><LayoutGrid className="size-4" /></button>
          </div>
        </div>

        {/* Kinds that exist in the library, with how many. */}
        {facets && facets.total > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Kind of resource">
            {RESOURCE_TYPES.filter(t => (facets.types[t] ?? 0) > 0).map(t => {
              const Icon = TYPE_ICON[t as ResourceType]
              return <button key={t} type="button" className={chip(filter.type === t)} aria-pressed={filter.type === t} onClick={() => set({ type: filter.type === t ? undefined : t })} data-type-filter={t}><Icon className="size-3.5" aria-hidden />{RESOURCE_TYPE_LABEL[t]}<span className="text-subtle">{facets.types[t]}</span></button>
            })}
          </div>
        )}

        {facets && facets.total > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="sr-only" htmlFor="library-tag">Tag</label>
            <select id="library-tag" value={filter.tag ?? ''} onChange={e => set({ tag: e.target.value || undefined })} className="h-8 max-w-[12rem] rounded-lg border border-white/10 bg-transparent px-2 text-foreground/80 focus:outline-none" data-tag-filter>
              <option value="">Any tag</option>{facets.tags.map(t => <option key={t.tag} value={t.tag}>{t.tag} ({t.count})</option>)}
            </select>
            <label className="sr-only" htmlFor="library-site">Site</label>
            <select id="library-site" value={filter.domain ?? ''} onChange={e => set({ domain: e.target.value || undefined })} className="h-8 max-w-[12rem] rounded-lg border border-white/10 bg-transparent px-2 text-foreground/80 focus:outline-none" data-domain-filter>
              <option value="">Any site</option>{facets.domains.map(d => <option key={d.domain} value={d.domain}>{d.domain} ({d.count})</option>)}
            </select>
            <label className="sr-only" htmlFor="library-days">Saved</label>
            <select id="library-days" value={filter.days ?? ''} onChange={e => set({ days: e.target.value ? Number(e.target.value) : undefined })} className="h-8 rounded-lg border border-white/10 bg-transparent px-2 text-foreground/80 focus:outline-none" data-days-filter>
              <option value="">Any time</option><option value="7">Past week</option><option value="30">Past month</option><option value="365">Past year</option>
            </select>
            {filtered && <button type="button" onClick={() => { setQuery(''); setFilter({ sort: filter.sort }) }} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-foreground/70 hover:bg-white/5 hover:text-foreground" data-clear-filters><X className="size-3.5" aria-hidden /> Clear filters</button>}
            <span className="ml-auto text-subtle" role="status" data-matched>{loading ? 'Loading…' : filtered ? `${matched} of ${facets.total}` : `${facets.total} saved`}</span>
          </div>
        )}

        {notice && <p role="status" className="text-sm text-foreground/70" data-library-notice>{notice} <button type="button" className="ml-2 underline" onClick={() => setNotice(null)}>Dismiss</button></p>}
        {error && <p role="alert" className="rounded-xl border border-red-400/30 px-4 py-3 text-sm text-foreground/80">{error} <button type="button" onClick={() => setReload(n => n + 1)} className="ml-2 underline">Try again</button></p>}

        {loading && items.length === 0 ? (
          <div className="space-y-2" aria-hidden>{[0, 1, 2].map(i => <div key={i} className="h-24 animate-pulse rounded-2xl bg-white/[0.03]" />)}</div>
        ) : shown.length === 0 && !error ? (
          <section className="rounded-3xl border border-white/8 bg-card/60 p-8 text-center" data-empty={filtered ? 'filtered' : 'saved'}>
            <h3 className="text-lg font-semibold text-foreground">{filtered ? 'Nothing matches' : 'Nothing saved yet'}</h3>
            <p className="mx-auto mt-2 max-w-prose text-sm leading-relaxed text-foreground/60">
              {filtered ? 'Try fewer filters, or another word.' : 'Save a page from the extension or paste a link above. It lands here, ready to read and study.'}
            </p>
          </section>
        ) : view === 'grid' ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" data-resources>
            {shown.map(r => <ResourceCard key={r.id} resource={r} view="grid" collections={collections} knownTags={knownTags} onRemoved={removed} onChanged={replaced} />)}
          </div>
        ) : (
          <div className="divide-y divide-white/6 rounded-2xl border border-white/8 bg-card/40" data-resources>
            {shown.map(r => <ResourceCard key={r.id} resource={r} view="list" collections={collections} knownTags={knownTags} onRemoved={removed} onChanged={replaced} />)}
          </div>
        )}

        {cursor && (
          <div className="flex justify-center pt-2">
            <button type="button" onClick={() => void loadMore()} disabled={more} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/12 px-4 text-sm text-foreground/85 hover:bg-white/5 disabled:opacity-60" data-load-more>
              {more && <Loader2 className="size-4 animate-spin" aria-hidden />} Show more
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
