import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { TOOLS } from "../tools";
import { ALL_SCOPES } from "../oauth-rules";
import { planIdOf } from "../plans";

describe("Kivo Connect tool registry", () => {
  test("names are unique, descriptions say what the tool does, scopes are known", () => {
    expect(new Set(TOOLS.map(t => t.name)).size).toBe(TOOLS.length);
    for (const t of TOOLS) {
      expect(t.description.length).toBeGreaterThan(60);
      expect(t.scopes.length).toBeGreaterThan(0);
      for (const s of t.scopes) expect(ALL_SCOPES).toContain(s);
    }
  });
  test("every spec'd tool exists", () => {
    const names = TOOLS.map(t => t.name);
    for (const n of ["get_my_profile", "list_workspaces", "get_workspace_context", "get_workspace_structure", "get_dashboard_summary",
      "search_notes", "get_note", "create_note", "update_note", "delete_note", "move_note", "link_notes", "list_recent_notes",
      "get_knowledge_map", "add_knowledge_node", "update_knowledge_node", "connect_knowledge_nodes", "get_node_connections", "search_knowledge_nodes", "build_knowledge_map",
      "global_search", "find_related_content", "find_knowledge_gaps", "summarize_workspace", "recommend_connections", "analyze_knowledge",
      "capture_knowledge", "organize_workspace", "preview_knowledge_changes", "execute_knowledge_changes"]) expect(names).toContain(n);
  });
  test("no tool takes an identity: the learner comes from the token", () => {
    for (const t of TOOLS) for (const k of Object.keys(t.input)) expect(["userId", "profileId", "accountId", "platformChatId", "email"]).not.toContain(k);
  });
  test("read tools ask for no write scope; writing tools ask for one", () => {
    for (const t of TOOLS) {
      const writes = t.scopes.some(s => s.endsWith(":write"));
      if (t.kind === "read") expect(writes).toBe(false);
      else expect(writes).toBe(true);
    }
  });
  test("deleting is destructive and goes through review", () => {
    const del = TOOLS.find(t => t.name === "delete_note")!;
    expect(del.destructive).toBe(true);
    expect(del.kind).toBe("structural");
  });
  test("a plan id binds the account, the records' versions, the changes and the expiry", () => {
    const c = [{ op: "delete_note" as const, noteId: "n1" }];
    const base = planIdOf("u1", "v1", [{ id: "n1", updatedAt: "t1" }], c, "2026-11-13T10:30:00.000Z");
    expect(base).toMatch(/^[a-f0-9]{32}$/);
    expect(planIdOf("u1", "v1", [{ id: "n1", updatedAt: "t1" }], c, "2026-11-13T10:30:00.000Z")).toBe(base);
    expect(planIdOf("u2", "v1", [{ id: "n1", updatedAt: "t1" }], c, "2026-11-13T10:30:00.000Z")).not.toBe(base);
    expect(planIdOf("u1", "v2", [{ id: "n1", updatedAt: "t1" }], c, "2026-11-13T10:30:00.000Z")).not.toBe(base);
    expect(planIdOf("u1", "v1", [{ id: "n1", updatedAt: "t2" }], c, "2026-11-13T10:30:00.000Z")).not.toBe(base);
    expect(planIdOf("u1", "v1", [{ id: "n1", updatedAt: "t1" }], [{ op: "delete_note", noteId: "n2" }], "2026-11-13T10:30:00.000Z")).not.toBe(base);
    expect(planIdOf("u1", "v1", [{ id: "n1", updatedAt: "t1" }], c, "2026-11-13T11:30:00.000Z")).not.toBe(base);
  });
  test("Kivo Connect writes no learning table itself: notes, subjects and topics only through their owners", () => {
    const dir = join(__dirname, "..");
    for (const f of readdirSync(dir).filter(f => f.endsWith(".ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src).not.toMatch(/prisma\.nova(Note|Subject|TopicMastery|LearningEvent|Task|Workspace)\b/);
      expect(src).not.toMatch(/\$executeRaw|\$queryRaw/);
    }
  });
  test("nothing in Kivo Connect calls a model", () => {
    const dir = join(__dirname, "..");
    for (const f of readdirSync(dir).filter(f => f.endsWith(".ts"))) expect(readFileSync(join(dir, f), "utf8")).not.toMatch(/openai\.service|generateOpenAIText|llmProviders/);
  });
});
