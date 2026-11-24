import type { Metadata } from "next"
import Link from "next/link"
import type { ReactNode } from "react"
import { KivoMark, KivoWordmark } from "@/components/brand/kivo-brand"
import { CONTACT_EMAIL } from "@/lib/site-links"
import { CopyField } from "@/components/connect/copy-field"
import { CONNECT_VIDEO, MCP_CLIENTS, MCP_PERMISSIONS, MCP_TOOLS, MCP_URL } from "@/components/connect/mcp-clients"
import { DemoVideo } from "@/components/media/demo-video"
import { DEFAULT_ALLOWANCES } from "@repo/api/billing/accounting/rules"

// Public documentation for Kivo Connect (the MCP server at /api/mcp): what it
// does, how to connect Claude or ChatGPT, what each permission allows, and how
// to disconnect. Linked from the OAuth metadata (resource_documentation) and
// from the Claude Connectors Directory listing, so it must stay reachable
// without signing in. Everything here describes behaviour in
// packages/api/src/connect and apps/api/lib/connect; keep them in step.

export const metadata: Metadata = {
  title: "Kivo Connect: use Kivo from Claude and ChatGPT",
  description: "Connect Claude or ChatGPT to your Kivo notes and Knowledge Map: setup, permissions, tools and privacy.",
}

const SECTIONS = [
  { id: "what", title: "What it does" },
  { id: "before", title: "Before you connect" },
  { id: "connect", title: "Connect your assistant" },
  { id: "check", title: "Check it works" },
  { id: "permissions", title: "Permissions" },
  { id: "tools", title: "Tools" },
  { id: "approval", title: "Changes that need your approval" },
  { id: "examples", title: "Things to ask" },
  { id: "limits", title: "Limits" },
  { id: "data", title: "Your data" },
  { id: "disconnect", title: "Disconnect" },
  { id: "help", title: "Troubleshooting" },
  { id: "support", title: "Support" },
]

const KIND_LABEL = { read: "Reads", write: "Changes", approval: "Needs approval" } as const

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 border-t border-white/8 pt-8">
      <h2 id={`${id}-title`} className="text-xl font-semibold leading-tight tracking-[-0.01em] text-foreground">{title}</h2>
      <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-foreground/80 [&_li]:pl-1 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_a]:text-action-ink [&_a]:underline [&_a]:underline-offset-4 [&_code]:rounded [&_code]:bg-white/6 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[0.9em]">
        {children}
      </div>
    </section>
  )
}

export default function KivoConnectDocs() {
  return (
    <div className="kivo-app min-h-screen bg-background text-foreground">
      <header className="border-b border-white/8">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" aria-label="Kivo home">
            <KivoMark size={26} className="text-foreground" />
            <KivoWordmark height={18} className="text-foreground" />
          </Link>
          <nav aria-label="Kivo Connect" className="flex items-center gap-4 text-sm">
            <Link href="/privacy" className="text-foreground/70 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">Privacy</Link>
            <Link href="/signup" className="rounded-lg border border-white/12 px-3 py-1.5 text-foreground/85 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-ring">Get Kivo</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-subtle">Integration</p>
        <h1 className="mt-2 text-[2.1rem] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[2.8rem]">Kivo Connect</h1>
        <p className="mt-6 text-[17px] leading-relaxed text-foreground/85">
          Use Claude or ChatGPT with what you have already learned. Kivo Connect lets your assistant read your Kivo notes and
          Knowledge Map, so its answers start from your material, and lets it save what you work out in a chat back into Kivo,
          filed in the right place. It only does what you allow.
        </p>

        {/* Value before setup (founder review #03). Every line here is a tool in packages/api/src/connect/tools.ts. */}
        <div className="mt-8 grid gap-3 sm:grid-cols-2" data-connect-value>
          {[
            ["It reads", "Your notes, subjects and topics, the Knowledge Map and your saved pages: search them, open one, see what connects to what and where a topic has no material yet."],
            ["It writes", "New notes and additions to notes, new subjects and topics, links between notes and topics, and saved web pages filed under a topic. Each change is read back and reported."],
            ["You approve the big changes", "Deleting, moving, renaming or refiling, and anything touching more than 12 items, waits for you: the assistant gives you a link, you see each change by name in Kivo, and choose Approve or Decline."],
            ["It all lands in your Kivo", "What it saves is ordinary Kivo notes, topics and saved pages: on your Knowledge Map, in Notes and in search, yours to edit like anything you write."],
            ["You choose what it may do", "Connecting opens a Kivo page (OAuth sign-in) that names the assistant and lists each permission it asks for. Nothing is shared until you choose Allow, and it gets only the tools those permissions cover."],
            ["You can take it back", "Settings › AI assistants (or AI Assistants in the sidebar) lists every connected assistant with its permissions and last use. Disconnect ends its access at once; an unused connection lapses after 30 days."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-xl border border-white/8 bg-card/60 p-4">
              <p className="text-sm font-semibold text-foreground">{t}</p>
              <p className="mt-1 text-sm leading-relaxed text-foreground/70">{d}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-xl border border-white/8 bg-card/60 p-4 sm:p-5" data-connect-start>
          <p className="text-sm font-semibold text-foreground">Get started</p>
          <ol className="mt-3 space-y-2 text-sm text-foreground/80 [&_a]:text-action-ink [&_a]:underline">
            <li><strong className="text-foreground">1.</strong> Have a Kivo account with at least one subject (<Link href="/signup">sign up</Link>).</li>
            <li><strong className="text-foreground">2.</strong> Copy Kivo&apos;s address below. Kivo can&apos;t add itself to Claude or ChatGPT: you paste it into the assistant&apos;s connector settings (<a href="#connect">where, exactly</a>).</li>
            <li><strong className="text-foreground">3.</strong> The assistant sends you to Kivo: sign in, look at what it asks for, and choose Allow. Signed in already? <Link href="/assistants">Set it up step by step</Link>; Kivo notices the moment it connects.</li>
          </ol>
          <div className="mt-4"><CopyField label="Server address" value={MCP_URL} /></div>
        </div>
        {CONNECT_VIDEO && <div className="mt-6"><DemoVideo video={CONNECT_VIDEO} /></div>}

        <nav aria-label="On this page" className="mt-8 rounded-xl border border-white/8 bg-card/60 p-4">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-subtle">On this page</p>
          <ol className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
            {SECTIONS.map((s, i) => (
              <li key={s.id}><a href={`#${s.id}`} className="text-foreground/80 hover:text-foreground hover:underline">{i + 1}. {s.title}</a></li>
            ))}
          </ol>
        </nav>

        <div className="mt-10 space-y-10">
          <Section id="what" title="What it does">
            <p>Kivo is a personal learning space: notes, subjects and topics, and a Knowledge Map of how they connect. Kivo Connect is a remote MCP server that gives an AI assistant a set of tools over that space, so you can:</p>
            <ul>
              <li>Ask questions about your own notes, and get answers that cite them.</li>
              <li>See a subject's structure, find related notes and topics, and find what is missing.</li>
              <li>Turn a useful conversation into notes, filed under the right subject, without duplicating what you already have.</li>
              <li>Build or extend a Knowledge Map from an outline.</li>
            </ul>
            <p>The assistant only reaches the Kivo account you sign in with, and only with the permissions you allow.</p>
          </Section>

          <Section id="before" title="Before you connect">
            <ul>
              <li>A Kivo account. <Link href="/signup">Sign up</Link> on the web, then finish setting up your learning space (subjects you study). Until then the tools answer that setup is not finished.</li>
              <li>An assistant that supports remote MCP connectors with OAuth, such as Claude or ChatGPT. Which of their plans include custom connectors is up to Anthropic and OpenAI.</li>
            </ul>
          </Section>

          <Section id="connect" title="Connect your assistant">
            <p>Every assistant connects the same way on Kivo&apos;s side: it sends you to Kivo to sign in, Kivo shows what it may do, and you choose Allow. There is no API key and nothing to install. Neither Claude nor ChatGPT has a link that adds a connector for you, so the one thing you do on their side is paste Kivo&apos;s address into the field named below.</p>
            <CopyField label="Server address" value={MCP_URL} />
            {MCP_CLIENTS.map(c => (
              <div key={c.id} id={c.id} className="scroll-mt-24 pt-2">
                <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold text-foreground">
                  {c.name}
                  {c.status === "untested" && <span className="rounded-full border border-white/12 px-2 py-px text-[11px] font-normal text-subtle">Not tested by Kivo</span>}
                </h3>
                {c.intro && <p className="mt-1">{c.intro}</p>}
                <ol className="mt-2">{c.steps.map(step => <li key={step}>{step}</li>)}</ol>
                {c.note && <p className="mt-2 text-sm text-subtle">{c.note}</p>}
              </div>
            ))}
          </Section>

          <Section id="check" title="Check it works">
            <ol>
              <li>Ask your assistant: <strong>&ldquo;Which Kivo account is connected?&rdquo;</strong> It calls <code>get_my_profile</code> and answers with your name and what it may do.</li>
              <li>Ask something about your own material, for example &ldquo;What subjects do I have in Kivo?&rdquo;.</li>
              <li>In Kivo, open <strong>Settings › AI assistants</strong>: the assistant is listed with the permissions you allowed and when it was last used.</li>
            </ol>
            <p>If the assistant says it has no Kivo tools, turn the connector on for that conversation, or connect again.</p>
          </Section>

          <Section id="permissions" title="Permissions">
            <p>When you connect, the assistant asks for some of these. Kivo&apos;s consent page lists the ones requested, and the assistant only gets the tools those permissions cover.</p>
            <ul>
              {MCP_PERMISSIONS.map(([scope, what]) => <li key={scope}><strong>{scope}</strong>: {what}.</li>)}
            </ul>
          </Section>

          <Section id="tools" title="Tools">
            <p>{MCP_TOOLS.reduce((n, g) => n + g.items.length, 0)} tools. &ldquo;Reads&rdquo; never change anything and need no approval. &ldquo;Changes&rdquo; write to your Kivo; your assistant may ask you before running them. &ldquo;Needs approval&rdquo; tools change nothing until you approve the exact change in Kivo (below), so you can let your assistant use Kivo&apos;s tools without asking each time and still decide every delete, move and rename.</p>
            {MCP_TOOLS.map(g => (
              <div key={g.group}>
                <h3 className="mt-6 text-base font-semibold text-foreground">{g.group}</h3>
                <ul className="mt-2 !list-none !pl-0">
                  {g.items.map(([name, what, kind]) => (
                    <li key={name} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-white/6 py-2 !pl-0">
                      <code>{name}</code>
                      <span className="flex-1">{what}</span>
                      <span className="text-xs text-subtle">{KIND_LABEL[kind]}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <p>Every change is read back from Kivo afterwards, and the result says what was created, updated, skipped or failed, with links. Repeating a request with the same key does not apply it twice, and a note that changed since the assistant read it is not overwritten.</p>
          </Section>

          <Section id="approval" title="Changes that need your approval">
            <p>Deleting, moving, renaming or refiling (notes, topics and subjects), and any change to more than 12 items, is never done straight away. The assistant shows you what it wants to do and gives you one link. The page lists each change by name and place: the note or topic, where it is now, and its new name or where it goes. Choose <strong>Approve</strong> and Kivo applies exactly that change there and then; go back to the conversation and the assistant reads the result, so you don&apos;t need to ask again. Choose <strong>Decline</strong> and nothing happens; the assistant can&apos;t apply it later. If anything changed in the meantime, nothing is applied and the assistant previews it again. Approvals expire after 30 minutes.</p>
            <p>When a change adds note text in bulk (more than 12 notes or additions at once), Kivo doesn&apos;t keep that text while it waits for you: Approve records your approval and the assistant applies it when you go back.</p>
            <p>Why a link and not a button in the chat: Claude and ChatGPT don&apos;t yet let a connected app ask you to approve something inside the conversation, so the approval happens on Kivo, where you are signed in.</p>
          </Section>

          <Section id="examples" title="Things to ask">
            <ul>
              <li>&ldquo;What do my Kivo notes say about Raft leader election?&rdquo;</li>
              <li>&ldquo;Which topics in my Distributed Systems subject have no notes yet?&rdquo;</li>
              <li>&ldquo;Save the key ideas from this conversation to Kivo under Machine Learning.&rdquo;</li>
              <li>&ldquo;Build a Knowledge Map for Organic Chemistry from this syllabus.&rdquo;</li>
              <li>&ldquo;Which of my notes should be linked to each other?&rdquo;</li>
            </ul>
          </Section>

          <Section id="limits" title="Limits">
            <ul>
              <li>Search matches words, not meaning. If nothing is found, try other words.</li>
              <li>Relationships are the ones Kivo keeps: a topic inside a subject, a note filed under a topic, and links between notes. Kivo does not infer hidden relationships.</li>
              <li>Kivo Connect does not call an AI model itself. The assistant you use writes the text; Kivo stores and organises it.</li>
              <li>Images: PNG, JPEG or WebP, up to 2.5 MB each and 6 per request. An assistant can send an image&apos;s data, a public https address, or (in ChatGPT) a file you attached. Claude cannot pass an image you pasted into the chat to a tool: open the note in Kivo and paste it there.</li>
              <li>When reading, an assistant gets up to 3 of a note&apos;s images per request and asks again for more.</li>
              <li>Up to 120 tool calls a minute per connection.</li>
              <li>On Free, ChatGPT and Claude can make {(DEFAULT_ALLOWANCES.free.mcpLifetime ?? 0).toLocaleString("en-US")} tool calls in total. After that, changes from an assistant pause and reading continues, up to {DEFAULT_ALLOWANCES.free.mcpReadOnly} read calls a month, starting again each month. Plus and Pro have no fixed number (fair use). Your usage is on <strong>Settings › Plan and billing</strong>.</li>
            </ul>
          </Section>

          <Section id="data" title="Your data">
            <ul>
              <li>Each tool reaches only the account that approved the connection. The account comes from the access token, never from what the assistant sends.</li>
              <li>Kivo stores the assistant&apos;s registration (its name and return address), the connection you approved (permissions, expiry, last use) and tokens in hashed form only.</li>
              <li>Kivo keeps a log of tool calls on your account: the tool, the outcome and the ids of the items affected, plus the result of each change so that a repeated request is not applied twice. It does not keep your conversation.</li>
              <li>What the assistant saves (notes, images, subjects, topics) becomes part of your Kivo, like anything you write yourself. Images are stored in your notes and shown only to you, and to an assistant you connected when it reads that note.</li>
              <li>When an assistant gives an image by its address, Kivo downloads it once from that public address (never from a private network) and keeps only the image.</li>
              <li>What the assistant does with what it reads is covered by that assistant&apos;s own terms. See also Kivo&apos;s <Link href="/privacy">Privacy Policy</Link>.</li>
            </ul>
          </Section>

          <Section id="disconnect" title="Disconnect">
            <p>In Kivo, open <strong>Settings › AI assistants</strong> and select <strong>Disconnect</strong> next to the assistant. Its access ends at once. You can also remove the connector in Claude or ChatGPT; that stops the assistant from using it, and the Kivo side lapses when its tokens expire. Deleting your Kivo account removes every connection and its log.</p>
          </Section>

          <Section id="help" title="Troubleshooting">
            <ul>
              <li><strong>&ldquo;Finish setting up Kivo on the web first&rdquo;</strong>: sign in to Kivo and complete setup, then try again.</li>
              <li><strong>The first call is slow</strong>: the server may be waking up. Try again after a few seconds.</li>
              <li><strong>&ldquo;approval_required&rdquo;</strong>: open the approval link the assistant gave you and approve or decline the change in Kivo.</li>
              <li><strong>&ldquo;declined&rdquo;</strong>: you declined that change. Nothing was done; ask again if you change your mind.</li>
              <li><strong>&ldquo;mcp_lifetime_exhausted&rdquo; or &ldquo;mcp_read_only_allowance_exhausted&rdquo;</strong>: this Free account has used its calls (see Limits). Reading continues within the month&apos;s reads; nothing in Kivo was changed.</li>
              <li><strong>Too many requests at once</strong>: wait a minute and try again.</li>
              <li><strong>The assistant can&apos;t find Kivo&apos;s tools</strong>: turn the connector on for the conversation, check that the address is exactly the one above, then connect again.</li>
              <li><strong>Asked to sign in again</strong>: the connection was disconnected or expired after 30 days without use. Connect again.</li>
            </ul>
          </Section>

          <Section id="support" title="Support">
            <p>Questions, problems or a security report about Kivo Connect: email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Include which assistant you use and, if you have one, the time the problem happened.</p>
          </Section>
        </div>
      </main>
    </div>
  )
}
