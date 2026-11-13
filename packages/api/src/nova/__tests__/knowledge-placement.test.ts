// Where a captured passage belongs: the pure rules (knowledge-placement-rules.ts).
import {
  chosenPlace, decide, decideByName, placesOf, placementPrompt, rankPlaces, readPick, readPlacement,
  CANDIDATES_FOR_MODEL, type Place,
} from "../product/knowledge-placement-rules";
import type { StudyStructure } from "../product/setup-edit.types";

const NOW = new Date("2026-11-14T10:00:00Z");
const topic = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, hasHistory: false, ...extra });

const WORKSPACE: Pick<StudyStructure, "subjects"> = {
  subjects: [
    { id: "ai", name: "Artificial Intelligence", dates: 0, topics: [
      topic("ml", "Machine Learning"), topic("dl", "Deep Learning", { parentId: "ml" }),
      topic("rag", "Retrieval-Augmented Generation"), topic("vdb", "Vector Databases"),
      topic("old", "Expert Systems", { archived: true }), topic("ms", "Ship v2", { kind: "milestone" }),
    ] },
    { id: "cs", name: "Computer Science", dates: 0, topics: [topic("dbs", "Database Systems"), topic("dist", "Distributed Systems")] },
    { id: "bio", name: "Biology", dates: 0, topics: [topic("cells", "Cell Biology"), topic("ev", "Evolution")] },
  ],
};
const places = placesOf(WORKSPACE);
const text = (t: string, title = "", context: string | null = null, domain: string | null = null) => ({ title, text: t, context, domain });

describe("places: only what exists", () => {
  it("lists every subject and every live topic, with ids and paths", () => {
    expect(places.map(p => p.key)).toEqual(["s:ai", "t:ml", "t:dl", "t:rag", "t:vdb", "s:cs", "t:dbs", "t:dist", "s:bio", "t:cells", "t:ev"]);
    expect(places.find(p => p.topicId === "dl")!.topicPath).toEqual(["Machine Learning", "Deep Learning"]);
  });
  it("leaves out archived topics and milestones", () => {
    expect(places.some(p => p.topicId === "old" || p.topicId === "ms")).toBe(false);
  });
  it("puts a subject inside a subject under its parent's path", () => {
    const nested = placesOf({ subjects: [{ id: "p", name: "Engineering", dates: 0, topics: [] }, { id: "c", name: "Robotics", parentId: "p", dates: 0, topics: [topic("k", "Kinematics")] }] });
    expect(nested.find(p => p.topicId === "k")!.subjectPath).toEqual(["Engineering", "Robotics"]);
  });
  it("an empty workspace has no places, and nothing is suggested", () => {
    expect(placesOf({ subjects: [] })).toEqual([]);
    expect(decide(null, [], NOW)).toEqual({ placement: null, suggestion: null });
  });
});

describe("high confidence: one name, said outright", () => {
  it("files a passage that names exactly one topic, with no model", () => {
    const ranked = rankPlaces(text("Vector databases index embeddings so a similarity search returns the nearest neighbours quickly."), places);
    const p = decideByName(ranked, NOW);
    expect(p).toMatchObject({ subjectId: "ai", topicId: "vdb", topicName: "Vector Databases", confidence: "high", basis: "name" });
    expect(p!.path).toEqual(["Artificial Intelligence", "Vector Databases"]);
  });
  it("prefers the topic over its own subject when both are named", () => {
    const ranked = rankPlaces(text("In Biology, cell biology studies the membrane."), places);
    expect(decideByName(ranked, NOW)).toMatchObject({ topicId: "cells" });
  });
  it("a nested topic is placed by its own id", () => {
    const ranked = rankPlaces(text("Deep learning stacks many layers."), places);
    expect(decideByName(ranked, NOW)).toMatchObject({ topicId: "dl", path: ["Artificial Intelligence", "Machine Learning", "Deep Learning"] });
  });
  it("two names said outright: no guess by name, the model is asked", () => {
    const ranked = rankPlaces(text("Distributed systems often rely on database systems for replication."), places);
    expect(decideByName(ranked, NOW)).toBeNull();
    expect(ranked.slice(0, 2).map(r => r.place.topicId).sort()).toEqual(["dbs", "dist"]);
  });
});

describe("the same topic name in two subjects", () => {
  const twins = placesOf({ subjects: [
    { id: "s1", name: "Physics", dates: 0, topics: [topic("p-int", "Introduction")] },
    { id: "s2", name: "Chemistry", dates: 0, topics: [topic("c-int", "Introduction")] },
  ] });
  it("is two places, told apart by subject and topic id", () => {
    expect(twins.filter(p => p.topicName === "Introduction").map(p => [p.subjectId, p.topicId])).toEqual([["s1", "p-int"], ["s2", "c-int"]]);
  });
  it("a passage naming only the shared name is not filed by name", () => {
    expect(decideByName(rankPlaces(text("An introduction to the course."), twins), NOW)).toBeNull();
  });
  it("the subject's own words break the tie", () => {
    const ranked = rankPlaces(text("A chemistry introduction: atoms and bonds."), twins);
    expect(ranked[0]!.place.subjectId).toBe("s2");
  });
});

describe("the model's pick: only from the list, capped by the evidence", () => {
  const ranked = rankPlaces(text("Embedding similarity search over millions of vectors", "Approximate nearest neighbour"), places);
  it("reads a label from the shortlist", () => {
    const pick = readPick('{"pick": "C1", "confidence": "high"}', ranked);
    expect(pick?.place?.key).toBe(ranked[0]!.place.key);
  });
  it("a label that is not on the list, or a made-up place, points at nothing", () => {
    expect(readPick('{"pick": "C99", "confidence": "high"}', ranked)).toEqual({ place: null, confidence: "low" });
    expect(readPick('{"pick": "Quantum Computing", "confidence": "high"}', ranked)).toEqual({ place: null, confidence: "low" });
    expect(readPick("I think it is about vectors", ranked)).toBeNull();
  });
  it("high with evidence: filed, high", () => {
    const d = decide({ place: ranked[0]!.place, confidence: "high" }, ranked, NOW);
    expect(d.placement).toMatchObject({ confidence: "high", basis: "model" });
  });
  it("high with no word in common: filed, but held to medium", () => {
    const evo = places.find(p => p.topicId === "ev")!;
    const d = decide({ place: evo, confidence: "high" }, ranked, NOW);
    expect(d.placement).toMatchObject({ topicId: "ev", confidence: "medium" });
  });
  it("medium: filed, medium (shown to the learner)", () => {
    expect(decide({ place: ranked[0]!.place, confidence: "medium" }, ranked, NOW).placement?.confidence).toBe("medium");
  });
  it("low: not filed, only suggested", () => {
    const d = decide({ place: ranked[0]!.place, confidence: "low" }, ranked, NOW);
    expect(d.placement).toBeNull();
    expect(d.suggestion).toMatchObject({ confidence: "low" });
  });
  it("no pick: not filed; the best keyword guess is the suggestion", () => {
    const d = decide({ place: null, confidence: "low" }, ranked, NOW);
    expect(d.placement).toBeNull();
    expect(d.suggestion?.subjectId).toBe(ranked[0]!.place.subjectId);
  });
  it("the prompt lists only the shortlist, never the whole workspace", () => {
    const prompt = placementPrompt(text("x"), ranked.slice(0, 3));
    expect(prompt).toContain("C1:");
    expect(prompt).not.toContain("C4:");
  });
});

describe("irrelevant and ambiguous passages", () => {
  it("no evidence, no suggestion: a place shown to the model only because the workspace is small is not suggested", () => {
    const shown = places.map(place => ({ place, score: 0, exact: null }));
    expect(decide({ place: null, confidence: "low" }, shown, NOW)).toEqual({ placement: null, suggestion: null });
  });
  it("a passage about nothing in the workspace ranks no place", () => {
    expect(rankPlaces(text("The recipe needs two cups of flour and an egg."), places)).toEqual([]);
    expect(decide(null, [], NOW)).toEqual({ placement: null, suggestion: null });
  });
  it("a common word shared by many names counts for less than a rare one", () => {
    const many = placesOf({ subjects: [{ id: "x", name: "Notes", dates: 0, topics: ["Systems Design", "Operating Systems", "Control Systems", "Embedded Systems", "Quantum Entanglement"].map((n, i) => topic(`t${i}`, n)) }] });
    const r = rankPlaces(text("systems and entanglement"), many);
    expect(r[0]!.place.topicName).toBe("Quantum Entanglement");
  });
});

describe("a very large workspace", () => {
  const big: Pick<StudyStructure, "subjects"> = { subjects: Array.from({ length: 60 }, (_, s) => ({
    id: `s${s}`, name: `Subject ${s}`, dates: 0,
    topics: Array.from({ length: 50 }, (_, t) => topic(`s${s}t${t}`, s === 42 && t === 7 ? "Bayesian Inference" : `Topic ${s}-${t}`)),
  })) };
  it("ranks 3,000 topics quickly and keeps only the shortlist for the model", () => {
    const all = placesOf(big);
    expect(all.length).toBe(60 + 3000);
    const started = Date.now();
    const ranked = rankPlaces(text("Bayesian inference updates a prior with evidence."), all);
    expect(Date.now() - started).toBeLessThan(500);
    expect(ranked.length).toBeLessThanOrEqual(CANDIDATES_FOR_MODEL);
    expect(decideByName(ranked, NOW)).toMatchObject({ topicId: "s42t7", confidence: "high" });
  });
});

describe("the learner's own choice", () => {
  it("must name an existing place", () => {
    expect(chosenPlace(places, { subjectId: "cs", topicId: "dist" })?.topicName).toBe("Distributed Systems");
    expect(chosenPlace(places, { subjectId: "cs", topicId: null })?.key).toBe("s:cs");
    expect(chosenPlace(places, { subjectId: "cs", topicId: "vdb" })).toBeNull();   // a topic of another subject
    expect(chosenPlace(places, { subjectId: "gone", topicId: null })).toBeNull();
  });
});

describe("stored placements are read defensively", () => {
  it("drops anything that is not a placement", () => {
    expect(readPlacement(null)).toBeNull();
    expect(readPlacement({ subjectId: 3 })).toBeNull();
    const p = readPlacement({ subjectId: "ai", subjectName: "AI", topicId: "vdb", topicName: "Vector Databases", confidence: "weird", basis: "learner", path: ["AI", 7, "Vector Databases"], at: "2026-11-14T00:00:00Z" });
    expect(p).toMatchObject({ confidence: "low", basis: "learner", path: ["AI", "Vector Databases"] });
  });
});

// A place that is the same object the rules returned (for type checks).
export const _place: Place | undefined = places[0];
