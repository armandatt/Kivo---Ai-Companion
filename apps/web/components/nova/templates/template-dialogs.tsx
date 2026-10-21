'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FileText, ImageIcon, Loader2, Paperclip, Sparkles, X } from 'lucide-react'
import { CATEGORY_INFO, type StudyTemplate, type TemplateCategory } from '@repo/api/nova/product/templates'
import { templateInputs, type TemplateInputs } from '@repo/api/nova/product/workspace-plan'
import type { ProposeResponse } from '@repo/api/nova/product/workspaces.types'
import { BUTTON_PRIMARY, BUTTON_QUIET } from '@/components/nova/workspace/ui'
import { cn } from '@/lib/utils'
import { PlanReview } from './plan-review'
import { encodeFile, FILES_MAX, FILES_TOTAL_BYTES, FILE_TYPES, propose } from './templates-api'

type Proposed = Extract<ProposeResponse, { plan: unknown }>

const FIELD = 'w-full rounded-xl border border-white/12 bg-background/60 px-3 text-[15px] text-foreground outline-none placeholder:text-foreground/40 focus:border-action'

// A modal panel: Escape and the close button leave it, focus moves into it
// and back to what opened it.
export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    panel.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); before?.focus?.() }
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="template-dialog-title"
        className={cn('max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-white/10 bg-card p-5 shadow-float outline-none sm:rounded-2xl sm:p-7', wide ? 'sm:max-w-3xl' : 'sm:max-w-xl')}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <h2 id="template-dialog-title" className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-lg text-foreground/60 hover:bg-white/6 hover:text-foreground"><X aria-hidden className="size-4" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ── A Kivo template ───────────────────────────────────────────────────────────

export function TemplatePreview({ template, category, onClose }: { template: StudyTemplate; category: TemplateCategory | null; onClose: () => void }) {
  const fields = templateInputs(template)
  const [inputs, setInputs] = useState<TemplateInputs>({})
  const [personalize, setPersonalize] = useState('')
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proposed, setProposed] = useState<Proposed | null>(null)
  const abort = useRef<AbortController | null>(null)

  const missing = fields.some(f => f.required && !(inputs[f.key] ?? '').trim())

  async function preview() {
    setBusy(true); setError(null)
    abort.current = new AbortController()
    const res = await propose({ templateId: template.id, inputs, ...(asking && personalize.trim() ? { personalize } : {}), category }, abort.current.signal)
    setBusy(false)
    if (!res.ok) { if (res.error !== 'cancelled') setError(res.message); return }
    if ('plan' in res) setProposed(res)
    else setError('route' in res && res.route === 'clarify' ? res.question : 'Nova couldn’t use that. Try different words.')
  }

  return (
    <Dialog title={proposed ? 'Review your workspace' : template.name} onClose={onClose} wide={!!proposed}>
      {proposed ? (
        <PlanReview route={proposed.route} reason={proposed.reason} plan={proposed.plan} dropped={proposed.dropped} similar={proposed.similar} onBack={() => setProposed(null)} />
      ) : (
        <form onSubmit={e => { e.preventDefault(); if (!busy && !missing) void preview() }} className="space-y-5">
          <p className="text-xs font-medium text-foreground/60">Kivo template · {template.placements.map(p => CATEGORY_INFO[p.category].label).join(', ')}</p>
          <p className="text-[15px] leading-relaxed text-foreground/80">{template.description}</p>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground/55">What it creates</p>
            <ul className="mt-2 space-y-1 text-sm text-foreground/80">{template.creates.map(c => <li key={c}>· {c}</li>)}</ul>
          </div>
          {fields.map(f => (
            <div key={f.key}>
              <label htmlFor={`tpl-${f.key}`} className="text-sm font-medium text-foreground/85">{f.label}{f.required && <span className="text-red-400"> *</span>}</label>
              {f.kind === 'lines'
                ? <textarea id={`tpl-${f.key}`} rows={4} value={inputs[f.key] ?? ''} onChange={e => setInputs(v => ({ ...v, [f.key]: e.target.value }))} className={cn(FIELD, 'mt-1.5 py-2.5 text-sm')} />
                : <input id={`tpl-${f.key}`} type={f.kind === 'date' ? 'date' : 'text'} value={inputs[f.key] ?? ''} maxLength={80} onChange={e => setInputs(v => ({ ...v, [f.key]: e.target.value }))} className={cn(FIELD, 'mt-1.5 h-11')} />}
            </div>
          ))}
          <div className="rounded-xl border border-white/8 p-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
              <input type="checkbox" checked={asking} onChange={e => setAsking(e.target.checked)} className="size-4 accent-[var(--color-action)]" />
              <Sparkles aria-hidden className="size-4 text-nova-ink" /> Personalise with Nova
            </label>
            {asking && (
              <>
                <textarea aria-label="What Nova should tailor" rows={3} value={personalize} maxLength={2000} onChange={e => setPersonalize(e.target.value)}
                  placeholder="e.g. I have 6 weeks and I'm weak in probability" className={cn(FIELD, 'mt-2 py-2.5 text-sm')} />
                <p className="mt-1.5 text-xs text-foreground/60">Uses your Nova allowance. Without it, the template is applied as it is.</p>
              </>
            )}
          </div>
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            {busy && <button type="button" onClick={() => abort.current?.abort()} className={BUTTON_QUIET}>Cancel</button>}
            <button type="submit" disabled={busy || missing || (asking && !personalize.trim())} className={BUTTON_PRIMARY}>
              {busy ? <><Loader2 aria-hidden className="size-4 animate-spin" /> {asking ? 'Nova is tailoring it…' : 'Preparing…'}</> : 'Preview workspace'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  )
}

// ── Create with Nova ──────────────────────────────────────────────────────────

export function CreateWithNova({ initial, category, onClose }: { initial: string; category: TemplateCategory | null; onClose: () => void }) {
  const [request, setRequest] = useState(initial)
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [proposed, setProposed] = useState<Proposed | null>(null)
  const abort = useRef<AbortController | null>(null)

  function addFiles(list: FileList | null) {
    setError(null)
    const next = [...files]
    for (const f of Array.from(list ?? [])) {
      if (!FILE_TYPES.includes(f.type)) { setError(`${f.name} isn't a PDF or a PNG, JPEG or WebP image.`); continue }
      if (f.size === 0) { setError(`${f.name} is empty.`); continue }
      if (next.length >= FILES_MAX) { setError(`Up to ${FILES_MAX} files.`); break }
      next.push(f)
    }
    if (next.reduce((n, f) => n + f.size, 0) > FILES_TOTAL_BYTES) { setError('Files can add up to 3 MB together.'); return }
    setFiles(next)
  }

  async function generate() {
    setBusy(true); setError(null); setNote(null)
    abort.current = new AbortController()
    let encoded: Array<{ name: string; data: string }>
    try { encoded = await Promise.all(files.map(encodeFile)) } catch { setBusy(false); setError("A file couldn't be read in this browser."); return }
    const res = await propose({ request, files: encoded, category }, abort.current.signal)
    setBusy(false)
    if (!res.ok) { if (res.error !== 'cancelled') setError(res.message); return }
    if ('plan' in res) { setProposed(res); return }
    if (res.route === 'clarify') setNote(`Nova needs one thing first: ${res.question} Add it to your request and try again.`)
    else setNote(res.message)
  }

  return (
    <Dialog title={proposed ? 'Review your workspace' : 'Create with Nova'} onClose={onClose} wide={!!proposed}>
      {proposed ? (
        <PlanReview route={proposed.route} reason={proposed.reason} plan={proposed.plan} dropped={proposed.dropped} similar={proposed.similar} onBack={() => setProposed(null)} />
      ) : (
        <form onSubmit={e => { e.preventDefault(); if (!busy && (request.trim() || files.length)) void generate() }} className="space-y-4" data-create-with-nova>
          <p className="text-sm leading-relaxed text-foreground/75">Describe what you want to set up. Nova uses a Kivo template when one fits and designs one when none does. You review it before anything is created.</p>
          <textarea aria-label="What should Nova set up?" rows={5} value={request} maxLength={2000} onChange={e => { setRequest(e.target.value); setNote(null) }}
            placeholder="e.g. A 3-month plan to learn backend development with Node, 8 hours a week. I know basic JavaScript." className={cn(FIELD, 'py-3')} />
          <div>
            <label className={cn(BUTTON_QUIET, 'cursor-pointer')}>
              <Paperclip aria-hidden className="size-3.5" /> Add a PDF or photo
              <input type="file" accept={FILE_TYPES.join(',')} multiple className="sr-only" onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
            </label>
            <p className="mt-1.5 text-xs text-foreground/60">A syllabus, notes or a timetable. Up to {FILES_MAX} files, 3 MB together, 40 pages a PDF. Scanned pages and photos are read too.</p>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1.5">{files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-white/8 px-2.5 py-1.5 text-sm text-foreground/80">
                  {f.type === 'application/pdf' ? <FileText aria-hidden className="size-4" /> : <ImageIcon aria-hidden className="size-4" />}
                  <span className="mr-auto truncate">{f.name}</span><span className="text-xs text-foreground/55">{Math.ceil(f.size / 1024)} KB</span>
                  <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="grid size-6 place-items-center rounded text-foreground/55 hover:text-foreground"><X aria-hidden className="size-3.5" /></button>
                </li>
              ))}</ul>
            )}
          </div>
          {note && <p role="status" className="rounded-xl border border-white/10 bg-white/3 p-3 text-sm text-foreground/80" data-route-note>{note}</p>}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-foreground/55">Uses your Nova allowance.</p>
            <div className="flex gap-2">
              {busy && <button type="button" onClick={() => abort.current?.abort()} className={BUTTON_QUIET}>Cancel</button>}
              <button type="submit" disabled={busy || (!request.trim() && files.length === 0)} className={BUTTON_PRIMARY}>
                {busy ? <><Loader2 aria-hidden className="size-4 animate-spin" /> {files.length ? 'Reading your files…' : 'Nova is building it…'}</> : <><Sparkles aria-hidden className="size-4" /> Build it</>}
              </button>
            </div>
          </div>
        </form>
      )}
    </Dialog>
  )
}
