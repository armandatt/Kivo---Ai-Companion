// ─── Tasks as a tree: the rules, pure ─────────────────────────────────────────
// A task may be a step of another task, which may itself be a step, up to
// TASK_DEPTH_MAX levels. Everything that writes or shows the tree goes
// through these: tasks.ts (the Planner), workspace-plan.ts (a plan's tasks),
// builder-changes.ts (changes Build with Nova proposes) and the web app's
// views. No imports, so the web app imports it directly.
//
// Nodes are named by an id (a stored task) or a key (a task in a plan); the
// rules are the same. Subjects inside subjects (setup-edit.ts) use them too,
// with their own cap (`max`).

// Levels a tree may have: a task, its steps, their steps, … Deep enough for
// any real plan; a cap so a view can always indent it.
export const TASK_DEPTH_MAX = 8;

export interface TreeNode { id: string; parent: string | null }

// id → its parent, for the walks below.
export function parentsOf(nodes: readonly TreeNode[]): Map<string, string | null> {
  return new Map(nodes.map(n => [n.id, n.parent]));
}

// The ids above a node, nearest first. A loop or a missing parent ends the walk.
export function ancestorsOf(parents: ReadonlyMap<string, string | null>, id: string): string[] {
  const out: string[] = [];
  let at = parents.get(id) ?? null;
  while (at !== null && !out.includes(at) && at !== id && out.length <= TASK_DEPTH_MAX) {
    out.push(at);
    at = parents.get(at) ?? null;
  }
  return out;
}

// The level a node sits at: 1 for a task of its own, 2 for its step, …
export const levelOf = (parents: ReadonlyMap<string, string | null>, id: string): number => ancestorsOf(parents, id).length + 1;

// A node and everything under it, the node first.
export function subtreeOf(nodes: readonly TreeNode[], id: string): string[] {
  const children = new Map<string, string[]>();
  for (const n of nodes) if (n.parent) children.set(n.parent, [...(children.get(n.parent) ?? []), n.id]);
  const out: string[] = [];
  const walk = (at: string) => { if (out.includes(at)) return; out.push(at); for (const c of children.get(at) ?? []) walk(c); };
  walk(id);
  return out;
}

// How many levels a node's subtree spans: 1 for a node with no steps.
export function heightOf(nodes: readonly TreeNode[], id: string): number {
  const children = new Map<string, string[]>();
  for (const n of nodes) if (n.parent) children.set(n.parent, [...(children.get(n.parent) ?? []), n.id]);
  const seen = new Set<string>();
  const h = (at: string): number => {
    if (seen.has(at)) return 0;
    seen.add(at);
    return 1 + Math.max(0, ...(children.get(at) ?? []).map(h));
  };
  return h(id);
}

export type MoveCheck = { ok: true } | { ok: false; reason: "self" | "loop" | "missing" | "too_deep" };

// Whether a node may go under `parent` (null: be a task of its own): not
// under itself or anything under it, under a node that exists, and the whole
// subtree within `max` levels.
export function canPlace(nodes: readonly TreeNode[], id: string, parent: string | null, max = TASK_DEPTH_MAX): MoveCheck {
  if (parent === null) return { ok: true };
  if (parent === id) return { ok: false, reason: "self" };
  if (!nodes.some(n => n.id === parent)) return { ok: false, reason: "missing" };
  if (subtreeOf(nodes, id).includes(parent)) return { ok: false, reason: "loop" };
  const parents = parentsOf(nodes);
  if (levelOf(parents, parent) + heightOf(nodes, id) > max) return { ok: false, reason: "too_deep" };
  return { ok: true };
}

// The nodes with any parent that would loop, is missing or is too deep set
// to null (a task of its own), in their order: what a plan or a stored list
// is read as, whatever it said.
export function untangle<T extends TreeNode>(nodes: readonly T[], max = TASK_DEPTH_MAX): T[] {
  const kept: T[] = [];
  const ids = new Set(nodes.map(n => n.id));
  for (const n of nodes) {
    if (n.parent === null || !ids.has(n.parent) || n.parent === n.id) { kept.push({ ...n, parent: null }); continue; }
    kept.push({ ...n });
  }
  // Break loops: walk each node up; a node that meets itself loses its parent.
  for (const n of kept) {
    const parents = parentsOf(kept);
    let at = n.parent, hops = 0;
    while (at !== null && hops <= kept.length) {
      if (at === n.id) { n.parent = null; break; }
      at = parents.get(at) ?? null;
      hops++;
    }
  }
  // Too deep: a node below the cap moves up to the deepest level allowed.
  for (const n of kept) {
    const parents = parentsOf(kept);
    while (n.parent !== null && levelOf(parents, n.id) > max) n.parent = parents.get(n.parent) ?? null;
  }
  return kept;
}

// Parents before their steps, each step right after its parent's earlier
// steps, keeping the given order among siblings: the order to write a tree
// in, and to show it. depth 0 is a task of its own.
export function treeOrder<T extends TreeNode>(nodes: readonly T[]): Array<{ item: T; depth: number }> {
  const ids = new Set(nodes.map(n => n.id));
  const children = new Map<string | null, T[]>();
  for (const n of nodes) {
    const p = n.parent && ids.has(n.parent) && n.parent !== n.id ? n.parent : null;
    children.set(p, [...(children.get(p) ?? []), n]);
  }
  const out: Array<{ item: T; depth: number }> = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const n of children.get(parent) ?? []) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push({ item: n, depth });
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  // Anything left (only in a loop) is shown as a task of its own.
  for (const n of nodes) if (!seen.has(n.id)) { seen.add(n.id); out.push({ item: n, depth: 0 }); walk(n.id, 1); }
  return out;
}
