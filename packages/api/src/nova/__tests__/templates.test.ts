// The starting templates: what they are allowed to contain, and that
// applying one goes through the ordinary writers. No database.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeSetupDraft } from "../product/setup";
import { parseTaskInput } from "../product/tasks";
import { TASK_KEY_MAX } from "../product/tasks.types";
import { STUDY_TEMPLATES, templateById, templateTaskKey } from "../product/templates";

const web = (file: string) => readFileSync(join(__dirname, "../../../../../apps/web", file), "utf8");

describe("the templates", () => {
  it("are the three starting points, and none is about fitness", () => {
    expect(STUDY_TEMPLATES.map(t => t.id)).toEqual(["engineering-semester", "exam-preparation", "skill-building"]);
    const text = JSON.stringify(STUDY_TEMPLATES).toLowerCase();
    for (const word of ["gym", "workout", "fitness", "bodybuilding", "calorie"]) expect(text).not.toContain(word);
  });

  it("say what they add before they are chosen", () => {
    for (const t of STUDY_TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(3);
      expect(t.description.length).toBeGreaterThan(40);
      expect(t.creates.length).toBeGreaterThan(0);
    }
  });

  it("stay small", () => {
    for (const t of STUDY_TEMPLATES) {
      expect(t.subjects.length).toBeLessThanOrEqual(6);
      expect(t.tasks.length).toBeLessThanOrEqual(6);
      for (const s of t.subjects) expect(s.topics.length).toBeLessThanOrEqual(8);
    }
  });

  it("list no subject, topic or task twice", () => {
    for (const t of STUDY_TEMPLATES) {
      const names = t.subjects.map(s => s.name.toLowerCase()).filter(Boolean);
      expect(new Set(names).size).toBe(names.length);
      for (const s of t.subjects) expect(new Set(s.topics.map(x => x.toLowerCase())).size).toBe(s.topics.length);
      expect(new Set(t.tasks.map(x => x.key)).size).toBe(t.tasks.length);
    }
  });

  it("ask the learner for a name where the subject is theirs to name", () => {
    for (const t of STUDY_TEMPLATES) {
      const unnamed = t.subjects.some(s => s.name === "");
      expect([t.id, Boolean(t.namePrompt)]).toEqual([t.id, unnamed]);
    }
  });

  it("state no progress: no status, no mastery, no session, no date", () => {
    const text = JSON.stringify(STUDY_TEMPLATES);
    for (const field of ["status", "mastery", "completed", "done", "session", "dueDay", "reviewCount"]) expect(text).not.toContain(`"${field}"`);
  });

  it("can be found by id", () => {
    expect(templateById("exam-preparation")?.asksExamDate).toBe(true);
    expect(templateById("nope")).toBeNull();
  });
});

describe("applying one goes through the ordinary writers", () => {
  it("is a setup draft the setup writer accepts", () => {
    for (const t of STUDY_TEMPLATES) {
      const draft = {
        subjects: t.subjects.map(s => ({ name: s.name || "My subject", topics: s.topics })),
        exams: [], dailyMinutes: null, studyTime: null,
      };
      const result = normalizeSetupDraft(draft, "2026-10-09");
      expect([t.id, result.issues]).toEqual([t.id, []]);
    }
  });

  it("makes tasks the task writer accepts, each under a key of its own", () => {
    const keys = new Set<string>();
    for (const t of STUDY_TEMPLATES) {
      for (const task of t.tasks) {
        const key = templateTaskKey(t.id, task.key);
        expect(key.length).toBeLessThanOrEqual(TASK_KEY_MAX);
        expect(keys.has(key)).toBe(false);
        keys.add(key);
        const parsed = parseTaskInput({ title: task.title, priority: task.priority ?? null, clientKey: key }, true);
        expect(parsed).toMatchObject({ ok: true, changes: { title: task.title, clientKey: key } });
      }
    }
    // The same template again gives the same keys: nothing is made twice.
    expect(templateTaskKey("exam-preparation", "topics")).toBe(templateTaskKey("exam-preparation", "topics"));
  });

  it("is applied by the setup form through /api/nova/setup and /api/nova/tasks, after a review", () => {
    const form = web("components/nova/setup-form.tsx");
    expect(form).toContain("fetch('/api/nova/setup'");
    expect(form).toContain("clientKey: templateTaskKey(template.id, task.key)");
    // Tasks are created only once the confirmed setup has been saved.
    const saved = form.indexOf("if (confirm && data.ok && data.saved) {");
    const tasks = form.indexOf("if (template) await createTemplateTasks(template)");
    expect(saved).toBeGreaterThan(0);
    expect(tasks).toBeGreaterThan(saved);
    // Choosing one only fills the form.
    expect(form).toContain("It never removes or");
  });
});
