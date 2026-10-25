// ─── Tasks inside tasks: the rules of the tree ────────────────────────────────
// A task may have steps, and every step may have steps of its own. One set
// of rules for every place a tree of tasks is made, checked or changed: a
// plan Nova writes (workspace-plan.ts), a change to tasks that exist
// (builder-changes.ts), the stored tasks (tasks.ts) and the page that edits
// them (the web app imports this file). Pure and import-free.
//
//   - A parent names another item of the same tree, never itself.
//   - No loops: an item is never inside its own steps.
//   - Depth is limited (TASK_DEPTH_MAX levels, counting the top as 1), so a
//     runaway reply cannot make a tree nobody can read. An item deeper than
//     that is attached to its ancestor at the last level, never dropped.
//   - An item whose parent is missing becomes a top-level item, never lost.
//   - Order is kept: siblings stay in the order they were given.
//
// Each repair is reported in words, so what code changed is said.

export const TASK_DEPTH_MAX = 8;

export interface TreeItem { key: string; parent: string | null }

export interface TreeCheck<T extends TreeItem> {
  items: T[];
  // What was repaired, in words ("“Write tests” was inside itself").
  fixes: string[];
}

// The keys of an item's ancestors, nearest first. Stops at a loop.
export function ancestorsOf<T extends TreeItem>(items: readonly T[], key: string): string[] {
  const byKey = new Map(items.map(i => [i.key, i]));
  const out: string[] = [];
  let at = byKey.get(key)?.parent ?? null;
  while (at !== null && !out.includes(at) && at !== key) {
    out.push(at);
    at = byKey.get(at)?.parent ?? null;
  }
  return out;
}

// 1 for a top-level item.
export const depthOf = <T extends TreeItem>(items: readonly T[], key: string): number => ancestorsOf(items, key).length + 1;

// Every item inside this one, at any depth, in tree order.
export function descendantsOf<T extends TreeItem>(items: readonly T[], key: string): string[] {
  const out: string[] = [];
  const walk = (k: string) => {
    for (const i of items) if (i.parent === k && !out.includes(i.key) && i.key !== key) { out.push(i.key); walk(i.key); }
  };
  walk(key);
  return out;
}

// Whether giving `key` the parent `parent` would put it inside itself.
export function wouldLoop<T extends TreeItem>(items: readonly T[], key: string, parent: string | null): boolean {
  if (parent === null) return false;
  if (parent === key) return true;
  return ancestorsOf(items, parent).includes(key);
}

// The tree checked: bad parents cleared, loops broken, depth limited. `name`
// gives an item's words for the repair lines.
export function checkTree<T extends TreeItem>(list: readonly T[], name: (item: T) => string, maxDepth = TASK_DEPTH_MAX): TreeCheck<T> {
  const fixes: string[] = [];
  const keys = new Set(list.map(i => i.key));
  const items = list.map(i => ({ ...i }));
  const byKey = new Map(items.map(i => [i.key, i]));
  for (const i of items) {
    if (i.parent === null) continue;
    if (i.parent === i.key) { fixes.push(`"${name(i)}" was listed inside itself, so it is a task of its own`); i.parent = null; continue; }
    if (!keys.has(i.parent)) { fixes.push(`"${name(i)}" named a parent that isn't in the plan, so it is a task of its own`); i.parent = null; }
  }
  // Loops: walk up from each item; meeting itself means a loop, broken where found.
  for (const i of items) {
    const seen = new Set<string>([i.key]);
    let at = i.parent;
    while (at !== null) {
      if (seen.has(at)) {
        fixes.push(`"${name(i)}" was inside its own steps, so it is a task of its own`);
        i.parent = null;
        break;
      }
      seen.add(at);
      at = byKey.get(at)?.parent ?? null;
    }
  }
  // Depth: an item deeper than allowed hangs from its ancestor at the last level.
  for (const i of items) {
    const up = ancestorsOf(items, i.key);
    if (up.length + 1 <= maxDepth) continue;
    const keep = up[up.length - (maxDepth - 1)]!;
    fixes.push(`"${name(i)}" was more than ${maxDepth} levels deep, so it sits under "${name(byKey.get(keep)!)}"`);
    i.parent = keep;
  }
  return { items, fixes };
}

// The tree in reading order: each item followed by its steps, with its depth
// (0 for the top). Items whose parent is not in the list are top-level.
export function treeOrder<T extends TreeItem>(items: readonly T[]): Array<{ item: T; depth: number }> {
  const keys = new Set(items.map(i => i.key));
  const out: Array<{ item: T; depth: number }> = [];
  const placed = new Set<string>();
  const walk = (item: T, depth: number) => {
    if (placed.has(item.key)) return;
    placed.add(item.key);
    out.push({ item, depth });
    for (const c of items) if (c.parent === item.key) walk(c, depth + 1);
  };
  for (const i of items) if (i.parent === null || !keys.has(i.parent)) walk(i, 0);
  // Anything left is in a loop the caller did not check: shown at the top.
  for (const i of items) if (!placed.has(i.key)) walk(i, 0);
  return out;
}

// Parents before their steps, siblings in their given order: the order to
// create them in, so a step's parent always exists first.
export const parentsFirst = <T extends TreeItem>(items: readonly T[]): T[] => treeOrder(items).map(x => x.item);

// The top-level item an item belongs to (itself when it is one).
export function rootOf<T extends TreeItem>(items: readonly T[], key: string): string {
  const up = ancestorsOf(items, key);
  return up.length ? up[up.length - 1]! : key;
}
