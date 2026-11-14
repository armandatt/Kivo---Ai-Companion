// What Nova is told about a card it is asked from on the Knowledge Map.
import { MAP_NODE_ID, mapFactsOf, mapOverviewFacts } from "../product/map-context";
import type { MapEdge, MapNode, NovaKnowledgeMapReady } from "../product/knowledge-map.types";

const base = { href: null, subjectId: "s" };
const nodes: MapNode[] = [
  { ...base, id: "subject:s", type: "subject", label: "Launch Strategy", topics: 2, notes: 1, resources: 1 },
  { ...base, id: "topic:a", type: "topic", label: "Go-to-Market", subjectName: "Launch Strategy", sessions: 0, level: null, masteryPercent: null, notes: 1, resources: 0 },
  { ...base, id: "topic:b", type: "topic", label: "Pricing", subjectName: "Launch Strategy", sessions: 2, level: "weak", masteryPercent: 30, reviewDue: true, notes: 0, resources: 1 },
  { ...base, id: "note:n", type: "note", label: "Secret note title", subjectName: "Launch Strategy", topicName: "Go-to-Market", topicLinked: true, updatedAt: "2026-11-01T00:00:00Z" },
  { ...base, id: "resource:r", type: "resource", label: "Pricing guide", subjectName: "Launch Strategy", topicName: "Pricing", topicLinked: true, url: "https://x.org/p", domain: "x.org", savedAt: "2026-11-01T00:00:00Z", kind: "saved" },
  { ...base, id: "task:t", type: "task", label: "Write launch plan", subjectName: "Launch Strategy", topicName: null, status: "in_progress", priority: null, dueDay: "2026-11-20", estimatedMinutes: null, order: 0, waitsOn: 0 },
  { ...base, id: "task:late", type: "task", label: "Send survey", subjectName: "Launch Strategy", topicName: null, status: "todo", priority: null, dueDay: "2026-11-10", estimatedMinutes: null, order: 1, waitsOn: 1 },
];
const edges: MapEdge[] = [
  { id: "1", from: "subject:s", to: "topic:a", kind: "has_topic" },
  { id: "2", from: "subject:s", to: "topic:b", kind: "has_topic" },
  { id: "3", from: "topic:a", to: "note:n", kind: "about_topic" },
  { id: "4", from: "topic:b", to: "resource:r", kind: "about_topic" },
  { id: "5", from: "subject:s", to: "task:t", kind: "has_task" },
  { id: "6", from: "subject:s", to: "task:late", kind: "has_task" },
];
const view: NovaKnowledgeMapReady = { status: "ready", nodes, edges, counts: { subject: 1, topic: 2, task: 2, note: 1, resource: 1 }, notShown: { notes: 0, resources: 0 }, unconnected: 0 };

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

describe("map-context: what stands out, for a specific answer", () => {
  const ctx = { today: "2026-11-14", now: new Date("2026-11-14T10:00:00Z"), exams: [
    { id: "e1", title: "Launch review", type: "project" as const, subjectName: "Launch Strategy", date: "2026-11-21", daysUntil: 7 },
    { id: "e2", title: "Other final", type: "exam" as const, subjectName: "Machine Learning", date: "2026-11-30", daysUntil: 16 },
  ] };
  it("leads with dates, overdue and soon-due tasks, reviews due and the weakest topics, from the record only", () => {
    const facts = mapFactsOf(view, "subject:s", ctx).join("\n");
    expect(facts).toContain('Dates coming up: "Launch review" (project, Launch Strategy) on 2026-11-21, in 7 days');
    expect(facts).not.toContain("Other final");
    expect(facts).toContain('Overdue tasks: "Send survey" (due 2026-11-10, 4 days late)');
    expect(facts).toContain('Tasks due within a week: "Write launch plan" (due in 6 days)');
    expect(facts).toContain('Reviews due now: "Pricing"');
    expect(facts).toContain('Weakest estimates: "Pricing" (30%)');
    expect(facts).toContain('Not started yet (1), in the map\'s order: "Go-to-Market"');
    expect(facts).toContain('Tasks waiting on other tasks first: "Send survey" (waits on 1)');
    expect(facts.indexOf("Dates coming up")).toBeLessThan(facts.indexOf("Reviews due now"));
  });
  it("the whole map: what stands out across every subject, dates of every subject", () => {
    const facts = mapOverviewFacts(view, "everything", ctx).join("\n");
    expect(facts).toContain("Other final");
    expect(facts).toContain("Overdue tasks");
  });
});
