// Learning events from the browser extension: what an event may carry, which
// addresses Nova keeps, and what an event is never allowed to become.
// Pure functions and source checks; the database side is in
// __integration__/nova-learning-events.itest.ts.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { normalizeResourceUrl, parseLearningEvent } from "../product/learning-events";
import { normalizePairingCode } from "../product/extension-connection";
import {
  EVENTS_PER_MINUTE, EVENT_BODY_MAX_BYTES, EVENT_TITLE_MAX, EVENT_TOPIC_MAX, EVENT_URL_MAX,
} from "../product/learning-events.types";

const NOW = new Date("2026-10-06T12:00:00Z");
const ID  = "3f6c1c1e-7a0b-4a57-9d55-2b1d2a6f9c10";
const event = (over: Record<string, unknown> = {}) => ({
  eventType: "resource_saved", clientEventId: ID, url: "https://example.com/graphs/bfs", title: "Breadth-first search", ...over,
});
const parse = (over: Record<string, unknown> = {}) => parseLearningEvent(event(over), NOW);
const ok = (over: Record<string, unknown> = {}) => {
  const result = parse(over);
  if (!result.ok) throw new Error(`expected a valid event, got ${result.failure.error}: ${result.failure.message}`);
  return result.event;
};
const errorOf = (over: Record<string, unknown> = {}) => { const r = parse(over); return r.ok ? null : r.failure.error; };

describe("which addresses Nova keeps", () => {
  it("keeps ordinary web pages", () => {
    expect(normalizeResourceUrl("https://example.com/graphs/bfs")).toEqual({ url: "https://example.com/graphs/bfs", domain: "example.com" });
    expect(normalizeResourceUrl("http://docs.example.org/a?page=2")).toEqual({ url: "http://docs.example.org/a?page=2", domain: "docs.example.org" });
    expect(normalizeResourceUrl("  https://WWW.Example.com/Path  ")).toEqual({ url: "https://www.example.com/Path", domain: "example.com" });
  });

  it("refuses anything that is not http or https", () => {
    for (const bad of [
      "javascript:alert(1)", "JAVASCRIPT:alert(1)", " javascript:alert(1)", "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd", "chrome://settings", "chrome-extension://abc/popup.html", "about:blank", "blob:https://example.com/1",
      "ftp://example.com/file", "view-source:https://example.com", "vbscript:msgbox(1)", "ws://example.com", "mailto:a@example.com",
    ]) expect([bad, normalizeResourceUrl(bad)]).toEqual([bad, null]);
  });

  it("refuses what is not an address at all", () => {
    for (const bad of ["", "   ", "example.com", "/relative/path", "https://", "not a url", null, undefined, 42, {}, ["https://example.com"]]) {
      expect(normalizeResourceUrl(bad)).toBeNull();
    }
  });

  it("refuses an address longer than the limit", () => {
    expect(EVENT_URL_MAX).toBe(2048);
    expect(normalizeResourceUrl(`https://example.com/${"a".repeat(2048)}`)).toBeNull();
    expect(normalizeResourceUrl(`https://example.com/${"a".repeat(1900)}`)).not.toBeNull();
  });

  it("drops a login, a fragment and credential parameters before keeping it", () => {
    expect(normalizeResourceUrl("https://user:hunter2@example.com/a#section")!.url).toBe("https://example.com/a");
    const cleaned = normalizeResourceUrl("https://example.com/watch?v=abc123&token=SECRET&access_token=S2&API_KEY=S3&sid=S4&X-Amz-Signature=S5&X-Amz-Credential=S6&page=2")!.url;
    expect(cleaned).toBe("https://example.com/watch?v=abc123&page=2");
    for (const secret of ["SECRET", "S2", "S3", "S4", "S5", "S6", "hunter2"]) expect(cleaned).not.toContain(secret);
  });

  it("keeps the parameters that say which page it is", () => {
    expect(normalizeResourceUrl("https://video.example/watch?v=dQw4w9WgXcQ&t=42")!.url).toBe("https://video.example/watch?v=dQw4w9WgXcQ&t=42");
    expect(normalizeResourceUrl("https://example.com/search?q=dijkstra+algorithm")!.url).toBe("https://example.com/search?q=dijkstra+algorithm");
  });

  it("takes the site from the address, never from the request", () => {
    expect(ok({ url: "https://www.geeksforgeeks.org/graphs", domain: "evil.example" }).domain).toBe("geeksforgeeks.org");
  });
});

describe("what a learning event may carry", () => {
  it("reads the two actions Nova knows and no other", () => {
    expect(ok().eventType).toBe("resource_saved");
    expect(ok({ eventType: "study_requested" }).eventType).toBe("study_requested");
    for (const eventType of ["page_viewed", "page_opened", "session_completed", "topic_mastered", "visited", "", null, undefined, 1]) {
      expect([eventType, errorOf({ eventType })]).toEqual([eventType, "invalid"]);
    }
  });

  it("requires an id for the action, of a sensible shape", () => {
    expect(ok({ clientEventId: "a".repeat(16) }).clientEventId).toHaveLength(16);
    for (const clientEventId of [undefined, null, "", "short", "a".repeat(65), "has spaces in it 123", "semi;colon;1234567890", "../../etc/passwd/aaaa", 1234567890123456, { id: ID }]) {
      expect([clientEventId, errorOf({ clientEventId })]).toEqual([clientEventId, "invalid"]);
    }
  });

  it("refuses an address Nova does not keep, as its own kind of error", () => {
    expect(errorOf({ url: "javascript:alert(1)" })).toBe("invalid_url");
    expect(errorOf({ url: "data:text/html,hi" })).toBe("invalid_url");
    expect(errorOf({ url: undefined })).toBe("invalid_url");
  });

  it("keeps the title to one line and within its length", () => {
    expect(EVENT_TITLE_MAX).toBe(300);
    expect(ok({ title: "  BFS\n\tand   DFS \u0000 explained  " }).title).toBe("BFS and DFS explained");
    expect(ok({ title: "x".repeat(300) }).title).toHaveLength(300);
    expect(errorOf({ title: "x".repeat(301) })).toBe("invalid");
    expect(errorOf({ title: "x".repeat(100_000) })).toBe("invalid");
    expect(errorOf({ title: 42 })).toBe("invalid");
    expect(errorOf({ title: undefined })).toBe("invalid");
  });

  it("falls back to the site when a page has no title", () => {
    expect(ok({ title: "   " }).title).toBe("example.com");
  });

  it("stores a title as text: markup is not interpreted, and not stripped either", () => {
    expect(ok({ title: "<img src=x onerror=alert(1)> Graphs" }).title).toBe("<img src=x onerror=alert(1)> Graphs");
  });

  it("takes a topic only with a subject, and within its length", () => {
    expect(EVENT_TOPIC_MAX).toBe(120);
    expect(ok({ subjectId: "subj_1", topicName: "  Graphs   BFS " })).toMatchObject({ subjectId: "subj_1", topicName: "Graphs BFS" });
    expect(errorOf({ topicName: "Graphs" })).toBe("invalid");
    expect(errorOf({ subjectId: "subj_1", topicName: "x".repeat(121) })).toBe("invalid");
    expect(ok({ subjectId: "subj_1", topicName: "   " }).topicName).toBeNull();
    expect(ok({ subjectId: "", topicName: "" })).toMatchObject({ subjectId: null, topicName: null });
    expect(errorOf({ subjectId: { id: "x" } })).toBe("invalid");
    expect(errorOf({ subjectId: "x".repeat(65) })).toBe("invalid");
  });

  it("uses the action's own time when it is believable, and never a future one", () => {
    expect(ok({ capturedAt: "2026-10-06T11:58:00Z" }).occurredAt.toISOString()).toBe("2026-10-06T11:58:00.000Z");
    expect(ok({ capturedAt: "2026-10-06T12:30:00Z" }).occurredAt).toEqual(NOW);       // ahead of the server
    expect(ok({ capturedAt: "1999-01-01T00:00:00Z" }).occurredAt).toEqual(NOW);       // backdated
    expect(ok({ capturedAt: "2099-01-01T00:00:00Z" }).occurredAt).toEqual(NOW);
    expect(ok({ capturedAt: "yesterday-ish" }).occurredAt).toEqual(NOW);
    expect(ok({ capturedAt: 12345 }).occurredAt).toEqual(NOW);
    expect(ok().occurredAt).toEqual(NOW);
  });

  it("refuses anything that is not an object", () => {
    for (const raw of [null, undefined, "string", 42, [], [event()], true]) {
      const result = parseLearningEvent(raw, NOW);
      expect(result.ok ? null : result.failure.error).toBe("invalid");
    }
  });

  it("never reads an owner, a source, page content or a metadata bag from the request", () => {
    const parsed = ok({
      profileId: "someone-else", learnerId: "someone-else", userId: "someone-else", companionId: "rex", source: "trusted_internal",
      mastery: 1, masteryProbability: 1, outcome: "crushed_it", durationMinutes: 600, status: "completed",
      body: "the whole page text", html: "<html>…</html>", cookies: "session=abc", metadata: { anything: "at all" }, formInputs: { password: "hunter2" },
    });
    expect(Object.keys(parsed).sort()).toEqual(["clientEventId", "domain", "eventType", "occurredAt", "subjectId", "title", "topicName", "url"]);
    expect(JSON.stringify(parsed)).not.toMatch(/someone-else|rex|trusted_internal|whole page|hunter2|session=abc|crushed_it/);
  });

  it("has sensible limits", () => {
    expect(EVENT_BODY_MAX_BYTES).toBe(8192);
    expect(EVENTS_PER_MINUTE).toBe(20);
  });
});

describe("pairing codes", () => {
  it("reads a code however it was typed", () => {
    expect(normalizePairingCode("ABCDE-FGHJK")).toBe("ABCDEFGHJK");
    expect(normalizePairingCode("  abcde fghjk ")).toBe("ABCDEFGHJK");
    expect(normalizePairingCode("abcdefghjk")).toBe("ABCDEFGHJK");
  });

  it("refuses what cannot be a code", () => {
    for (const bad of ["", "ABCDE", "ABCDE-FGHJK-MNPQR", "ABCDE-FGHJ0", "ABCDE-FGHJI", null, undefined, 1234567890, { code: "ABCDEFGHJK" }, "A".repeat(41), "'; DROP TABLE x; --"]) {
      expect([bad, normalizePairingCode(bad)]).toEqual([bad, null]);
    }
  });
});

// ── Boundaries, read from the source ──────────────────────────────────────────

const NOVA = join(__dirname, "..");
const read = (path: string) => readFileSync(join(NOVA, path), "utf8");
function sourceFiles(dir: string): string[] {
  return readdirSync(join(NOVA, dir)).flatMap(name => {
    const path = join(dir, name);
    if (statSync(join(NOVA, path)).isDirectory()) return name.startsWith("__") ? [] : sourceFiles(path);
    return name.endsWith(".ts") ? [path] : [];
  });
}
const files = sourceFiles(".").map(path => ({ path, src: read(path) }));

describe("a learning event is a record of an action, and nothing else", () => {
  const source = read("product/learning-events.ts");

  it("writes the learning-event table and no other", () => {
    const writes = [...source.matchAll(/prisma\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g)].map(m => m[1]);
    expect([...new Set(writes)]).toEqual(["novaLearningEvent"]);
  });

  it("is the only code that touches that table", () => {
    expect(files.filter(f => /novaLearningEvent\b/.test(f.src)).map(f => f.path)).toEqual(["product/learning-events.ts"]);
  });

  it("moves no mastery, starts no session and feeds no Learning DNA", () => {
    expect(source).not.toMatch(/updateTopicMastery|novaTopicMastery\.(create|update|upsert)|novaTopicMasterySnapshot/);
    expect(source).not.toMatch(/openStudySession|runNovaSessionCommand|persistSessionEnd|novaStudySession\.(create|update|upsert)/);
    expect(source).not.toMatch(/refreshLearningDna|novaLearningDNA|computeLearningDna/);
  });

  it("creates no fact, reality, pattern, note or message, and calls no brain or LLM", () => {
    expect(source).not.toMatch(/userFact|userReality|behavioralPattern|novaCognitiveState|novaNote|companionMessage|memoryFact/);
    expect(source).not.toMatch(/from "\.\.\/(brains|consolidation|decision|context|adapters|persistence)\//);
    expect(source).not.toMatch(/openai|generateOpenAIText|handleNovaTurn/i);
  });

  it("never fetches a saved address", () => {
    expect(source).not.toMatch(/\bfetch\(|https?\.get|axios|undici/);
  });

  it("is read by no engine: Planner, Knowledge, Progress and Learning DNA do not see events", () => {
    const readers = files.filter(f => /learning-events"|loadSavedResources|recordLearningEvent/.test(f.src)).map(f => f.path);
    // The Knowledge Map draws a saved page as a point filed under its subject.
    // It is a picture of what is on record, not an engine: it computes
    // nothing about the learner from an event, and it reads them only
    // through this module's own listResourceLinks.
    expect(readers.sort()).toEqual(["product/knowledge-map.ts", "product/learning-events.ts"]);
    const map = read("product/knowledge-map.ts");
    expect(map).not.toMatch(/prisma\.novaLearningEvent/);
    expect(map).not.toMatch(/updateTopicMastery|novaStudySession/);
    expect(map).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
    for (const engine of ["product/planner.ts", "product/planning-inputs.ts", "product/knowledge.ts", "product/progress.ts", "product/today.ts", "engines/planning-engine.ts", "engines/learning-dna-engine.ts"]) {
      expect([engine, readers.includes(engine)]).toEqual([engine, false]);
    }
  });

  it("has a contract the web app can import without pulling in the server", () => {
    expect(read("product/learning-events.types.ts")).not.toMatch(/^import /m);
  });
});

describe("the extension's credential", () => {
  const source = read("product/extension-connection.ts");

  it("is kept as a hash: neither the code nor the credential is stored", () => {
    expect(source).toMatch(/codeHash: sha256\(code\)/);
    expect(source).toMatch(/tokenHash: sha256\(token\)/);
    expect(source).not.toMatch(/data:\s*\{[^}]*\b(token|code):/);
  });

  it("does not use or sign with the web session's secret", () => {
    expect(source).not.toMatch(/JWT_SECRET|jose|SignJWT|kevo_session|cookies\(/);
  });

  it("is the only code that touches the connection table", () => {
    expect(files.filter(f => /novaExtensionConnection\b/.test(f.src)).map(f => f.path)).toEqual(["product/extension-connection.ts"]);
  });
});
