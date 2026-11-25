'use client'

// "Nova in your browser": what the extension's side panel does beyond saving
// (docs/BROWSER_AGENT.md), on the Browser Extension page. Everything here is
// what apps/extension does today, in its own words: Chat with Nova answers
// about the page in front of you; Do it for me carries out a task on it or
// across sites, with your Kivo as context, asking before anything with
// consequences. Monthly task allowances come from the same table the pricing
// page reads (billing/accounting/rules.ts DEFAULT_ALLOWANCES), never written
// here twice.

import { ArrowRight, Check, Hand, MessageCircle, MousePointerClick, ShieldCheck, Sparkles, Square, Timer } from 'lucide-react'
import { DEFAULT_ALLOWANCES } from '@repo/api/billing/accounting/rules'
import { cn } from '@/lib/utils'

const MODES = [
  {
    key: 'chat', icon: MessageCircle, name: 'Chat with Nova', where: 'From the extension’s popup',
    body: 'Ask about the page you’re reading: explain a passage, summarise a long article, or check something against your own notes.',
    asks: ['Explain this paragraph more simply', 'Summarise this in five points', 'How does this connect to my DBMS notes?'],
  },
  {
    key: 'task', icon: MousePointerClick, name: 'Do it for me', where: 'In the side panel',
    body: 'Hand Nova a task and watch it work: it reads, clicks, fills and searches, on this page or across sites, using your Kivo for context.',
    asks: ['Find three good explanations of paging and save them', 'Open this course page and list the units', 'Compare these two courses’ syllabi'],
  },
] as const

// How a task runs, in the order the side panel shows it.
const FLOW = [
  { icon: Sparkles, title: 'You ask', body: 'In plain words, in the side panel.' },
  { icon: MousePointerClick, title: 'Nova works', body: 'Step by step, on pages you can see.' },
  { icon: Hand, title: 'You approve', body: 'Before anything that sends, submits or buys.' },
  { icon: Check, title: 'Done', body: 'An answer with its sources, or the task finished. Its extra tabs close.' },
] as const

const CONTROL = [
  { icon: ShieldCheck, text: 'Nova works only on sites you allow: for one task, or always (you can remove a site from the extension).' },
  { icon: Square, text: 'Stop a task at any moment. A “no” to an action is final for that task.' },
  { icon: Hand, text: 'Never types into password or payment fields, never signs in for you, and hands any “are you human?” check back to you.' },
  { icon: Timer, text: 'A task stops by itself after 30 steps or 12 minutes.' },
]

export function BrowserAgentSection() {
  const t = DEFAULT_ALLOWANCES
  return (
    <section aria-labelledby="agent-heading" className="overflow-hidden rounded-2xl border border-white/8 bg-card/40" data-section="browser-agent">
      <div className="grid gap-8 p-5 sm:p-7 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-10">
        {/* What it is */}
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-nova-ink">Nova in your browser</p>
          <h2 id="agent-heading" className="mt-2 text-[1.45rem] font-semibold leading-tight tracking-[-0.02em] text-foreground sm:text-[1.65rem]">Ask about the page. Or let Nova do it.</h2>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-foreground/65">
            The extension isn’t only for saving. Nova sits beside the page you’re on, knows your subjects, notes and saved pages, and can either answer you or carry out the task itself.
          </p>

          <div className="mt-6 space-y-3">
            {MODES.map(m => (
              <article key={m.key} className="rounded-xl border border-white/8 bg-background/40 p-4" data-agent-mode={m.key}>
                <div className="flex items-center gap-3">
                  <span aria-hidden className={cn('grid size-9 shrink-0 place-items-center rounded-lg', m.key === 'task' ? 'bg-nova/15 text-nova-ink' : 'bg-white/[0.06] text-foreground/75')}><m.icon className="size-[18px]" /></span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-foreground">{m.name}</h3>
                    <p className="text-xs text-foreground/50">{m.where}</p>
                  </div>
                </div>
                <p className="mt-2.5 text-[13px] leading-relaxed text-foreground/65">{m.body}</p>
                <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={`Things to ask: ${m.name}`}>
                  {m.asks.map(a => <li key={a} className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-xs text-foreground/70">“{a}”</li>)}
                </ul>
              </article>
            ))}
          </div>
        </div>

        {/* How a task runs, and the user's control */}
        <div className="min-w-0 space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-foreground">How a task runs</h3>
            <ol className="mt-3 space-y-0" data-agent-flow>
              {FLOW.map((s, i) => (
                <li key={s.title} className="relative flex gap-3 pb-4 last:pb-0">
                  {i < FLOW.length - 1 && <span aria-hidden className="absolute left-[15px] top-8 h-[calc(100%-1.75rem)] w-px bg-white/10" />}
                  <span aria-hidden className="relative grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-background text-foreground/70"><s.icon className="size-4" /></span>
                  <div className="min-w-0 pt-1">
                    <p className="text-sm font-medium text-foreground/90">{s.title}</p>
                    <p className="text-[13px] leading-relaxed text-foreground/55">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="rounded-xl bg-white/[0.025] p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground"><ShieldCheck aria-hidden className="size-4 text-keppel-300" /> You stay in control</h3>
            <ul className="mt-2.5 space-y-2">
              {CONTROL.map(c => <li key={c.text} className="flex gap-2.5 text-[13px] leading-relaxed text-foreground/60"><c.icon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-foreground/40" />{c.text}</li>)}
            </ul>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/6 pt-4">
            <p className="text-xs text-foreground/55" data-agent-allowance>
              Browser tasks a month: <span className="text-foreground/80">Free {t.free.browserTasks}</span> · <span className="text-foreground/80">Plus {t.plus.browserTasks}</span> · <span className="text-foreground/80">Pro {t.pro.browserTasks}</span>. Chat with Nova uses Nova credits.
            </p>
            <a href="/guide#extension" className="inline-flex items-center gap-1 text-sm font-medium text-action-ink hover:underline">How to start <ArrowRight aria-hidden className="size-3.5" /></a>
          </div>
        </div>
      </div>
      <p className="border-t border-white/6 bg-white/[0.015] px-5 py-3 text-xs text-foreground/55 sm:px-7">
        To start: click <span className="font-medium text-foreground/75">Nova</span> in Chrome’s toolbar on any page, then <span className="font-medium text-foreground/75">Chat with Nova</span>, or open the side panel for <span className="font-medium text-foreground/75">Do it for me</span>.
      </p>
    </section>
  )
}
