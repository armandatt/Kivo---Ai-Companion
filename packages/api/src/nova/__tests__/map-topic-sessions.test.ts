// Bug batch 28 Nov, item 3: a session filed on a topic shows on that topic's
// map card. The map counts a topic's sessions from the session rows (as
// Progress does), not from mastery's review count, which a Quick Focus filed
// later never moves.

jest.mock("@repo/db/client", () => ({ prisma: {} }));

import { buildKnowledgeMap, type MapInputs } from "../product/knowledge-map";

const base = (): MapInputs => ({
  subjects: [{ id: "s_fin", name: "Finance" }],
  topics: [
    { id: "t_wacc", subjectId: "s_fin", name: "WACC", masteryProbability: 0.1, reviewCount: 0 },
    { id: "t_dcf",  subjectId: "s_fin", name: "DCF",  masteryProbability: 0.1, reviewCount: 0 },
  ],
  notes: [], resources: [], totals: { notes: 0, resources: 0 },
});
const topic = (m: ReturnType<typeof buildKnowledgeMap>, id: string) => m.nodes.find(n => n.id === id) as Extract<ReturnType<typeof buildKnowledgeMap>["nodes"][number], { type: "topic" }>;

describe("REGRESSION item 3: topic sessions on the map", () => {
  it("counts filed sessions from the rows, matching the topic name however it is cased", () => {
    const m = buildKnowledgeMap({ ...base(), sessionsByTopic: [
      { subjectId: "s_fin", topicName: "wacc", sessions: 1, minutes: 38 },
      { subjectId: "s_fin", topicName: "WACC", sessions: 1, minutes: 25 },
    ] });
    expect([topic(m, "topic:t_wacc").sessions, topic(m, "topic:t_wacc").focusedMinutes]).toEqual([2, 63]);
    expect(topic(m, "topic:t_dcf").sessions).toBe(0);
  });

  it("an older caller with no session rows keeps the review count", () => {
    const m = buildKnowledgeMap({ ...base(), topics: [{ id: "t_wacc", subjectId: "s_fin", name: "WACC", masteryProbability: 0.5, reviewCount: 3 }] });
    expect(topic(m, "topic:t_wacc").sessions).toBe(3);
  });
});
