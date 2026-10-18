// Where the learner put the cards on their Knowledge Map: what a save may
// hold, and that the layout is its own table and nothing else. No database;
// the real-Postgres proof (ownership, reset, concurrency) is
// nova-map-layout.itest.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLayoutInput, parseNodeId } from "../product/map-layout";
import { MAP_LAYOUT_COORD_MAX, MAP_LAYOUT_MAX_POSITIONS } from "../product/map-layout.types";

const read = (file: string) => readFileSync(join(__dirname, "..", file), "utf8");

describe("a map node id", () => {
  it("is one of the map's four kinds and a row id", () => {
    expect(parseNodeId("topic:ck1abc_D-9")).toEqual({ nodeType: "topic", nodeId: "ck1abc_D-9" });
    expect(parseNodeId("resource:r1")).toEqual({ nodeType: "resource", nodeId: "r1" });
    for (const bad of [null, 3, "", "topic", "topic:", ":abc", "exam:abc", "Topic:abc", "topic:a b", "topic:a:b", "topic:é", `note:${"a".repeat(65)}`]) {
      expect(parseNodeId(bad)).toBeNull();
    }
  });

  it("keeps kinds apart: the same row id under two kinds is two cards", () => {
    const parsed = parseLayoutInput({ positions: [{ node: "note:x1", x: 1, y: 1 }, { node: "topic:x1", x: 2, y: 2 }] });
    expect(parsed.ok && parsed.positions.map(p => [p.nodeType, p.nodeId])).toEqual([["note", "x1"], ["topic", "x1"]]);
  });
});

describe("a layout save", () => {
  it("takes finite positions within the map and rounds them", () => {
    const parsed = parseLayoutInput({ positions: [{ node: "subject:s", x: 1.006, y: -MAP_LAYOUT_COORD_MAX }] });
    expect(parsed).toEqual({ ok: true, positions: [{ node: "subject:s", nodeType: "subject", nodeId: "s", x: 1.01, y: -MAP_LAYOUT_COORD_MAX }] });
  });

  it("keeps the last position of a card named twice", () => {
    const parsed = parseLayoutInput({ positions: [{ node: "note:a", x: 1, y: 1 }, { node: "note:b", x: 0, y: 0 }, { node: "note:a", x: 9, y: 9 }] });
    expect(parsed.ok && parsed.positions.map(p => [p.node, p.x])).toEqual([["note:b", 0], ["note:a", 9]]);
  });

  it("is refused whole when any entry is wrong", () => {
    const ok = { node: "note:a", x: 1, y: 1 };
    const bad: unknown[] = [
      undefined, null, [], "x", {}, { positions: {} },
      { positions: [ok, null] },
      { positions: [ok, { node: "note:b", x: Number.NaN, y: 0 }] },
      { positions: [ok, { node: "note:b", x: 0, y: Number.NEGATIVE_INFINITY }] },
      { positions: [ok, { node: "note:b", x: MAP_LAYOUT_COORD_MAX + 1, y: 0 }] },
      { positions: [ok, { node: "note:b", x: "1", y: 0 }] },
      { positions: [ok, { node: "note:b", x: 1 }] },
      { positions: [ok, { node: "exam:b", x: 1, y: 1 }] },
      { positions: Array.from({ length: MAP_LAYOUT_MAX_POSITIONS + 1 }, () => ok) },
    ];
    for (const body of bad) expect(parseLayoutInput(body)).toMatchObject({ ok: false, error: "invalid" });
  });

  it("holds as many positions as the limit allows", () => {
    const parsed = parseLayoutInput({ positions: Array.from({ length: MAP_LAYOUT_MAX_POSITIONS }, (_, i) => ({ node: `note:n${i}`, x: i, y: i })) });
    expect(parsed.ok && parsed.positions.length).toBe(MAP_LAYOUT_MAX_POSITIONS);
  });
});

describe("the layout is its own record", () => {
  const source = read("product/map-layout.ts");

  it("writes only NovaMapLayout, and the map's read model stays read-only", () => {
    const writes = [...source.matchAll(/prisma\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g)].map(m => m[1]);
    expect(writes.length).toBeGreaterThan(0);
    expect(new Set(writes)).toEqual(new Set(["novaMapLayout"]));
    expect(source).not.toMatch(/prisma\.(novaNote|novaLearningEvent|novaTopicMastery|novaSubject)\b/);
    expect(read("product/knowledge-map.ts")).not.toContain("novaMapLayout");
    const imports = source.split("\n").filter(line => line.startsWith("import ")).join("\n");
    for (const forbidden of ["brains/", "openai", "nova-orchestrator", "consolidation"]) expect(imports).not.toContain(forbidden);
  });

  it("checks a save against the learner's own map, found by the session's key", () => {
    expect(source).toContain("learnerKey(platformChatId)");
    expect(source).toContain("await loadNovaKnowledgeMap(platformChatId)");
    expect(source).toContain("keep = parsed.positions.filter(p => onMap.has(p.node))");
    expect(source).toContain("where: { profileId: profile.profileId }");
  });

  it("the route reads the learner from the session only and caps the body", () => {
    const route = readFileSync(join(__dirname, "../../../../../apps/api/app/api/nova/knowledge-map/layout/route.ts"), "utf8");
    expect(route).toContain("resolveNovaLearner()");
    expect(route).toContain("readSmallJson(req, MAP_LAYOUT_BODY_MAX_BYTES)");
    expect(route).not.toMatch(/profileId|searchParams|params/);
  });
});
