'use client'

// AI assistants: Kivo inside Claude and ChatGPT. Pick one, and three moves
// take it from nothing to connected: copy the address, open the assistant's
// connector settings, allow it on Kivo. The page watches for the connection
// (GET /api/connect/connections, every few seconds while a setup is open and
// the tab is visible) and says the moment it lands. Words are kept to the
// least that makes each move clear; the full guide is a link away.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, ArrowUpRight, BookOpen, ChevronDown, Check, Copy, FilePlus2, Loader2, Plug, ShieldCheck, Sparkles, Unplug, X } from 'lucide-react'
import { ASSISTANTS, ASSISTANTS_WALKTHROUGH, assistantOf, canWrite, newConnection, since, type Assistant, type AssistantId, type Connection } from './assistants-model'
import { MCP_URL, mcpAddressFor } from './mcp-clients'
import { DemoVideo } from '@/components/media/demo-video'
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
  // Copied once, anywhere on the page: the setup's first step is then done, never asked again.
  const [addressCopied, setAddressCopied] = useState(false)
  useEffect(() => { setAddress(mcpAddressFor(window.location.origin)) }, [])

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
          <p className="text-sm text-foreground/60">Let the assistant you already use read your notes and map, and save what you work out back to Kivo.</p>
        </div>
      </header>

      {/* One address for every assistant (item 8, 28 Nov), first on the page. */}
      <McpAddressCard address={address || MCP_URL} copied={addressCopied} onCopied={() => setAddressCopied(true)} />

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-[0.14em] text-foreground/50">Set up step by step</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2" role="list">
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
                <span className="block font-semibold text-foreground">{a.name} <span className="font-normal text-foreground/45">by {a.maker}</span></span>
                <span className="mt-0.5 flex items-center gap-1.5 text-xs">
                  {mine.length > 0
                    ? <><span className="size-1.5 rounded-full bg-emerald-400" /> <span className="text-emerald-300">Connected</span></>
                    : <span className="text-foreground/50">Not connected</span>}
                </span>
              </span>
              <span className={cn('rounded-lg px-2.5 py-1 text-xs font-medium transition-colors', selected ? 'bg-white/10 text-foreground' : 'bg-nova/12 text-nova-ink group-hover:bg-nova/20')}>
                {selected ? 'Close' : mine.length ? 'Add again' : 'Set up'}
              </span>
            </button>
          )
        })}
      </div>

      {open && address && (
        <Setup key={open} a={ASSISTANTS.find(x => x.id === open)!} address={address} copied={addressCopied} onCopied={() => setAddressCopied(true)} reload={load} before={list}
          onClose={() => setOpen(null)} />
      )}

      <OtherAssistant />

      {/* A 30-second look (item 11, 28 Nov): poster only until opened; captions in the player. */}
      <section className="mt-8" aria-labelledby="walkthrough-title" data-assistants-walkthrough>
        <h2 id="walkthrough-title" className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground/50">See it in 30 seconds</h2>
        <div className="mt-3 max-w-md"><DemoVideo video={{ ...ASSISTANTS_WALKTHROUGH }} /></div>
        <p className="mt-2 text-xs text-foreground/50">Copy the address, add Kivo in your assistant, press Allow on Kivo, and what it saves appears in your notes and on your map.</p>
      </section>

      <section className="mt-10" aria-labelledby="connected-title">
        <h2 id="connected-title" className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground/50">Your connections</h2>
        {failed && list === null && <p role="alert" className="mt-3 text-sm text-amber-200">Couldn’t load your connections. <button type="button" className="underline" onClick={() => void load()}>Try again</button></p>}
        {list === null && !failed && <div aria-busy="true" className="mt-3 h-14 animate-pulse rounded-xl bg-white/5" />}
        {list?.length === 0 && <p className="mt-3 text-sm text-foreground/50">No assistant is connected yet. Set one up above: it takes about a minute.</p>}
        <ul className="mt-2 divide-y divide-white/6">
          {list?.map(c => <ConnectionRow key={c.id} c={c} onGone={setList} />)}
        </ul>
      </section>

      <p className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-foreground/45">
        <span className="inline-flex items-center gap-1"><ShieldCheck aria-hidden className="size-3.5" /> Nothing connects until you press Allow, and you can disconnect at any time. Deleting, moving or renaming always waits for your approval.</span>
        <Link href="/integrations/kivo-connect" className="underline-offset-2 hover:text-foreground hover:underline">Full guide and every tool</Link>
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
function Setup({ a, address, copied, onCopied, before, reload, onClose }: {
  a: Assistant; address: string; copied: boolean; onCopied: () => void; before: Connection[] | null
  reload: () => Promise<Connection[] | null>; onClose: () => void
}) {
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

  // Copied anywhere on the page ticks the first step; it is never asked for twice.
  const copy = () => { void navigator.clipboard?.writeText(address).then(onCopied, () => undefined) }

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

  return (
    <div ref={panel} className="mt-4 rounded-2xl border border-white/10 bg-card/70 p-4 sm:p-5 motion-safe:animate-[subject-pop_220ms_ease-out]" data-setup={a.id}>
      <div className="flex items-center gap-2.5">
        <Mark a={a} size="sm" />
        <p className="min-w-0 flex-1 text-sm font-semibold text-foreground">Connect {a.name} in three steps</p>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-foreground/50 hover:bg-white/5 hover:text-foreground"><X className="size-4" /></button>
      </div>
      <ol className="mt-4 space-y-0">
        <Step n={1} done={copied} active={!copied} title="Copy your Kivo address" last={false}>
          {copied
            ? <p className="text-xs text-foreground/60" data-setup-copied>Done. It’s on your clipboard, ready to paste.</p>
            : (
              <button type="button" onClick={copy} className="inline-flex max-w-full items-center gap-2 rounded-lg border border-nova/40 bg-nova/[0.08] px-3 py-1.5 text-left text-sm hover:bg-nova/15" data-setup-copy>
                <Copy aria-hidden className="size-4 shrink-0 text-nova-ink" />
                <code className="min-w-0 truncate text-xs text-foreground/80">{address.replace(/^https?:\/\//, '')}</code>
              </button>
            )}
        </Step>
        <Step n={2} done={opened} active={copied && !opened} title={`Add Kivo in ${a.name}`} last={false}>
          <a href={a.settingsUrl} target="_blank" rel="noopener noreferrer" onClick={() => setOpened(true)}
            className={cn('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors',
              copied ? 'bg-action text-action-foreground hover:bg-action-hover' : 'border border-white/12 text-foreground/80 hover:bg-white/5')} data-setup-open>
            {a.add} <ArrowUpRight aria-hidden className="size-3.5" />
          </a>
          <p className="mt-2.5 text-xs font-medium text-foreground/70">Then, in {a.name}:</p>
          <ol className="mt-1.5 flex flex-wrap items-center gap-1.5" data-setup-path aria-label={`The clicks in ${a.name}`}>
            {a.path.map((p, i) => (
              <li key={p} className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.03] px-2.5 py-1 text-xs text-foreground/85">
                  <span className="grid size-4 place-items-center rounded-full bg-white/10 text-[10px] font-semibold text-foreground/70">{i + 1}</span>{p}
                </span>
                {i < a.path.length - 1 && <ArrowRight aria-hidden className="size-3 text-foreground/30" />}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[11px] leading-relaxed text-foreground/50">{a.planNote} <a href={a.docsUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">{a.name}’s own guide</a></p>
        </Step>
        <Step n={3} done={false} active={opened} title="Press Allow on Kivo" last>
          <div className="inline-flex items-center gap-2 rounded-lg border border-dashed border-white/15 px-3 py-1.5 text-sm text-foreground/75" data-setup-waiting>
            {opened ? <Loader2 aria-hidden className="size-4 animate-spin text-nova-ink" /> : <ShieldCheck aria-hidden className="size-4 text-foreground/40" />}
            <span>{opened ? 'Waiting for your Allow… this page updates by itself.' : 'Kivo shows what it may do, and nothing connects until you allow it.'}</span>
          </div>
          <p className="mt-1.5 text-[11px] text-foreground/50">{a.allow}</p>
        </Step>
      </ol>
    </div>
  )
}

function Step({ n, title, done, active, last, children }: { n: number; title: string; done: boolean; active: boolean; last: boolean; children: React.ReactNode }) {
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0" data-step={n} data-step-done={done || undefined}>
      {!last && <span aria-hidden className={cn('absolute left-[11px] top-7 bottom-1 w-px', done ? 'bg-emerald-400/50' : 'bg-white/10')} />}
      <span className={cn('relative z-[1] grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold transition-colors duration-300',
        done ? 'bg-emerald-400 text-emerald-950' : active ? 'bg-nova text-background ring-4 ring-nova/15' : 'bg-white/10 text-foreground/60')}>
        {done ? <Check aria-hidden className="size-3.5" /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-medium', done ? 'text-foreground/70' : 'text-foreground')}>{title}</p>
        <div className="mt-1.5">{children}</div>
      </div>
    </li>
  )
}

// The Kivo MCP address with a copy button: what any MCP client asks for.
// Copied is the page's one state, so the setup below does not ask again.
function McpAddressCard({ address, copied, onCopied }: { address: string; copied: boolean; onCopied: () => void }) {
  const [flash, setFlash] = useState(false)
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(false), 2000); return () => clearTimeout(t) }, [flash])
  const copy = () => { void navigator.clipboard?.writeText(address).then(() => { onCopied(); setFlash(true) }, () => undefined) }
  return (
    <section className="mt-6 rounded-2xl border border-nova/30 bg-nova/[0.05] p-4" aria-labelledby="mcp-address-title" data-mcp-address>
      <p id="mcp-address-title" className="text-sm font-semibold text-foreground">Your Kivo address</p>
      <p className="mt-0.5 text-xs text-foreground/60">The one link every assistant needs. It is the same for everyone; signing in is what makes it yours.</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground/85" data-mcp-url>{address}</code>
        <button type="button" onClick={copy} className={cn('inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors',
          copied ? 'border border-emerald-400/40 bg-emerald-400/10 text-foreground' : 'bg-action text-action-foreground hover:bg-action-hover')} data-mcp-copy data-copied={copied || undefined}>
          {copied ? <Check aria-hidden className="size-4 text-emerald-400" /> : <Copy aria-hidden className="size-4" />}{flash ? 'Copied' : copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <ul className="mt-3 grid gap-2 text-xs text-foreground/75 sm:grid-cols-3" data-mcp-can>
        <li className="flex items-start gap-1.5"><BookOpen aria-hidden className="mt-0.5 size-3.5 shrink-0 text-nova-ink" /> Reads your notes, map and saved pages</li>
        <li className="flex items-start gap-1.5"><FilePlus2 aria-hidden className="mt-0.5 size-3.5 shrink-0 text-nova-ink" /> Saves notes, edits and topics to Kivo</li>
        <li className="flex items-start gap-1.5"><ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0 text-nova-ink" /> Asks you before deleting or moving anything</li>
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-foreground/55">Works with any AI assistant that can add a remote MCP server (often called a custom connector) and sign in to it.</p>
      <span className="sr-only" role="status" aria-live="polite">{flash ? 'Address copied' : ''}</span>
    </section>
  )
}

// Any other MCP-compatible assistant: the same three moves, said generally.
function OtherAssistant() {
  return (
    <details className="group mt-3 rounded-2xl border border-white/10 bg-card/40 px-4 py-3" data-other-assistant>
      <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-foreground/80 hover:text-foreground">
        <span>Another assistant? <span className="font-normal text-foreground/50">Any app that supports remote MCP servers</span></span>
        <ChevronDown aria-hidden className="size-4 text-foreground/50 transition-transform group-open:rotate-180" />
      </summary>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-foreground/70">
        <li>In its settings, add a remote MCP server (it may be called a custom connector or integration).</li>
        <li>Paste your Kivo address above as the server URL. Choose OAuth if it asks how to sign in.</li>
        <li>Sign in to Kivo when it opens, check what it asks for, and press Allow.</li>
      </ol>
      <p className="mt-2 text-xs text-foreground/50">Kivo has been tested with Claude and ChatGPT. Others that support remote MCP servers with sign-in should work the same way.</p>
    </details>
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
