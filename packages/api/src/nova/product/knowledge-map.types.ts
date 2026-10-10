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
  // Where the item itself lives in the app. null: it has no page of its own.
  href:      string | null;
  // The subject it belongs to or was filed under. null: none.
  subjectId: string | null;
}

export type MapNode =
  | (NodeBase & { type: "subject"; topics: number; notes: number; resources: number })
  | (NodeBase & {
      type: "topic"; subjectName: string;
      // Finished sessions that fed the topic. 0: declared, never studied.
      sessions: number;
      // A self-report-driven estimate, as on Knowledge. null with no session.
      level: MapLevel | null; masteryPercent: number | null;
      notes: number; resources: number;
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
    });

export type MapEdgeKind =
  | "has_topic"     // subject → topic: the topic is one of the subject's
  | "about_topic"   // topic → note or saved page filed under that topic
  | "filed_under";  // subject → note or saved page filed under the subject only

export interface MapEdge { id: string; from: string; to: string; kind: MapEdgeKind }

export interface NovaKnowledgeMapReady {
  status: "ready";
  nodes:  MapNode[];
  edges:  MapEdge[];
  counts: Record<MapNodeType, number>;
  // Items on record that are not drawn because of the caps above.
  notShown: { notes: number; resources: number };
  // Nodes with no edge at all.
  unconnected: number;
}

export type NovaKnowledgeMapView =
  | NovaKnowledgeMapReady
  | { status: "not_nova" } | { status: "not_connected" } | { status: "onboarding_incomplete" };
