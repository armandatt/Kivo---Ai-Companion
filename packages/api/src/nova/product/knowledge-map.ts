// ─── Knowledge Map ────────────────────────────────────────────────────────────
// A read model: the learner's subjects, topics, notes and saved pages as
// nodes, and the links between them that are already stored. It writes
// nothing, calls no LLM and creates no relationship. An edge exists here
// only because a row says so:
//
//   subject → topic      NovaTopicMastery.subjectId
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
import { listTaskLinks } from "./tasks";
import { descendantsOf } from "./task-tree";
import { masteryLevel } from "../engines/knowledge-engine";
import { normalizeTopicName } from "../engines/topic-mastery-engine";
import {
  MAP_NOTES_MAX, MAP_RESOURCES_MAX, MAP_TASKS_MAX,
  type MapEdge, type MapNode, type MapNodeType, type MapSuggestion, type NovaKnowledgeMapReady, type NovaKnowledgeMapView,
} from "./knowledge-map.types";

export interface MapInputs {
  subjects:  Array<{ id: string; name: string }>;
  topics:    Array<{ id: string; subjectId: string; name: string; masteryProbability: number; reviewCount: number }>;
  // linksTo: titles the note names in [[...]] (notes.ts). Absent: none.
  notes:     Array<{ id: string; title: string; subjectId: string | null; topicName: string | null; updatedAt: Date; linksTo?: string[] }>;
  resources: Array<{
    id: string; title: string; url: string; domain: string; eventType: string; subjectId: string | null; topicName: string | null; occurredAt: Date;
    filedBy?: "learner" | "nova" | null;
    suggestions?: Array<{ subjectId: string; topicName: string | null; confidence: "high" | "possible"; basis: MapSuggestion["basis"] }>;
  }>;
  // Tasks filed under a subject (tasks.ts listTaskLinks). Absent: none drawn.
  tasks?:    Array<{ id: string; title: string; status: "todo" | "in_progress" | "done"; subjectId: string | null; topicName: string | null; parentId: string | null }>;
  totals:    { notes: number; resources: number; tasks?: number };
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

  // Tasks: a step hangs from its task; a task of its own from the topic it
  // names in its subject (its milestone), else from the subject.
  const taskRows = (input.tasks ?? []).filter(t => t.subjectId !== null && subjectName.has(t.subjectId));
  const shown = new Set(taskRows.map(t => t.id));
  const tree = taskRows.map(t => ({ key: t.id, parent: t.parentId && shown.has(t.parentId) ? t.parentId : null }));
  const taskNodes: MapNode[] = taskRows.map(t => {
    const id = `task:${t.id}`;
    const parent = t.parentId && shown.has(t.parentId) ? `task:${t.parentId}` : null;
    if (parent) link(parent, id, "has_step");
    else {
      const topicId = t.topicName ? topicAt.get(topicKey(t.subjectId!, t.topicName)) : undefined;
      link(topicId ? `topic:${topicId}` : `subject:${t.subjectId}`, id, "task_of");
    }
    return {
      id, type: "task", label: t.title, href: "/planner?view=board", subjectId: t.subjectId,
      subjectName: subjectName.get(t.subjectId!) ?? null, topicName: t.topicName, status: t.status, parent,
      steps: descendantsOf(tree, t.id).length,
    };
  });

  const topicNodes: MapNode[] = topics.map(t => {
    const id = `topic:${t.id}`;
    link(`subject:${t.subjectId}`, id, "has_topic");
    // "unverified" (no session behind it) is no level at all here.
    const known   = masteryLevel(t);
    const studied = known !== "unverified";
    return {
      id, type: "topic", label: t.name, href: `/knowledge?topic=${encodeURIComponent(t.id)}`, subjectId: t.subjectId, subjectName: subjectName.get(t.subjectId)!,
      sessions: t.reviewCount,
      level: known === "unverified" ? null : known,
      masteryPercent: studied ? Math.round(t.masteryProbability * 100) : null,
      notes: tally.get(id)?.notes ?? 0, resources: tally.get(id)?.resources ?? 0,
    };
  });
  const subjectNodes: MapNode[] = input.subjects.map(s => {
    const id = `subject:${s.id}`;
    return {
      id, type: "subject", label: s.name, href: `/knowledge?subject=${encodeURIComponent(s.id)}`, subjectId: s.id,
      topics: topics.filter(t => t.subjectId === s.id).length,
      notes: tally.get(id)?.notes ?? 0, resources: tally.get(id)?.resources ?? 0,
    };
  });

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

  const nodes = [...subjectNodes, ...topicNodes, ...noteNodes, ...resourceNodes, ...taskNodes];
  const linked = new Set(edges.flatMap(e => [e.from, e.to]));
  const counts: Record<MapNodeType, number> = {
    subject: subjectNodes.length, topic: topicNodes.length, note: noteNodes.length, resource: resourceNodes.length, task: taskNodes.length,
  };
  return {
    status: "ready", nodes, edges, suggestions, counts,
    notShown: { notes: Math.max(0, input.totals.notes - noteNodes.length), resources: Math.max(0, input.totals.resources - resourceNodes.length), tasks: Math.max(0, (input.totals.tasks ?? 0) - taskNodes.length) },
    unconnected: nodes.filter(n => !linked.has(n.id)).length,
  };
}

// A fixed number of queries whatever the learner has.
export async function loadNovaKnowledgeMap(platformChatId: string): Promise<NovaKnowledgeMapView> {
  const user = await prisma.messengerUser.findUnique({
    where:  learnerKey(platformChatId),
    select: { novaAcademicProfile: { select: { id: true, onboardingComplete: true } } },
  });
  if (!user) return { status: "not_connected" };
  const profile = user.novaAcademicProfile;
  if (!profile?.onboardingComplete) return { status: "onboarding_incomplete" };
  const profileId = profile.id;

  // Notes and saved pages are read through their owners: this file touches
  // neither table.
  const [subjects, topics, noted, saved, tasked] = await Promise.all([
    prisma.novaSubject.findMany({ where: { profileId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.novaTopicMastery.findMany({
      where: { subject: { profileId }, archivedAt: null }, orderBy: { name: "asc" },
      select: { id: true, subjectId: true, name: true, masteryProbability: true, reviewCount: true },
    }),
    listNoteLinks(profileId, MAP_NOTES_MAX),
    listResourceLinks(profileId, MAP_RESOURCES_MAX),
    listTaskLinks(profileId, MAP_TASKS_MAX),
  ]);
  return buildKnowledgeMap({
    subjects, topics, notes: noted.notes, resources: saved.resources, tasks: tasked.tasks,
    totals: { notes: noted.total, resources: saved.total, tasks: tasked.total },
  });
}
