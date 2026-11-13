import type { Metadata } from "next"
import Link from "next/link"
import type { ReactNode } from "react"
import { KivoMark, KivoWordmark } from "@/components/brand/kivo-brand"
import { LEGAL_CONTACT } from "@/components/legal/to-confirm"

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

const MCP_URL = "https://www.thekivo.in/api/mcp"

const SECTIONS = [
  { id: "what", title: "What it does" },
  { id: "before", title: "Before you connect" },
  { id: "claude", title: "Connect Claude" },
  { id: "chatgpt", title: "Connect ChatGPT" },
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

const TOOLS: Array<{ group: string; items: Array<[string, string, "read" | "write" | "approval"]> }> = [
  { group: "Your workspace", items: [
    ["get_my_profile", "Which Kivo account is connected and what it may do", "read"],
    ["list_workspaces", "Your workspaces and top-level subjects", "read"],
    ["get_workspace_context", "One workspace: its subjects, topics and recent notes", "read"],
    ["get_workspace_structure", "The subject and topic outline of a workspace", "read"],
    ["get_dashboard_summary", "Counts and recent activity across your knowledge", "read"],
    ["summarize_workspace", "A summary of a workspace's material", "read"],
  ] },
  { group: "Notes", items: [
    ["search_notes", "Find notes by words in their title or text", "read"],
    ["get_note", "Read one note", "read"],
    ["list_recent_notes", "Notes you changed most recently", "read"],
    ["create_note", "Create a note, optionally filed under a subject or topic", "write"],
    ["update_note", "Add to a note or rename it", "write"],
    ["link_notes", "Link a note to another note or a topic", "write"],
    ["move_note", "Refile a note under another subject or topic", "approval"],
    ["delete_note", "Delete a note", "approval"],
  ] },
  { group: "Knowledge Map", items: [
    ["get_knowledge_map", "Your subjects, topics and how they connect", "read"],
    ["search_knowledge_nodes", "Find a subject or topic on the map", "read"],
    ["get_node_connections", "What a subject or topic connects to", "read"],
    ["add_knowledge_node", "Add a subject or topics", "write"],
    ["update_knowledge_node", "Describe a subject or topic, or rename it", "write"],
    ["connect_knowledge_nodes", "Connect two items on the map", "write"],
    ["build_knowledge_map", "Build or extend a map from an outline (preview first)", "write"],
  ] },
  { group: "Understanding your knowledge", items: [
    ["global_search", "Search notes and the map together", "read"],
    ["find_related_content", "Notes and topics related to one item", "read"],
    ["analyze_knowledge", "How your material is structured, and where it is thin", "read"],
    ["recommend_connections", "Links that may be missing between notes and topics", "read"],
    ["find_knowledge_gaps", "Topics with little or no material", "read"],
    ["organize_workspace", "A proposed reorganisation (nothing is changed)", "read"],
  ] },
  { group: "Saving and reviewed changes", items: [
    ["capture_knowledge", "Save ideas from the conversation as notes, skipping duplicates and adding to existing notes (preview first)", "write"],
    ["preview_knowledge_changes", "Show exactly what a set of changes would do", "read"],
    ["execute_knowledge_changes", "Apply a previewed set of changes once you have approved it in Kivo", "approval"],
  ] },
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
          Kivo Connect lets Claude and ChatGPT work with your Kivo knowledge base, with your permission: search and read your notes,
          explore your Knowledge Map, spot gaps and missing links, and save what you learn in a conversation as organised notes.
        </p>
        <div className="mt-6 rounded-xl border border-white/8 bg-card/60 p-4 text-sm">
          <p className="text-subtle">Server address</p>
          <p className="mt-1 break-all font-mono text-foreground">{MCP_URL}</p>
        </div>

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

          <Section id="claude" title="Connect Claude">
            <ol>
              <li>In Claude, open <strong>Settings › Connectors</strong>. If Kivo is listed in the directory, choose it. Otherwise choose <strong>Add custom connector</strong>, name it Kivo and paste <code>{MCP_URL}</code>.</li>
              <li>Select <strong>Connect</strong>. A Kivo page opens; sign in if asked.</li>
              <li>Kivo shows which assistant is asking and what it may do. Select <strong>Allow</strong>.</li>
              <li>Back in Claude, enable Kivo in a conversation (the tools menu) and ask something about your notes.</li>
            </ol>
          </Section>

          <Section id="chatgpt" title="Connect ChatGPT">
            <ol>
              <li>In ChatGPT settings, turn on developer mode for connectors (under Apps / Connectors), then create a connector.</li>
              <li>Paste <code>{MCP_URL}</code> as the MCP server URL and choose OAuth for authentication.</li>
              <li>Connect, sign in to Kivo if asked, and select <strong>Allow</strong>.</li>
            </ol>
            <p>Menu names in both assistants change from time to time; the steps on Kivo&apos;s side stay the same.</p>
          </Section>

          <Section id="permissions" title="Permissions">
            <p>When you connect, the assistant asks for some of these. Kivo&apos;s consent page lists the ones requested, and the assistant only gets the tools those permissions cover.</p>
            <ul>
              <li><strong>profile:read</strong>: your name and which account is connected.</li>
              <li><strong>workspace:read</strong>: your workspaces, subjects and topics.</li>
              <li><strong>notes:read</strong>: read and search your notes.</li>
              <li><strong>notes:write</strong>: create, add to, link, move and delete notes.</li>
              <li><strong>knowledge:read</strong>: read your Knowledge Map.</li>
              <li><strong>knowledge:write</strong>: add, describe and connect subjects and topics.</li>
            </ul>
          </Section>

          <Section id="tools" title="Tools">
            <p>30 tools. &ldquo;Reads&rdquo; never change anything. &ldquo;Changes&rdquo; write to your Kivo, and Claude asks you before running them. &ldquo;Needs approval&rdquo; tools are refused until you approve the exact change in Kivo (below).</p>
            {TOOLS.map(g => (
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
            <p>Deleting, moving, renaming or refiling, and any change to more than 12 items, is never done straight away. The assistant gets a preview and a link. Open the link, check the summary in Kivo, and approve it; then the assistant can apply that exact change, once. If anything changed in the meantime, the change is refused and previewed again. Approvals expire after 30 minutes.</p>
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
              <li>Up to 120 tool calls a minute per connection.</li>
            </ul>
          </Section>

          <Section id="data" title="Your data">
            <ul>
              <li>Each tool reaches only the account that approved the connection. The account comes from the access token, never from what the assistant sends.</li>
              <li>Kivo stores the assistant&apos;s registration (its name and return address), the connection you approved (permissions, expiry, last use) and tokens in hashed form only.</li>
              <li>Kivo keeps a log of tool calls on your account: the tool, the outcome and the ids of the items affected, plus the result of each change so that a repeated request is not applied twice. It does not keep your conversation.</li>
              <li>What the assistant saves (notes, subjects, topics) becomes part of your Kivo, like anything you write yourself.</li>
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
              <li><strong>&ldquo;approval_required&rdquo;</strong>: open the approval link the assistant gave you and approve the change in Kivo.</li>
              <li><strong>Asked to sign in again</strong>: the connection was disconnected or expired after 30 days without use. Connect again.</li>
            </ul>
          </Section>

          <Section id="support" title="Support">
            <p>Questions, problems or a security report about Kivo Connect: email <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>. Include which assistant you use and, if you have one, the time the problem happened.</p>
          </Section>
        </div>
      </main>
    </div>
  )
}
