// ─── Learning events: the contract between a learner's browser and Nova ───────
// A learning event is something the learner explicitly did with a page:
// saved it, or asked to study it. It records that action. It is not a study
// session and says nothing about what the learner knows:
//
//   viewing a page  is not  learning it
//   saving a page   is not  mastering it
//
// Nothing here carries page content. No imports, so the web app and the
// extension's tests can read the types directly.

export type LearningEventType   = "resource_saved" | "study_requested";
export type LearningEventSource = "browser_extension";

export const EVENT_URL_MAX   = 2048;
export const EVENT_TITLE_MAX = 300;
export const EVENT_TOPIC_MAX = 120;
// The whole request. Anything larger is refused unread.
export const EVENT_BODY_MAX_BYTES = 8 * 1024;
export const EVENT_ID_MIN    = 16;
export const EVENT_ID_MAX    = 64;
export const EVENTS_PER_MINUTE = 20;

// What the extension sends. Every other field in the request is ignored:
// there is no metadata bag, and no field names whose event this is.
export interface LearningEventInput {
  eventType:     LearningEventType;
  // Made up by the client for this one action. A retry sends the same id.
  clientEventId: string;
  url:           string;
  title:         string;
  capturedAt?:   string;            // ISO time of the action
  subjectId?:    string | null;     // one of the learner's own subjects
  topicName?:    string | null;     // needs a subject
}

// A page the learner saved or asked to study.
export interface LearningResource {
  id:          string;
  eventType:   LearningEventType;
  url:         string;
  domain:      string;
  title:       string;
  subjectId:   string | null;
  subjectName: string | null;
  topicName:   string | null;
  savedAt:     string;
  // Whether a session can be started from it as it stands. A session needs
  // a subject and a topic to be tied to anything.
  study: { available: boolean; blockedBy: "no_subject" | "no_topic" | null; minutes: number };
}

export type LearningEventError =
  | "invalid" | "invalid_url" | "unknown_subject" | "too_large" | "rate_limited"
  | "unauthenticated" | "not_nova" | "not_connected" | "onboarding_incomplete" | "failed";

export type LearningEventResponse =
  | {
      success:  true;
      eventId:  string;
      action:   "saved" | "already_saved" | "study_requested";
      // true: this exact action had been received before; nothing was written.
      duplicate: boolean;
      resource: LearningResource;
      // Where the web app continues a study request. null for a save.
      focusPath: string | null;
    }
  | { success: false; error: LearningEventError; message: string };

// GET /api/nova/learning-events
export interface NovaSavedResourcesReady {
  status:    "ready";
  resources: LearningResource[];          // newest first
  subjects:  Array<{ id: string; name: string }>;
  activeSession: { topicName: string | null } | null;
}
export type NovaSavedResourcesView =
  | NovaSavedResourcesReady
  | { status: "not_nova" } | { status: "not_connected" } | { status: "onboarding_incomplete" };

// GET /api/nova/learning-events/[id]
export type LearningResourceResponse =
  | { ok: true; resource: LearningResource; subjects: Array<{ id: string; name: string; topics: string[] }> }
  | { ok: false; error: "not_found" | LearningEventError; message: string };

// ── The extension ─────────────────────────────────────────────────────────────

// GET /api/nova/extension/context: what the popup needs to offer a save.
export type ExtensionContext =
  | {
      status:   "ready";
      learner:  { name: string | null };
      subjects: Array<{ id: string; name: string; topics: string[] }>;
      activeSession: { topicName: string | null } | null;
      limits:   { title: number; topic: number };
    }
  | { status: "not_nova" } | { status: "not_connected" } | { status: "onboarding_incomplete" };

// POST /api/nova/extension/pair (signed-in web app)
export type PairingCodeResponse =
  | { ok: true; code: string; expiresAt: string }
  | { ok: false; error: "unauthenticated" | "not_nova" | "not_connected" | "failed"; message: string };

// POST /api/nova/extension/connect (the extension, with the code)
export type ExtensionConnectResponse =
  | { ok: true; token: string; idleDays: number }
  | { ok: false; error: "invalid_code" | "rate_limited" | "failed"; message: string };

// GET /api/nova/extension/connections (signed-in web app)
export interface ExtensionConnectionView {
  id:          string;
  label:       string | null;
  connectedAt: string;
  lastUsedAt:  string | null;
}
