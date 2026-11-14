// ─── What Nova is told about a card on the Knowledge Map ────────────────────
// When the learner asks Nova from a card's panel on the map, the turn is
// given what that card holds, as facts read from their own map (the same
// read model the page draws): what it is, where it sits, the topics, tasks
// and saved pages inside it with their state, and how many notes are filed
// there. Note titles and text are never included (notes stay out of the chat
// pipeline). Nothing is inferred or added; the reply may state only these.
// `mapFactsOf` is pure; `loadMapFacts` reads the map for the learner.

import type { MapEdgeKind, MapNode, NovaKnowledgeMapReady } from "./knowledge-map.types";
import type { NovaExamItem } from "./exams.types";
import { loadNovaKnowledgeMap } from "./knowledge-map";
import { listExams } from "./exams";

// The learner's own day (YYYY-MM-DD in their zone), the moment, and their
// dates on record: for what is due, overdue, recent or coming up.
export interface MapFactsContext { today: string; now: Date; exams?: NovaExamItem[] }
const defaultContext = (): MapFactsContext => { const now = new Date(); return { now, today: now.toISOString().slice(0, 10) } };
const dayGap = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
const daysAgo = (iso: string | null | undefined, now: Date) => (iso ? Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 86_400_000)) : null);
const when = (d: number) => (d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`);
const inDays = (d: number) => (d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`);
type Topic = Extract<MapNode, { type: "topic" }>;
type Task = Extract<MapNode, { type: "task" }>;

// What stands out among these items, from their records only, most pressing
// first: so a reply can be specific and recommend one real next step.
function standsOut(items: readonly MapNode[], ctx: MapFactsContext, subjects: ReadonlySet<string> | null): string[] {
  const out: string[] = [];
  const topics = items.filter((n): n is Topic => n.type === "topic" && n.kind !== "milestone" && n.studied !== false);
  const tasks = items.filter((n): n is Task => n.type === "task" && n.status !== "done");
  const names = (list: string[], max = 6) => `${list.slice(0, max).join(", ")}${list.length > max ? ` and ${list.length - max} more` : ""}`;
  const dates = (ctx.exams ?? []).filter(e => e.daysUntil >= 0 && (subjects === null ? e.daysUntil <= 120 : e.subjectName !== null && subjects.has(e.subjectName))).slice(0, 4);
  if (dates.length) out.push(`Dates coming up: ${dates.map(e => `"${e.title}" (${e.type}${e.subjectName ? `, ${e.subjectName}` : ""}) on ${e.date}, ${inDays(e.daysUntil)}`).join("; ")}.`);
  const overdue = tasks.filter(t => t.dueDay && t.dueDay < ctx.today).map(t => `"${t.label}" (due ${t.dueDay}, ${dayGap(t.dueDay!, ctx.today)} days late)`);
  if (overdue.length) out.push(`Overdue tasks: ${names(overdue)}.`);
  const soon = tasks.filter(t => t.dueDay && t.dueDay >= ctx.today && dayGap(ctx.today, t.dueDay) <= 7).sort((a, b) => a.dueDay!.localeCompare(b.dueDay!)).map(t => `"${t.label}" (due ${inDays(dayGap(ctx.today, t.dueDay!))})`);
  if (soon.length) out.push(`Tasks due within a week: ${names(soon)}.`);
  const due = topics.filter(t => t.reviewDue && t.sessions > 0).map(t => { const a = daysAgo(t.lastStudiedAt, ctx.now); return `"${t.label}"${a !== null ? ` (last studied ${when(a)})` : ""}` });
  if (due.length) out.push(`Reviews due now: ${names(due)}.`);
  const weak = topics.filter(t => t.level === "weak" && t.masteryPercent !== null).sort((a, b) => a.masteryPercent! - b.masteryPercent!).map(t => `"${t.label}" (${t.masteryPercent}%)`);
  if (weak.length) out.push(`Weakest estimates: ${names(weak, 5)}.`);
  const fresh = topics.filter(t => t.sessions === 0).map(t => `"${t.label}"`);
  if (fresh.length) out.push(`Not started yet (${fresh.length}), in the map's order: ${names(fresh, 5)}.`);
  const stale = topics.filter(t => t.sessions > 0 && !t.reviewDue && (daysAgo(t.lastStudiedAt, ctx.now) ?? 0) >= 14).map(t => `"${t.label}" (${daysAgo(t.lastStudiedAt, ctx.now)} days)`);
  if (stale.length) out.push(`Not touched for two weeks or more: ${names(stale, 5)}.`);
  const recent = topics.filter(t => t.sessions > 0 && (daysAgo(t.lastStudiedAt, ctx.now) ?? 99) <= 7).map(t => `"${t.label}" (${when(daysAgo(t.lastStudiedAt, ctx.now)!)})`);
  if (recent.length) out.push(`Studied in the last week: ${names(recent, 5)}.`);
  const bare = topics.filter(t => t.sessions > 0 && t.notes === 0 && t.resources === 0).map(t => `"${t.label}"`);
  if (bare.length) out.push(`Studied but nothing written or saved there yet: ${names(bare, 5)}.`);
  const blocked = tasks.filter(t => t.waitsOn > 0).map(t => `"${t.label}" (waits on ${t.waitsOn})`);
  if (blocked.length) out.push(`Tasks waiting on other tasks first: ${names(blocked, 5)}.`);
  const going = tasks.filter(t => t.status === "in_progress").map(t => `"${t.label}"`);
  if (going.length) out.push(`Tasks in progress: ${names(going, 5)}.`);
  return out.length ? ["What stands out (from the record, most pressing first):", ...out.map(l => `  ${l}`)] : [];
}

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

export function mapFactsOf(view: NovaKnowledgeMapReady, nodeId: string, ctx: MapFactsContext = defaultContext()): string[] {
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
  // The card and everything under it, for what stands out and how it links out.
  const inside = new Set<string>([nodeId])
  const collect = (id: string) => { for (const c of children.get(id) ?? []) if (!inside.has(c)) { inside.add(c); collect(c) } }
  collect(nodeId)
  const rootOf = (id: string) => { let r = id; for (let p = parent.get(r), hops = 0; p && hops < 24; p = parent.get(p), hops++) r = p; return r }
  const rootLabel = byId.get(rootOf(nodeId))?.label
  const subjectNames = new Set<string>([...(rootLabel ? [rootLabel] : []), ...(node.type === "subject" ? [node.label] : []), ...("subjectName" in node && node.subjectName ? [node.subjectName] : [])])
  facts.push(...standsOut([...inside].map(id => byId.get(id)!).filter(Boolean), ctx, subjectNames))
  // [[Links]] the learner wrote between this card's items and other subjects'.
  const across = new Map<string, number>()
  for (const e of view.edges) {
    if (e.kind !== "links_to") continue
    const a = inside.has(e.from), b = inside.has(e.to)
    if (a === b) continue
    const other = byId.get(rootOf(a ? e.to : e.from))
    if (other && other.id !== rootOf(nodeId)) across.set(other.label, (across.get(other.label) ?? 0) + 1)
  }
  if (across.size) facts.push(`[[Links]] between it and other subjects: ${[...across].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([l, c]) => `"${l}" (${c})`).join(", ")}.`)
  return facts
}

// The whole map shown, for Nova on the map itself: each top-level subject with
// its topics and their state, what is due or weak, and what is filed under
// nothing. Names only from the map; note titles never.
export function mapOverviewFacts(view: NovaKnowledgeMapReady, scope: string, ctx: MapFactsContext = defaultContext()): string[] {
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
  facts.push(...standsOut(view.nodes, ctx, null));
  // Which subjects the learner's own [[links]] tie together most.
  const rootOf = (id: string) => { let r = id; for (let p = parent.get(r), hops = 0; p && hops < 24; p = parent.get(p), hops++) r = p; return r };
  const pairs = new Map<string, number>();
  for (const e of view.edges) {
    if (e.kind !== "links_to") continue;
    const a = byId.get(rootOf(e.from))?.label, b = byId.get(rootOf(e.to))?.label;
    if (!a || !b || a === b) continue;
    const key = [a, b].sort().map(l => `"${l}"`).join(" and ");
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
  }
  if (pairs.size) facts.push(`Subjects their [[links]] tie together most: ${[...pairs].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, c]) => `${k} (${c})`).join("; ")}.`);
  if (view.unconnected > 0) facts.push(`Items filed under nothing: ${view.unconnected}.`);
  return facts;
}

export async function loadMapFacts(platformChatId: string, nodeId: string, at: { today: string; now: Date }): Promise<string[]> {
  if (!MAP_NODE_ID.test(nodeId)) return []
  const whole = nodeId === "map" || nodeId.startsWith("map:")
  const workspace = whole && nodeId.startsWith("map:") ? nodeId.slice(4) : "all"
  const [view, exams] = await Promise.all([
    loadNovaKnowledgeMap(platformChatId, { workspace }),
    listExams(platformChatId, at.now).catch(() => null),
  ])
  if (view.status !== "ready") return []
  const ctx: MapFactsContext = { ...at, exams: exams ?? [] }
  return whole ? mapOverviewFacts(view, workspace === "all" ? "everything" : "one workspace", ctx) : mapFactsOf(view, nodeId, ctx)
}
