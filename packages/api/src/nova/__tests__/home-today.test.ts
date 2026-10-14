// Today's page (Home for a Nova learner), read from source: the web app has
// no component test runner, so these show what the page is written to do.
// None of it has been seen in a browser.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const web = (file: string) => readFileSync(join(__dirname, "../../../../../apps/web", file), "utf8");

describe("the links drawn around today's topic", () => {
  const graph  = web("components/nova/local-graph.ts");
  const linked = web("components/nova/linked-to-topic.tsx");
  it("follow only the edges the map returned, and rank nothing", () => {
    expect(graph).toContain("for (const edge of map.edges as MapEdge[])");
    expect(graph).not.toContain(".sort(");
    expect(linked).not.toContain(".sort(");
  });
  it("are an extra: the panel says when the map did not load and keeps the rest", () => {
    expect(linked).toContain("!mapReady && map.error");
    expect(linked).toContain("{hasContext && <FocusContext view={context}");
  });
});

describe("Today keeps what it already did", () => {
  const home = web("components/nova/nova-home.tsx");
  it("still shows the shortfall, the recovery card and the learner's context for the topic", () => {
    expect(home).toContain("<ShortfallNote shortfall={view.plan.shortfall}");
    expect(home).toContain("<RecoveryCard");
    expect(home).toContain("useFocusContext(rec ?");
  });
  it("still starts a focus session from a task", () => {
    expect(home).toContain("onStart={active ? undefined : task => start({ topicName: task.topicName!, subjectName: task.subjectName!, durationMinutes: TASK_SESSION_MINUTES }, `task:${task.id}`)}");
  });
  it("does not wait for the map: the recommendation renders whatever the map request does", () => {
    expect(home.indexOf("<RecommendationCard")).toBeLessThan(home.indexOf("<LinkedToTopic"));
    expect(home).not.toMatch(/map\.(loading|error)/);
  });
});
