// What a saved page connects to: the name matcher, what a model's reply may
// become, which link Nova may make by itself, and what this step is never
// allowed to touch. Pure functions and source checks; the rows are covered in
// __integration__/nova-learning-events.itest.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";

jest.mock("../product/learning-events", () => ({
  claimForProcessing: jest.fn(), completeProcessing: jest.fn(), failProcessing: jest.fn(),
  listWaitingForProcessing: jest.fn(), loadVocabulary: jest.fn(),
}));

import {
  findConnections, labelVocabulary, matchNames, mergeConnections, namesIt, placeToFile, processSavedResource,
  readModelReply, wordsOf, type Vocabulary,
} from "../product/resource-processing";
import * as rows from "../product/learning-events";

const VOCABULARY: Vocabulary = [
  { id: "s_os",  name: "Operating Systems", topics: ["Deadlocks", "Virtual memory", "C"] },
  { id: "s_alg", name: "Algorithms",        topics: ["Graphs", "Dynamic programming"] },
];
const page = (title: string, excerpt: string | null = null) => ({ title, domain: "example.com", excerpt });

describe("names: the learner's own words, word for word", () => {
  it("splits a text into words, whatever the punctuation", () => {
    expect(wordsOf("Dead-locks, in OS/2 — “virtual” memory!")).toEqual(["dead", "locks", "in", "os", "2", "virtual", "memory"]);
    expect(wordsOf("")).toEqual([]);
  });

  it("matches a name as whole words in order, in any case", () => {
    const words = wordsOf("Understanding virtual memory and DEADLOCKS");
    expect(namesIt(words, "Virtual Memory")).toBe(true);
    expect(namesIt(words, "deadlocks")).toBe(true);
    expect(namesIt(words, "memory virtual")).toBe(false);
    expect(namesIt(words, "Deadlock")).toBe(false);          // not the same word
    expect(namesIt(wordsOf("Graphics programming"), "Graphs")).toBe(false);
  });

  it("does not act on a name too short to mean anything", () => {
    expect(namesIt(wordsOf("Programming in C"), "C")).toBe(false);
    expect(matchNames(page("Programming in C"), VOCABULARY)).toEqual([]);
  });

  it("finds a topic in the title or in the selected passage, and says which", () => {
    expect(matchNames(page("Deadlocks explained"), VOCABULARY)).toEqual([
      { subjectId: "s_os", subjectName: "Operating Systems", topicName: "Deadlocks", confidence: "high", basis: "name_in_title" },
    ]);
    expect(matchNames(page("Lecture 9", "Dynamic programming trades memory for time."), VOCABULARY)).toEqual([
      { subjectId: "s_alg", subjectName: "Algorithms", topicName: "Dynamic programming", confidence: "high", basis: "name_in_selection" },
    ]);
  });

  it("offers a subject as a whole only when none of its topics is named", () => {
    expect(matchNames(page("Operating systems: an overview"), VOCABULARY)).toEqual([
      { subjectId: "s_os", subjectName: "Operating Systems", topicName: null, confidence: "high", basis: "name_in_title" },
    ]);
    expect(matchNames(page("Operating systems: deadlocks"), VOCABULARY).map(m => m.topicName)).toEqual(["Deadlocks"]);
  });

  it("finds nothing in a page that names nothing of the learner's", () => {
    expect(matchNames(page("How to bake bread", "Flour, water, salt."), VOCABULARY)).toEqual([]);
    expect(matchNames(page("Deadlocks"), [])).toEqual([]);
  });
});

describe("the one link Nova may make by itself", () => {
  const high = (topicName: string) => ({ subjectId: "s_os", subjectName: "Operating Systems", topicName, confidence: "high" as const, basis: "name_in_title" as const });
  const possible = { subjectId: "s_alg", subjectName: "Algorithms", topicName: "Graphs", confidence: "possible" as const, basis: "model" as const };

  it("is the only outright match", () => {
    expect(placeToFile([high("Deadlocks")])).toEqual({ subjectId: "s_os", topicName: "Deadlocks" });
    expect(placeToFile([high("Deadlocks"), possible])).toEqual({ subjectId: "s_os", topicName: "Deadlocks" });
  });

  it("is none when two places are named: the learner chooses", () => {
    expect(placeToFile([high("Deadlocks"), high("Virtual memory")])).toBeNull();
  });

  it("is never a model's pick", () => {
    expect(placeToFile([possible])).toBeNull();
    expect(placeToFile([])).toBeNull();
  });
});

describe("a model's reply is a proposal", () => {
  const { text, byLabel } = labelVocabulary(VOCABULARY);

  it("is shown a numbered list of the learner's own subjects and topics", () => {
    expect(text.split("\n")).toEqual([
      "S1: Operating Systems", "  S1.T1: Deadlocks", "  S1.T2: Virtual memory", "  S1.T3: C",
      "S2: Algorithms", "  S2.T1: Graphs", "  S2.T2: Dynamic programming",
    ]);
  });

  it("can point only at that list, and its picks are 'possible'", () => {
    const read = readModelReply('Sure! {"concepts": ["Banker\'s algorithm", "Resource allocation"], "related": ["S1.T1", "S9", "S1.T99", "drop table", "S2"]}', byLabel);
    expect(read).toEqual({
      concepts: ["Banker's algorithm", "Resource allocation"],
      related: [
        { subjectId: "s_os",  subjectName: "Operating Systems", topicName: "Deadlocks", confidence: "possible", basis: "model" },
        { subjectId: "s_alg", subjectName: "Algorithms",        topicName: null,        confidence: "possible", basis: "model" },
      ],
    });
  });

  it("keeps a few short concepts, once each, and nothing that is not text", () => {
    const read = readModelReply(JSON.stringify({ concepts: ["Paging", "paging", 42, "x".repeat(60), " Page\ntables ", "a", "b", "c", "d"], related: "S1" }), byLabel)!;
    expect(read.concepts).toEqual(["Paging", "Page tables", "a", "b", "c"]);
    expect(read.related).toEqual([]);
  });

  it("is nothing at all when it is not the shape that was asked for", () => {
    for (const reply of ["", "I can't help with that.", "[1,2]", "{not json}", "null"]) expect(readModelReply(reply, byLabel)).toBeNull();
  });

  it("never repeats a place the names already found, and names come first", () => {
    const names = matchNames(page("Deadlocks explained"), VOCABULARY);
    const model = readModelReply('{"concepts": [], "related": ["S1.T1", "S1", "S2.T1"]}', byLabel)!.related;
    expect(mergeConnections(names, model).map(c => [c.topicName, c.confidence])).toEqual([["Deadlocks", "high"], ["Graphs", "possible"]]);
  });
});

describe("looking at one page", () => {
  const claim = { id: "ev_1", profileId: "p_1", startedAt: new Date("2026-10-14T10:00:00Z"), title: "Deadlocks explained", domain: "example.com", excerpt: null, subjectId: null };
  const mocked = rows as jest.Mocked<typeof rows>;
  beforeEach(() => {
    jest.clearAllMocks();
    mocked.loadVocabulary.mockResolvedValue(VOCABULARY);
    mocked.completeProcessing.mockResolvedValue(true);
    mocked.failProcessing.mockResolvedValue(undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("gives the model the title, the site, the passage and the learner's names, and not the address", async () => {
    const generate = jest.fn(async () => '{"concepts": ["Deadlock"], "related": []}');
    await findConnections({ title: "Deadlocks explained", domain: "example.com", excerpt: "Four conditions." }, VOCABULARY, generate as never);
    const [[request]] = generate.mock.calls as unknown as [[{ prompt: string; deadlineMs: number; model: string }]];
    expect(request.prompt).toContain("Title: Deadlocks explained");
    expect(request.prompt).toContain("Site: example.com");
    expect(request.prompt).toContain("Four conditions.");
    expect(request.prompt).toContain("S1.T1: Deadlocks");
    expect(request.prompt).not.toMatch(/https?:\/\//);
    expect(request.deadlineMs).toBeGreaterThan(0);
    expect(request.model).toBe("gpt-4o-mini");
  });

  it("records what it found and files the page in the one place it names", async () => {
    mocked.claimForProcessing.mockResolvedValue(claim);
    const outcome = await processSavedResource("ev_1", "queue", { generate: (async () => '{"concepts": ["Deadlock"], "related": ["S2.T1"]}') as never });
    expect(outcome).toBe("done");
    const [, found, file] = mocked.completeProcessing.mock.calls[0]!;
    expect(found).toMatchObject({ version: 1, model: true, concepts: ["Deadlock"] });
    expect(found.suggestions.map(s => [s.topicName, s.confidence])).toEqual([["Deadlocks", "high"], ["Graphs", "possible"]]);
    expect(file).toEqual({ subjectId: "s_os", topicName: "Deadlocks" });
    expect(mocked.failProcessing).not.toHaveBeenCalled();
  });

  it("files nothing when the learner already filed the page", async () => {
    mocked.claimForProcessing.mockResolvedValue({ ...claim, subjectId: "s_alg" });
    await processSavedResource("ev_1", "queue", { generate: (async () => '{"concepts": [], "related": []}') as never });
    expect(mocked.completeProcessing.mock.calls[0]![2]).toBeNull();
  });

  it("a model that fails or answers nonsense is a failed attempt on the row, and nothing else changes", async () => {
    mocked.claimForProcessing.mockResolvedValue(claim);
    for (const generate of [async () => { throw new Error("rate limited") }, async () => "no json here"]) {
      const outcome = await processSavedResource("ev_1", "queue", { generate: generate as never });
      expect(outcome).toBe("failed");
    }
    expect(mocked.completeProcessing).not.toHaveBeenCalled();
    expect(mocked.failProcessing).toHaveBeenCalledTimes(2);
    expect(mocked.failProcessing.mock.calls[0]![1]).toBe("Nova couldn't look at this one just now.");
  });

  it("does nothing when the page is not there to take", async () => {
    mocked.claimForProcessing.mockResolvedValue(null);
    const generate = jest.fn();
    expect(await processSavedResource("ev_1", "learner", { profileId: "p_1", generate: generate as never })).toBe("skipped");
    expect(generate).not.toHaveBeenCalled();
    expect(mocked.loadVocabulary).not.toHaveBeenCalled();
  });
});

describe("processing is not evidence of learning", () => {
  const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");
  const source = read("product/resource-processing.ts");
  const events = read("product/learning-events.ts");

  it("touches no table itself: it reads and writes through learning-events.ts", () => {
    expect(source).not.toMatch(/prisma|@repo\/db/);
  });

  it("moves no mastery, starts no session and writes no fact, pattern or note", () => {
    for (const text of [source, events]) {
      expect(text).not.toMatch(/updateTopicMastery|novaTopicMastery\.(create|update|upsert)|novaTopicMasterySnapshot|declareTopics/);
      expect(text).not.toMatch(/openStudySession|runNovaSessionCommand|novaStudySession\.(create|update|upsert)/);
      expect(text).not.toMatch(/userFact|userReality|behavioralPattern|novaNote|companionMessage|memoryFact|refreshLearningDna/);
    }
  });

  it("stays out of the chat pipeline: one direct model call, no brain, no consolidation", () => {
    expect(source).not.toMatch(/from "\.\.\/(brains|consolidation|decision|context|adapters|persistence|interaction)\//);
    expect(source).not.toMatch(/handleNovaTurn|runNovaOrchestrator|consolidateTurn/);
    expect((source.match(/generate\(\{/g) ?? []).length).toBe(1);
  });

  it("never fetches a saved address", () => {
    expect(source).not.toMatch(/\bfetch\(|https?\.get|axios|undici/);
  });

  it("a failure is written on the row and removes nothing", () => {
    const fail = events.slice(events.indexOf("export async function failProcessing"), events.indexOf("// Saved pages waiting"));
    expect(fail).toMatch(/updateMany/);
    expect(fail).not.toMatch(/delete|subjectId|topicName|title|url/);
  });

  it("a link Nova makes is written only while the page is filed nowhere, and is marked as Nova's", () => {
    const complete = events.slice(events.indexOf("export async function completeProcessing"), events.indexOf("// Records that an attempt failed"));
    expect(complete).toMatch(/where: \{ \.\.\.mine, subjectId: null \}/);
    expect(complete).toMatch(/filedBy: "nova"/);
  });
});
