// ─── Kivo Connect: Saved Pages ───────────────────────────────────────────────
// What an assistant can do with the learner's Saved Pages, through Kivo's own
// saved-pages writer (nova/product/learning-events.ts, the one the browser
// extension and the web app's "Save a link" use) and nothing else: a page is
// a saved page (a NovaLearningEvent "resource_saved" row), never a note.
//
// A saved page is filed in one place on the Knowledge Map, as a note is: a
// subject, and optionally one of its topics (subjectId + topicName on the
// row). That filing is the page's relationship to the map: the map draws it
// as "filed under" the subject or "about" the topic. One page, one place; a
// place holds any number of pages.
//
// Map node ids an assistant sends ("subject:<id>", "topic:<id>") are resolved
// against the learner's own study structure here, so another learner's id,
// an archived topic or a made-up id is simply not found. Nothing is trusted
// from the assistant but the id it names.

import { loadStudyStructure } from "../nova/product/setup-edit";
import type { StudyStructure } from "../nova/product/setup-edit.types";
import type { LearningResource } from "../nova/product/learning-events.types";
import { linkTo, mapLink } from "./knowledge";

export type NodePlace = { subjectId: string; subjectName: string; topicId: string | null; topicName: string | null; nodeId: string; label: string };
export type NodeResolution = { ok: true; place: NodePlace } | { ok: false; message: string };

const NODE_HINT = 'Use a map node id ("subject:<id>" or "topic:<id>") from search_knowledge_nodes, get_workspace_structure or get_knowledge_map.';

const topicKey = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

// "subject:<id>" or "topic:<id>" → where a page would be filed, if it is the learner's.
export function resolveNode(st: StudyStructure, nodeId: string): NodeResolution {
  const [kind, ...rest] = nodeId.split(":");
  const id = rest.join(":");
  if (!id || (kind !== "subject" && kind !== "topic")) {
    return { ok: false, message: `A saved page is filed under a subject or a topic. ${NODE_HINT}` };
  }
  if (kind === "subject") {
    const s = st.subjects.find(x => x.id === id);
    if (!s) return { ok: false, message: `The learner has no subject with that id. ${NODE_HINT}` };
    return { ok: true, place: { subjectId: s.id, subjectName: s.name, topicId: null, topicName: null, nodeId: `subject:${s.id}`, label: s.name } };
  }
  for (const s of st.subjects) {
    const t = s.topics.find(x => x.id === id);
    if (!t) continue;
    if (t.archived) return { ok: false, message: "That topic was removed from the learner's map. Choose another, or file the page under its subject." };
    return { ok: true, place: { subjectId: s.id, subjectName: s.name, topicId: t.id, topicName: t.name, nodeId: `topic:${t.id}`, label: `${s.name} › ${t.name}` } };
  }
  return { ok: false, message: `The learner has no topic with that id. ${NODE_HINT}` };
}

// Where a saved page is filed, as map nodes (the topic only when the learner
// still has a topic of that name, as the map links it).
export function filingOf(st: StudyStructure, r: Pick<LearningResource, "subjectId" | "subjectName" | "topicName">, origin: string) {
  if (!r.subjectId) return null;
  const s = st.subjects.find(x => x.id === r.subjectId);
  const topic = r.topicName && s ? s.topics.find(t => !t.archived && topicKey(t.name) === topicKey(r.topicName!)) : undefined;
  const nodeId = topic ? `topic:${topic.id}` : `subject:${r.subjectId}`;
  return {
    subject: { id: `subject:${r.subjectId}`, name: r.subjectName ?? s?.name ?? null },
    topic: r.topicName ? { id: topic ? `topic:${topic.id}` : null, name: r.topicName, onMap: !!topic } : null,
    nodeId, mapUrl: mapLink(origin, nodeId),
  };
}

// One saved page as an assistant sees it.
export function pageOut(st: StudyStructure, r: LearningResource, origin: string) {
  return {
    id: `resource:${r.id}`, kind: "saved_page", title: r.title, url: r.url, domain: r.domain,
    type: r.resourceType, description: r.description, siteName: r.siteName, author: r.author, publishedAt: r.publishedAt,
    savedAt: r.savedAt, readingStatus: r.readingStatus, tags: r.tags, collection: r.collection?.name ?? null, personalNote: r.personalNote,
    ...(r.eventType === "selection_saved" ? { selectedPassage: r.excerpt } : {}),
    filedUnder: filingOf(st, r, origin),
    filedBy: r.filedBy,
    kivoUrl: linkTo(origin, "resource", r.id),
  };
}

export const loadStructure = (profileId: string) => loadStudyStructure(profileId);
