// ─── Kivo Connect tools for usage accounting: read or write ──────────────────
// Every MCP tool, classed by what its handler does on the server (checked
// against tools.ts, 2026-11-22), not by its name or its `kind` hint:
//   read    reads the learner's records and writes nothing a learner owns
//   write   creates, changes, files, links, deletes, or stores anything that
//           can change the learner's records later
// Free's read-only allowance (after the lifetime one) admits `read` only.
// A tool missing from this table is accounted as `write` and logged
// (unclassifiedTools): it can never pass as a read. Held by
// __tests__/usage-class.test.ts, which fails when tools.ts has a tool this
// table does not name.
//
// Batch tools also report how many items one call carries (`items`), counted
// beside the allowance as abuse units: one call is one unit of the allowance,
// whatever its size.

import type { McpKind } from "../billing/accounting/rules";

interface ToolClass { kind: McpKind; why: string; items?: (args: Record<string, unknown>) => number }

const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
const outlineSize = (v: unknown): number =>
  Array.isArray(v) ? v.reduce((a: number, x) => a + 1 + outlineSize((x as { children?: unknown } | null)?.children), 0) : 0;
const withFiles = (a: Record<string, unknown>) => 1 + len(a.images) + len(a.files);

export const MCP_TOOL_CLASS: Record<string, ToolClass> = {
  get_my_profile:            { kind: "read",  why: "profile and scopes" },
  list_workspaces:           { kind: "read",  why: "workspace list" },
  get_workspace_context:     { kind: "read",  why: "workspace, notes and map summary" },
  get_workspace_structure:   { kind: "read",  why: "subject/topic tree" },
  get_dashboard_summary:     { kind: "read",  why: "counts and recent items" },
  search_notes:              { kind: "read",  why: "keyword search" },
  get_note:                  { kind: "read",  why: "one note, links, optional images" },
  list_recent_notes:         { kind: "read",  why: "recent notes" },
  get_knowledge_map:         { kind: "read",  why: "map read" },
  search_knowledge_nodes:    { kind: "read",  why: "map search" },
  get_node_connections:      { kind: "read",  why: "map edges" },
  get_saved_page:            { kind: "read",  why: "one saved page" },
  search_saved_pages:        { kind: "read",  why: "saved-page search" },
  global_search:             { kind: "read",  why: "search everything" },
  find_related_content:      { kind: "read",  why: "keyword similarity" },
  analyze_knowledge:         { kind: "read",  why: "structure facts" },
  summarize_workspace:       { kind: "read",  why: "summary" },
  recommend_connections:     { kind: "read",  why: "suggestions, nothing applied" },
  find_knowledge_gaps:       { kind: "read",  why: "gaps, nothing applied" },
  organize_workspace:        { kind: "read",  why: "proposals only; applying goes through preview/execute" },
  check_approval:            { kind: "read",  why: "a plan's status; writes only its own refusal audit" },

  create_note:               { kind: "write", why: "creates a note (and its images)", items: withFiles },
  update_note:               { kind: "write", why: "appends, renames, adds images; renames wait for approval", items: withFiles },
  delete_note:               { kind: "write", why: "deletes a note (after approval)" },
  move_note:                 { kind: "write", why: "refiles a note (after approval)" },
  link_notes:                { kind: "write", why: "writes a [[link]] into a note" },
  add_knowledge_node:        { kind: "write", why: "creates a subject or topics", items: a => Math.max(1, len(a.topics)) },
  update_knowledge_node:     { kind: "write", why: "describes or renames a node" },
  connect_knowledge_nodes:   { kind: "write", why: "links or files map items" },
  build_knowledge_map:       { kind: "write", why: "creates topics from an outline (preview mode stores a plan)", items: a => Math.max(1, outlineSize(a.outline)) },
  save_page:                 { kind: "write", why: "saves a page to Saved Pages" },
  file_saved_page:           { kind: "write", why: "files a saved page" },
  unfile_saved_page:         { kind: "write", why: "unfiles a saved page" },
  capture_knowledge:         { kind: "write", why: "creates/appends notes; preview stores a plan", items: a => Math.max(1, len(a.items)) },
  // Its description says it writes nothing to the learner's records, but it
  // stores a pending plan that Approve on Kivo applies (connect/plans.ts
  // approveAndApply): allowing it as a read would let read-only mode change
  // knowledge.
  preview_knowledge_changes: { kind: "write", why: "stores a plan the learner's Approve applies", items: a => Math.max(1, len(a.changes)) },
  execute_knowledge_changes: { kind: "write", why: "applies a previewed plan", items: a => Math.max(1, len(a.changes)) },
};

export interface McpCallClass { kind: McpKind; items: number; classified: boolean }

export function classifyMcpCall(tool: string, args: Record<string, unknown> | null | undefined): McpCallClass {
  const c = MCP_TOOL_CLASS[tool];
  if (!c) return { kind: "write", items: 1, classified: false };
  let items = 1;
  try { items = c.items ? Math.max(1, Math.min(10_000, Math.floor(c.items(args ?? {})))) : 1; } catch { items = 1; }
  return { kind: c.kind, items, classified: true };
}

// Tools that exist but are not in the table (for the test and the log).
export function unclassifiedTools(names: readonly string[]): string[] {
  return names.filter(name => !(name in MCP_TOOL_CLASS));
}
