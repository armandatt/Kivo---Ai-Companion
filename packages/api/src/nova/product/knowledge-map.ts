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

import { prisma } from "@repo/db/client";
import { learnerKey } from "./learner-key";
import { masteryLevel } from "../engines/knowledge-engine";
import { normalizeTopicName } from "../engines/topic-mastery-engine";
import {
  MAP_NOTES_MAX, MAP_RESOURCES_MAX,
  type MapEdge, type MapNode, type MapNodeType, type NovaKnowledgeMapReady, type NovaKnowledgeMapView,
} from "./knowledge-map.types";

export interface MapInputs {
  subjects:  Array<{ id: string; name: string }>;
  topics:    Array<{ id: string; subjectId: string; name: string; masteryProbability: number; reviewCount: number }>;
  notes:     Array<{ id: string; title: string; subjectId: string | null; topicName: string | null; updatedAt: Date }>;
  resources: Array<{ id: string; title: string; url: string; domain: string; eventType: string; subjectId: string | null; topicName: string | null; occurredAt: Date }>;
  totals:    { notes: number; resources: number };
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
  const resourceNodes: MapNode[] = input.resources.map(r => {
    const id = `resource:${r.id}`;
    const at = place(id, r.subjectId, r.topicName, "resources");
    return {
      id, type: "resource", label: r.title || r.domain, href: "/saved", subjectId: at.subjectId,
      subjectName: at.subjectId ? subjectName.get(at.subjectId)! : null,
      topicName: r.topicName, topicLinked: at.topicLinked,
      url: r.url, domain: r.domain, savedAt: r.occurredAt.toISOString(),
      kind: r.eventType === "study_requested" ? "study_requested" : "saved",
    };
  });

  const topicNodes: MapNode[] = topics.map(t => {
    const id = `topic:${t.id}`;
    link(`subject:${t.subjectId}`, id, "has_topic");
    // "unverified" (no session behind it) is no level at all here.
    const known   = masteryLevel(t);
    const studied = known !== "unverified";
    return {
      id, type: "topic", label: t.name, href: "/knowledge", subjectId: t.subjectId, subjectName: subjectName.get(t.subjectId)!,
      sessions: t.reviewCount,
      level: known === "unverified" ? null : known,
      masteryPercent: studied ? Math.round(t.masteryProbability * 100) : null,
      notes: tally.get(id)?.notes ?? 0, resources: tally.get(id)?.resources ?? 0,
    };
  });
  const subjectNodes: MapNode[] = input.subjects.map(s => {
    const id = `subject:${s.id}`;
    return {
      id, type: "subject", label: s.name, href: "/knowledge", subjectId: s.id,
      topics: topics.filter(t => t.subjectId === s.id).length,
      notes: tally.get(id)?.notes ?? 0, resources: tally.get(id)?.resources ?? 0,
    };
  });

  const nodes = [...subjectNodes, ...topicNodes, ...noteNodes, ...resourceNodes];
  const linked = new Set(edges.flatMap(e => [e.from, e.to]));
  const counts: Record<MapNodeType, number> = {
    subject: subjectNodes.length, topic: topicNodes.length, note: noteNodes.length, resource: resourceNodes.length,
  };
  return {
    status: "ready", nodes, edges, counts,
    notShown: { notes: Math.max(0, input.totals.notes - noteNodes.length), resources: Math.max(0, input.totals.resources - resourceNodes.length) },
    unconnected: nodes.filter(n => !linked.has(n.id)).length,
  };
}

// A fixed number of queries whatever the learner has: one for the learner,
// then six together.
export async function loadNovaKnowledgeMap(platformChatId: string): Promise<NovaKnowledgeMapView> {
  const user = await prisma.messengerUser.findUnique({
    where:  learnerKey(platformChatId),
    select: { novaAcademicProfile: { select: { id: true, onboardingComplete: true } } },
  });
  if (!user) return { status: "not_connected" };
  const profile = user.novaAcademicProfile;
  if (!profile?.onboardingComplete) return { status: "onboarding_incomplete" };
  const profileId = profile.id;

  const [subjects, topics, notes, resources, noteTotal, resourceTotal] = await Promise.all([
    prisma.novaSubject.findMany({ where: { profileId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.novaTopicMastery.findMany({
      where: { subject: { profileId } }, orderBy: { name: "asc" },
      select: { id: true, subjectId: true, name: true, masteryProbability: true, reviewCount: true },
    }),
    prisma.novaNote.findMany({
      where: { profileId }, orderBy: { updatedAt: "desc" }, take: MAP_NOTES_MAX,
      select: { id: true, title: true, subjectId: true, topicName: true, updatedAt: true },
    }),
    prisma.novaLearningEvent.findMany({
      where: { profileId }, orderBy: { occurredAt: "desc" }, take: MAP_RESOURCES_MAX,
      select: { id: true, title: true, url: true, domain: true, eventType: true, subjectId: true, topicName: true, occurredAt: true },
    }),
    prisma.novaNote.count({ where: { profileId } }),
    prisma.novaLearningEvent.count({ where: { profileId } }),
  ]);
  return buildKnowledgeMap({ subjects, topics, notes, resources, totals: { notes: noteTotal, resources: resourceTotal } });
}
