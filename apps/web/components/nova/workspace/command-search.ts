import type { MapNode } from '@repo/api/nova/product/knowledge-map.types'
import type { NovaTaskItem } from '@repo/api/nova/product/tasks.types'

// What the command palette can find, and the order it lists matches in.
// Every entry opens a place that exists: a page in the sidebar, or a row the
// Knowledge Map returned with its own address. Nothing is made up to fill
// the list. Pure, so it is tested without a page.

export type CommandKind = 'page' | 'subject' | 'topic' | 'note' | 'resource' | 'task'

export interface CommandEntry {
  id:     string
  kind:   CommandKind
  label:  string
  // A second line: the subject a topic or note belongs to, a page's site.
  detail: string | null
  href:   string
}

export const KIND_LABEL: Record<CommandKind, string> = {
  page: 'Page', subject: 'Subject', topic: 'Topic', note: 'Note', resource: 'Saved page', task: 'Task',
}

const TASK_BOARD = '/planner?view=board'

export function commandEntries(sources: {
  pages: ReadonlyArray<{ path: string; label: string }>
  nodes: readonly MapNode[]
  tasks: readonly NovaTaskItem[]
}): CommandEntry[] {
  const entries: CommandEntry[] = sources.pages.map(p => ({ id: `page:${p.path}`, kind: 'page', label: p.label, detail: null, href: p.path }))
  for (const node of sources.nodes) {
    // A node with no page of its own cannot be opened, so it is not offered.
    if (!node.href) continue
    const detail = node.type === 'subject' ? null
      : node.type === 'resource' ? node.domain
      : node.subjectName
    entries.push({ id: node.id, kind: node.type, label: node.label, detail, href: node.href })
  }
  for (const task of sources.tasks) {
    if (task.status === 'done') continue
    entries.push({ id: `task:${task.id}`, kind: 'task', label: task.title, detail: task.subjectName, href: TASK_BOARD })
  }
  return entries
}

// How well an entry's name matches what was typed: the whole name, its
// start, the start of a word in it, anywhere in it; then its second line.
// null: no match. Lower is better.
function score(entry: CommandEntry, q: string): number | null {
  const label = entry.label.toLowerCase()
  if (label === q) return 0
  if (label.startsWith(q)) return 1
  if (label.split(/[\s\-_/.,:()]+/).some(word => word.startsWith(q))) return 2
  if (label.includes(q)) return 3
  if (entry.detail?.toLowerCase().includes(q)) return 4
  return null
}

const KIND_ORDER: CommandKind[] = ['page', 'subject', 'topic', 'note', 'task', 'resource']

// With nothing typed, the pages, in the sidebar's order. Otherwise the
// matches, best first; equal matches keep their kind's order and then the
// order they were given in, so the same data always lists the same way.
export function searchCommands(entries: readonly CommandEntry[], query: string, limit = 12): CommandEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return entries.filter(e => e.kind === 'page').slice(0, limit)
  return entries
    .map((entry, index) => ({ entry, index, s: score(entry, q) }))
    .filter((m): m is { entry: CommandEntry; index: number; s: number } => m.s !== null)
    .sort((a, b) => a.s - b.s || KIND_ORDER.indexOf(a.entry.kind) - KIND_ORDER.indexOf(b.entry.kind) || a.index - b.index)
    .slice(0, limit)
    .map(m => m.entry)
}
