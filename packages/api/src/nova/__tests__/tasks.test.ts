// The learner's to-do list: what a request may carry, the board's order, and
// the boundary that keeps a task from being anything else. No database; the
// real-Postgres proof is nova-tasks.itest.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compareTasks, isDay, parseTaskInput } from "../product/tasks";
import { TASK_STATUSES, TASK_TITLE_MAX, type NovaTaskItem } from "../product/tasks.types";

const read = (file: string) => readFileSync(join(__dirname, "..", file), "utf8");
const api  = (file: string) => readFileSync(join(__dirname, "../../../../../apps/api", file), "utf8");

const task = (over: Partial<NovaTaskItem>): NovaTaskItem => ({
  id: "t", title: "T", status: "todo", priority: null, subjectId: null, subjectName: null, topicName: null,
  dueDay: null, dueInDays: null, completedAt: null, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", ...over,
});

describe("what a task request may carry", () => {
  it("needs a title to create, and tidies it", () => {
    expect(parseTaskInput({}, true)).toMatchObject({ ok: false, error: "title_required" });
    expect(parseTaskInput({ title: "   " }, true)).toMatchObject({ ok: false, error: "title_required" });
    expect(parseTaskInput({ title: "  Finish   OS\n assignment " }, true)).toEqual({ ok: true, changes: { title: "Finish OS assignment" } });
    expect(parseTaskInput({ title: "x".repeat(TASK_TITLE_MAX + 1) }, true)).toMatchObject({ ok: false, error: "title_too_long" });
  });

  it("accepts the three statuses and three priorities, and nothing else", () => {
    for (const status of TASK_STATUSES) expect(parseTaskInput({ status }, false)).toEqual({ ok: true, changes: { status } });
    for (const bad of ["doing", "DONE", "", 1, null]) expect(parseTaskInput({ status: bad }, false)).toMatchObject({ ok: false, error: "unknown_status" });
    expect(parseTaskInput({ priority: "high" }, false)).toEqual({ ok: true, changes: { priority: "high" } });
    expect(parseTaskInput({ priority: null }, false)).toEqual({ ok: true, changes: { priority: null } });
    expect(parseTaskInput({ priority: "urgent" }, false)).toMatchObject({ ok: false, error: "unknown_priority" });
  });

  it("takes a due day as a real calendar day, or none", () => {
    expect(parseTaskInput({ dueDay: "2026-10-31" }, false)).toEqual({ ok: true, changes: { dueDay: "2026-10-31" } });
    expect(parseTaskInput({ dueDay: "" }, false)).toEqual({ ok: true, changes: { dueDay: null } });
    for (const bad of ["2026-02-30", "31-10-2026", "tomorrow", "2026-13-01", 20261031]) {
      expect(parseTaskInput({ dueDay: bad }, false)).toMatchObject({ ok: false, error: "bad_due_day" });
    }
    expect(isDay("2028-02-29")).toBe(true);
    expect(isDay("2027-02-29")).toBe(false);
  });

  it("reads nothing that names a learner, a profile or a time of completion", () => {
    const parsed = parseTaskInput({ title: "A", profileId: "other", userId: "u", id: "x", completedAt: "2020-01-01", createdAt: "2020-01-01" }, true);
    expect(parsed).toEqual({ ok: true, changes: { title: "A" } });
  });

  it("only a create may carry a key", () => {
    expect(parseTaskInput({ title: "A", clientKey: "web:1" }, true)).toEqual({ ok: true, changes: { title: "A", clientKey: "web:1" } });
    expect(parseTaskInput({ clientKey: "web:1" }, false)).toEqual({ ok: true, changes: {} });
  });

  it("refuses what is not an object", () => {
    for (const bad of [null, "task", 3, ["a"]]) expect(parseTaskInput(bad, true)).toMatchObject({ ok: false, error: "invalid" });
  });
});

describe("the order of a column", () => {
  it("puts what is due soonest first, and what has no due day last", () => {
    const list = [task({ id: "none" }), task({ id: "late", dueDay: "2026-10-20" }), task({ id: "soon", dueDay: "2026-10-09" })];
    expect(list.sort(compareTasks).map(t => t.id)).toEqual(["soon", "late", "none"]);
  });

  it("then by priority, then the oldest", () => {
    const list = [
      task({ id: "low", priority: "low" }), task({ id: "unset" }), task({ id: "high", priority: "high" }),
      task({ id: "older", createdAt: "2026-09-01T00:00:00.000Z" }),
    ];
    expect(list.sort(compareTasks).map(t => t.id)).toEqual(["high", "low", "older", "unset"]);
  });

  it("shows the most recently finished first", () => {
    const list = [
      task({ id: "a", status: "done", completedAt: "2026-10-01T10:00:00.000Z" }),
      task({ id: "b", status: "done", completedAt: "2026-10-05T10:00:00.000Z" }),
    ];
    expect(list.sort(compareTasks).map(t => t.id)).toEqual(["b", "a"]);
  });
});

describe("a task is only a task", () => {
  const source = read("product/tasks.ts");

  it("has one owner", () => {
    const others = ["product/today.ts", "product/planner.ts", "product/planning-inputs.ts", "product/progress.ts", "product/session.ts",
      "persistence/nova-persistence.ts", "engines/planning-engine.ts", "telegram/telegram-actions.ts", "nova-orchestrator.ts"];
    for (const file of others) expect([file, read(file).includes("novaTask")]).toEqual([file, false]);
  });

  it("writes no table but its own", () => {
    const writes = [...source.matchAll(/prisma\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g)].map(m => m[1]);
    expect([...new Set(writes)]).toEqual(["novaTask"]);
  });

  it("imports no brain, orchestrator, consolidation or model client", () => {
    const imports = source.split("\n").filter(line => line.startsWith("import ") || line.includes(" from \"")).join("\n");
    for (const forbidden of ["brains/", "nova-orchestrator", "consolidation", "openai", "persistence/", "study-session-engine", "topic-mastery-engine", "planning-engine"]) {
      expect([forbidden, imports.includes(forbidden)]).toEqual([forbidden, false]);
    }
  });

  it("scopes every query to the learner's own profile", () => {
    const queries = source.split("prisma.novaTask.").slice(1).map(q => q.slice(0, q.indexOf("\n") + 200));
    for (const q of queries) expect(q).toMatch(/profileId/);
  });

  it("takes the learner from the session and nothing from the request", () => {
    const access = api("lib/nova/task-access.ts");
    expect(access).toContain("resolveNovaLearner()");
    for (const route of ["app/api/nova/tasks/route.ts", "app/api/nova/tasks/[id]/route.ts"]) {
      const code = api(route);
      expect(code).toContain("requireTaskLearner()");
      expect(code).not.toMatch(/searchParams|profileId:\s*body|userId/);
    }
  });
});
