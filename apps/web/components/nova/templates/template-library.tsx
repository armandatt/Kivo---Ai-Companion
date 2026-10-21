'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Search, Sparkles, Trash2 } from 'lucide-react'
import { CATEGORY_INFO, STUDY_TEMPLATES, TEMPLATE_CATEGORIES, type StudyTemplate, type TemplateCategory } from '@repo/api/nova/product/templates'
import { recommendedCategory, recommendedTemplates, searchTemplates, templatesIn } from '@repo/api/nova/product/workspace-routing'
import type { WorkspaceSummary } from '@repo/api/nova/product/workspaces.types'
import { EmptyState, PageFrame, PageHeader } from '@/components/dashboard/page-states'
import { BUTTON_PRIMARY, BUTTON_QUIET } from '@/components/nova/workspace/ui'
import { cn } from '@/lib/utils'
import { CreateWithNova, TemplatePreview } from './template-dialogs'
import { loadWorkspaces, removeWorkspace } from './templates-api'

// The template library: optional ready-made starting points, by who they are
// for, and the learner's own workspaces. Build with Nova (/build) is the main
// way in; "Start from a document" is the one-shot Create with Nova that
// reads a PDF or photo. Every category is open to everyone;
// what they said at sign-up only picks the one shown first.

type Tab = 'for-you' | TemplateCategory

// What a template makes, in a few words, from the template itself.
function outputs(t: StudyTemplate): string {
  const subjects = t.asksSubjectList ? 'subjects you list' : `${t.subjects.length} subject${t.subjects.length === 1 ? '' : 's'}`
  return [subjects, `${t.tasks.length} tasks`, t.notes?.length ? `${t.notes.length} note${t.notes.length === 1 ? '' : 's'}` : null, t.asksExamDate ? 'a date' : null].filter(Boolean).join(' · ')
}

function TemplateCard({ t, tab, onOpen }: { t: StudyTemplate; tab: Tab; onOpen: () => void }) {
  const place = t.placements.find(p => p.category === tab) ?? t.placements[0]!
  return (
    <li className="group flex flex-col rounded-2xl border border-white/8 bg-card/70 p-4 transition-colors hover:border-white/20 focus-within:border-action/60" data-template={t.id}>
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-foreground/55">{CATEGORY_INFO[place.category].subcategories[place.subcategory]}</p>
      <h3 className="mt-1.5 text-[15px] font-semibold text-foreground">{t.name}</h3>
      <p className="mt-1 line-clamp-2 text-sm leading-snug text-foreground/70">{t.purpose}</p>
      <p className="mt-3 text-xs text-foreground/55">{outputs(t)}</p>
      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="text-[11px] text-foreground/50">Kivo template</span>
        <button type="button" onClick={onOpen} className={BUTTON_QUIET} aria-label={`Use ${t.name}`}>Use template</button>
      </div>
    </li>
  )
}

export function TemplateLibrary() {
  const params = useSearchParams()
  const [contexts, setContexts] = useState<string[] | null>(null)
  const [workingOn, setWorkingOn] = useState<string[]>([])
  const [tab, setTab] = useState<Tab>('for-you')
  const [sub, setSub] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<StudyTemplate | null>(null)
  const [creating, setCreating] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[] | null>(null)
  const [workspacesFailed, setWorkspacesFailed] = useState(false)

  // A request handed over from chat ("set up my GATE prep") opens Create with Nova with it.
  useEffect(() => {
    const asked = params.get('create')
    if (asked !== null) setCreating(asked.slice(0, 2000))
  }, [params])

  useEffect(() => {
    let live = true
    fetch('/api/settings', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((s: { learningContexts?: string[]; workingOn?: { selected?: string[] } | null } | null) => {
        if (!live) return
        setContexts(s?.learningContexts ?? [])
        setWorkingOn(s?.workingOn?.selected ?? [])
      })
      .catch(() => { if (live) setContexts([]) })
    return () => { live = false }
  }, [])

  const refresh = useCallback(async () => {
    const res = await loadWorkspaces()
    if ('status' in res) { setWorkspaces(res.workspaces); setWorkspacesFailed(false) } else setWorkspacesFailed(true)
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const category: TemplateCategory | null = tab === 'for-you' ? null : tab
  const recommended = useMemo(() => (contexts ? recommendedTemplates(contexts, workingOn, 6) : []), [contexts, workingOn])
  const shown = useMemo(() => {
    if (query.trim()) return searchTemplates(query, category ? templatesIn(category) : STUDY_TEMPLATES)
    if (!category) return recommended
    return templatesIn(category, sub ?? undefined)
  }, [query, category, sub, recommended])

  const close = useCallback(() => { setOpen(null); setCreating(null); void refresh() }, [refresh])
  const tabs: Array<{ id: Tab; label: string }> = [{ id: 'for-you', label: 'For you' }, ...TEMPLATE_CATEGORIES.map(c => ({ id: c, label: CATEGORY_INFO[c].label }))]

  return (
    <PageFrame>
      <PageHeader title="Templates" description="Ready-made starting points, if one fits. For anything else, talk it through with Nova: it asks what it needs and builds nothing until you approve."
        actions={<>
          <Link href="/build" className={BUTTON_PRIMARY}><Sparkles aria-hidden className="size-4" /> Build with Nova</Link>
          <button type="button" onClick={() => setCreating('')} className={BUTTON_QUIET} data-open-create>Start from a document</button>
        </>} />

      <div className="mt-8 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div role="tablist" aria-label="Template categories" className="flex gap-1 overflow-x-auto rounded-xl border border-white/8 bg-card/50 p-1">
          {tabs.map(t => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => { setTab(t.id); setSub(null) }}
              className={cn('shrink-0 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors', tab === t.id ? 'bg-white/10 text-foreground' : 'text-foreground/65 hover:text-foreground')}>
              {t.label}
            </button>
          ))}
        </div>
        <label className="relative block md:w-72">
          <span className="sr-only">Search templates</span>
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground/45" />
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search templates"
            className="h-10 w-full rounded-xl border border-white/10 bg-card/50 pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-foreground/45 focus:border-action" />
        </label>
      </div>

      {category && !query.trim() && (
        <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Subcategories">
          {[null, ...Object.keys(CATEGORY_INFO[category].subcategories)].map(s => (
            <button key={s ?? 'all'} type="button" aria-pressed={sub === s} onClick={() => setSub(s)}
              className={cn('rounded-full border px-3 py-1 text-xs font-medium transition-colors', sub === s ? 'border-action bg-action-soft text-foreground' : 'border-white/10 text-foreground/65 hover:text-foreground')}>
              {s ? CATEGORY_INFO[category].subcategories[s] : 'All'}
            </button>
          ))}
        </div>
      )}

      <section className="mt-6" aria-label="Templates">
        {tab === 'for-you' && !query.trim() && (
          <p className="mb-3 text-sm text-foreground/65">{contexts === null ? 'Finding templates for you…' : `Picked for you from ${CATEGORY_INFO[recommendedCategory(contexts, workingOn)].label}. Every category is open: use the tabs.`}</p>
        )}
        {shown.length > 0 ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map(t => <TemplateCard key={t.id} t={t} tab={tab} onOpen={() => setOpen(t)} />)}
          </ul>
        ) : (
          <EmptyState icon={Search} title={query.trim() ? `No templates match “${query.trim()}”` : 'No templates here yet'}
            action={<button type="button" onClick={() => setCreating(query)} className={BUTTON_PRIMARY}><Sparkles aria-hidden className="size-4" /> Ask Nova to build it</button>}>
            Nova can design a workspace for it instead.
          </EmptyState>
        )}
      </section>

      <section className="mt-12" aria-labelledby="your-workspaces">
        <h2 id="your-workspaces" className="text-base font-semibold text-foreground">Your workspaces</h2>
        <p className="mt-1 text-sm text-foreground/60">Made from a template or by Nova. Their subjects, tasks and notes live in Knowledge, the Planner and Notes.</p>
        {workspaces === null && !workspacesFailed && <div aria-busy="true" aria-label="Loading your workspaces" className="mt-4 h-16 animate-pulse rounded-2xl bg-white/4" />}
        {workspacesFailed && <p role="alert" className="mt-4 text-sm text-foreground/70">Your workspaces didn&apos;t load. <button type="button" onClick={() => void refresh()} className="font-medium text-action-ink underline underline-offset-2">Try again</button></p>}
        {workspaces && workspaces.length === 0 && <p className="mt-4 text-sm text-foreground/60">None yet. Use a template, or <Link href="/build" className="underline underline-offset-4">build one with Nova</Link>.</p>}
        {workspaces && workspaces.length > 0 && (
          <ul className="mt-4 divide-y divide-white/6 rounded-2xl border border-white/8 bg-card/50">
            {workspaces.map(w => (
              <li key={w.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" data-workspace={w.kind}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{w.title}</p>
                  <p className="text-xs text-foreground/55">{w.kind === 'template' ? `From ${w.templateName ?? 'a Kivo template'}` : 'Designed by Nova'} · {new Date(w.createdAt).toLocaleDateString()}</p>
                </div>
                <Link href={`/build?improve=${encodeURIComponent(w.id)}`} className="text-xs font-medium text-foreground/65 hover:text-foreground">Improve with Nova</Link>
                <div className="flex flex-wrap gap-1.5">
                  {w.subjects.slice(0, 3).map(s => <Link key={s.id} href={`/knowledge?subject=${s.id}`} className="rounded-full border border-white/10 px-2.5 py-0.5 text-xs text-foreground/75 hover:border-white/25">{s.name}</Link>)}
                </div>
                <button type="button" aria-label={`Remove ${w.title} from this list`} title="Removes it from this list. Its subjects, tasks and notes stay."
                  onClick={async () => { if (window.confirm('Remove it from this list? Its subjects, tasks and notes stay where they are.') && await removeWorkspace(w.id)) void refresh() }}
                  className="grid size-8 place-items-center rounded-lg text-foreground/45 hover:bg-white/6 hover:text-foreground"><Trash2 aria-hidden className="size-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {open && <TemplatePreview template={open} category={category} onClose={close} />}
      {creating !== null && <CreateWithNova initial={creating} category={category} onClose={close} />}
    </PageFrame>
  )
}
