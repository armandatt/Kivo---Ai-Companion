// ─── Nova's help on a note: the contract with the notes page ──────────────────
// No imports, so the web app imports it directly. Rules: product/note-assist.ts.

export const NOTE_ASSIST_ACTIONS = ["summarize", "structure", "concepts", "links", "ask"] as const;
export type NoteAssistAction = (typeof NOTE_ASSIST_ACTIONS)[number];
export const NOTE_ASSIST_QUESTION_MAX = 500;

// One thing the model was given, labelled as it was given (S1 is the note).
export interface NoteAssistSource {
  id:       string;                    // "S1", "S2", …
  kind:     "note" | "resource";
  recordId: string;                    // the note's or saved page's own id
  title:    string;
  domain:   string | null;             // a saved page's site
  url:      string | null;
}

export type NoteAssistResponse =
  | {
      ok: true;
      action:       NoteAssistAction;
      sources:      NoteAssistSource[];
      // What the sources say, each claim marked with the [S#] it rests on.
      fromSources:  string;
      // What Nova adds of its own. Shown apart, and labelled as Nova's.
      nova:         string;
      // The sources do not contain what was asked.
      notInSources: boolean;
      // Proposals only: nothing is created or linked until the learner does it.
      concepts:     string[];
      links:        Array<{ sourceId: string; why: string }>;
      // A suggested rewrite of the learner's text ("structure"). It goes into
      // the editor unsaved; only their Save keeps it.
      draft:        string | null;
    }
  | { ok: false; error: "invalid" | "too_long" | "not_found" | "empty" | "unavailable" | "rate_limited" | "unauthenticated" | "not_nova" | "not_connected" | "onboarding_incomplete" | "failed"; message: string };
