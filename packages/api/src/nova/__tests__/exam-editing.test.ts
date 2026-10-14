// Moving, renaming and removing an exam. The rule for what a change may be is
// pure and is run here. That only the learner's own exam is ever reached, and
// that a moved or removed exam leaves no stale countdown, are read from the
// source and from the proactive decision; the writes themselves need a real
// database (nova-exams.itest.ts).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkExamChange, examInstant, EXAM_HORIZON_DAYS } from "../product/exams";
import { EXAM_TITLE_MAX, EXAMS_HREF } from "../product/exams.types";
import { generateCandidates, type ProactiveFacts } from "../decision/proactive-decision";

const NOW   = new Date("2026-10-13T08:00:00.000Z");
const TODAY = "2026-10-13";

type Exam = { title: string; date: string; subjectId: string | null };
const OS: Exam       = { title: "Operating Systems exam", date: "2026-10-20", subjectId: "s-os" };
const DBMS: Exam     = { title: "DBMS exam",              date: "2026-10-22", subjectId: "s-db" };
const NAMELESS: Exam = { title: "Entrance test",          date: "2026-11-02", subjectId: null };

const change = (input: unknown, current: Exam = OS, others: Exam[] = [DBMS, NAMELESS]) => checkExamChange(current, others, input, TODAY, NOW);

describe("what a change to an exam may be", () => {
  it("moves the date and keeps the name when only a date is given", () => {
    expect(change({ date: "2026-10-27" })).toEqual({ ok: true, changed: true, change: { title: OS.title, date: "2026-10-27" } });
  });

  it("renames and keeps the date when only a name is given", () => {
    expect(change({ title: "  OS midterm  " })).toEqual({ ok: true, changed: true, change: { title: "OS midterm", date: OS.date } });
  });

  it("a move of one day is not a duplicate of itself", () => {
    expect(change({ date: "2026-10-21" })).toMatchObject({ ok: true, changed: true });
    expect(change({ date: "2026-10-19" })).toMatchObject({ ok: true, changed: true });
  });

  it("saying what is already on record changes nothing, and is not an error", () => {
    expect(change({ title: OS.title, date: OS.date })).toEqual({ ok: true, changed: false, change: { title: OS.title, date: OS.date } });
    expect(change({})).toMatchObject({ ok: true, changed: false });
  });

  it("an exam whose date has passed can still be renamed, since its date is not being set", () => {
    const past = { ...OS, date: "2026-10-01" };
    expect(change({ title: "OS midterm" }, past)).toMatchObject({ ok: true, changed: true });
    expect(change({ date: "2026-10-02" }, past)).toEqual({ ok: false, reason: "in_the_past" });
  });

  it("refuses a date that has passed, is unreadable, or is more than a year away", () => {
    expect(change({ date: "2026-10-12" })).toEqual({ ok: false, reason: "in_the_past" });
    expect(change({ date: TODAY })).toMatchObject({ ok: true });
    for (const date of ["", "next friday", "2026-13-40", "20-10-2026", "2026-10-20T10:00:00Z"]) {
      expect(change({ date })).toEqual({ ok: false, reason: "bad_date" });
    }
    const far = new Date(NOW.getTime() + (EXAM_HORIZON_DAYS + 2) * 86_400_000).toISOString().slice(0, 10);
    expect(change({ date: far })).toEqual({ ok: false, reason: "too_far" });
  });

  it("refuses a second exam for the same subject on the same day, and only that", () => {
    const second = { title: "OS lab exam", date: "2026-10-25", subjectId: "s-os" };
    expect(change({ date: "2026-10-25" }, OS, [DBMS, second])).toEqual({ ok: false, reason: "duplicate" });
    // Another subject's exam that day is a different exam.
    expect(change({ date: DBMS.date })).toMatchObject({ ok: true });
    // With no subject the name stands in for it.
    expect(change({ date: NAMELESS.date }, { title: "entrance TEST", date: "2026-11-09", subjectId: null })).toEqual({ ok: false, reason: "duplicate" });
    expect(change({ date: NAMELESS.date }, { title: "Scholarship test", date: "2026-11-09", subjectId: null })).toMatchObject({ ok: true });
  });

  it("refuses an empty name, an over-long one, and anything that is not a change", () => {
    expect(change({ title: "   " })).toEqual({ ok: false, reason: "no_title" });
    expect(change({ title: "x".repeat(EXAM_TITLE_MAX + 1) })).toEqual({ ok: false, reason: "invalid" });
    expect(change({ title: "x".repeat(EXAM_TITLE_MAX) })).toMatchObject({ ok: true });
    for (const input of [null, undefined, "2026-10-27", 7, [], [{ date: "2026-10-27" }], { date: 20261027 }, { title: ["a"] }]) {
      expect(change(input)).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("reads nothing but the name and the date: an id or a subject in the body is ignored", () => {
    expect(change({ date: "2026-10-27", id: "someone-elses", profileId: "p2", subjectId: "s-db", examType: "final" }))
      .toEqual({ ok: true, changed: true, change: { title: OS.title, date: "2026-10-27" } });
  });

  it("stores the day the learner gave", () => {
    expect(examInstant("2026-10-27").toISOString()).toBe("2026-10-27T12:00:00.000Z");
  });
});

// ── No stale countdown ────────────────────────────────────────────────────────
// The proactive tick builds its facts from the exams on record at that tick.
// These show what the decision does once the record has changed.

describe("a moved or removed exam leaves no stale countdown", () => {
  const facts = (exams: ProactiveFacts["exams"]): ProactiveFacts => ({
    localDay: TODAY, localHour: 10, window: { from: 17, to: 20, basis: "default" },
    studiedToday: true, daysSinceLastSession: 0, lastSessionDay: TODAY,
    exams, reviewDueCount: 0, hasPlan: true,
  });
  const countdown = (f: ProactiveFacts) => generateCandidates(f).find(c => c.type === "exam_countdown");

  it("an exam two days away is a reason to speak", () => {
    expect(countdown(facts([{ id: "e1", title: "OS exam", daysUntil: 2 }]))).toMatchObject({ occurrenceKey: `exam:e1:${TODAY}`, examId: "e1" });
  });

  it("removed, it is no reason at all, so a claim waiting on it finds no candidate and is dropped", () => {
    const after = generateCandidates(facts([]));
    expect(after.find(c => c.occurrenceKey === `exam:e1:${TODAY}`)).toBeUndefined();
    expect(after).toEqual([]);
  });

  it("moved three weeks out, it stops counting down", () => {
    expect(countdown(facts([{ id: "e1", title: "OS exam", daysUntil: 23 }]))).toBeUndefined();
  });

  it("moved nearer, it counts down from the new date and names it", () => {
    expect(countdown(facts([{ id: "e1", title: "OS exam", daysUntil: 1 }]))!.reason).toBe("OS exam is tomorrow");
  });

  it("the tick drops an unworded claim whose reason has gone", () => {
    const cron = readFileSync(join(__dirname, "..", "proactive/nova-proactive-cron.ts"), "utf8");
    const recover = cron.slice(cron.indexOf("const pending = await recoverPending"), cron.indexOf("const decision = decideProactive"));
    expect(recover).toContain("generateCandidates(facts).find(c => c.occurrenceKey === waiting.occurrenceKey)");
    expect(recover).toContain("await dropUnworded(waiting.id)");
  });
});

// ── Ownership and the one writer, read from source ────────────────────────────

describe("an exam is reached only as the learner's own", () => {
  const nova = join(__dirname, "..");
  const repo = join(nova, "..", "..", "..", "..");
  const exams = readFileSync(join(nova, "product/exams.ts"), "utf8");

  it("every exam query in the owner file carries the learner's profile", () => {
    const calls = exams.split("prisma.novaExam.").slice(1).map(c => c.slice(0, c.indexOf(");")));
    expect(calls.length).toBeGreaterThanOrEqual(6);
    for (const call of calls) {
      if (call.startsWith("create(")) expect(call).toContain("profileId: profile.id");
      else expect(call).toContain("profileId: profile.id");
    }
  });

  it("a change and a removal are guarded writes on (id, profile), so a repeat writes nothing", () => {
    expect(exams).toContain("prisma.novaExam.updateMany({\n      where: { id: examId, profileId: profile.id },");
    expect(exams).toContain("prisma.novaExam.deleteMany({ where: { id: examId, profileId: profile.id } })");
    expect(exams).not.toContain("novaExam.update(");
    expect(exams).not.toContain("novaExam.delete(");
  });

  it("nothing else in Nova or the API changes or removes an exam", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".next" || name === "__tests__" || name === "__integration__") continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name.endsWith(".ts") || name.endsWith(".tsx")) files.push(path);
      }
    };
    walk(nova);
    walk(join(repo, "apps/api/app"));
    walk(join(repo, "apps/api/lib"));
    const touching = files.filter(f => ["novaExam.update", "novaExam.delete", "novaExam.upsert"].some(w => readFileSync(f, "utf8").includes(w)));
    expect(touching.map(f => f.slice(nova.length + 1))).toEqual(["product/exams.ts"]);
  });

  it("the routes take the learner from the session and the exam from the path, and nothing from the body but name and date", () => {
    const one  = readFileSync(join(repo, "apps/api/app/api/nova/exams/[id]/route.ts"), "utf8");
    const list = readFileSync(join(repo, "apps/api/app/api/nova/exams/route.ts"), "utf8");
    for (const route of [one, list]) {
      expect(route).toContain("await resolveNovaLearner()");
      expect(route).not.toContain("searchParams");
    }
    expect(one).toContain("updateExam(access.platformChatId, (await params).id, read.body)");
    expect(one).toContain("removeExam(access.platformChatId, (await params).id)");
    expect(one).toContain("readSmallJson(req, EXAM_BODY_MAX_BYTES)");
  });

  it("pages that show an exam link to where it can be changed", () => {
    expect(EXAMS_HREF).toBe("/settings/study#exams");
    expect(readFileSync(join(repo, "apps/web/components/nova/exams-editor.tsx"), "utf8")).toContain('<section id="exams"');
    expect(readFileSync(join(repo, "apps/web/components/nova/home-panels.tsx"), "utf8")).toContain("href={EXAMS_HREF}");
  });
});
