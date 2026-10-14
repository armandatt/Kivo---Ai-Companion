// What is shown beside a topic (the learner's own tasks, saved pages, the
// subject's exam, their last session note), and the note itself. The rules
// are pure and run here; who may write what is read from source. The writes
// need a real database and have no test here.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildFocusContext, parseReflection, readReflection, FOCUS_RESOURCES_SHOWN, FOCUS_TASKS_SHOWN } from "../product/focus-context";
import { REFLECTION_FIELD_MAX } from "../product/focus-context.types";
import type { NovaTaskItem } from "../product/tasks.types";

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");
const repo = (path: string) => readFileSync(join(__dirname, "../../../../..", path), "utf8");

const OS = { id: "s-os", name: "Operating Systems" };
let n = 0;
const task = (over: Partial<NovaTaskItem>): NovaTaskItem => ({
  id: `t${++n}`, title: "Task", status: "todo", priority: null, subjectId: OS.id, subjectName: OS.name, topicName: "Deadlocks",
  dueDay: null, dueInDays: null, completedAt: null, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", ...over,
});
const page = (over: Partial<{ id: string; title: string; url: string; domain: string; subjectId: string | null; topicName: string | null }>) => ({
  id: `r${++n}`, title: "A page", url: "https://example.com/a", domain: "example.com", subjectId: OS.id, topicName: "Deadlocks", ...over,
});
const build = (over: Partial<Parameters<typeof buildFocusContext>[0]> = {}) =>
  buildFocusContext({ subject: OS, topicName: "Deadlocks", tasks: [], resources: [], exams: [], lastNote: null, ...over });

describe("what is shown beside a topic", () => {
  it("is the learner's open tasks filed under that topic, then under the subject alone", () => {
    const view = build({ tasks: [
      task({ title: "Subject-wide", topicName: null }),
      task({ title: "On topic", topicName: "  deadlocks " }),
      task({ title: "Other topic", topicName: "Paging" }),
      task({ title: "Other subject", subjectId: "s-db" }),
      task({ title: "No subject", subjectId: null, topicName: "Deadlocks" }),
      task({ title: "Finished", status: "done" }),
    ] });
    expect(view.tasks.map(t => [t.title, t.onTopic])).toEqual([["On topic", true], ["Subject-wide", false]]);
  });

  it("is the pages saved under that topic, then under the subject alone, and no others", () => {
    const view = build({ resources: [
      page({ title: "Subject-wide", topicName: null }),
      page({ title: "On topic", topicName: "DEADLOCKS" }),
      page({ title: "Other topic", topicName: "Paging" }),
      page({ title: "Unfiled", subjectId: null, topicName: null }),
    ] });
    expect(view.resources.map(r => [r.title, r.onTopic])).toEqual([["On topic", true], ["Subject-wide", false]]);
  });

  it("is short", () => {
    const view = build({
      tasks:     Array.from({ length: 12 }, (_, i) => task({ title: `T${i}` })),
      resources: Array.from({ length: 12 }, (_, i) => page({ title: `P${i}` })),
    });
    expect(view.tasks).toHaveLength(FOCUS_TASKS_SHOWN);
    expect(view.resources).toHaveLength(FOCUS_RESOURCES_SHOWN);
  });

  it("names the subject's nearest exam, and no other subject's", () => {
    const view = build({ exams: [
      { title: "DBMS exam", subjectName: "DBMS", daysUntil: 2 },
      { title: "OS final", subjectName: "Operating Systems", daysUntil: 30 },
      { title: "OS midterm", subjectName: "operating systems", daysUntil: 9 },
    ] });
    expect(view.deadline).toEqual({ title: "OS midterm", daysUntil: 9 });
    expect(build().deadline).toBeNull();
  });

  it("with no subject there is nothing to file under, so nothing is shown", () => {
    const view = build({ subject: null, tasks: [task({})], resources: [page({})], exams: [{ title: "OS midterm", subjectName: "Operating Systems", daysUntil: 9 }] });
    expect(view).toMatchObject({ subjectName: null, tasks: [], resources: [], deadline: null, lastNote: null });
  });

  it("shows their last note on the topic as they wrote it", () => {
    const text = JSON.stringify({ did: "Two examples", blocked: "", next: "Practice set" });
    const view = build({ lastNote: { text, date: new Date("2026-10-10T09:00:00.000Z") } });
    expect(view.lastNote).toEqual({ did: "Two examples", blocked: "", next: "Practice set", date: "2026-10-10T09:00:00.000Z" });
    for (const stored of [null, "", "not json", "[]", "{}", JSON.stringify({ did: 4 })]) {
      expect(build({ lastNote: { text: stored, date: new Date() } }).lastNote).toBeNull();
    }
  });
});

describe("the note after a session", () => {
  it("is up to three short answers, kept as written", () => {
    expect(parseReflection({ did: "  Read ch. 3 ", blocked: "", next: "Problems 1-5", sessionId: "s1", outcome: "crushed_it" }))
      .toEqual({ ok: true, reflection: { did: "Read ch. 3", blocked: "", next: "Problems 1-5" } });
    expect(parseReflection({ next: "One more pass" })).toEqual({ ok: true, reflection: { did: "", blocked: "", next: "One more pass" } });
  });

  it("with nothing written there is nothing to keep", () => {
    expect(parseReflection({})).toEqual({ ok: false, reason: "empty" });
    expect(parseReflection({ did: "  ", blocked: "", next: "\n" })).toEqual({ ok: false, reason: "empty" });
  });

  it("refuses an answer that is too long or not text, whole: nothing is cut to fit", () => {
    expect(parseReflection({ did: "x".repeat(REFLECTION_FIELD_MAX + 1) })).toEqual({ ok: false, reason: "invalid" });
    expect(parseReflection({ did: "x".repeat(REFLECTION_FIELD_MAX) })).toMatchObject({ ok: true });
    for (const raw of [null, "note", 3, [], { did: 5 }, { next: ["a"] }, { blocked: { a: 1 } }]) expect(parseReflection(raw)).toEqual({ ok: false, reason: "invalid" });
  });

  it("reads back what was stored", () => {
    const reflection = { did: "A", blocked: "B", next: "C" };
    expect(readReflection(JSON.stringify(reflection))).toEqual(reflection);
  });
});

describe("a note and a shown record are never evidence (read from source)", () => {
  const persistence = read("persistence/nova-persistence.ts");
  const note = persistence.slice(persistence.indexOf("export async function saveSessionNote"), persistence.indexOf("export async function latestSessionNote"));

  it("the note is written once, to the learner's own finished session, by a guarded write", () => {
    expect(note).toContain('where: { id: sessionId, profileId, status: "completed", reflectionText: null },');
    expect(note).toContain("data:  { reflectionText: text },");
    expect(note.split("prisma.").length - 1).toBe(2);
  });

  it("saving it touches nothing else: no mastery, review, report, Learning DNA or consolidation", () => {
    for (const word of ["updateTopicMastery", "masteryProbability", "nextReviewAt", "executionReport", "refreshLearningDna", "consolidat", "performanceScore", "durationMinutes"]) {
      expect([word, note.includes(word)]).toEqual([word, false]);
    }
    const session = read("product/session.ts");
    const save = session.slice(session.indexOf("export async function saveReflection"));
    for (const word of ["persistSessionEnd", "openStudySession", "updateTopicMastery", "outcome"]) expect([word, save.includes(word)]).toEqual([word, false]);
  });

  it("no engine, brain or context builder reads a note", () => {
    for (const file of [
      "engines/topic-mastery-engine.ts", "engines/retention-engine.ts", "engines/planning-engine.ts", "engines/learning-dna-engine.ts",
      "engines/knowledge-engine.ts", "persistence/learning-dna-store.ts", "context/context-builder.ts", "product/progress.ts",
      "product/planning-inputs.ts", "consolidation/consolidator.ts",
    ]) {
      const source = read(file);
      expect([file, source.includes("latestSessionNote") || source.includes("readReflection")]).toEqual([file, false]);
    }
  });

  it("the context reads tasks, pages and exams only through their owners, and writes nothing", () => {
    const focus = read("product/focus-context.ts");
    for (const call of ["listTasks(profile.id", "listResourceLinks(profile.id", "listExams(platformChatId", "latestSessionNote(profile.id"]) expect([call, focus.includes(call)]).toEqual([call, true]);
    for (const table of ["prisma.novaTask", "prisma.novaLearningEvent", "prisma.novaExam", "prisma.novaTopicMastery"]) expect([table, focus.includes(table)]).toEqual([table, false]);
  });

  it("the routes take the learner from the session, and the note route reads the body through the size limit", () => {
    const context = repo("apps/api/app/api/nova/focus-context/route.ts");
    const reflect = repo("apps/api/app/api/nova/session/reflection/route.ts");
    for (const route of [context, reflect]) expect(route).toContain("await resolveNovaLearner()");
    expect(reflect).toContain("readSmallJson(req, REFLECTION_BODY_MAX_BYTES)");
    expect(reflect).toContain("saveReflection(learner.platformChatId, body.sessionId, body)");
  });

  it("a task starts a session only when it names a subject and a topic, and ticking it is still only a task", () => {
    const list = repo("apps/web/components/nova/tasks/today-tasks.tsx");
    expect(list).toContain("{onStart && task.subjectName && task.topicName && (");
    const tasks = read("product/tasks.ts");
    for (const word of ["openStudySession", "updateTopicMastery", "novaStudySession"]) expect([word, tasks.includes(word)]).toEqual([word, false]);
  });

  it("the page says a saved page is not study, and that the note changes nothing on record", () => {
    expect(repo("apps/web/components/nova/focus-context.tsx")).toContain("Opening a page is not counted as study.");
    expect(repo("apps/web/components/nova/session-note.tsx")).toContain("It doesn&apos;t change what Nova has on record for this topic.");
  });
});
