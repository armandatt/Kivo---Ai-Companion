// Notes: what a learner may write, and the boundary that keeps a note from
// becoming anything else.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { notePreview, parseNoteInput, studyAvailability } from "../product/notes";
import { NOTE_BODY_MAX, NOTE_PREVIEW_LENGTH, NOTE_TITLE_MAX, NOTE_TOPIC_MAX } from "../product/notes.types";
import { NOVA_ROUTES, routeAccess } from "../product/companion";
import { REVIEW_BLOCK_MINUTES } from "../engines/planning-engine";

const changes = (raw: unknown, creating = true) => {
  const parsed = parseNoteInput(raw, creating);
  if (!parsed.ok) throw new Error(`expected a valid note, got ${parsed.error}`);
  return parsed.changes;
};
const error = (raw: unknown, creating = true) => {
  const parsed = parseNoteInput(raw, creating);
  return parsed.ok ? null : parsed.error;
};

describe("parseNoteInput", () => {
  it("accepts a note and keeps the body exactly as written", () => {
    const body = "  Deadlocks need four conditions:\n\n\t1. mutual exclusion\n  2. hold and wait  \n";
    expect(changes({ title: "  Deadlock   basics ", body, subjectId: "s1", topicName: "  deadlocks  " })).toEqual({
      title: "Deadlock basics", body, subjectId: "s1", topicName: "deadlocks",
    });
  });

  it("unifies line endings and changes nothing else in the body", () => {
    expect(changes({ title: "t", body: "a\r\nb\rc\n" }).body).toBe("a\nb\nc\n");
  });

  it("allows a note with no body, no subject and no topic", () => {
    expect(changes({ title: "Loose thought" })).toEqual({ title: "Loose thought", body: "" });
    expect(changes({ title: "t", subjectId: null, topicName: null })).toMatchObject({ subjectId: null, topicName: null });
    expect(changes({ title: "t", subjectId: "", topicName: "   " })).toMatchObject({ subjectId: null, topicName: null });
  });

  it("requires a title to create", () => {
    expect(error({ body: "text" })).toBe("title_required");
    expect(error({ title: "   ", body: "text" })).toBe("title_required");
    expect(error({ title: 42 })).toBe("title_required");
  });

  it("enforces the size limits", () => {
    expect(error({ title: "x".repeat(NOTE_TITLE_MAX + 1) })).toBe("title_too_long");
    expect(error({ title: "x".repeat(NOTE_TITLE_MAX) })).toBeNull();
    expect(error({ title: "t", body: "x".repeat(NOTE_BODY_MAX + 1) })).toBe("body_too_long");
    expect(error({ title: "t", body: "x".repeat(NOTE_BODY_MAX) })).toBeNull();
    expect(error({ title: "t", topicName: "x".repeat(NOTE_TOPIC_MAX + 1) })).toBe("topic_too_long");
  });

  it("rejects what is not a note", () => {
    for (const raw of [null, undefined, "note", 7, [], [{ title: "t" }]]) expect(error(raw)).toBe("invalid");
    expect(error({ title: "t", body: { text: "x" } })).toBe("invalid");
    expect(error({ title: "t", subjectId: 5 })).toBe("invalid");
    expect(error({ title: "t", topicName: ["a"] })).toBe("invalid");
  });

  it("reads only the four fields a learner may write, whatever else is sent", () => {
    const forged = changes({
      title: "t", body: "b", id: "other-note", profileId: "someone-else", userId: "u2", learnerId: "l2",
      createdAt: "2020-01-01", updatedAt: "2020-01-01", profile: { connect: { id: "x" } },
    });
    expect(Object.keys(forged).sort()).toEqual(["body", "title"]);
  });

  it("an edit changes only what it names", () => {
    expect(changes({ body: "new text" }, false)).toEqual({ body: "new text" });
    expect(changes({ topicName: "Paging" }, false)).toEqual({ topicName: "Paging" });
    expect(changes({}, false)).toEqual({});
    expect(error({ title: "" }, false)).toBe("title_required");     // a title cannot be edited away
    expect(changes({ profileId: "someone-else" }, false)).toEqual({});
  });
});

describe("preview and study availability", () => {
  it("previews the start of the body on one line", () => {
    expect(notePreview("Line one\n\n  line   two")).toBe("Line one line two");
    const long = notePreview("word ".repeat(100));
    expect(long.length).toBeLessThanOrEqual(NOTE_PREVIEW_LENGTH + 1);
    expect(long.endsWith("…")).toBe(true);
    expect(notePreview("")).toBe("");
  });

  it("offers Study this only when the note has a subject and a topic, and says which is missing", () => {
    expect(studyAvailability({ subjectId: "s1", topicName: "Deadlocks" })).toEqual({ available: true, blockedBy: null, minutes: REVIEW_BLOCK_MINUTES });
    expect(studyAvailability({ subjectId: null, topicName: "Deadlocks" })).toMatchObject({ available: false, blockedBy: "no_subject" });
    expect(studyAvailability({ subjectId: "s1", topicName: null })).toMatchObject({ available: false, blockedBy: "no_topic" });
    expect(studyAvailability({ subjectId: null, topicName: null })).toMatchObject({ available: false, blockedBy: "no_subject" });
  });
});

describe("route access", () => {
  it("Notes is a Nova page, and only a Nova page", () => {
    expect(NOVA_ROUTES.map(r => r.path)).toContain("/notes");
    expect(routeAccess("nova", "/notes")).toBe("render");
    expect(routeAccess("nova", "/notes/abc123")).toBe("render");
    expect(routeAccess("nova", "/notes/new")).toBe("render");
    expect(routeAccess("rex", "/notes")).toBe("not_for_rex");
    expect(routeAccess("rex", "/notes/abc123")).toBe("not_for_rex");
  });
});

// ── The boundary ──────────────────────────────────────────────────────────────
// A note is learner-owned content. These read the source, like the other
// boundary tests: the rule is about what code is allowed to exist.

const NOVA  = resolve(__dirname, "..");
const REPO  = resolve(__dirname, "../../../../..");
const read  = (file: string) => readFileSync(file, "utf8");
const code  = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "__tests__" && name !== "__integration__" && name !== "node_modules") sourceFiles(full, out);
    } else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe("notes boundary: a note is content, not cognitive state", () => {
  const notes = code(join(NOVA, "product/notes.ts"));

  it("the notes module imports no brain, orchestrator, consolidation, conversation log or LLM client", () => {
    const imports = [...notes.matchAll(/from\s+"([^"]+)"/g)].map(m => m[1]!);
    expect(imports.sort()).toEqual([
      // learner-key: a pure helper with no imports (how a learner's row is named).
      "../engines/planning-engine", "../engines/topic-mastery-engine", "./learner-key", "./notes.types", "@repo/db/client",
    ]);
    for (const banned of ["brains", "consolidation", "orchestrator", "entry", "conversation-adapter", "openai", "persistence", "knowledge-engine"]) {
      expect(imports.some(i => i.includes(banned))).toBe(false);
    }
  });

  it("takes only pure helpers from the engines it does import", () => {
    expect(notes).toMatch(/import \{ REVIEW_BLOCK_MINUTES \} from "\.\.\/engines\/planning-engine"/);
    expect(notes).toMatch(/import \{ likeLiteral, normalizeTopicName \} from "\.\.\/engines\/topic-mastery-engine"/);
    expect(notes).not.toMatch(/updateTopicMastery|resolveTopicSubject|generateStudyPlan/);
  });

  it("writes one table: NovaNote", () => {
    const writes = [...notes.matchAll(/prisma\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g)].map(m => m[1]);
    expect(writes.length).toBeGreaterThanOrEqual(3);
    expect(new Set(writes)).toEqual(new Set(["novaNote"]));
    expect(notes).not.toMatch(/\$transaction|\$executeRaw|\$queryRaw/);
  });

  it("reads only the note table and what the pickers need", () => {
    const tables = new Set([...notes.matchAll(/prisma\.(\w+)\./g)].map(m => m[1]));
    expect(tables).toEqual(new Set(["novaNote", "novaSubject", "novaStudySession", "messengerUser"]));
  });

  it("every note query carries the learner's profile", () => {
    const calls = [...notes.matchAll(/prisma\.novaNote\.(\w+)\(\{[\s\S]*?\n {2,4}\}\)/g)].map(m => m[0]);
    const all   = [...notes.matchAll(/prisma\.novaNote\.(\w+)\(/g)];
    expect(all.length).toBeGreaterThanOrEqual(6);
    for (const m of all) {
      const from = m.index!;
      const snippet = notes.slice(from, from + 260);
      expect(snippet).toMatch(/profileId/);
    }
    expect(calls.length).toBeGreaterThan(0);
    expect(notes).not.toMatch(/novaNote\.(findUnique|update|delete)\(/);   // the by-id-only forms are not used
  });

  it("no other Nova module reads or writes notes: the brains, the context and consolidation cannot see them", () => {
    const others = sourceFiles(NOVA).filter(f => !f.endsWith("product/notes.ts") && !f.endsWith("product/notes.types.ts"));
    expect(others.length).toBeGreaterThan(60);
    const touching = others.filter(f => /novaNote\b|NovaNote\b|product\/notes"/.test(code(f))).map(f => relative(NOVA, f));
    expect(touching).toEqual([]);
  });

  it("the notes routes never run a Nova turn or call a model", () => {
    const routes = [
      "apps/api/app/api/nova/notes/route.ts", "apps/api/app/api/nova/notes/[id]/route.ts", "apps/api/lib/nova/note-access.ts",
    ].map(f => code(join(REPO, f))).join("\n");
    expect(routes).not.toMatch(/handleNovaTurn|runNovaOrchestrator|nova\/entry|generateOpenAIText|consolidat|understanding/i);
    expect(routes).toMatch(/requireNoteLearner\(\)/);
    // The learner comes from the session. Nothing naming a learner is read from the request.
    expect(routes).not.toMatch(/searchParams\.get\("(userId|profileId|learnerId|platformChatId)"\)/);
    expect(routes).not.toMatch(/body\.(userId|profileId|learnerId)/);
  });

  it("the chat route is not handed notes", () => {
    const chat = code(join(REPO, "apps/api/app/api/nova/message/route.ts"));
    expect(chat).not.toMatch(/note/i);
  });

  it("the Notes pages never send a note to the chat route", () => {
    const web = [join(REPO, "apps/web/components/nova/notes"), join(REPO, "apps/web/app/(dashboard)/notes")]
      .flatMap(dir => sourceFiles(dir));
    expect(web.length).toBeGreaterThan(0);
    for (const file of web) {
      const src = code(file);
      expect(src).not.toMatch(/api\/nova\/message|sendNovaMessage|TalkToNova/);
    }
  });
});
