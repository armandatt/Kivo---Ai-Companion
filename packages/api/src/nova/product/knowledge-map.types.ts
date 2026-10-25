// ─── Knowledge Map: the contract between Nova and the map page ────────────────
// The learner's subjects, topics, notes and saved pages, and how they are
// connected ON RECORD. Every node is a row the learner can open; every edge
// is a link that is stored (a topic belongs to its subject; a note or a saved
// page was filed under a subject, and under a topic when it names one of that
// subject's topics). Nothing is inferred, and no edge is drawn to make the
// picture fuller: an item filed under nothing is shown unconnected.
// No imports, so the web app can import the types directly.

export type MapNodeType = "subject" | "topic" | "note" | "resource";
export type MapLevel    = "weak" | "developing" | "solid";

export const MAP_NOTES_MAX     = 150;
export const MAP_RESOURCES_MAX = 150;

interface NodeBase {
  // Unique on the map: "<type>:<row id>".
  id:        string;
  label:     string;
  // Where the item itself lives in the app: the note, that topic or subject
  // on Knowledge, that page's own row on Saved. Never a list the learner has
  // to search again. null: it has no page of its own.
  href:      string | null;
  // The subject it belongs to or was filed under. null: none.
  subjectId: string | null;
}

// A task shown in a topic's or subject's panel, with its steps under it
// (parentId names the task it is a step of). Tasks are not drawn as points:
// the map stays subjects, topics, notes and pages.
export interface MapTask { id: string; title: string; status: "todo" | "in_progress" | "done"; parentId: string | null }

export type MapNode =
  // parentId: the subject it sits inside (a "contains" edge comes from it). Absent: on its own.
  | (NodeBase & { type: "subject"; topics: number; notes: number; resources: number; tasks?: MapTask[]; parentId?: string })
  | (NodeBase & {
      type: "topic"; subjectName: string;
      // Finished sessions that fed the topic. 0: declared, never studied.
      sessions: number;
      // A self-report-driven estimate, as on Knowledge. null with no session.
      level: MapLevel | null; masteryPercent: number | null;
      notes: number; resources: number;
      tasks?: MapTask[];
    })
  | (NodeBase & {
      type: "note"; subjectName: string | null;
      // The topic the note names, as the learner wrote it. It is an edge only
      // when the subject has a topic of that name (topicLinked).
      topicName: string | null; topicLinked: boolean; updatedAt: string;
    })
  | (NodeBase & {
      type: "resource"; subjectName: string | null; topicName: string | null; topicLinked: boolean;
      url: string; domain: string; savedAt: string; kind: "saved" | "study_requested";
      // "nova": Nova filed it where it is from a name match, and the learner
      // has not kept or undone that yet. Absent on an older server.
      filedBy?: "learner" | "nova" | null;
    });

export type MapEdgeKind =
  | "contains"      // subject → subject: the learner put one inside the other
  | "has_topic"     // subject → topic: the topic is one of the subject's
  | "about_topic"   // topic → note or saved page filed under that topic
  | "filed_under"   // subject → note or saved page filed under the subject only
  | "links_to";     // note → note or topic: the learner wrote [[its name]] in the note

export interface MapEdge { id: string; from: string; to: string; kind: MapEdgeKind }

// A place a saved page was suggested for and is NOT filed under. It is not an
// edge: it takes no part in the layout or in what counts as connected, and
// the page draws it differently. It becomes an edge only when the learner
// files the page there, on Saved.
export interface MapSuggestion {
  id: string; from: string; to: string;
  // high: the learner's own name for the topic or subject appears in the
  // page's title or selected passage. possible: a model's reading.
  confidence: "high" | "possible";
  basis: "name_in_title" | "name_in_selection" | "model";
}

export interface NovaKnowledgeMapReady {
  status: "ready";
  nodes:  MapNode[];
  edges:  MapEdge[];
  // Absent on an older server.
  suggestions?: MapSuggestion[];
  counts: Record<MapNodeType, number>;
  // Items on record that are not drawn because of the caps above.
  notShown: { notes: number; resources: number };
  // Nodes with no edge at all.
  unconnected: number;
}

export type NovaKnowledgeMapView =
  | NovaKnowledgeMapReady
  | { status: "not_nova" } | { status: "not_connected" } | { status: "onboarding_incomplete" };
