// [[Links]] a learner writes in a note are drawn on the Knowledge Map as
// "links_to" edges: to the note of that title, else to a topic of that name.
// Nothing else is linked, and nothing is inferred.

import { buildKnowledgeMap, type MapInputs } from "../product/knowledge-map";

jest.mock("@repo/db/client", () => ({ prisma: {} }));

const at = (d: number) => new Date(Date.UTC(2026, 9, d));
const input = (notes: MapInputs["notes"]): MapInputs => ({
  subjects:  [{ id: "os", name: "Operating Systems" }],
  topics:    [{ id: "t-paging", subjectId: "os", name: "Paging", masteryProbability: 0, reviewCount: 0 }],
  notes,
  resources: [],
  totals:    { notes: notes.length, resources: 0 },
});

describe("[[links]] on the map", () => {
  it("joins a note to the note it names and to a topic it names, once each", () => {
    const map = buildKnowledgeMap(input([
      { id: "a", title: "OS revision", subjectId: "os", topicName: null, updatedAt: at(10), linksTo: ["Banker's algorithm", "paging", "Banker's  ALGORITHM"] },
      { id: "b", title: "Banker's algorithm", subjectId: null, topicName: null, updatedAt: at(9) },
    ]));
    const links = map.edges.filter(e => e.kind === "links_to").map(e => [e.from, e.to]);
    expect(links).toEqual([["note:a", "note:b"], ["note:a", "topic:t-paging"]]);
    // A note filed under nothing is connected once something links to it.
    expect(map.unconnected).toBe(0);
  });

  it("draws nothing for a link to nothing on record, or to the note itself", () => {
    const map = buildKnowledgeMap(input([
      { id: "a", title: "Thrashing", subjectId: "os", topicName: null, updatedAt: at(10), linksTo: ["Thrashing", "Not written yet"] },
    ]));
    expect(map.edges.filter(e => e.kind === "links_to")).toEqual([]);
  });

  it("when two notes share a title, the link goes to the one edited last", () => {
    const map = buildKnowledgeMap(input([
      { id: "old", title: "Summary", subjectId: null, topicName: null, updatedAt: at(1) },
      { id: "new", title: "summary", subjectId: null, topicName: null, updatedAt: at(5) },
      { id: "x", title: "Index", subjectId: null, topicName: null, updatedAt: at(6), linksTo: ["Summary"] },
    ]));
    expect(map.edges.filter(e => e.kind === "links_to").map(e => e.to)).toEqual(["note:new"]);
  });
});
