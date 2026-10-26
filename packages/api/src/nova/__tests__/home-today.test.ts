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

describe("Today keeps what it already did, a step away", () => {
  const home = web("components/nova/nova-home.tsx");
  it("still shows the shortfall and the recovery card, in sections that open", () => {
    expect(home).toContain("<ShortfallNote shortfall={view.plan.shortfall}");
    expect(home).toContain("<RecoveryCard");
    expect(home).toContain("<details className=\"group rounded-2xl");
  });
  it("keeps the task board one link away instead of listing every task on Today", () => {
    expect(home).toContain('href="/planner?view=board"');
    expect(home).not.toContain("<TodayTasks");
  });
  it("starts an item of the flow through the day's own route, and does not wait for the map", () => {
    expect(home).toContain("day.act({ action: 'start', itemId: item.id, minutes }");
    expect(home).not.toMatch(/map\.(loading|error)/);
  });
});

describe("today's plan", () => {
  const sections = web("components/nova/today-sections.tsx");
  const home = web("components/nova/nova-home.tsx");
  it("is the planner's order, the recommendation first, with nothing reordered", () => {
    expect(sections).toContain("const blocks = recommendation ? [recommendation, ...alternatives] : alternatives");
    expect(sections).not.toContain(".sort(");
  });
  it("starts a block the way it always has; on Today the planner's blocks are suggestions to add, never the flow itself", () => {
    expect(sections).toContain("onClick={() => onStart(action)}");
    expect(home).not.toContain("<TodayPlan");
    expect(home).toContain("Its blocks appear in Add to today as suggestions; it never fills your flow by itself.");
  });
  it("says when the day has more blocks than Today carries", () => {
    expect(sections).toContain("const more = blockCount > blocks.length");
  });
});

describe("the task list on Today", () => {
  it("keeps its one link to the board", () => {
    const tasks = web("components/nova/tasks/today-tasks.tsx");
    expect(tasks).toContain('<Link href="/planner?view=board"');
    expect(web("components/nova/today-sections.tsx")).not.toContain("view=board");
  });
});

describe("the knowledge board and what came in last", () => {
  const board = web("components/nova/knowledge-board.tsx");
  const data = web("components/nova/knowledge-board-data.ts");
  it("show the map's levels as Knowledge words them, and no level without a session", () => {
    expect(board).toContain("import { LEVEL_LABEL, LEVEL_TONE } from './knowledge/labels'");
    expect(board).toContain("const level = topic.sessions > 0 && topic.level ? topic.level : null");
    expect(board).not.toContain("masteryPercent");
  });
  it("mark a topic due only when Today listed every due topic", () => {
    expect(data).toContain("const complete = reviewDue.count === reviewDue.topics.length");
  });
  it("order nothing except saved pages by the date they were saved", () => {
    expect(data.match(/\.sort\(/g)).toHaveLength(1);
    expect(data).toContain(".sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))");
    expect(board).not.toContain(".sort(");
  });
  it("say what the map's limits left out, and how much is filed under nothing", () => {
    expect(board).toContain("ready.notShown.notes > 0 || ready.notShown.resources > 0");
    expect(board).toContain("ready.unconnected > 0");
  });
  it("load and fail on their own, apart from Today's plan", () => {
    expect(board).toContain("!ready && map.error");
    expect(board).toContain("noteList === null && notes.error");
    expect(board).toContain("pages === null && map.error");
  });
});

describe("Today's side column", () => {
  const panels = web("components/nova/home-panels.tsx");
  const home = web("components/nova/nova-home.tsx");
  it("draws only the finished weeks from Progress, and a week before the first session as a dash", () => {
    expect(panels).toContain("const weeks = ready.consistency.weeks.filter(w => !w.current)");
    expect(panels).toContain("{week.beforeStart ? '–' : week.activeDays}");
    expect(panels).toContain("if (!ready || !ready.hasEvidence) return null");
  });
  it("keeps this week's numbers from Today, and says when the weeks did not load", () => {
    expect(panels).toContain("if (progress.sessionsThisWeek > 0)");
    expect(panels).toContain("Your last eight weeks didn&apos;t load.");
  });
  it("picks up the last session without listing the notes Recently captured already shows", () => {
    expect(panels).toContain("onClick={() => onResume(last.topicName!)}");
    expect(panels).not.toContain("notes.slice(0, 2)");
    expect(home).not.toMatch(/<ContinueLearning[^>]*notes=/);
  });
  it("keeps each deadline's own kind and the way to change a date", () => {
    expect(panels).toContain("kind: e.kindLabel");
    expect(panels).toContain("href={EXAMS_HREF}");
  });
  it("keeps the planner's constraints a step away; the week, goals, companion and Telegram have their own pages", () => {
    expect(home).toContain("<AccountingFor constraints={view.constraints} />");
    for (const gone of ["<WorkingToward", "<CompanionCard", "<TelegramCard", "<WeekSoFar", "<KnowledgeBoard"]) expect(home).not.toContain(gone);
  });
});

describe("acting from Today without leaving it", () => {
  const tasks   = web("components/nova/tasks/today-tasks.tsx");
  const palette = web("components/nova/workspace/command-palette.tsx");
  const sidebar = web("components/sidebar.tsx");
  it("puts a ticked task back the way it was when the learner undoes it", () => {
    expect(tasks).toContain("setDone({ id: task.id, title: task.title, was: task.status })");
    expect(tasks).toContain("onUpdate(done.id, { status: done.was })");
  });
  it("searches only what the server returned, and creates through the existing task route or the note editor", () => {
    expect(palette).toContain("commandEntries({ pages: NOVA_ROUTES, nodes, tasks })");
    expect(palette).toContain("await onCreateTask(typed)");
    expect(palette).toContain("go(`/notes/new?title=${encodeURIComponent(typed)}`)");
    expect(palette).not.toContain("fetch(");
  });
  it("groups the sidebar without dropping a page", () => {
    expect(sidebar).toContain("const rest = items.filter(i => !NOVA_GROUPS.some(g => g.paths.includes(i.href)))");
  });
});

describe("connected knowledge on the page", () => {
  const board  = web("components/nova/knowledge/subject-board-view.tsx");
  const links  = web("components/nova/knowledge/topic-connections.tsx");
  const record = web("components/nova/topic-record.tsx");
  const focus  = web("components/nova/focus-session.tsx");
  it("says the board is not saved, and saves nothing", () => {
    expect(board).toContain("can&apos;t be moved");
    expect(board).not.toContain("localStorage");
    expect(board).not.toContain("fetch(");
  });
  it("names related topics only from the map's stored edges, each with the note that joins them", () => {
    expect(links).toContain("topicConnections(map, nodeId)");
    expect(links).toContain("RELATION_WORDS[r.relation](r.via.label)");
  });
  it("reads a session's topic record once, never on a timer", () => {
    expect(focus).toContain("useTopicRecord(");
    expect(record).not.toContain("setInterval");
  });
});
