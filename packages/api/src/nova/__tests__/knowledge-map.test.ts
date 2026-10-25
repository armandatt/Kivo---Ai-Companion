// The Knowledge Map draws what is on record and nothing else. No database;
// the real-Postgres proof is nova-workspace.itest.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildKnowledgeMap, type MapInputs } from "../product/knowledge-map";

const read = (file: string) => readFileSync(join(__dirname, "..", file), "utf8");
const at   = new Date("2026-10-08T10:00:00Z");

const input = (over: Partial<MapInputs> = {}): MapInputs => ({
  subjects: [{ id: "os", name: "Operating Systems" }, { id: "db", name: "DBMS" }],
  topics: [
    { id: "t1", subjectId: "os", name: "Deadlocks", masteryProbability: 0.42, reviewCount: 2 },
    { id: "t2", subjectId: "os", name: "Paging", masteryProbability: 0, reviewCount: 0 },
  ],
  notes: [], resources: [], totals: { notes: 0, resources: 0 }, ...over,
});
const note = (id: string, subjectId: string | null, topicName: string | null) => ({ id, title: `Note ${id}`, subjectId, topicName, updatedAt: at });
const page = (id: string, subjectId: string | null, topicName: string | null, eventType = "resource_saved") =>
  ({ id, title: `Page ${id}`, url: `https://example.org/${id}`, domain: "example.org", eventType, subjectId, topicName, occurredAt: at });
const edgesOf = (map: ReturnType<typeof buildKnowledgeMap>) => map.edges.map(e => `${e.from} -${e.kind}-> ${e.to}`).sort();

describe("nodes", () => {
  it("is one node per subject, topic, note and saved page, each with its own id", () => {
    const map = buildKnowledgeMap(input({ notes: [note("n1", "os", null)], resources: [page("r1", null, null)], totals: { notes: 1, resources: 1 } }));
    expect(map.nodes.map(n => n.id).sort()).toEqual(["note:n1", "resource:r1", "subject:db", "subject:os", "topic:t1", "topic:t2"]);
    expect(map.counts).toEqual({ subject: 2, topic: 2, note: 1, resource: 1, task: 0 });
  });

  it("opens the real item", () => {
    const map = buildKnowledgeMap(input({ notes: [note("n1", "os", null)], resources: [page("r1", "os", null)] }));
    const href = Object.fromEntries(map.nodes.map(n => [n.id, n.href]));
    expect(href["note:n1"]).toBe("/notes/n1");
    // Each node opens its own record, not a list to search again.
    expect(href["resource:r1"]).toBe("/saved?page=r1");
    expect(href["topic:t1"]).toBe("/knowledge?topic=t1");
    for (const node of map.nodes) if (node.type === "subject") expect(node.href).toBe(`/knowledge?subject=${node.subjectId}`);
  });

  it("gives a topic a level only when a session stands behind it", () => {
    const map = buildKnowledgeMap(input());
    const topics = map.nodes.filter(n => n.type === "topic");
    expect(topics.map(t => t.type === "topic" && [t.label, t.sessions, t.level, t.masteryPercent])).toEqual([
      ["Deadlocks", 2, "developing", 42], ["Paging", 0, null, null],
    ]);
  });
});

describe("edges are links that are stored", () => {
  it("joins a topic to its subject", () => {
    expect(edgesOf(buildKnowledgeMap(input()))).toEqual([
      "subject:os -has_topic-> topic:t1", "subject:os -has_topic-> topic:t2",
    ]);
  });

  it("joins a note to the topic it names, when that subject has the topic", () => {
    const map = buildKnowledgeMap(input({ notes: [note("n1", "os", "  deadlocks ")] }));
    expect(edgesOf(map)).toContain("topic:t1 -about_topic-> note:n1");
    expect(edgesOf(map)).not.toContain("subject:os -filed_under-> note:n1");
    expect(map.nodes.find(n => n.id === "note:n1")).toMatchObject({ topicLinked: true, topicName: "  deadlocks " });
  });

  it("joins a note to its subject only, when the topic it names is not one of that subject's", () => {
    const map = buildKnowledgeMap(input({ notes: [note("n1", "os", "Scheduling"), note("n2", "db", "Deadlocks")] }));
    expect(edgesOf(map)).toContain("subject:os -filed_under-> note:n1");
    // "Deadlocks" is a topic of Operating Systems, not of DBMS: no line to it.
    expect(edgesOf(map)).toContain("subject:db -filed_under-> note:n2");
    expect(map.edges.filter(e => e.to === "note:n2")).toHaveLength(1);
    expect(map.nodes.find(n => n.id === "note:n2")).toMatchObject({ topicLinked: false });
  });

  it("joins a saved page by the same two rules", () => {
    const map = buildKnowledgeMap(input({ resources: [page("r1", "os", "Paging"), page("r2", "os", null, "study_requested")] }));
    expect(edgesOf(map)).toContain("topic:t2 -about_topic-> resource:r1");
    expect(edgesOf(map)).toContain("subject:os -filed_under-> resource:r2");
    expect(map.nodes.find(n => n.id === "resource:r2")).toMatchObject({ kind: "study_requested" });
  });

  it("leaves what is filed under nothing unconnected, and says how many", () => {
    const map = buildKnowledgeMap(input({ notes: [note("n1", null, "Deadlocks")], resources: [page("r1", null, null)] }));
    expect(map.edges.filter(e => e.to === "note:n1" || e.to === "resource:r1")).toEqual([]);
    // Two loose items, and the subject with nothing in it.
    expect(map.unconnected).toBe(3);
  });

  it("draws no line to a subject the learner no longer has", () => {
    const map = buildKnowledgeMap(input({ notes: [note("n1", "gone", "Deadlocks")], topics: [{ id: "tx", subjectId: "gone", name: "X", masteryProbability: 0, reviewCount: 0 }] }));
    expect(map.edges).toEqual([]);
    expect(map.nodes.some(n => n.id === "topic:tx")).toBe(false);
    expect(map.nodes.find(n => n.id === "note:n1")).toMatchObject({ subjectId: null, subjectName: null });
  });

  it("never joins two notes, two pages or two topics to each other", () => {
    const map = buildKnowledgeMap(input({
      notes: [note("n1", "os", "Deadlocks"), note("n2", "os", "Deadlocks")], resources: [page("r1", "os", "Deadlocks")],
    }));
    for (const e of map.edges) {
      const [from, to] = [e.from.split(":")[0], e.to.split(":")[0]];
      expect(["subject>topic", "topic>note", "topic>resource", "subject>note", "subject>resource"]).toContain(`${from}>${to}`);
    }
  });

  it("counts what hangs from a subject and a topic", () => {
    const map = buildKnowledgeMap(input({ notes: [note("n1", "os", "Deadlocks"), note("n2", "os", null)], resources: [page("r1", "os", "Deadlocks")] }));
    expect(map.nodes.find(n => n.id === "subject:os")).toMatchObject({ topics: 2, notes: 2, resources: 1 });
    expect(map.nodes.find(n => n.id === "topic:t1")).toMatchObject({ notes: 1, resources: 1 });
  });

  it("says what was left out by the caps", () => {
    expect(buildKnowledgeMap(input({ notes: [note("n1", "os", null)], totals: { notes: 180, resources: 0 } })).notShown).toEqual({ notes: 179, resources: 0, tasks: 0 });
  });
});

describe("the map is a read model", () => {
  const source = read("product/knowledge-map.ts");

  it("writes nothing and calls no model", () => {
    expect(source).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
    const imports = source.split("\n").filter(line => line.startsWith("import ")).join("\n");
    for (const forbidden of ["brains/", "openai", "nova-orchestrator", "consolidation"]) expect(imports).not.toContain(forbidden);
  });

  it("reads only the learner's own rows", () => {
    expect(source).toContain("learnerKey(platformChatId)");
    expect(source).toContain("where: { profileId }");
    // Its own topics, and only the active ones (an archived topic is not drawn).
    expect(source).toContain("where: { subject: { profileId }, archivedAt: null }");
    // Notes and saved pages come from their owners, by profile.
    expect(source).toContain("listNoteLinks(profileId, MAP_NOTES_MAX)");
    expect(source).toContain("listResourceLinks(profileId, MAP_RESOURCES_MAX)");
    expect(source).not.toMatch(/prisma\.(novaNote|novaLearningEvent)\b/);
    // Of what a note says, only the titles it names in [[...]] reach the map:
    // notes.ts reads the body to find them and the body itself never leaves it.
    const lister = read("product/notes.ts").split("export async function listNoteLinks")[1]!;
    expect(lister).toContain("rows.map(({ body, ...n }) => ({ ...n, linksTo: linkedTitles(body)");
    expect(source).not.toMatch(/\bbody\b/);
  });
});

// ── The page: opening, acting and moving without a pointer ────────────────────
// Read from the web source: nothing here renders the map, so these show what
// the page is written to do, not that a browser does it.

describe("the map page (read from source)", () => {
  const { readFileSync } = jest.requireActual("node:fs") as typeof import("node:fs");
  const { join } = jest.requireActual("node:path") as typeof import("node:path");
  const web = (file: string) => readFileSync(join(__dirname, "../../../../../apps/web/components/nova", file), "utf8");
  const page = web("knowledge-map/knowledge-map.tsx");

  it("a topic or subject link opens that record on Knowledge, and a page link marks its row on Saved", () => {
    const knowledge = web("knowledge/subject-topics.tsx");
    expect(knowledge).toContain("if (linkedId('topic') !== topic.id) return");
    expect(knowledge).toContain("if (linkedId('subject') !== subject.subjectId) return");
    expect(knowledge).toContain("row.current?.scrollIntoView({ block: 'center' })");
    expect(web("saved/nova-saved.tsx")).toContain("new URLSearchParams(window.location.search).get('page') !== resource.id");
  });

  it("a topic can be studied from the map with the ordinary start, and a note written where the node is", () => {
    expect(page).toContain("start({ topicName: node.label, subjectName: node.subjectName, durationMinutes: MAP_SESSION_MINUTES }, node.id)");
    expect(page).toContain("`/notes/new?subjectId=${encodeURIComponent(node.subjectId ?? '')}&topic=${encodeURIComponent(node.label)}`");
    // The page starts a session only through the shared hook; it writes nothing itself.
    expect(page).not.toContain("fetch(");
  });

  it("the drawing is a group that holds its items, not an image", () => {
    expect(page).not.toContain('role="img"');
    expect(page).toContain('<svg className="absolute inset-0 size-full" role="group"');
    expect(page).toContain('role="button" tabIndex={0} aria-label={`${TYPE_LABEL[n.type]}: ${n.label}`} aria-pressed={on}');
  });

  it("the map moves, zooms and fits from the keyboard, only while the map itself has focus", () => {
    expect(page).toContain("if (e.target !== e.currentTarget) return");
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) expect(page).toContain(`${key}: [`);
    expect(page).toContain("else if (e.key === '0') { e.preventDefault(); fit() }");
  });
});
