import { draftLines, graphLines, matchNodes, neighbours, relatedLines } from "../product/workspace-graph";
import type { MapEdge, MapNode } from "../product/knowledge-map.types";

const node = (id: string, label: string, extra: Partial<MapNode> = {}) => ({ id, label, href: null, subjectId: "s1", ...extra }) as MapNode;
const NODES: MapNode[] = [
  node("subject:s1", "Artificial Intelligence", { type: "subject", topics: 2, notes: 1, resources: 1 } as Partial<MapNode>),
  node("topic:t1", "Vector Databases", { type: "topic", subjectName: "Artificial Intelligence", sessions: 2, level: "developing", masteryPercent: 55, notes: 1, resources: 1 } as Partial<MapNode>),
  node("topic:t2", "HNSW", { type: "topic", subjectName: "Artificial Intelligence", parentId: "topic:t1", sessions: 0, level: null, masteryPercent: null, notes: 1, resources: 0 } as Partial<MapNode>),
  node("note:n1", "Layered graphs, my notes", { type: "note", subjectName: "Artificial Intelligence", topicName: "HNSW", topicLinked: true, updatedAt: "2026-11-01" } as Partial<MapNode>),
  node("task:k1", "Revise HNSW before the quiz", { type: "task", subjectName: null, topicName: "HNSW", status: "todo", priority: null, dueDay: "2026-11-20", estimatedMinutes: 30, order: 0, waitsOn: 0 } as Partial<MapNode>),
  node("resource:r1", "Faiss documentation", { type: "resource", subjectName: null, topicName: null, topicLinked: false, url: "https://faiss.ai", domain: "faiss.ai", savedAt: "x", kind: "saved" } as Partial<MapNode>),
];
const EDGES: MapEdge[] = [
  { id: "e1", from: "subject:s1", to: "topic:t1", kind: "has_topic" },
  { id: "e2", from: "topic:t1", to: "topic:t2", kind: "subtopic" },
  { id: "e3", from: "topic:t2", to: "note:n1", kind: "about_topic" },
  { id: "e4", from: "topic:t2", to: "task:k1", kind: "has_task" },
  { id: "e5", from: "topic:t1", to: "resource:r1", kind: "about_topic" },
];
const MAP = { nodes: NODES, edges: EDGES };

describe("the learner's Kivo as one graph", () => {
  it("matches things by their own names, best first", () => {
    expect(matchNodes(NODES, "hnsw").map(n => n.id)).toEqual(["topic:t2", "task:k1"]);
    expect(matchNodes(NODES, "vector database")[0]!.id).toBe("topic:t1");
    expect(matchNodes(NODES, "quantum")).toEqual([]);
  });
  it("brings what is connected, said as the relationship, across kinds", () => {
    const rel = neighbours(MAP, "topic:t2").map(r => `${r.relation} ${r.node.id}`);
    expect(rel).toEqual(["is a subtopic of topic:t1", "has filed note:n1", "has task task:k1"]);
    const { text } = graphLines(MAP, "HNSW");
    expect(text).toContain('topic "HNSW" (id topic:t2; not studied yet)');
    expect(text).toContain('has filed note "Layered graphs, my notes" (id note:n1)');
    expect(text).toContain('has task task "Revise HNSW before the quiz" (id task:k1; todo, due 2026-11-20)');
  });
  it("follows one node, and says when it is not on the map", () => {
    expect(relatedLines(MAP, "topic:t1")!.text).toContain('has filed saved page "Faiss documentation" (id resource:r1; faiss.ai)');
    expect(relatedLines(MAP, "topic:nope")).toBeNull();
  });
  it("lists open drafts that match, never merged or discarded ones", () => {
    const drafts = [
      { id: "d1", title: "HNSW reading", passages: 3, sourceTitles: ["Malkov 2016"], status: "open" },
      { id: "d2", title: "HNSW old", passages: 1, sourceTitles: [], status: "merged" },
    ];
    expect(draftLines(drafts, "hnsw")).toContain('"HNSW reading" (draft d1, 3 passages from Malkov 2016)');
    expect(draftLines(drafts, "hnsw")).not.toContain("HNSW old");
  });
});
