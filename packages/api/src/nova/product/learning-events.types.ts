// ─── Learning events: the contract between a learner's browser and Nova ───────
// A learning event is something the learner explicitly did with a page:
// saved it, or asked to study it. It records that action. It is not a study
// session and says nothing about what the learner knows:
//
//   viewing a page  is not  learning it
//   saving a page   is not  mastering it
//
// The only page content an event may carry is a passage the learner selected
// and sent themselves ("selection_saved"). No imports, so the web app and the
// extension's tests can read the types directly.

// resource_saved: a page. selection_saved: a passage the learner selected on a
// page. study_requested: a page the learner asked to study now.
export type LearningEventType   = "resource_saved" | "selection_saved" | "study_requested";
// Where the action was taken: the extension's popup, or the web app's own
// "Save a link" box (which the bookmarklet also opens). Set by the server from
// the kind of credential the request carried, never read from the request.
export type LearningEventSource = "browser_extension" | "web";

export const EVENT_URL_MAX   = 2048;
export const EVENT_TITLE_MAX = 300;
export const EVENT_TOPIC_MAX = 120;
// The whole request. Anything larger is refused unread. Room for a full
// passage in a script that takes three bytes a character, escaped as JSON.
export const EVENT_BODY_MAX_BYTES = 32 * 1024;
// A selected passage: about 600 words. Longer selections are refused, not
// cut: the learner should know what was kept.
export const EVENT_EXCERPT_MAX = 4000;
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
  canonicalUrl?: string | null;     // the page's own canonical link, if it has one
  excerpt?:      string | null;     // selection_saved only: the selected passage
}

// ── What processing found ─────────────────────────────────────────────────────
// A saved page is looked at once, in the background, for what it connects to
// among the learner's own subjects and topics. Nothing here is knowledge
// about the learner: a connection says a page is about a topic, never that
// the learner knows the topic.
export type ProcessingStatus = "none" | "pending" | "processing" | "done" | "failed";

export interface ResourceConnection {
  subjectId:   string;
  subjectName: string;
  topicName:   string | null;       // null: the subject as a whole
  // high: the learner's own topic or subject name appears, word for word, in
  // the title or the selected passage. possible: a model's reading.
  confidence:  "high" | "possible";
  basis:       "name_in_title" | "name_in_selection" | "model";
}

export interface ResourceConnections {
  version:     1;
  // Short names of what the page is about, in the model's words. Shown as
  // labels; they create no topic.
  concepts:    string[];
  suggestions: ResourceConnection[];
  // Whether a model was consulted. false: only name matching ran.
  model:       boolean;
}

export interface ResourceProcessing {
  status:      ProcessingStatus;
  // In words, when it failed.
  error:       string | null;
  canRetry:    boolean;
  concepts:    string[];
  // Connections the learner has not acted on. One that matches where the
  // page is already filed is left out.
  suggestions: ResourceConnection[];
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
  canonicalUrl: string | null;
  excerpt:      string | null;
  // "nova": Nova filed it here from a name match; the learner can keep or undo it.
  filedBy:      "learner" | "nova" | null;
  processing:   ResourceProcessing;
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

// PATCH /api/nova/learning-events/[id]  { subjectId, topicName } | { keep: true } | { undo: true } | { dismiss: { subjectId, topicName } }
// POST  /api/nova/learning-events/[id]/process
export type ResourceUpdateResponse =
  | { ok: true; resource: LearningResource }
  | { ok: false; error: "not_found" | "invalid" | "unknown_subject" | "busy" | LearningEventError; message: string };

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
      limits:   { title: number; topic: number; excerpt: number };
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
