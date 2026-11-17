// ─── The learner's Kivo as one graph, for Nova in the browser ─────────────────
// Retrieval across every kind of thing Kivo keeps, through the graph the
// Knowledge Map already builds (knowledge-map.ts buildKnowledgeMap): subjects
// (inside subjects), topics (inside topics), tasks and their steps, notes,
// saved pages, and the edges between them (contains, has_topic, subtopic,
// has_task, step, depends_on, about_topic, filed_under, links_to). A match
// is a node whose own name holds the words; what it is connected to comes
// with it, said as the relationship, so "what do I have on HNSW" also finds
// the note filed under the HNSW topic and the task that waits on it.
//
// Pure: no database, no model, no regex. browser-agent.ts loads the graph.

import type { MapEdge, MapNode, NovaKnowledgeMapReady } from "./knowledge-map.types";

export const GRAPH_MATCHES   = 6;
export const GRAPH_NEIGHBOURS = 8;

const TYPE_WORD: Record<MapNode["type"], string> = { subject: "subject", topic: "topic", task: "task", note: "note", resource: "saved page" };

// How an edge reads from one end. `out`: from → to; `in`: to ← from.
const EDGE_WORDS: Record<MapEdge["kind"], { out: string; in: string }> = {
  contains:    { out: "contains subject", in: "is inside subject" },
  has_topic:   { out: "has topic", in: "is a topic of" },
  subtopic:    { out: "has subtopic", in: "is a subtopic of" },
  has_task:    { out: "has task", in: "is a task under" },
  step:        { out: "has step", in: "is a step of" },
  depends_on:  { out: "waits on", in: "is waited on by" },
  about_topic: { out: "has filed", in: "is filed under topic" },
  filed_under: { out: "has filed", in: "is filed under subject" },
  links_to:    { out: "links to", in: "is linked from" },
};

const words = (s: string) => s.toLowerCase().split(" ").map(w => w.split("").filter(c => c.toLowerCase() !== c.toUpperCase() || (c >= "0" && c <= "9")).join("")).filter(w => w.length > 1);

/** Nodes whose own words hold the query's, best first: all words, then most words, then the shortest name. */
export function matchNodes(nodes: MapNode[], query: string, max = GRAPH_MATCHES): MapNode[] {
  const q = words(query);
  if (!q.length) return [];
  const scored: Array<{ n: MapNode; score: number }> = [];
  for (const n of nodes) {
    const own = words(n.label);
    const hits = q.filter(w => own.some(o => o === w || o.startsWith(w) || (w.length > 4 && w.startsWith(o) && o.length > 3))).length;
    if (!hits) continue;
    const exact = n.label.toLowerCase() === query.trim().toLowerCase() ? 5 : 0;
    scored.push({ n, score: exact + hits * 2 + (hits === q.length ? 3 : 0) - own.length * 0.05 });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, max).map(s => s.n);
}

/** What one node is connected to, as relationships. */
export function neighbours(map: Pick<NovaKnowledgeMapReady, "nodes" | "edges">, id: string, max = GRAPH_NEIGHBOURS): Array<{ relation: string; node: MapNode }> {
  const byId = new Map(map.nodes.map(n => [n.id, n] as const));
  const out: Array<{ relation: string; node: MapNode }> = [];
  for (const e of map.edges) {
    if (e.from === id && byId.has(e.to)) out.push({ relation: EDGE_WORDS[e.kind].out, node: byId.get(e.to)! });
    else if (e.to === id && byId.has(e.from)) out.push({ relation: EDGE_WORDS[e.kind].in, node: byId.get(e.from)! });
  }
  // Structure first (where it sits), then what is filed and linked.
  const rank = (r: string) => (r.startsWith("is inside") || r.startsWith("is a topic") || r.startsWith("is a subtopic") || r.startsWith("is a task") || r.startsWith("is filed") ? 0 : 1);
  return out.sort((a, b) => rank(a.relation) - rank(b.relation)).slice(0, max);
}

const describe = (n: MapNode): string => {
  const bits: string[] = [];
  if (n.type === "topic") { if (n.sessions > 0 && n.masteryPercent !== null) bits.push(`Kivo's estimate ${n.masteryPercent}% from ${n.sessions} session${n.sessions === 1 ? "" : "s"}`); else bits.push("not studied yet"); if (n.reviewDue) bits.push("review due"); }
  if (n.type === "task") { bits.push(n.status.replace("_", " ")); if (n.dueDay) bits.push(`due ${n.dueDay}`); }
  if (n.type === "resource") bits.push(n.domain);
  return `${TYPE_WORD[n.type]} "${n.label}" (id ${n.id}${bits.length ? `; ${bits.join(", ")}` : ""})`;
};

/** The graph's answer to a query: each match, where it sits and what it is connected to. */
export function graphLines(map: Pick<NovaKnowledgeMapReady, "nodes" | "edges">, query: string, max = GRAPH_MATCHES): { text: string; found: number } {
  const hits = matchNodes(map.nodes, query, max);
  if (!hits.length) return { text: "Connected knowledge: nothing on the map has these words in its name.", found: 0 };
  const lines = ["Connected knowledge (from the Knowledge Map; read a note with read_note using its id after \"note:\", or follow a node with workspace_related):"];
  for (const n of hits) {
    lines.push(`- ${describe(n)}`);
    for (const { relation, node } of neighbours(map, n.id, 5)) lines.push(`    ${relation} ${describe(node)}`);
  }
  return { text: lines.join("\n"), found: hits.length };
}

/** One node and everything connected to it (workspace_related). */
export function relatedLines(map: Pick<NovaKnowledgeMapReady, "nodes" | "edges">, id: string): { text: string; found: number } | null {
  const node = map.nodes.find(n => n.id === id);
  if (!node) return null;
  const all = neighbours(map, id, 30);
  return { text: [`${describe(node)}:`, ...(all.length ? all.map(({ relation, node: m }) => `- ${relation} ${describe(m)}`) : ["- nothing is connected to it"])].join("\n"), found: all.length + 1 };
}

/** Drafts whose title or sources hold the query's words (captures not yet in a note). */
export function draftLines(drafts: Array<{ id: string; title: string; passages: number; sourceTitles: string[]; status: string }>, query: string, max = 4): string {
  const q = words(query);
  const hits = drafts.filter(d => d.status !== "merged" && d.status !== "discarded").filter(d => { const own = words(`${d.title} ${d.sourceTitles.join(" ")}`); return q.some(w => own.includes(w)); }).slice(0, max);
  return hits.length ? `Drafts (captured, not yet in a note):\n${hits.map(d => `- "${d.title}" (draft ${d.id}, ${d.passages} passage${d.passages === 1 ? "" : "s"}${d.sourceTitles.length ? ` from ${d.sourceTitles.slice(0, 2).join("; ")}` : ""})`).join("\n")}` : "Drafts: none match.";
}
