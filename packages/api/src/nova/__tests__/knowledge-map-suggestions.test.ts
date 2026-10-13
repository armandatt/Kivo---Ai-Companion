// Suggestions on the Knowledge Map: places a saved page was suggested for and
// is not filed under. They are passed through as stored, and they are not edges.

jest.mock("@repo/db/client", () => ({ prisma: {} }));

import { buildKnowledgeMap, type MapInputs } from "../product/knowledge-map";

const base = (): MapInputs => ({
  subjects: [{ id: "s_os", name: "Operating Systems" }, { id: "s_alg", name: "Algorithms" }],
  topics: [
    { id: "t_dead",  subjectId: "s_os",  name: "Deadlocks", masteryProbability: 0.2, reviewCount: 0 },
    { id: "t_graph", subjectId: "s_alg", name: "Graphs",    masteryProbability: 0.2, reviewCount: 0 },
  ],
  notes: [],
  resources: [],
  totals: { notes: 0, resources: 0 },
});
const resource = (over: Partial<MapInputs["resources"][number]> = {}): MapInputs["resources"][number] => ({
  id: "r1", title: "Deadlocks explained", url: "https://example.com/d", domain: "example.com", eventType: "resource_saved",
  subjectId: null, topicName: null, occurredAt: new Date("2026-10-14T10:00:00Z"), ...over,
});

describe("suggestions on the map", () => {
  it("draws nothing new for pages with no suggestions: the map is as before", () => {
    const map = buildKnowledgeMap({ ...base(), resources: [resource()] });
    expect(map.suggestions).toEqual([]);
    expect(map.edges.map(e => e.kind)).toEqual(["has_topic", "has_topic"]);
  });

  it("passes a stored suggestion through, to the topic it names, with why", () => {
    const map = buildKnowledgeMap({ ...base(), resources: [resource({ suggestions: [
      { subjectId: "s_os",  topicName: "deadlocks", confidence: "high",     basis: "name_in_title" },
      { subjectId: "s_alg", topicName: null,        confidence: "possible", basis: "model" },
    ] })] });
    expect(map.suggestions).toEqual([
      { id: "topic:t_dead~resource:r1", from: "topic:t_dead",  to: "resource:r1", confidence: "high",     basis: "name_in_title" },
      { id: "subject:s_alg~resource:r1", from: "subject:s_alg", to: "resource:r1", confidence: "possible", basis: "model" },
    ]);
  });

  it("is not an edge: a page that is only suggested for is still unconnected", () => {
    const withOne = buildKnowledgeMap({ ...base(), resources: [resource({ suggestions: [{ subjectId: "s_os", topicName: "Deadlocks", confidence: "high", basis: "name_in_title" }] })] });
    const without = buildKnowledgeMap({ ...base(), resources: [resource()] });
    expect(withOne.edges).toEqual(without.edges);
    expect(withOne.unconnected).toBe(without.unconnected);
    expect(withOne.nodes).toEqual(without.nodes);
  });

  it("drops a suggestion for a subject or topic the learner no longer has", () => {
    const map = buildKnowledgeMap({ ...base(), resources: [resource({ suggestions: [
      { subjectId: "s_gone", topicName: null,            confidence: "possible", basis: "model" },
      { subjectId: "s_os",   topicName: "Paging",        confidence: "possible", basis: "model" },
    ] })] });
    expect(map.suggestions).toEqual([]);
  });

  it("marks a page Nova filed by itself, and draws it where it is filed like any other", () => {
    const map = buildKnowledgeMap({ ...base(), resources: [resource({ subjectId: "s_os", topicName: "Deadlocks", filedBy: "nova" })] });
    const node = map.nodes.find(n => n.id === "resource:r1");
    expect(node).toMatchObject({ type: "resource", filedBy: "nova", topicLinked: true });
    expect(map.edges).toContainEqual({ id: "topic:t_dead>resource:r1", from: "topic:t_dead", to: "resource:r1", kind: "about_topic" });
  });
});
