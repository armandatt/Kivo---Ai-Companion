// ─── What Nova still needs to know to plan ────────────────────────────────────
// The minimum a study plan rests on: the subjects this term, what each one
// covers, when the exams are, and when the learner usually studies. Pure: no
// DB, no LLM.
//
// It answers one question: of those, what is not on record, and which single
// thing is worth asking for next? Nothing already on record is ever asked for
// again, and nothing is reported as known that is not there.
//
// Everything else about a learner (what is weak, what works, how long they
// last) is learned from sessions, not asked.

export interface SetupFacts {
  subjects:      Array<{ name: string; topicCount: number }>;
  upcomingExams: number;
  studyTime:     string | null;   // when they usually study
}

export type SetupGap = "subjects" | "topics" | "exams" | "study_time";

// Most blocking first: without subjects there is nothing to file a topic
// under, and without topics there is nothing to plan.
export function setupGaps(facts: SetupFacts): SetupGap[] {
  const gaps: SetupGap[] = [];
  if (facts.subjects.length === 0) return ["subjects"];
  if (facts.subjects.some(s => s.topicCount === 0)) gaps.push("topics");
  if (facts.upcomingExams === 0) gaps.push("exams");
  if (!facts.studyTime) gaps.push("study_time");
  return gaps;
}

// Whether a plan can be made at all. Exams and the usual hour sharpen a plan;
// they do not block one.
export const canPlan = (facts: SetupFacts): boolean => facts.subjects.some(s => s.topicCount > 0);

export interface SetupQuestion {
  gap:      SetupGap;
  question: string;
}

// The one thing to ask for next. null: nothing is missing.
export function nextSetupQuestion(facts: SetupFacts): SetupQuestion | null {
  const gap = setupGaps(facts)[0];
  if (!gap) return null;
  switch (gap) {
    case "subjects":
      return { gap, question: "Which subjects are you taking this term?" };
    case "topics": {
      const subject = facts.subjects.find(s => s.topicCount === 0)!.name;
      return { gap, question: `What does ${subject} cover this term? List the topics or chapters, in any order.` };
    }
    case "exams":
      return { gap, question: "Any exam or deadline dates yet? Tell me the subject and the day." };
    case "study_time":
      return { gap, question: "When do you usually study: morning, afternoon, evening or night?" };
  }
}
