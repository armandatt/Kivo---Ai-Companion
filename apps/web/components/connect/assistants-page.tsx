'use client'

// AI assistants: Kivo inside Claude and ChatGPT. Pick one, and three moves
// take it from nothing to connected: copy the address, open the assistant's
// connector settings, allow it on Kivo. The page watches for the connection
// (GET /api/connect/connections, every few seconds while a setup is open and
// the tab is visible) and says the moment it lands. Words are kept to the
// least that makes each move clear; the full guide is a link away.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Check, Copy, Loader2, Plug, ShieldCheck, Sparkles, Unplug, X } from 'lucide-react'
import { ASSISTANTS, assistantOf, canWrite, newConnection, since, type Assistant, type AssistantId, type Connection } from './assistants-model'
import { cn } from '@/lib/utils'

const POLL_MS = 3_000
const POLL_FOR_MS = 10 * 60_000

async function readConnections(): Promise<Connection[] | null> {
  try {
    const r = await fetch('/api/connect/connections', { cache: 'no-store' })
    const b = await r.json() as { ok?: boolean; connections?: Connection[] }
    return b.ok && b.connections ? b.connections : null
  } catch { return null }
}

export function AssistantsPage() {
  const [list, setList] = useState<Connection[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState<AssistantId | null>(null)
  const [address, setAddress] = useState('')
  useEffect(() => { setAddress(`${window.location.origin}/api/mcp`) }, [])

  const load = useCallback(async () => {
    const got = await readConnections()
    if (got) { setList(got); setFailed(false) } else setFailed(true)
    return got
  }, [])
  useEffect(() => { void load() }, [load])

  const connectedTo = (id: AssistantId) => (list ?? []).filter(c => assistantOf(c.client) === id)

  return (
    <div className="mx-auto w-full max-w-3xl pb-16" data-assistants-page>
      <header className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-nova/12 text-nova-ink"><Plug aria-hidden className="size-5" /></span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">AI assistants</h1>
          <p className="text-sm text-foreground/60">Chat with Claude or ChatGPT about your notes and map.</p>
        </div>
      </header>

      <div className="mt-6 grid gap-3 sm:grid-cols-2" role="list">
        {ASSISTANTS.map(a => {
          const mine = connectedTo(a.id)
          const selected = open === a.id
          return (
            <button key={a.id} type="button" role="listitem" onClick={() => setOpen(selected ? null : a.id)} aria-expanded={selected}
              className={cn('group relative flex items-center gap-3 rounded-2xl border p-4 text-left transition-all duration-200',
                selected ? 'border-nova/50 bg-nova/[0.07] ring-4 ring-nova/10' : 'border-white/10 bg-card/60 hover:-translate-y-0.5 hover:border-white/20 motion-reduce:hover:translate-y-0')}
              data-assistant={a.id}>
              <Mark a={a} />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-foreground">{a.name}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-xs">
                  {mine.length > 0
                    ? <><span className="size-1.5 rounded-full bg-emerald-400" /> <span className="text-emerald-300">Connected</span></>
                    : <span className="text-foreground/50">Not connected</span>}
                </span>
              </span>
              <span className={cn('rounded-lg px-2.5 py-1 text-xs font-medium transition-colors', selected ? 'bg-white/10 text-foreground' : 'bg-nova/12 text-nova-ink group-hover:bg-nova/20')}>
                {selected ? 'Close' : mine.length ? 'Add again' : 'Connect'}
              </span>
            </button>
          )
        })}
      </div>

      {open && address && (
        <Setup key={open} a={ASSISTANTS.find(x => x.id === open)!} address={address} reload={load} before={list}
          onClose={() => setOpen(null)} />
      )}

      <section className="mt-10" aria-labelledby="connected-title">
        <h2 id="connected-title" className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground/50">Connected</h2>
        {failed && list === null && <p role="alert" className="mt-3 text-sm text-amber-200">Couldn’t load your connections. <button type="button" className="underline" onClick={() => void load()}>Try again</button></p>}
        {list === null && !failed && <div aria-busy="true" className="mt-3 h-14 animate-pulse rounded-xl bg-white/5" />}
        {list?.length === 0 && <p className="mt-3 text-sm text-foreground/50">Nothing connected yet. Pick Claude or ChatGPT above.</p>}
        <ul className="mt-2 divide-y divide-white/6">
          {list?.map(c => <ConnectionRow key={c.id} c={c} onGone={setList} />)}
        </ul>
      </section>

      <p className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-foreground/45">
        <span className="inline-flex items-center gap-1"><ShieldCheck aria-hidden className="size-3.5" /> Nothing connects without your Allow. Deleting or moving notes always asks you first.</span>
        <Link href="/integrations/kivo-connect" className="underline-offset-2 hover:text-foreground hover:underline">Other apps & help</Link>
      </p>
    </div>
  )
}

function Mark({ a, size = 'md' }: { a: Assistant; size?: 'md' | 'sm' }) {
  return (
    <span aria-hidden className={cn('grid shrink-0 place-items-center rounded-xl font-semibold',
      a.id === 'claude' ? 'bg-[#d97757]/15 text-[#e7926f]' : 'bg-white/10 text-foreground',
      size === 'md' ? 'size-11 text-lg' : 'size-7 text-sm')}>{a.mark}</span>
  )
}

// One assistant's setup: three moves, each lighting up as it is done, then
// the connection as soon as Kivo sees it.
function Setup({ a, address, before, reload, onClose }: {
  a: Assistant; address: string; before: Connection[] | null
  reload: () => Promise<Connection[] | null>; onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [opened, setOpened] = useState(false)
  const [done, setDone] = useState<Connection | null>(null)
  const start = useRef(before)
  const started = useRef(Date.now())
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => { panel.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }) }, [])
  // Watch for the connection while this is open and the tab is in view.
  useEffect(() => {
    if (done) return
    const tick = async () => {
      if (document.visibilityState !== 'visible' || Date.now() - started.current > POLL_FOR_MS) return
      const now = await reload()
      const fresh = now ? newConnection(start.current, now, a.id) : null
      if (fresh) setDone(fresh)
    }
    const t = window.setInterval(() => void tick(), POLL_MS)
    const onShow = () => { if (document.visibilityState === 'visible') void tick() }
    document.addEventListener('visibilitychange', onShow)
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', onShow) }
  }, [a.id, done, reload])

  // Copied stays ticked: it is the first step's done mark.
  const copy = () => { void navigator.clipboard?.writeText(address).then(() => setCopied(true), () => setCopied(true)) }

  if (done) {
    return (
      <div ref={panel} role="status" className="mt-4 overflow-hidden rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.06] p-5 motion-safe:animate-[subject-pop_300ms_ease-out]" data-setup-done={a.id}>
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-emerald-400/20 text-emerald-300 motion-safe:animate-[map-card-new_450ms_ease-out]"><Check aria-hidden className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-foreground">{a.name} is connected</p>
            <p className="text-xs text-foreground/60">{canWrite(done) ? 'Can read and add to your Kivo' : 'Read only'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-foreground/50 hover:bg-white/5 hover:text-foreground"><X className="size-4" /></button>
        </div>
        <p className="mt-4 flex items-center gap-1.5 text-xs font-medium text-foreground/60"><Sparkles aria-hidden className="size-3.5 text-nova-ink" /> Try asking {a.name}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {a.tryPrompts.map(p => <CopyChip key={p} text={p} />)}
        </div>
      </div>
    )
  }

  const step2Ready = copied
  return (
    <div ref={panel} className="mt-4 rounded-2xl border border-white/10 bg-card/70 p-4 sm:p-5 motion-safe:animate-[subject-pop_220ms_ease-out]" data-setup={a.id}>
      <ol className="grid gap-3 sm:grid-cols-3">
        <Step n={1} done={copied} active={!copied} title="Copy your Kivo link">
          <button type="button" onClick={copy} className={cn('mt-2 flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors',
            copied ? 'border-emerald-400/40 bg-emerald-400/10' : 'border-nova/40 bg-nova/[0.08] hover:bg-nova/15')} data-setup-copy>
            <code className="min-w-0 flex-1 truncate text-[11px] text-foreground/80">{address.replace(/^https?:\/\//, '')}</code>
            {copied ? <Check aria-hidden className="size-4 shrink-0 text-emerald-300" /> : <Copy aria-hidden className="size-4 shrink-0 text-nova-ink" />}
            <span className="sr-only">{copied ? 'Copied' : 'Copy the address'}</span>
          </button>
        </Step>
        <Step n={2} done={opened} active={step2Ready && !opened} title={`Add it in ${a.name}`}>
          <a href={a.settingsUrl} target="_blank" rel="noopener noreferrer" onClick={() => setOpened(true)}
            className={cn('mt-2 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
              step2Ready ? 'bg-action text-action-foreground hover:bg-action-hover' : 'border border-white/12 text-foreground/80 hover:bg-white/5')} data-setup-open>
            <Mark a={a} size="sm" /> {a.add} <ArrowUpRight aria-hidden className="size-3.5" />
          </a>
          <p className="mt-1.5 text-[11px] text-foreground/50">Paste the link as the <span className="text-foreground/70">{a.paste}</span></p>
        </Step>
        <Step n={3} done={false} active={opened} title="Allow">
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-dashed border-white/12 px-3 py-2 text-sm text-foreground/70" data-setup-waiting>
            {opened ? <Loader2 aria-hidden className="size-4 animate-spin text-nova-ink" /> : <span className="size-2 rounded-full bg-white/20" />}
            <span>{opened ? 'Waiting for you…' : 'Kivo will ask you'}</span>
          </div>
          <p className="mt-1.5 text-[11px] text-foreground/50">{a.allow}</p>
        </Step>
      </ol>
    </div>
  )
}

function Step({ n, title, done, active, children }: { n: number; title: string; done: boolean; active: boolean; children: React.ReactNode }) {
  return (
    <li className={cn('rounded-xl p-3 transition-colors duration-300', active ? 'bg-white/[0.05] ring-1 ring-nova/30' : 'bg-white/[0.02]')} data-step={n} data-step-done={done || undefined}>
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <span className={cn('grid size-5 place-items-center rounded-full text-[11px] font-semibold transition-colors duration-300',
          done ? 'bg-emerald-400 text-emerald-950' : active ? 'bg-nova text-background' : 'bg-white/10 text-foreground/60')}>
          {done ? <Check aria-hidden className="size-3" /> : n}
        </span>
        {title}
      </p>
      {children}
    </li>
  )
}

function CopyChip({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button type="button" onClick={() => void navigator.clipboard?.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1400) })}
      className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.03] px-3 py-1.5 text-xs text-foreground/80 transition-colors hover:border-nova/40 hover:text-foreground" data-try-prompt>
      {copied ? <Check aria-hidden className="size-3 text-emerald-300" /> : <Copy aria-hidden className="size-3 text-foreground/40" />} {text}
    </button>
  )
}

function ConnectionRow({ c, onGone }: { c: Connection; onGone: (list: Connection[]) => void }) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const who = ASSISTANTS.find(a => a.id === assistantOf(c.client))
  async function disconnect() {
    setBusy(true); setErr('')
    const r = await fetch('/api/connect/connections', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: c.id }) }).catch(() => null)
    const b = r ? await r.json().catch(() => null) as { ok?: boolean; connections?: Connection[]; message?: string } | null : null
    setBusy(false)
    if (b?.ok && b.connections) onGone(b.connections); else setErr(b?.message ?? 'Couldn’t disconnect. Try again.')
  }
  return (
    <li className="flex items-center gap-3 py-3" data-connection={c.id}>
      {who ? <Mark a={who} size="sm" /> : <span aria-hidden className="grid size-7 place-items-center rounded-xl bg-white/10 text-sm text-foreground/70"><Plug className="size-3.5" /></span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{c.client}</span>
        <span className="block text-xs text-foreground/50">
          {canWrite(c) ? 'Read & add' : 'Read only'} · {c.lastUsedAt ? `used ${since(c.lastUsedAt)}` : `connected ${since(c.connectedAt)}`}
        </span>
        {err && <span role="alert" className="block text-xs text-amber-200">{err}</span>}
      </span>
      {confirm ? (
        <span className="flex items-center gap-1.5">
          <button type="button" disabled={busy} onClick={() => void disconnect()} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-rose-500/90 px-3 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-60" data-disconnect-confirm>
            {busy ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <Unplug aria-hidden className="size-3.5" />} Disconnect
          </button>
          <button type="button" onClick={() => setConfirm(false)} className="h-8 rounded-lg px-2 text-xs text-foreground/60 hover:text-foreground">Keep</button>
        </span>
      ) : (
        <button type="button" onClick={() => setConfirm(true)} aria-label={`Disconnect ${c.client}`} className="rounded-lg p-2 text-foreground/45 transition-colors hover:bg-white/5 hover:text-foreground" data-disconnect>
          <Unplug aria-hidden className="size-4" />
        </button>
      )}
    </li>
  )
}
