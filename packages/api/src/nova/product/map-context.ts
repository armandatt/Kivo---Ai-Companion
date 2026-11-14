// ─── What Nova is told about a card on the Knowledge Map ────────────────────
// When the learner asks Nova from a card's panel on the map, the turn is
// given what that card holds, as facts read from their own map (the same
// read model the page draws): what it is, where it sits, the topics, tasks
// and saved pages inside it with their state, and how many notes are filed
// there. Note titles and text are never included (notes stay out of the chat
// pipeline). Nothing is inferred or added; the reply may state only these.
// `mapFactsOf` is pure; `loadMapFacts` reads the map for the learner.

import type { MapEdgeKind, MapNode, NovaKnowledgeMapReady } from "./knowledge-map.types";
import { loadNovaKnowledgeMap } from "./knowledge-map";

// A card id on the map: "<type>:<row id>"; or the whole map shown: "map"
// (everything) or "map:<workspace id>". Anything else names nothing.
export const MAP_NODE_ID = /^(?:(subject|topic|task|note|resource):[A-Za-z0-9_-]{1,64}|map(?::[A-Za-z0-9_-]{1,64})?)$/;

const TREE: ReadonlySet<MapEdgeKind> = new Set<MapEdgeKind>(["contains", "has_topic", "subtopic", "has_task", "step", "about_topic", "filed_under"]);
const LIST_MAX = 40;
const KIND: Record<MapNode["type"], string> = { subject: "subject", topic: "topic", task: "task", note: "note", resource: "saved page" };

const stateOf = (n: Extract<MapNode, { type: "topic" }>): string => {
  if (n.kind === "milestone") return "milestone";
  if (n.studied === false) return "studied through its topics";
  if (n.sessions === 0 || !n.level || n.masteryPercent === null) return "not studied yet";
  return `${n.level}, ${n.masteryPercent}%, ${n.sessions} session${n.sessions === 1 ? "" : "s"}${n.reviewDue ? ", review due now" : ""}`;
};
const taskState = (s: "todo" | "in_progress" | "done") => (s === "todo" ? "to do" : s === "in_progress" ? "in progress" : "done");

export function mapFactsOf(view: NovaKnowledgeMapReady, nodeId: string): string[] {
  const byId = new Map(view.nodes.map(n => [n.id, n]));
  const node = byId.get(nodeId);
  if (!node) return [];
  const children = new Map<string, string[]>();
  const parent = new Map<string, string>();
  for (const e of view.edges) {
    if (!TREE.has(e.kind) || parent.has(e.to)) continue;
    parent.set(e.to, e.from);
    const list = children.get(e.from); if (list) list.push(e.to); else children.set(e.from, [e.to]);
  }
  const path: string[] = []
  for (let p = parent.get(nodeId), hops = 0; p && hops < 12; p = parent.get(p), hops++) { const n = byId.get(p); if (n) path.unshift(n.label) }
  const facts: string[] = [
    `The learner is asking from their Knowledge Map about the ${KIND[node.type]} "${node.label}"${path.length ? `, inside ${path.map(l => `"${l}"`).join(" › ")}` : ""}.`,
  ];
  if (node.type === "topic") facts.push(`Its state: ${stateOf(node)}.`);
  if (node.type === "task") facts.push(`It is ${taskState(node.status)}${node.dueDay ? `, due ${node.dueDay}` : ""}.`);
  if (node.type === "resource") facts.push(`It is a saved page from ${node.domain}.`);
  if (node.type === "subject") facts.push(`On record: ${node.topics} topic${node.topics === 1 ? "" : "s"}, ${node.notes} note${node.notes === 1 ? "" : "s"}, ${node.resources} saved page${node.resources === 1 ? "" : "s"}.`);

  // Everything under it, in the map's own order, by kind.
  const topics: string[] = [], tasks: string[] = [], pages: string[] = [], subjects: string[] = []
  let notes = 0
  const walk = (id: string, trail: string[], depth: number) => {
    for (const c of children.get(id) ?? []) {
      const n = byId.get(c); if (!n || depth > 6) continue
      const name = [...trail, n.label].join(" › ")
      if (n.type === "topic") topics.push(`"${name}" (${stateOf(n)})`)
      else if (n.type === "task") tasks.push(`"${name}" (${taskState(n.status)})`)
      else if (n.type === "resource") pages.push(`"${n.label}" (${n.domain})`)
      else if (n.type === "subject") subjects.push(`"${n.label}"`)
      else notes++
      walk(c, n.type === "note" || n.type === "resource" ? trail : [...trail, n.label], depth + 1)
    }
  }
  walk(nodeId, [], 0)
  const list = (label: string, items: string[]) => {
    if (items.length === 0) return
    const shown = items.slice(0, LIST_MAX)
    facts.push(`${label} (${items.length}): ${shown.join("; ")}${items.length > shown.length ? `; and ${items.length - shown.length} more` : ""}.`)
  }
  list("Subjects inside it", subjects)
  list("Topics inside it", topics)
  list("Tasks filed there", tasks)
  list("Saved pages filed there", pages)
  if (notes > 0) facts.push(`Notes filed there: ${notes} (their titles and text are not given to Nova).`)
  if (!children.get(nodeId)?.length) facts.push("Nothing is filed inside it yet.")
  return facts
}

// The whole map shown, for Nova on the map itself: each top-level subject with
// its topics and their state, what is due or weak, and what is filed under
// nothing. Names only from the map; note titles never.
export function mapOverviewFacts(view: NovaKnowledgeMapReady, scope: string): string[] {
  const byId = new Map(view.nodes.map(n => [n.id, n]));
  const parent = new Map<string, string>(), children = new Map<string, string[]>();
  for (const e of view.edges) {
    if (!TREE.has(e.kind) || parent.has(e.to)) continue;
    parent.set(e.to, e.from);
    const list = children.get(e.from); if (list) list.push(e.to); else children.set(e.from, [e.to]);
  }
  const topics = view.nodes.filter((n): n is Extract<MapNode, { type: "topic" }> => n.type === "topic");
  const studied = topics.filter(t => t.sessions > 0 && t.kind !== "milestone").length;
  const facts: string[] = [
    `The learner is asking about their Knowledge Map as a whole (${scope}): ${view.counts.subject} subjects, ${view.counts.topic} topics (${studied} studied), ${view.counts.task} tasks, ${view.counts.note} notes, ${view.counts.resource} saved pages.`,
  ];
  const roots = view.nodes.filter(n => n.type === "subject" && !parent.has(n.id));
  for (const r of roots.slice(0, 24)) {
    const inside: string[] = [];
    const walk = (id: string, trail: string[], depth: number) => {
      for (const c of children.get(id) ?? []) {
        const n = byId.get(c); if (!n || depth > 3) continue;
        if (n.type === "topic") inside.push(`"${[...trail, n.label].join(" › ")}" (${stateOf(n)})`);
        if (n.type === "subject") inside.push(`subject "${n.label}"`);
        if (n.type === "topic" || n.type === "subject") walk(c, [...trail, n.label], depth + 1);
      }
    };
    walk(r.id, [], 0);
    const shown = inside.slice(0, 16);
    facts.push(`Subject "${r.label}": ${shown.length ? shown.join("; ") : "nothing inside yet"}${inside.length > shown.length ? `; and ${inside.length - shown.length} more` : ""}.`);
  }
  if (roots.length > 24) facts.push(`And ${roots.length - 24} more subjects.`);
  const due = topics.filter(t => t.reviewDue && t.sessions > 0).map(t => `"${t.label}"`);
  if (due.length) facts.push(`Reviews due now: ${due.slice(0, 12).join(", ")}${due.length > 12 ? ` and ${due.length - 12} more` : ""}.`);
  const weak = topics.filter(t => t.level === "weak").map(t => `"${t.label}"`);
  if (weak.length) facts.push(`Topics whose estimate is weak: ${weak.slice(0, 12).join(", ")}.`);
  const unstudied = topics.filter(t => t.sessions === 0 && t.kind !== "milestone" && t.studied !== false).length;
  facts.push(`Topics not studied yet: ${unstudied}.`);
  if (view.unconnected > 0) facts.push(`Items filed under nothing: ${view.unconnected}.`);
  return facts;
}

export async function loadMapFacts(platformChatId: string, nodeId: string): Promise<string[]> {
  if (!MAP_NODE_ID.test(nodeId)) return []
  const whole = nodeId === "map" || nodeId.startsWith("map:")
  const workspace = whole && nodeId.startsWith("map:") ? nodeId.slice(4) : "all"
  const view = await loadNovaKnowledgeMap(platformChatId, { workspace })
  if (view.status !== "ready") return []
  return whole ? mapOverviewFacts(view, workspace === "all" ? "everything" : "one workspace") : mapFactsOf(view, nodeId)
}
