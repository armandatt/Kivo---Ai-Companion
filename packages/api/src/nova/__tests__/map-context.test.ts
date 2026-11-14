// What Nova is told about a card it is asked from on the Knowledge Map.
import { MAP_NODE_ID, mapFactsOf } from "../product/map-context";
import type { MapEdge, MapNode, NovaKnowledgeMapReady } from "../product/knowledge-map.types";

const base = { href: null, subjectId: "s" };
const nodes: MapNode[] = [
  { ...base, id: "subject:s", type: "subject", label: "Launch Strategy", topics: 2, notes: 1, resources: 1 },
  { ...base, id: "topic:a", type: "topic", label: "Go-to-Market", subjectName: "Launch Strategy", sessions: 0, level: null, masteryPercent: null, notes: 1, resources: 0 },
  { ...base, id: "topic:b", type: "topic", label: "Pricing", subjectName: "Launch Strategy", sessions: 2, level: "weak", masteryPercent: 30, reviewDue: true, notes: 0, resources: 1 },
  { ...base, id: "note:n", type: "note", label: "Secret note title", subjectName: "Launch Strategy", topicName: "Go-to-Market", topicLinked: true, updatedAt: "2026-11-01T00:00:00Z" },
  { ...base, id: "resource:r", type: "resource", label: "Pricing guide", subjectName: "Launch Strategy", topicName: "Pricing", topicLinked: true, url: "https://x.org/p", domain: "x.org", savedAt: "2026-11-01T00:00:00Z", kind: "saved" },
  { ...base, id: "task:t", type: "task", label: "Write launch plan", subjectName: "Launch Strategy", topicName: null, status: "in_progress", priority: null, dueDay: "2026-11-20", estimatedMinutes: null, order: 0, waitsOn: 0 },
];
const edges: MapEdge[] = [
  { id: "1", from: "subject:s", to: "topic:a", kind: "has_topic" },
  { id: "2", from: "subject:s", to: "topic:b", kind: "has_topic" },
  { id: "3", from: "topic:a", to: "note:n", kind: "about_topic" },
  { id: "4", from: "topic:b", to: "resource:r", kind: "about_topic" },
  { id: "5", from: "subject:s", to: "task:t", kind: "has_task" },
];
const view: NovaKnowledgeMapReady = { status: "ready", nodes, edges, counts: { subject: 1, topic: 2, task: 1, note: 1, resource: 1 }, notShown: { notes: 0, resources: 0 }, unconnected: 0 };

describe("map-context", () => {
  it("names what the card holds, with each topic's state, from the learner's own map", () => {
    const facts = mapFactsOf(view, "subject:s").join("\n");
    expect(facts).toContain('the subject "Launch Strategy"');
    expect(facts).toContain('"Go-to-Market" (not studied yet)');
    expect(facts).toContain('"Pricing" (weak, 30%, 2 sessions, review due now)');
    expect(facts).toContain('"Write launch plan" (in progress)');
    expect(facts).toContain('"Pricing guide" (x.org)');
    expect(facts).toContain("Notes filed there: 1");
  });
  it("never gives a note's title or text", () => {
    expect(mapFactsOf(view, "subject:s").join("\n")).not.toContain("Secret note title");
    expect(mapFactsOf(view, "topic:a").join("\n")).not.toContain("Secret note title");
  });
  it("says where a card sits, and nothing for a card not on the map or a malformed id", () => {
    expect(mapFactsOf(view, "topic:b").join("\n")).toContain('inside "Launch Strategy"');
    expect(mapFactsOf(view, "topic:zzz")).toEqual([]);
    expect(MAP_NODE_ID.test("topic:abc_1")).toBe(true);
    expect(MAP_NODE_ID.test("topic:abc; drop")).toBe(false);
  });
});

describe("map-context: the map itself", () => {
  it("summarises every subject with its topics' state, and accepts only map or map:<workspace> as the whole map", () => {
    const { mapOverviewFacts } = require("../product/map-context");
    const facts = mapOverviewFacts(view, "everything").join("\n");
    expect(facts).toContain("1 subjects, 2 topics (1 studied)");
    expect(facts).toContain('Subject "Launch Strategy": "Go-to-Market" (not studied yet); "Pricing" (weak, 30%');
    expect(facts).toContain('Reviews due now: "Pricing"');
    expect(facts).not.toContain("Secret note title");
    expect(MAP_NODE_ID.test("map")).toBe(true);
    expect(MAP_NODE_ID.test("map:ws_1")).toBe(true);
    expect(MAP_NODE_ID.test("mapx")).toBe(false);
  });
});
