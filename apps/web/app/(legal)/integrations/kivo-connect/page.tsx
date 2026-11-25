import type { Metadata } from "next"
import Link from "next/link"
import type { ReactNode } from "react"
import { ArrowRight, BookOpen, Check, ChevronRight, KeyRound, Lock, MessageSquare, Network, PenLine, Search, ShieldCheck, Unplug } from "lucide-react"
import { KivoMark, KivoWordmark } from "@/components/brand/kivo-brand"
import { CONTACT_EMAIL } from "@/lib/site-links"
import { CopyField } from "@/components/connect/copy-field"
import { CONNECT_VIDEO, MCP_CAPABILITIES, MCP_CLIENTS, MCP_PERMISSIONS, MCP_TOOLS, MCP_URL, toolInfo, type ToolKind } from "@/components/connect/mcp-clients"
import { DemoVideo } from "@/components/media/demo-video"
import { DEFAULT_ALLOWANCES } from "@repo/api/billing/accounting/rules"

// Kivo Connect (the MCP server at /api/mcp): what it is for, what an
// assistant can do with it, how access is controlled, and how to connect
// Claude or ChatGPT; then the full reference (every permission and tool,
// limits, data, troubleshooting). Linked from the OAuth metadata
// (resource_documentation) and from the Claude Connectors Directory listing,
// so it stays reachable without signing in. Every claim comes from
// components/connect/mcp-clients.ts, which mcp-clients.test.ts holds to the
// server's tool registry and scopes (packages/api/src/connect).

const PAGE_URL = "https://www.thekivo.in/integrations/kivo-connect"
const TITLE = "Kivo Connect: your Kivo knowledge in Claude and ChatGPT"
const DESCRIPTION = "Connect Claude or ChatGPT to Kivo and bring your notes, Knowledge Map and saved pages into the conversations where you already think. You choose what it may do, and approve the big changes."

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PAGE_URL },
  openGraph: { title: TITLE, description: DESCRIPTION, url: PAGE_URL, type: "website", images: [{ url: "/kivo-connect/consent-screen.webp", width: 496, height: 848, alt: "Kivo's consent screen: Allow Claude to use your Kivo?" }] },
  twitter: { card: "summary", title: TITLE, description: DESCRIPTION },
}

const KIND: Record<ToolKind, { label: string; tone: string }> = {
  read: { label: "Reads", tone: "text-sky-300/90 bg-sky-400/10" },
  write: { label: "Changes", tone: "text-keppel-300 bg-keppel-400/10" },
  approval: { label: "Needs your approval", tone: "text-amber-200 bg-amber-400/10" },
}
const CAP_ICON: Record<string, typeof Search> = { find: Search, understand: Network, work: PenLine }

const FLOW = [
  { icon: MessageSquare, title: "Your assistant", body: "Claude or ChatGPT, in a normal conversation." },
  { icon: KeyRound, title: "Kivo Connect", body: "Kivo's MCP server. The assistant signs in with OAuth; no password or API key is shared." },
  { icon: ShieldCheck, title: "Your permissions", body: "Only the tools your allowed permissions cover. Big changes wait for you in Kivo." },
  { icon: BookOpen, title: "Your Kivo", body: "Notes, Knowledge Map and saved pages, read and written by Kivo's own code." },
]

// A real session, tool by tool: what the assistant calls and what happens.
const WORKFLOW: Array<{ you: string; tools: string[]; result: string }> = [
  { you: "“What do my Kivo notes say about paging?”", tools: ["search_notes", "get_note"], result: "It finds your notes on paging, reads them and answers from them, citing each note with a link back to Kivo." },
  { you: "“Save the key ideas from this chat under Operating Systems › Paging.”", tools: ["capture_knowledge"], result: "It previews the notes it would write, skips what you already have, then saves them filed under that topic." },
  { you: "“Move my old TLB note under Memory management.”", tools: ["move_note", "check_approval"], result: "Nothing moves yet. It gives you one Kivo link; you see the exact change by name and choose Approve. Then it confirms the result." },
  { you: "Open Kivo.", tools: [], result: "The new notes are on your Knowledge Map and in Notes, ordinary Kivo notes you can edit like anything you wrote." },
]

const free = DEFAULT_ALLOWANCES.free
const FAQ: Array<{ q: string; a: ReactNode }> = [
  { q: "What is Kivo Connect?", a: "A connector (an MCP server) that lets an AI assistant use your Kivo: search and read your notes, Knowledge Map and saved pages, and save what you work out in a conversation back into Kivo, filed in the right place." },
  { q: "Do I need Claude or ChatGPT?", a: "Yes. Kivo Connect is how those assistants reach your Kivo; it doesn't add a chat of its own. Which of their plans allow custom connectors is up to Anthropic and OpenAI." },
  { q: "Is Kivo Connect free?", a: <>Yes, on every Kivo plan. On Free, an assistant can make {(free.mcpLifetime ?? 0).toLocaleString("en-US")} tool calls in total; after that it can keep reading, up to {free.mcpReadOnly} reads a month. Plus and Pro have no fixed number (fair use).</> },
  { q: "Does it use my Nova credits?", a: "No. Kivo Connect doesn't call an AI model; your assistant does the thinking and writing on its own service. Tool calls are counted as tool calls (see above), not as Nova credits." },
  { q: "What can my assistant read?", a: "What the permissions you allow cover: your name and setup, workspaces, subjects and topics, notes, the Knowledge Map and your saved pages. It never sees your password, other accounts, or anything outside your Kivo." },
  { q: "Can it create or change my notes?", a: "Yes, if you allow it: create notes, add to them, link them, add subjects and topics, and save web pages. Each change is read back and reported." },
  { q: "Do I approve changes?", a: "Deleting, moving, renaming or refiling, and any change touching more than 12 items, waits for you: the assistant gives you a Kivo link that lists each change by name, and you choose Approve or Decline. Smaller additions happen straight away, and your assistant may ask you before running them." },
  { q: "Can I disconnect it?", a: <>Any time. Open <strong>Settings › AI assistants</strong> in Kivo and choose Disconnect; access ends at once. An unused connection also lapses after 30 days.</> },
  { q: "Does it work across my whole Kivo?", a: "Yes. It sees every workspace and subject in the account you sign in with, and can be pointed at one workspace when you ask." },
  { q: "Are other MCP clients supported?", a: "Claude and ChatGPT are tested end to end. Other clients that add a remote MCP server with OAuth (dynamic registration and PKCE) should work, but Kivo hasn't tested them." },
]

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-medium uppercase tracking-[0.16em] text-keppel-300/90">{children}</p>
}

function Kind({ kind }: { kind: ToolKind }) {
  return <span className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${KIND[kind].tone}`}>{KIND[kind].label}</span>
}

// A reference section, folded so the product story reads first.
function Reference({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <details id={id} className="group scroll-mt-24 border-t border-white/8 py-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold text-foreground [&::-webkit-details-marker]:hidden">
        {title}<ChevronRight aria-hidden className="size-4 shrink-0 text-foreground/40 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
      </summary>
      <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-foreground/75 [&_li]:pl-1 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_a]:text-action-ink [&_a]:underline [&_a]:underline-offset-4 [&_code]:rounded [&_code]:bg-white/6 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[0.9em]">
        {children}
      </div>
    </details>
  )
}

export default function KivoConnectPage() {
  const toolCount = MCP_TOOLS.reduce((n, g) => n + g.items.length, 0)
  const approvals = MCP_TOOLS.flatMap(g => g.items).filter(([, , k]) => k === "approval")
  const claude = MCP_CLIENTS.find(c => c.id === "claude")!, chatgpt = MCP_CLIENTS.find(c => c.id === "chatgpt")!, other = MCP_CLIENTS.find(c => c.id === "other")
  return (
    <div className="kivo-app min-h-screen bg-background text-foreground">
      <header className="border-b border-white/8">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" aria-label="Kivo home">
            <KivoMark size={26} className="text-foreground" />
            <KivoWordmark height={18} className="text-foreground" />
          </Link>
          <nav aria-label="Kivo Connect" className="flex items-center gap-4 text-sm">
            <a href="#setup" className="text-foreground/70 hover:text-foreground max-sm:hidden">Setup</a>
            <a href="#control" className="text-foreground/70 hover:text-foreground max-sm:hidden">Privacy and control</a>
            <Link href="/signup" className="rounded-lg border border-white/12 px-3 py-1.5 text-foreground/85 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-ring">Get Kivo</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        {/* A — Hero: what it is, shown working, and how to start. */}
        <section aria-labelledby="hero-title" className="grid items-center gap-10 pb-16 pt-12 sm:pt-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-14" data-connect-hero>
          <div className="min-w-0">
            <Eyebrow>Kivo Connect · for Claude and ChatGPT</Eyebrow>
            <h1 id="hero-title" className="mt-4 text-[2.3rem] font-semibold leading-[1.04] tracking-[-0.035em] sm:text-[3.1rem]">Your Kivo knowledge. Now available to your AI&nbsp;assistant.</h1>
            <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-foreground/75">
              Connect Kivo to Claude or ChatGPT and bring your notes, Knowledge Maps and saved pages into the conversations where you already think and work. Answers start from your own material, and what you work out can be saved straight back into Kivo.
            </p>
            {/* On a phone the picture comes before the buttons. */}
            <div className="mt-8 lg:hidden"><HeroVisual /></div>
            <div className="mt-8 flex flex-wrap items-center gap-3" data-connect-ctas>
              <a href="#claude" className="inline-flex h-11 items-center gap-2 rounded-xl bg-action px-5 text-sm font-semibold text-action-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.16)] transition-colors hover:bg-action-hover" data-connect-claude>Connect Claude <ArrowRight aria-hidden className="size-4" /></a>
              <a href="#chatgpt" className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/14 px-5 text-sm font-semibold text-foreground/90 transition-colors hover:border-white/25 hover:bg-white/5" data-connect-chatgpt>Connect ChatGPT</a>
            </div>
            <p className="mt-4 flex items-center gap-2 text-[13px] text-foreground/55"><Lock aria-hidden className="size-3.5" /> You choose what it may do, approve the big changes, and can disconnect any time.</p>
          </div>
          <div className="min-w-0 max-lg:hidden"><HeroVisual /></div>
        </section>

        {/* B — What an assistant can actually do (real tools only). */}
        <section aria-labelledby="can-title" className="border-t border-white/8 py-16" data-connect-capabilities>
          <Eyebrow>What your assistant can do</Eyebrow>
          <h2 id="can-title" className="mt-3 max-w-2xl text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] sm:text-[2.1rem]">Ask about what you know. Keep what you work out.</h2>
          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {MCP_CAPABILITIES.map(c => {
              const Icon = CAP_ICON[c.id] ?? Search
              return (
                <article key={c.id} className="flex flex-col rounded-2xl border border-white/8 bg-card/40 p-5" data-capability={c.id}>
                  <span aria-hidden className="grid size-10 place-items-center rounded-xl bg-white/[0.05] text-foreground/80"><Icon className="size-5" /></span>
                  <h3 className="mt-4 text-lg font-semibold text-foreground">{c.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-foreground/65">{c.summary}</p>
                  <ul className="mt-4 space-y-2 border-t border-white/6 pt-4">
                    {c.tools.map(t => { const info = toolInfo(t)!; return (
                      <li key={t} className="flex items-start justify-between gap-3 text-[13px] leading-snug text-foreground/75"><span>{info.what}</span><Kind kind={info.kind} /></li>
                    ) })}
                  </ul>
                  <div className="mt-auto pt-5">
                    <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-foreground/40">Try asking</p>
                    <ul className="mt-2 space-y-1.5">{c.asks.map(a => <li key={a} className="rounded-lg bg-white/[0.035] px-3 py-2 text-[13px] text-foreground/80">“{a}”</li>)}</ul>
                  </div>
                </article>
              )
            })}
          </div>
          <p className="mt-6 text-sm text-foreground/55">{toolCount} tools in all. <a href="#tools" className="text-action-ink underline underline-offset-4">See every tool</a></p>
        </section>

        {/* C — How it works. */}
        <section aria-labelledby="how-title" className="border-t border-white/8 py-16" data-connect-how>
          <Eyebrow>How it works</Eyebrow>
          <h2 id="how-title" className="mt-3 text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] sm:text-[2.1rem]">Four steps, once. Then just ask.</h2>
          <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Connect your assistant", "In Claude or ChatGPT, add a custom connector and paste Kivo's address."],
              ["Authorise Kivo", "A Kivo page names the assistant and what it asks for. You choose Allow."],
              ["Ask naturally", "Talk as usual. The assistant calls Kivo's tools when your question needs your material."],
              ["It lands in Kivo", "Notes, topics and saved pages it creates appear in your Kivo, filed where you asked."],
            ].map(([t, d], i) => (
              <li key={t} className="rounded-2xl border border-white/8 p-5">
                <span className="text-sm font-semibold tabular-nums text-keppel-300">0{i + 1}</span>
                <p className="mt-2 font-semibold text-foreground">{t}</p>
                <p className="mt-1 text-sm leading-relaxed text-foreground/65">{d}</p>
              </li>
            ))}
          </ol>
          <div className="mt-8 rounded-2xl border border-white/8 bg-card/30 p-5 sm:p-6" aria-label="How a request travels" data-connect-flow>
            <ol className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] md:items-stretch">
              {FLOW.map((f, i) => (
                <li key={f.title} className="contents">
                  <div className="rounded-xl bg-white/[0.03] p-4">
                    <f.icon aria-hidden className="size-5 text-foreground/70" />
                    <p className="mt-2 text-sm font-semibold text-foreground">{f.title}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-foreground/60">{f.body}</p>
                  </div>
                  {i < FLOW.length - 1 && <span aria-hidden className="grid place-items-center text-foreground/30 max-md:rotate-90"><ArrowRight className="size-4" /></span>}
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* D — A real workflow, tool by tool. */}
        <section aria-labelledby="flow-title" className="border-t border-white/8 py-16" data-connect-workflow>
          <Eyebrow>A real session</Eyebrow>
          <h2 id="flow-title" className="mt-3 text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] sm:text-[2.1rem]">From a question to a note in your Kivo</h2>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-foreground/65">What happens, step by step, when you use Kivo from your assistant. The tool names are the ones your assistant shows when it calls Kivo.</p>
          <ol className="mt-10 space-y-3">
            {WORKFLOW.map((w, i) => (
              <li key={i} className="grid gap-3 rounded-2xl border border-white/8 p-5 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:gap-8">
                <div className="flex gap-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-white/[0.06] text-xs font-semibold tabular-nums text-foreground/70">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium text-foreground">{w.you}</p>
                    {w.tools.length > 0 && <p className="mt-2 flex flex-wrap gap-1.5">{w.tools.map(t => <code key={t} className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[12px] text-foreground/75">{t}</code>)}</p>}
                  </div>
                </div>
                <p className="text-[14px] leading-relaxed text-foreground/65">{w.result}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* E — Permissions, privacy and control. */}
        <section id="control" aria-labelledby="control-title" className="scroll-mt-20 border-t border-white/8 py-16" data-connect-control>
          <Eyebrow>Permissions, privacy and control</Eyebrow>
          <h2 id="control-title" className="mt-3 text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] sm:text-[2.1rem]">You decide what it may do</h2>
          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            <div className="rounded-2xl border border-white/8 p-5">
              <h3 className="font-semibold text-foreground">What you can allow</h3>
              <p className="mt-1 text-sm text-foreground/60">Kivo's consent page lists exactly the ones the assistant asks for.</p>
              <ul className="mt-4 space-y-2.5">
                {MCP_PERMISSIONS.map(([scope, what]) => (
                  <li key={scope} className="flex gap-2.5 text-[13px] leading-snug text-foreground/75"><Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-keppel-300" /><span><span className="font-medium text-foreground/90">{what.charAt(0).toUpperCase() + what.slice(1)}</span> <code className="ml-1 text-[11px] text-foreground/40">{scope}</code></span></li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-white/8 p-5">
              <h3 className="font-semibold text-foreground">What waits for your approval</h3>
              <p className="mt-1 text-sm text-foreground/60">Deleting, moving, renaming or refiling, and any change to more than 12 items. You get one Kivo link, see every change by name, and choose Approve or Decline.</p>
              <ul className="mt-4 space-y-2">{approvals.map(([name, what]) => <li key={name} className="text-[13px] leading-snug text-foreground/75">{what}</li>)}</ul>
            </div>
            <div className="rounded-2xl border border-white/8 p-5">
              <h3 className="font-semibold text-foreground">How your data moves</h3>
              <ul className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-foreground/70">
                <li>The assistant signs in with OAuth. It never gets your password, and Kivo keeps its tokens hashed.</li>
                <li>Each tool reaches only the account that allowed it; the account comes from the token, never from what the assistant sends.</li>
                <li>What the assistant reads from Kivo goes to that assistant's service (Anthropic or OpenAI) and is covered by its terms.</li>
                <li>Kivo logs which tool ran and what it changed, not your conversation.</li>
              </ul>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl bg-white/[0.025] px-5 py-4 text-sm text-foreground/75">
            <span className="flex items-center gap-2"><Unplug aria-hidden className="size-4 text-foreground/50" /> Disconnect any time in <strong className="font-semibold text-foreground">Settings › AI assistants</strong>; access ends at once.</span>
            <Link href="/assistants" className="inline-flex items-center gap-1 font-medium text-action-ink hover:underline">Manage connections <ArrowRight aria-hidden className="size-3.5" /></Link>
          </div>
        </section>

        {/* F — Choose your assistant. */}
        <section id="setup" aria-labelledby="setup-title" className="scroll-mt-20 border-t border-white/8 py-16" data-connect-setup>
          <Eyebrow>Set it up</Eyebrow>
          <h2 id="setup-title" className="mt-3 text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] sm:text-[2.1rem]">Choose your assistant</h2>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-foreground/65">The one thing you do on their side is paste Kivo's address into the field named below. Neither Claude nor ChatGPT has a link that adds a connector for you.</p>
          <div className="mt-6 max-w-xl"><CopyField label="Kivo's MCP server address" value={MCP_URL} /></div>
          <div className="mt-8 grid gap-5 lg:grid-cols-2">
            {[claude, chatgpt].map(c => (
              <article key={c.id} id={c.id} className="scroll-mt-24 rounded-2xl border border-white/8 bg-card/40 p-5 sm:p-6" data-client={c.id}>
                <h3 className="text-xl font-semibold text-foreground">{c.name}</h3>
                {c.intro && <p className="mt-1 text-sm text-foreground/60">{c.intro}</p>}
                <ol className="mt-5 space-y-3">
                  {c.steps.map((step, i) => (
                    <li key={step} className="flex gap-3 text-[14px] leading-relaxed text-foreground/80">
                      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-white/[0.06] text-[11px] font-semibold tabular-nums text-foreground/65">{i + 1}</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
                {c.note && <p className="mt-5 border-t border-white/6 pt-4 text-[13px] leading-relaxed text-foreground/50">{c.note}</p>}
              </article>
            ))}
          </div>
          {other && (
            <details className="group mt-5 rounded-2xl border border-white/8 px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-foreground/80 [&::-webkit-details-marker]:hidden">{other.name} <span className="text-xs font-normal text-foreground/45">Not tested by Kivo</span></summary>
              {other.intro && <p className="mt-3 text-sm text-foreground/65">{other.intro}</p>}
              <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-foreground/75">{other.steps.map(s => <li key={s}>{s}</li>)}</ol>
              {other.note && <p className="mt-3 text-[13px] text-foreground/50">{other.note}</p>}
            </details>
          )}
          <p className="mt-6 text-sm text-foreground/60">Check it works: ask <strong className="font-semibold text-foreground/85">“Which Kivo account is connected?”</strong> Signed in already? <Link href="/assistants" className="text-action-ink underline underline-offset-4">Set it up step by step in Kivo</Link>, which notices the moment it connects.</p>
        </section>

        {/* G — FAQ. */}
        <section aria-labelledby="faq-title" className="border-t border-white/8 py-16" data-connect-faq>
          <h2 id="faq-title" className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">Questions</h2>
          <div className="mt-6 grid gap-x-10 lg:grid-cols-2">
            {FAQ.map(f => (
              <details key={f.q} className="group border-b border-white/8 py-4" data-faq>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium text-foreground/90 [&::-webkit-details-marker]:hidden">{f.q}<ChevronRight aria-hidden className="size-4 shrink-0 text-foreground/40 transition-transform group-open:rotate-90 motion-reduce:transition-none" /></summary>
                <div className="mt-2 text-sm leading-relaxed text-foreground/65 [&_strong]:font-semibold [&_strong]:text-foreground/85">{f.a}</div>
              </details>
            ))}
          </div>
        </section>

        {/* Reference: everything the documentation link promises. */}
        <section aria-labelledby="ref-title" className="border-t border-white/8 pt-16" data-connect-reference>
          <h2 id="ref-title" className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">Reference</h2>
          <div className="mt-4">
            <Reference id="tools" title={`All ${toolCount} tools`}>
              <p>“Reads” never change anything. “Changes” write to your Kivo; your assistant may ask you before running them. “Needs your approval” tools change nothing until you approve the exact change in Kivo.</p>
              {MCP_TOOLS.map(g => (
                <div key={g.group}>
                  <h3 className="mt-6 text-base font-semibold text-foreground">{g.group}</h3>
                  <ul className="mt-2 !list-none !pl-0">
                    {g.items.map(([name, what, kind]) => (
                      <li key={name} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-white/6 py-2 !pl-0"><code>{name}</code><span className="flex-1">{what}</span><Kind kind={kind} /></li>
                    ))}
                  </ul>
                </div>
              ))}
              <p>Every change is read back from Kivo afterwards, and the result says what was created, updated, skipped or failed, with links. Repeating a request with the same key does not apply it twice, and a note that changed since the assistant read it is not overwritten.</p>
            </Reference>
            <Reference id="approval" title="Changes that need your approval">
              <p>The assistant shows you what it wants to do and gives you one link. The page lists each change by name and place. Choose <strong>Approve</strong> and Kivo applies exactly that change; go back to the conversation and the assistant reads the result. Choose <strong>Decline</strong> and nothing happens. If anything changed in the meantime, nothing is applied and the assistant previews it again. Approvals expire after 30 minutes.</p>
              <p>Why a link and not a button in the chat: Claude and ChatGPT don't yet let a connected app ask you to approve something inside the conversation, so the approval happens on Kivo, where you are signed in.</p>
            </Reference>
            <Reference id="limits" title="Limits">
              <ul>
                <li>Search matches words, not meaning. If nothing is found, try other words.</li>
                <li>Relationships are the ones Kivo keeps: a topic inside a subject, a note filed under a topic, and links between notes.</li>
                <li>Images: PNG, JPEG or WebP, up to 2.5 MB each and 6 per request. Claude cannot pass an image you pasted into the chat to a tool: open the note in Kivo and paste it there.</li>
                <li>Up to 120 tool calls a minute per connection.</li>
                <li>On Free, {(free.mcpLifetime ?? 0).toLocaleString("en-US")} tool calls in total; after that, reading continues up to {free.mcpReadOnly} reads a month. Plus and Pro: fair use. Your usage is on <strong>Settings › Plan and billing</strong>.</li>
              </ul>
            </Reference>
            <Reference id="data" title="Your data">
              <ul>
                <li>Kivo stores the assistant's registration (its name and return address), the connection you approved (permissions, expiry, last use) and tokens in hashed form only.</li>
                <li>Kivo keeps a log of tool calls on your account: the tool, the outcome and the ids of the items affected. It does not keep your conversation.</li>
                <li>What the assistant saves becomes part of your Kivo, like anything you write yourself. Images are stored in your notes and shown only to you, and to an assistant you connected when it reads that note.</li>
                <li>When an assistant gives an image by its address, Kivo downloads it once from that public address (never from a private network) and keeps only the image.</li>
                <li>What the assistant does with what it reads is covered by its own terms. See also Kivo's <Link href="/privacy">Privacy Policy</Link>. Deleting your Kivo account removes every connection and its log.</li>
              </ul>
            </Reference>
            <Reference id="help" title="Troubleshooting">
              <ul>
                <li><strong>“Finish setting up Kivo on the web first”</strong>: sign in to Kivo and complete setup, then try again.</li>
                <li><strong>The first call is slow</strong>: the server may be waking up. Try again after a few seconds.</li>
                <li><strong>“approval_required”</strong>: open the approval link the assistant gave you and approve or decline the change in Kivo.</li>
                <li><strong>“mcp_lifetime_exhausted” or “mcp_read_only_allowance_exhausted”</strong>: this Free account has used its calls (see Limits). Nothing in Kivo was changed.</li>
                <li><strong>Too many requests</strong>: wait a minute and try again.</li>
                <li><strong>The assistant can't find Kivo's tools</strong>: turn the connector on for the conversation, check that the address is exactly the one above, then connect again.</li>
                <li><strong>Asked to sign in again</strong>: the connection was disconnected or expired after 30 days without use. Connect again.</li>
              </ul>
            </Reference>
            <Reference id="support" title="Support">
              <p>Questions, problems or a security report about Kivo Connect: email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Include which assistant you use and, if you have one, the time the problem happened.</p>
            </Reference>
          </div>
        </section>
      </main>
    </div>
  )
}

// The demonstration beside the headline: the recording when there is one
// (CONNECT_VIDEO, a real session), else Kivo's real consent screen, the
// moment that decides what an assistant may do. Never a mock-up.
function HeroVisual() {
  if (CONNECT_VIDEO) return <DemoVideo video={CONNECT_VIDEO} />
  return (
    <figure className="relative mx-auto max-w-[17rem] sm:max-w-[22rem] lg:max-w-[26rem]" data-connect-visual="consent">
      <div aria-hidden className="absolute -inset-6 -z-10 rounded-[2rem] bg-[radial-gradient(60%_50%_at_50%_40%,rgb(45_212_191/0.10),transparent_70%)]" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/kivo-connect/consent-screen.webp" width={496} height={848} alt="Kivo's consent screen asking “Allow Claude to use your Kivo?”, listing what Claude may do, with Don't allow and Allow" className="w-full rounded-2xl border border-white/10 shadow-2xl" />
      <figcaption className="mt-3 text-center text-[13px] text-foreground/55">The real screen Kivo shows when Claude asks to connect. Nothing is shared until you choose Allow.</figcaption>
    </figure>
  )
}
