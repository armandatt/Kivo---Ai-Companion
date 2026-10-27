import type { KnowledgeSubject, KnowledgeTopic } from '@repo/api/nova/product/knowledge.types'

// The Knowledge explorer's tree: subjects (a subject inside another under
// it), then each subject's topics as arranged, topics inside topics to any
// depth. Built only from what the Knowledge view returned (the outline, in
// saved order); nothing is grouped by name or made up. Pure, so it is tested
// without a page.

export type TreeKind = 'subject' | 'topic'

export interface TreeNode {
  key:       string                 // "s:<subjectId>" or "t:<topicId>"
  kind:      TreeKind
  id:        string
  name:      string
  subjectId: string                 // a subject's own id; a topic's subject
  parentKey: string | null
  children:  TreeNode[]
  // A studied topic's state. Absent on subjects and on topics that organise
  // others (units, topics with topics inside, milestones).
  topic?:    KnowledgeTopic
  milestone: boolean
  // Studied topics at or below this node, and how many of them are due.
  topicCount: number
  dueCount:   number
}

export interface Selection { kind: TreeKind; id: string }

export const subjectKey = (id: string) => `s:${id}`
export const topicKey   = (id: string) => `t:${id}`
export const keyOf     = (s: Selection) => (s.kind === 'subject' ? subjectKey(s.id) : topicKey(s.id))

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

// parentOf: the subject a subject sits inside, when known. A parent that is
// missing, or that would make a loop, leaves the subject at the top.
export function buildKnowledgeTree(subjects: KnowledgeSubject[], parentOf: (subjectId: string) => string | null | undefined = () => null): TreeNode[] {
  const nodes = new Map<string, TreeNode>()
  for (const s of subjects) {
    const node: TreeNode = { key: subjectKey(s.subjectId), kind: 'subject', id: s.subjectId, name: s.subjectName, subjectId: s.subjectId, parentKey: null, children: [], milestone: false, topicCount: 0, dueCount: 0 }
    const state = new Map(s.topics.map(t => [t.id, t]))
    const topicNode = (id: string, name: string, parentKey: string, milestone: boolean): TreeNode =>
      ({ key: topicKey(id), kind: 'topic', id, name, subjectId: s.subjectId, parentKey, children: [], topic: state.get(id), milestone, topicCount: 0, dueCount: 0 })
    if (s.outline && s.outline.length > 0) {
      // Rows come in saved order with their depth: each row's parent is the
      // nearest row above it one level up.
      const stack: TreeNode[] = []
      for (const row of s.outline) {
        stack.length = Math.min(stack.length, row.depth)
        const parent = stack[stack.length - 1] ?? node
        const child = topicNode(row.id, row.name, parent.key, row.kind === 'milestone')
        if (!row.studied) delete child.topic
        parent.children.push(child)
        stack.push(child)
      }
    } else {
      for (const t of [...s.topics].sort((a, b) => a.topicName.localeCompare(b.topicName, undefined, { sensitivity: 'base' }))) node.children.push(topicNode(t.id, t.topicName, node.key, false))
    }
    nodes.set(s.subjectId, node)
  }

  const roots: TreeNode[] = []
  const inside = new Map<string, TreeNode[]>()
  for (const node of nodes.values()) {
    let parent = parentOf(node.id) ?? null
    // A loop or a missing parent: on its own.
    const seen = new Set([node.id])
    for (let p = parent; p; p = parentOf(p) ?? null) {
      if (seen.has(p) || !nodes.has(p)) { parent = null; break }
      seen.add(p)
    }
    if (parent) { node.parentKey = subjectKey(parent); (inside.get(parent) ?? inside.set(parent, []).get(parent)!).push(node) }
    else roots.push(node)
  }
  for (const [parent, children] of inside) {
    const host = nodes.get(parent)!
    // Subjects inside a subject come before its topics, by name.
    host.children = [...children.sort(byName), ...host.children]
  }

  const count = (n: TreeNode): void => {
    n.children.forEach(count)
    n.topicCount = (n.topic ? 1 : 0) + n.children.reduce((sum, c) => sum + c.topicCount, 0)
    n.dueCount   = (n.topic?.reviewState === 'due' ? 1 : 0) + n.children.reduce((sum, c) => sum + c.dueCount, 0)
  }
  roots.forEach(count)
  return roots.sort(byName)
}

export function indexTree(roots: TreeNode[]): Map<string, TreeNode> {
  const index = new Map<string, TreeNode>()
  const walk = (n: TreeNode) => { index.set(n.key, n); n.children.forEach(walk) }
  roots.forEach(walk)
  return index
}

// The node and everything above it, outermost first.
export function pathTo(index: Map<string, TreeNode>, key: string): TreeNode[] {
  const path: TreeNode[] = []
  for (let n = index.get(key); n; n = n.parentKey ? index.get(n.parentKey) : undefined) path.unshift(n)
  return path
}

// What the tree shows: every root, and the children of each open node.
export function visibleRows(roots: TreeNode[], open: ReadonlySet<string>): Array<{ node: TreeNode; level: number }> {
  const rows: Array<{ node: TreeNode; level: number }> = []
  const walk = (n: TreeNode, level: number) => {
    rows.push({ node: n, level })
    if (open.has(n.key)) n.children.forEach(c => walk(c, level + 1))
  }
  roots.forEach(r => walk(r, 1))
  return rows
}

const fold = (text: string) => text.toLocaleLowerCase().replace(/\s+/g, ' ').trim()

// Every subject and topic whose name holds the query, in tree order, each with
// the names above it so two topics of one name can be told apart.
export function searchTree(roots: TreeNode[], query: string, limit = 50): Array<{ node: TreeNode; path: string[] }> {
  const q = fold(query)
  if (!q) return []
  const found: Array<{ node: TreeNode; path: string[] }> = []
  const walk = (n: TreeNode, above: string[]) => {
    if (found.length >= limit) return
    if (fold(n.name).includes(q)) found.push({ node: n, path: above })
    n.children.forEach(c => walk(c, [...above, n.name]))
  }
  roots.forEach(r => walk(r, []))
  return found
}

// The address names what is shown: ?subject=<id> (its board) or ?topic=<id>
// (the topic). The Knowledge Map links here the same way.
export function selectionFrom(search: string): Selection | null {
  const params = new URLSearchParams(search)
  const topic = params.get('topic')
  if (topic) return { kind: 'topic', id: topic }
  const subject = params.get('subject')
  return subject ? { kind: 'subject', id: subject } : null
}

export function selectionHref(pathname: string, s: Selection | null): string {
  return s ? `${pathname}?${s.kind}=${encodeURIComponent(s.id)}` : pathname
}

// The workspace whose structure Build with Nova should open for a subject:
// the first (newest) that holds the subject or a subject it sits inside.
export function workspaceFor(index: Map<string, TreeNode>, subjectId: string, workspaces: Array<{ id: string; subjects: Array<{ id: string }> }>): string | null {
  const chain = pathTo(index, subjectKey(subjectId)).filter(n => n.kind === 'subject').map(n => n.id).reverse()
  for (const id of chain) {
    const holder = workspaces.find(w => w.subjects.some(s => s.id === id))
    if (holder) return holder.id
  }
  return null
}
