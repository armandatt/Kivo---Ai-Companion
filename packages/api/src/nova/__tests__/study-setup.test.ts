// The canonical study setup: what a draft may contain, what stays unknown,
// and that every way in ends at the one writer. No model and no database;
// the saving itself is proven against Postgres in nova-setup.itest.ts.

// The model client cannot load under jest; nothing here calls it.
jest.mock("../../services/openai.service", () => ({ generateOpenAIText: jest.fn() }));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSetupStatement } from "../brains/understanding-parser";
import { statedDailyMinutes, ASSUMED_DAILY_HOURS } from "../engines/study-snapshot";
import { nextSetupQuestion, setupGaps } from "../interaction/initialization";
import { setupAsk, SETUP_INTRO } from "../interaction/setup-turn";
import { normalizeSetupDraft, MAX_SUBJECTS, MAX_TOPICS_IN_DRAFT } from "../product/setup";
import { setupSavedText } from "../telegram/telegram-replies";

const TODAY = "2026-10-08";
const read = (file: string) => readFileSync(join(__dirname, "..", file), "utf8");

describe("a setup draft", () => {
  it("is tidied, with repeats folded together", () => {
    const { draft, issues } = normalizeSetupDraft({
      subjects: [
        { name: "  Operating   Systems ", topics: ["Deadlocks", "deadlocks", " Paging ", "", "Operating Systems"] },
        { name: "operating systems", topics: ["Scheduling", "Paging"] },
        { name: "Databases", topics: [] },
      ],
      exams: [{ subjectName: "Databases", date: "2026-11-02" }, { subjectName: "databases", date: "2026-11-02" }],
      dailyMinutes: 120, studyTime: "night",
    }, TODAY);
    expect(issues).toEqual([]);
    expect(draft.subjects).toEqual([{ name: "Operating Systems", topics: ["Deadlocks", "Paging", "Scheduling"] }, { name: "Databases", topics: [] }]);
    expect(draft.exams).toEqual([{ subjectName: "Databases", date: "2026-11-02", title: null }]);
    expect([draft.dailyMinutes, draft.studyTime]).toEqual([120, "night"]);
  });

  it("keeps what the learner did not say as unknown, never as a default", () => {
    for (const raw of [{}, { dailyMinutes: null, studyTime: null }, { dailyMinutes: "", studyTime: "" }, { subjects: [{ name: "OS", topics: ["A1"] }] }]) {
      const { draft, issues } = normalizeSetupDraft(raw, TODAY);
      expect([draft.dailyMinutes, draft.studyTime, issues]).toEqual([null, null, []]);
    }
  });

  it("reports what it cannot use and does not turn it into something else", () => {
    const { draft, issues } = normalizeSetupDraft({
      subjects: [{ name: "", topics: ["Orphan"] }],
      exams: [
        { subjectName: "OS", date: "2026-10-01" }, { subjectName: "OS", date: "not a date" },
        { subjectName: "", date: "2026-11-01" }, { subjectName: "OS", date: "2028-01-01" },
      ],
      dailyMinutes: 5, studyTime: "dawn",
    }, TODAY);
    expect(draft).toEqual({ subjects: [], exams: [], dailyMinutes: null, studyTime: null });
    expect(issues.map(i => i.field)).toEqual(["subjects", "exams", "exams", "exams", "exams", "dailyMinutes", "studyTime"]);
  });

  it("is bounded", () => {
    const many = normalizeSetupDraft({ subjects: Array.from({ length: 30 }, (_, i) => ({ name: `Subject ${i}`, topics: [] })) }, TODAY);
    expect(many.draft.subjects).toHaveLength(MAX_SUBJECTS);
    const long = normalizeSetupDraft({ subjects: [{ name: "OS", topics: Array.from({ length: 90 }, (_, i) => `Topic ${i}`) }] }, TODAY);
    expect(long.draft.subjects[0]!.topics).toHaveLength(MAX_TOPICS_IN_DRAFT);
    expect(long.issues).toHaveLength(1);
  });

  it("ignores anything that is not the shape of a draft", () => {
    for (const raw of [null, "OS", 7, [], { subjects: "OS", exams: {} }]) {
      expect(normalizeSetupDraft(raw, TODAY)).toEqual({ draft: { subjects: [], exams: [], dailyMinutes: null, studyTime: null }, issues: [] });
    }
  });
});

describe("daily study time that was never stated is unknown", () => {
  it("reads the stated column, and an older profile's hours only when they are not the default", () => {
    expect(statedDailyMinutes({ dailyStudyMinutes: 90, preferredStudyHoursPerDay: 3 })).toBe(90);
    expect(statedDailyMinutes({ dailyStudyMinutes: null, preferredStudyHoursPerDay: 3 })).toBeNull();
    expect(statedDailyMinutes({ dailyStudyMinutes: null, preferredStudyHoursPerDay: 2 })).toBe(120);
    expect(ASSUMED_DAILY_HOURS).toBe(3);
  });
  it("is a gap Nova can ask about, after the things that block a plan", () => {
    const facts = { subjects: [{ name: "OS", topicCount: 2 }], upcomingExams: 1, studyTime: "night", dailyMinutes: null };
    expect(setupGaps(facts)).toEqual(["daily_minutes"]);
    expect(nextSetupQuestion(facts)!.question).toBe("How long do you usually have to study on a normal day?");
    expect(setupGaps({ ...facts, dailyMinutes: 60 })).toEqual([]);
  });
  it("the plan says when it assumed a figure", () => {
    expect(read("product/planning-inputs.ts")).toContain("snapshot.dailyMinutesStated === null && availableMinutes === null");
  });
});

describe("setup from a sentence", () => {
  it("can name the subjects of the term", () => {
    expect(parseSetupStatement({ subjects: ["OS", "os", "DBMS", 4, ""], topics: [] })).toEqual({ subjects: ["OS", "DBMS"], subject: null, topics: [], dailyMinutes: null, studyTime: null });
    expect(parseSetupStatement({ subjects: [], topics: [] })).toBeNull();
  });
  it("is asked for one thing at a time, with the page offered as the other way in", () => {
    const empty = setupAsk(null, SETUP_INTRO);
    expect(empty.text).toBe("I'm Nova. Before I can plan anything I need to know what you're studying. Which subjects are you taking this term?");
    expect(empty.link).toEqual({ label: "Set it up on the web", path: "/home" });
    expect(empty.text).not.toMatch(/year|goal|\/\w+/i);
  });
  it("says what was saved, and nothing it did not save", () => {
    expect(setupSavedText({ subjectName: "OS", addedSubjects: ["OS", "Maths"], added: ["Paging"], existing: [], dailyMinutes: null, studyTime: null }))
      .toBe("Added subject: Maths. Added to OS: Paging.");
    expect(setupSavedText({ subjectName: null, addedSubjects: [], added: [], existing: [], dailyMinutes: null, studyTime: null })).toBe("That was already on record.");
  });
});

describe("one setup, however it is reached", () => {
  it("the page, the web chat and Telegram all save through product/setup.ts", () => {
    expect(read("../../../../apps/api/app/api/nova/setup/route.ts")).toMatch(/previewSetup\(learner\.platformChatId, body\.draft\)[\s\S]*saveSetup\(learner\.platformChatId, body\.draft\)/);
    expect(read("telegram/telegram-actions.ts")).toContain("applySetup(ctx.chatId, action)");
    const setup = read("product/setup.ts");
    expect(setup.match(/novaSubject\.create/g)).toHaveLength(1);
    expect(setup).toContain("declareTopics(tx, subject.id, s.topics)");
    expect(setup).toContain("await addExam(platformChatId");
    // No other file creates a subject or sets the stated daily minutes.
    for (const file of ["interaction/setup-turn.ts", "interaction/web-sentence.ts", "telegram/telegram-turn.ts", "telegram/telegram-actions.ts", "entry.ts"]) {
      expect(read(file)).not.toMatch(/novaSubject\.|dailyStudyMinutes|novaAcademicProfile\.(update|create|upsert)/);
    }
  });
  it("the route saves only on confirm, and takes no learner id from the request", () => {
    const route = read("../../../../apps/api/app/api/nova/setup/route.ts");
    expect(route).toContain("if (body.confirm !== true) {");
    expect(route).not.toMatch(/body\.(userId|profileId|learnerId|platformChatId|chatId)|searchParams/);
  });
  it("a learner who has not finished setup is no longer put through the year-and-goals conversation", () => {
    for (const file of ["entry.ts", "telegram/telegram-turn.ts", "interaction/setup-turn.ts", "interaction/web-sentence.ts"]) {
      expect(read(file)).not.toMatch(/runNovaOnboarding|nova-onboarding/);
    }
    expect(read("interaction/setup-turn.ts")).not.toMatch(/runNovaOrchestrator|runResponseBrain/);
  });
  it("the setup page shows a review and saves what was reviewed", () => {
    const form = read("../../../../apps/web/components/nova/setup-form.tsx");
    expect(form).toContain("body: JSON.stringify({ draft: review?.draft ?? draft(), confirm })");
    expect(form).toContain("Nothing is saved until you confirm.");
    expect(form).toContain("{ label: 'Not sure', minutes: null }");
    expect(form).not.toMatch(/localStorage|userId|profileId/);
  });
});
