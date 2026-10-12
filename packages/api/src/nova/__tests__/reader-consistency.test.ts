// Two faults of the reader found with a real model, and what holds them now.
//
//   1. A perfectly ordinary message sent right after an off-topic one ("tell
//      me a joke", then "I have a Databases exam on Thursday") came back as
//      "unsupported", with the exam it had just read sitting beside that
//      verdict. The learner was told an exam is outside what Nova does.
//   2. English with slang in it ("bro I'm stressed") came back as Hinglish,
//      and the learner was answered in a language they had not written.
//
// The model is asked differently (the prompt, checked here as text), and a
// reading that contradicts itself is resolved by the parser, whatever the
// model does next time.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLearnerRequest } from "../brains/understanding-parser";
import { UNDERSTANDING_BRAIN_SYSTEM_PROMPT } from "../brains/prompts/understanding-brain.prompt";
import { NOVA_STATIC_LAYER } from "../brains/prompts/nova-static-layer.prompt";

const read = (over: Record<string, unknown>) => parseLearnerRequest({ clarity: "unsupported", action: "none", ...over });

describe("a reading that calls a message unsupported and finds study content in it", () => {
  it("an exam with its date: the exam is believed, and the message is clear", () => {
    const r = read({ exam: { title: "Databases", date: "2026-10-15" } });
    expect(r.clarity).toBe("clear");
    expect(r.exam).toEqual({ title: "Databases", date: "2026-10-15" });
  });

  it("time they have, a topic they are stuck on, how a session went, or part of their setup", () => {
    expect(read({ availableMinutes: 30 }).clarity).toBe("clear");
    expect(read({ struggleTopic: "deadlocks" }).clarity).toBe("clear");
    expect(read({ sessionOutcome: "good" }).clarity).toBe("clear");
    expect(read({ setup: { subject: "Operating Systems", topics: ["Deadlocks", "Paging"] } }).clarity).toBe("clear");
  });

  it("content that does not survive validation does not count: the verdict stands", () => {
    expect(read({ exam: { title: "Databases", date: "next Thursday" } }).clarity).toBe("unsupported");
    expect(read({ exam: { title: "", date: "2026-10-15" } }).clarity).toBe("unsupported");
    expect(read({ availableMinutes: -5 }).clarity).toBe("unsupported");
    expect(read({ sessionOutcome: "amazing" }).clarity).toBe("unsupported");
    expect(read({ setup: {} }).clarity).toBe("unsupported");
  });
});

describe("what is still unsupported, unclear or noise", () => {
  it("a request with nothing about studying in it", () => {
    expect(read({}).clarity).toBe("unsupported");
    expect(read({ language: "english" }).clarity).toBe("unsupported");
  });

  it("only 'unsupported' is ever overturned: an unclear or unintelligible reading is left as it is", () => {
    for (const clarity of ["ambiguous", "unintelligible"]) {
      expect(parseLearnerRequest({ clarity, exam: { title: "Databases", date: "2026-10-15" }, availableMinutes: 30 }).clarity).toBe(clarity);
    }
    expect(parseLearnerRequest({ clarity: "clear", exam: { title: "Databases", date: "2026-10-15" } }).clarity).toBe("clear");
  });

  it("a reading that does not say how clear it is is still not treated as clear", () => {
    expect(parseLearnerRequest({ exam: { title: "Databases", date: "2026-10-15" } }).clarity).toBe("ambiguous");
  });
});

describe("how the reader is asked", () => {
  const brain = readFileSync(join(__dirname, "../brains/understanding-brain.ts"), "utf8");

  it("earlier messages are given for reference, and nothing about them is to be carried over", () => {
    expect(brain).toContain("Earlier messages, already dealt with.");
    expect(brain).toContain("Use them only to work out what the new message refers to.");
    expect(brain).toContain("not their language, not whether they were unsupported or unclear, not their intent or emotion");
    expect(brain).toContain("Classify this one alone, from its own words:");
    expect(brain).not.toContain("Now classify this new message:");
  });

  it("slang English is English: Hinglish needs Hindi words", () => {
    expect(UNDERSTANDING_BRAIN_SYSTEM_PROMPT).toContain("Casual or slang English is still english");
    expect(UNDERSTANDING_BRAIN_SYSTEM_PROMPT).toContain("hinglish needs actual Hindi words in the message");
  });
});

// Seen in real replies: "hit translation lookaside buffers (TLB) next" (not on
// the learner's syllabus, not in the plan) and "that binging habit" (from one
// message). What to study next is the planner's to decide, and one remark is
// not a habit.
describe("what the wording model may not add of its own", () => {
  it("it does not choose what they study next", () => {
    expect(NOVA_STATIC_LAYER).toContain("13. What they study next is already decided, and it is in the context");
    expect(NOVA_STATIC_LAYER).toContain("If the context recommends nothing, recommend nothing.");
    expect(NOVA_STATIC_LAYER).toContain("Explaining a topic they asked about is not this");
  });

  it("it does not turn one remark into a habit", () => {
    expect(NOVA_STATIC_LAYER).toContain("Something they said once is one thing they said");
    expect(NOVA_STATIC_LAYER).toContain("12. Say nothing about the student that is not in the context above or in their own message");
  });
});
