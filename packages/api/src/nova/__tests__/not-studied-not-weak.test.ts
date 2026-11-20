// K-12: a topic with no study behind it is "not studied yet", never "weak".
import { buildExamContext } from "../engines/exam-engine";
import { masteryLevel } from "../engines/knowledge-engine";
import type { TopicMasteryState } from "../types/engine.types";

const topic = (name: string, mastery: number, reviews: number): TopicMasteryState => ({
  topicId: name, topicName: name, subjectName: "OS", masteryProbability: mastery, lastStudied: reviews ? new Date("2026-11-10T10:00:00Z") : null,
  retentionEstimate: mastery, confidenceReported: 0, calibrationGap: 0, reviewDueAt: null, masteryTrend: "stable", reviewCount: reviews,
});
const exam = { id: "e1", title: "OS midterm", subjectName: "OS", scheduledAt: new Date("2026-11-30T12:00:00Z"), examType: "exam" };
const NOW = new Date("2026-11-21T12:00:00Z");

describe("not studied is not weak (K-12)", () => {
  test("never-studied topics are their own group; only studied low topics are weak", () => {
    const c = buildExamContext(exam, [topic("Paging", 0, 0), topic("Deadlock", 0.2, 3), topic("Scheduling", 0.5, 2), topic("Threads", 0.9, 5)], NOW);
    expect(c.riskMatrix.unstudied).toEqual(["Paging"]);
    expect(c.riskMatrix.critical).toEqual(["Deadlock"]);
    expect(c.riskMatrix.risky).toEqual(["Scheduling"]);
    expect(c.riskMatrix.safe).toEqual(["Threads"]);
  });
  test("a starting estimate with no study is not called developing or solid either", () => {
    const c = buildExamContext(exam, [topic("Paging", 0.8, 0)], NOW);
    expect(c.riskMatrix.unstudied).toEqual(["Paging"]);
    expect(c.riskMatrix.safe).toEqual([]);
  });
  test("where to start is unchanged: a low topic, studied or not", () => {
    expect(buildExamContext(exam, [topic("Paging", 0, 0), topic("Threads", 0.9, 5)], NOW).primaryFocus).toBe("Paging");
  });
  test("the Knowledge Engine says the same: no study, no level", () => {
    expect(masteryLevel({ masteryProbability: 0, reviewCount: 0 })).toBe("unverified");
    expect(masteryLevel({ masteryProbability: 0.2, reviewCount: 2 })).toBe("weak");
  });
});
