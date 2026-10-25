// ─── Knowledge Map ────────────────────────────────────────────────────────────
// A read model: the learner's subjects, topics, notes and saved pages as
// nodes, and the links between them that are already stored. It writes
// nothing, calls no LLM and creates no relationship. An edge exists here
// only because a row says so:
//
//   subject → subject    NovaSubject.parentId: a subject inside another
//   subject → topic      NovaTopicMastery.subjectId, for a topic at its top
//   topic   → topic      NovaTopicMastery.parentId: a topic inside another,
//                        in the order its position gives (never by name)
//   topic   → task       NovaTask.topicName naming a topic of its subject
//                        (the top task of a tree; else subject → task)
//   task    → task       NovaTask.parentId: a step of the task
//   task    → task       NovaTaskDependency: waits on (depends_on)
//   topic   → note       NovaNote.subjectId + topicName naming a topic of
//                        that subject (compared the way sessions compare
//                        topic names: trimmed, single-spaced, any case)
//   subject → note       NovaNote.subjectId, when it names no such topic
//   the same two rules for a saved page (NovaLearningEvent)
//
// An item with no subject has no edge and is drawn alone.
//
// Beside the edges there are suggestions: places a saved page was suggested
// for when it was looked at (product/resource-processing.ts) and is not filed
// under. They are stored on the page's own row and passed through as they
// are; this file works none out. They are not edges.

import { prisma } from "@repo/db/client";
import { learnerKey } from "./learner-key";
import { listResourceLinks } from "./learning-events";
import { listNoteLinks } from "./notes";
import { listTaskOutline } from "./tasks";
import { workspaceScopes } from "./workspaces";
import { readTopicDetails, studyTopicIds, topicKindOf, topicOutline } from "./topic-tree";
import { treeOrder } from "./task-tree";
import { masteryLevel } from "../engines/knowledge-engine";
import { normalizeTopicName } from "../engines/topic-mastery-engine";
import {
  MAP_NOTES_MAX, MAP_RESOURCES_MAX,
  type MapEdge, type MapNode, type MapNodeType, type MapSuggestion, type MapTask, type MapWorkspace, type NovaKnowledgeMapReady, type NovaKnowledgeMapView,
} from "./knowledge-map.types";

export interface MapInputs {
  subjects:  Array<{ id: string; name: string; parentId?: string | null }>;
  topics:    Array<{ id: string; subjectId: string; name: string; masteryProbability: number; reviewCount: number; parentId?: string | null; position?: number | null; kind?: string | null; details?: unknown; createdAt?: Date }>;
  // linksTo: titles the note names in [[...]] (notes.ts). Absent: none.
  notes:     Array<{ id: string; title: string; subjectId: string | null; topicName: string | null; updatedAt: Date; linksTo?: string[] }>;
  resources: Array<{
    id: string; title: string; url: string; domain: string; eventType: string; subjectId: string | null; topicName: string | null; occurredAt: Date;
    filedBy?: "learner" | "nova" | null;
    suggestions?: Array<{ subjectId: string; topicName: string | null; confidence: "high" | "possible"; basis: MapSuggestion["basis"] }>;
  }>;
  totals:    { notes: number; resources: number };
  // The learner's tasks (tasks.ts), each with the task it is a step of. A
  // tree goes to the topic its top task is filed under, else its subject.
  tasks?:    Array<MapTask & { subjectId: string | null; topicName: string | null; dueDay?: string | null; priority?: "low" | "medium" | "high" | null; estimatedMinutes?: number | null; after?: string[] }>;
  // What is drawn and what else there is to switch to.
  workspaceId?: string | null;
  workspaces?:  MapWorkspace[];
}

const topicKey = (subjectId: string, name: string) => `${subjectId}\n${normalizeTopicName(name).toLowerCase()}`;

export function buildKnowledgeMap(input: MapInputs): NovaKnowledgeMapReady {
  const subjectName = new Map(input.subjects.map(s => [s.id, s.name]));
  // Only topics of a subject the learner still has.
  const topics  = input.topics.filter(t => subjectName.has(t.subjectId));
  const topicAt = new Map(topics.map(t => [topicKey(t.subjectId, t.name), t.id]));

  const edges: MapEdge[] = [];
  const link = (from: string, to: string, kind: MapEdge["kind"]) => edges.push({ id: `${from}>${to}`, from, to, kind });
  const tally = new Map<string, { notes: number; resources: number }>();
  const count = (nodeId: string, what: "notes" | "resources") => {
    const t = tally.get(nodeId) ?? { notes: 0, resources: 0 };
    t[what]++;
    tally.set(nodeId, t);
  };

  // Where a note or a saved page hangs: its topic, else its subject, else nowhere.
  const place = (nodeId: string, subjectId: string | null, topicName: string | null, what: "notes" | "resources") => {
    const subject = subjectId !== null && subjectName.has(subjectId) ? subjectId : null;
    if (subject === null) return { subjectId: null, topicLinked: false };
    const topicId = topicName ? topicAt.get(topicKey(subject, topicName)) : undefined;
    count(`subject:${subject}`, what);
    if (topicId) { link(`topic:${topicId}`, nodeId, "about_topic"); count(`topic:${topicId}`, what); }
    else link(`subject:${subject}`, nodeId, "filed_under");
    return { subjectId: subject, topicLinked: topicId !== undefined };
  };

  const noteNodes: MapNode[] = input.notes.map(n => {
    const id = `note:${n.id}`;
    const at = place(id, n.subjectId, n.topicName, "notes");
    return {
      id, type: "note", label: n.title, href: `/notes/${n.id}`, subjectId: at.subjectId,
      subjectName: at.subjectId ? subjectName.get(at.subjectId)! : null,
      topicName: n.topicName, topicLinked: at.topicLinked, updatedAt: n.updatedAt.toISOString(),
    };
  });
  const suggestions: MapSuggestion[] = [];
  const resourceNodes: MapNode[] = input.resources.map(r => {
    const id = `resource:${r.id}`;
    const at = place(id, r.subjectId, r.topicName, "resources");
    // A suggestion points at a topic or subject the learner still has.
    for (const s of r.suggestions ?? []) {
      if (!subjectName.has(s.subjectId)) continue;
      const topicId = s.topicName ? topicAt.get(topicKey(s.subjectId, s.topicName)) : undefined;
      if (s.topicName && !topicId) continue;
      const from = topicId ? `topic:${topicId}` : `subject:${s.subjectId}`;
      if (!suggestions.some(x => x.from === from && x.to === id)) suggestions.push({ id: `${from}~${id}`, from, to: id, confidence: s.confidence, basis: s.basis });
    }
    return {
      id, type: "resource", label: r.title || r.domain, href: `/saved?page=${encodeURIComponent(r.id)}`, subjectId: at.subjectId,
      subjectName: at.subjectId ? subjectName.get(at.subjectId)! : null,
      topicName: r.topicName, topicLinked: at.topicLinked,
      url: r.url, domain: r.domain, savedAt: r.occurredAt.toISOString(),
      kind: r.eventType === "study_requested" ? "study_requested" : "saved",
      filedBy: r.filedBy ?? (at.subjectId ? "learner" : null),
    };
  });

  // Each task tree, by where its top task is filed.
  const treeAt = new Map<string, MapTask[]>();
  const allTasks = input.tasks ?? [];
  const rootOf = (t: (typeof allTasks)[number]) => {
    let at = t;
    for (let i = 0; at.parentId && i < 12; i++) at = allTasks.find(x => x.id === at.parentId) ?? at;
    return at;
  };
  for (const t of allTasks) {
    const root = rootOf(t);
    const subject = root.subjectId && subjectName.has(root.subjectId) ? root.subjectId : null;
    if (!subject) continue;
    const topicId = root.topicName ? topicAt.get(topicKey(subject, root.topicName)) : undefined;
    const at = topicId ? `topic:${topicId}` : `subject:${subject}`;
    treeAt.set(at, [...(treeAt.get(at) ?? []), { id: t.id, title: t.title, status: t.status, parentId: t.parentId }]);
  }

  // Topics as arranged: each subject's outline, a parent before what is
  // inside it, siblings in their saved order.
  const topicNodes: MapNode[] = [];
  for (const s of input.subjects) {
    const own = topics.filter(t => t.subjectId === s.id);
    const studied = studyTopicIds(own);
    const order = new Map<string, number>();
    for (const { item: t } of topicOutline(own)) {
      const id = `topic:${t.id}`;
      const parent = t.parentId && own.some(x => x.id === t.parentId) ? t.parentId : null;
      const k = parent ?? "";
      const at = order.get(k) ?? 0;
      order.set(k, at + 1);
      link(parent ? `topic:${parent}` : `subject:${s.id}`, id, parent ? "subtopic" : "has_topic");
      // "unverified" (no session behind it) is no level at all here.
      const known   = masteryLevel(t);
      const kind = topicKindOf(t.kind);
      const details = readTopicDetails(t.details);
      topicNodes.push({
        id, type: "topic", label: t.name, href: `/knowledge?topic=${encodeURIComponent(t.id)}`, subjectId: t.subjectId, subjectName: s.name,
        sessions: t.reviewCount,
        level: known === "unverified" ? null : known,
        masteryPercent: known !== "unverified" ? Math.round(t.masteryProbability * 100) : null,
        notes: tally.get(id)?.notes ?? 0, resources: tally.get(id)?.resources ?? 0,
        order: at, studied: studied.has(t.id),
        ...(parent ? { parentId: parent } : {}), ...(kind ? { kind } : {}),
        ...(details ? { details: { explanation: details.explanation, weeks: details.weeks, hoursPerWeek: details.hoursPerWeek, goals: details.goals, exercises: details.exercises, project: details.project, completion: details.completion } } : {}),
        ...(treeAt.has(id) ? { tasks: treeAt.get(id)! } : {}),
      });
    }
  }
  const subjectNodes: MapNode[] = input.subjects.map(s => {
    const id = `subject:${s.id}`;
    const parentId = s.parentId && subjectName.has(s.parentId) && s.parentId !== s.id ? s.parentId : null;
    if (parentId) link(`subject:${parentId}`, id, "contains");
    return {
      ...(parentId ? { parentId } : {}),
      id, type: "subject", label: s.name, href: `/knowledge?subject=${encodeURIComponent(s.id)}`, subjectId: s.id,
      topics: topics.filter(t => t.subjectId === s.id).length,
      notes: tally.get(id)?.notes ?? 0, resources: tally.get(id)?.resources ?? 0,
      ...(treeAt.has(id) ? { tasks: treeAt.get(id)! } : {}),
    };
  });

  // Every task is a card: a step under its task, a top task under its topic
  // (else its subject, else on its own), in their order; waits between them.
  const taskIds = new Set(allTasks.map(t => t.id));
  const stepOrder = new Map<string, number>();
  const taskNodes: MapNode[] = treeOrder(allTasks.map(t => ({ ...t, parent: t.parentId && taskIds.has(t.parentId) ? t.parentId : null }))).map(({ item: t }) => {
    const id = `task:${t.id}`;
    const parent = t.parent;
    const root = rootOf(t);
    const subject = root.subjectId && subjectName.has(root.subjectId) ? root.subjectId : null;
    if (parent) link(`task:${parent}`, id, "step");
    else if (subject) {
      const topicId = root.topicName ? topicAt.get(topicKey(subject, root.topicName)) : undefined;
      link(topicId ? `topic:${topicId}` : `subject:${subject}`, id, "has_task");
    }
    const k = parent ?? `${subject ?? ""}\n${root.topicName ?? ""}`;
    const order = stepOrder.get(k) ?? 0;
    stepOrder.set(k, order + 1);
    return {
      id, type: "task", label: t.title, href: `/planner?view=board&task=${encodeURIComponent(t.id)}`, subjectId: subject,
      subjectName: subject ? subjectName.get(subject)! : null, topicName: root.topicName,
      status: t.status, priority: t.priority ?? null, dueDay: t.dueDay ?? null, estimatedMinutes: t.estimatedMinutes ?? null,
      ...(parent ? { parentId: parent } : {}), order, waitsOn: (t.after ?? []).filter(a => taskIds.has(a)).length,
    };
  });
  for (const t of allTasks) for (const a of t.after ?? []) if (taskIds.has(a)) link(`task:${t.id}`, `task:${a}`, "depends_on");

  // [[Links]] the learner wrote: to the note with that title (the most
  // recently edited, when two share one), else to a topic of theirs with that
  // name. A link to nothing on record, or to the note itself, draws nothing.
  const key = (s: string) => s.trim().split(" ").filter(Boolean).join(" ").toLowerCase();
  const noteByTitle = new Map<string, string>();
  for (const n of [...input.notes].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())) {
    if (!noteByTitle.has(key(n.title))) noteByTitle.set(key(n.title), `note:${n.id}`);
  }
  const topicByName = new Map<string, string>();
  for (const t of topics) if (!topicByName.has(key(t.name))) topicByName.set(key(t.name), `topic:${t.id}`);
  for (const n of input.notes) {
    const from = `note:${n.id}`;
    for (const title of n.linksTo ?? []) {
      const to = noteByTitle.get(key(title)) ?? topicByName.get(key(title));
      if (!to || to === from || edges.some(e => e.from === from && e.to === to)) continue;
      link(from, to, "links_to");
    }
  }

  const nodes = [...subjectNodes, ...topicNodes, ...taskNodes, ...noteNodes, ...resourceNodes];
  const linked = new Set(edges.flatMap(e => [e.from, e.to]));
  const counts: Record<MapNodeType, number> = {
    subject: subjectNodes.length, topic: topicNodes.length, task: taskNodes.length, note: noteNodes.length, resource: resourceNodes.length,
  };
  return {
    status: "ready", nodes, edges, suggestions, counts,
    workspaceId: input.workspaceId ?? null, workspaces: input.workspaces ?? [],
    notShown: { notes: Math.max(0, input.totals.notes - noteNodes.length), resources: Math.max(0, input.totals.resources - resourceNodes.length) },
    unconnected: nodes.filter(n => !linked.has(n.id)).length,
  };
}

// A fixed number of queries whatever the learner has.
// workspace: one of theirs by id, "all" for everything, or absent for the
// one they worked on last (everything when they have none). A workspace is
// its subjects with everything inside them, and the tasks it made.
export async function loadNovaKnowledgeMap(platformChatId: string, options: { workspace?: string | null } = {}): Promise<NovaKnowledgeMapView> {
  const user = await prisma.messengerUser.findUnique({
    where:  learnerKey(platformChatId),
    select: { novaAcademicProfile: { select: { id: true, onboardingComplete: true } } },
  });
  if (!user) return { status: "not_connected" };
  const profile = user.novaAcademicProfile;
  if (!profile?.onboardingComplete) return { status: "onboarding_incomplete" };
  const profileId = profile.id;

  const workspaces = await workspaceScopes(profileId);
  const chosen = options.workspace === "all" ? null
    : options.workspace ? workspaces.find(w => w.id === options.workspace) ?? null
    : workspaces[0] ?? null;

  // Notes and saved pages are read through their owners: this file touches
  // neither table.
  const [allSubjects, allTopics, noted, saved, allTasks] = await Promise.all([
    prisma.novaSubject.findMany({ where: { profileId }, select: { id: true, name: true, parentId: true }, orderBy: { createdAt: "asc" } }),
    prisma.novaTopicMastery.findMany({
      where: { subject: { profileId }, archivedAt: null }, orderBy: { createdAt: "asc" },
      select: { id: true, subjectId: true, name: true, masteryProbability: true, reviewCount: true, parentId: true, position: true, kind: true, details: true, createdAt: true },
    }),
    listNoteLinks(profileId, MAP_NOTES_MAX),
    listResourceLinks(profileId, MAP_RESOURCES_MAX),
    listTaskOutline(profileId),
  ]);
  // A workspace's subjects and every subject inside them.
  const inScope = new Set(chosen ? chosen.subjectIds : allSubjects.map(s => s.id));
  for (let grew = true; chosen && grew;) {
    grew = false;
    for (const s of allSubjects) if (s.parentId && inScope.has(s.parentId) && !inScope.has(s.id)) { inScope.add(s.id); grew = true; }
  }
  const subjects = allSubjects.filter(s => inScope.has(s.id));
  // Its tasks: those filed under its subjects, those it made (filed under
  // nothing, too), and every step under them.
  const made = (t: { clientKey: string | null }) => chosen !== null && (t.clientKey?.startsWith(`ws:${chosen.clientKey}:`) ?? false);
  const top = new Set(allTasks.filter(t => !chosen || made(t) || (t.subjectId !== null && inScope.has(t.subjectId))).map(t => t.id));
  for (let grew = true; chosen && grew;) {
    grew = false;
    for (const t of allTasks) if (t.parentId && top.has(t.parentId) && !top.has(t.id)) { top.add(t.id); grew = true; }
  }
  const scoped = <T extends { subjectId: string | null }>(list: T[]) => (chosen ? list.filter(x => x.subjectId !== null && inScope.has(x.subjectId)) : list);
  return buildKnowledgeMap({
    subjects, topics: allTopics.filter(t => inScope.has(t.subjectId)),
    notes: scoped(noted.notes), resources: scoped(saved.resources), tasks: allTasks.filter(t => top.has(t.id)),
    totals: { notes: chosen ? scoped(noted.notes).length : noted.total, resources: chosen ? scoped(saved.resources).length : saved.total },
    workspaceId: chosen?.id ?? null, workspaces: workspaces.map(w => ({ id: w.id, title: w.title })),
  });
}
