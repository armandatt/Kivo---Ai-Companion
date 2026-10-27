// ─── Workspaces: the contract the web app reads ───────────────────────────────
// No imports beyond types, so the web app imports it directly.

import type { WorkspacePlan } from "./workspace-plan";

export interface WorkspaceSummary {
  id:              string;
  // template: made from a Kio template. custom: designed by Nova.
  kind:            "template" | "custom";
  templateId:      string | null;
  templateName:    string | null;
  title:           string;
  summary:         string | null;
  createdAt:       string;
  // Its subjects as they now are (renamed or removed ones show as they stand).
  subjects:        Array<{ id: string; name: string }>;
}

export interface WorkspacesView { status: "ready"; workspaces: WorkspaceSummary[] }

export interface WorkspaceCounts { subjectsAdded: number; topicsAdded: number; datesAdded: number; tasksAdded: number; notesAdded: number; notesSkipped: string[]; datesSkipped: string[] }

export type CreateWorkspaceResponse =
  // Made now, or added to the workspace named.
  | { ok: true; status: "created" | "updated"; workspace: WorkspaceSummary; counts: WorkspaceCounts }
  // This request was made before (same key): nothing written again.
  | { ok: true; status: "exists"; workspace: WorkspaceSummary }
  // A workspace like it exists. Nothing written: open it, add to it, or ask for another.
  | { ok: true; status: "similar"; similar: WorkspaceSummary[] }
  | { ok: false; error: "invalid" | "not_found" | "too_many" | "not_ready" | "failed"; message: string };

// What "Create with Nova" or a template preview proposes. Nothing is stored.
export type ProposeResponse =
  | {
      ok: true;
      route: "use" | "adapt" | "custom";
      reason: string;
      plan: WorkspacePlan;
      // What the check left out of Nova's reply, in words.
      dropped: string[];
      // Workspaces of theirs this would repeat.
      similar: WorkspaceSummary[];
    }
  | { ok: true; route: "not_creation"; message: string }
  | { ok: true; route: "clarify"; question: string }
  | { ok: false; error: "invalid" | "files" | "unavailable" | "bad_output" | "not_ready"; message: string };
