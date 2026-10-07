// ─── Nova on Telegram: contracts ──────────────────────────────────────────────
// Telegram is a surface. Nothing here is learner state: the session, the
// plan, mastery, reality and memory live where they always did and are
// reached through the same product functions the web app calls.
//
// Three kinds of input, and only one of them is language:
//   command   "/today"            protocol, no model call
//   callback  a button tap         protocol, no model call
//   text      anything else        one Understanding call, then the same
//                                  deterministic action path as the other two

import type { NovaSessionOutcome } from "../product/today.types";
import type { StudyTime } from "../types/understanding.types";

// ── Inbound ───────────────────────────────────────────────────────────────────

export type TelegramCommandName =
  | "start" | "today" | "focus" | "done" | "status" | "settings" | "help"
  // Older Nova commands. /study is /focus with a topic; the rest are deep
  // work and are handed to the web app.
  | "study" | "explain" | "quiz" | "revise";

interface EventBase {
  updateId: number | null;
  chatId:   string;
  // Telegram's id for the sender. In a private chat it equals the chat id.
  fromId:   string | null;
}

export type TelegramEvent =
  | (EventBase & { kind: "command"; command: TelegramCommandName; argument: string })
  | (EventBase & { kind: "callback"; callbackId: string; data: string; messageId: number | null })
  | (EventBase & { kind: "text"; text: string })
  // Recognised but not handled: an unknown command, a photo, an edit.
  | (EventBase & { kind: "unsupported"; reason: "unknown_command" | "not_text" })
  // Not a private chat, or not shaped like an update we act on.
  | { kind: "ignored"; reason: "not_private" | "malformed" | "no_chat"; updateId: number | null; chatId: string | null };

// ── What a button does ────────────────────────────────────────────────────────
// Closed vocabulary. An option's action is stored with the prompt on the
// server; a tap only names the prompt and the option.

export type OptionAction =
  | { type: "start"; topicName: string; subjectName: string | null; minutes: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "ask_outcome" }
  | { type: "end"; outcome: NovaSessionOutcome }
  | { type: "today"; minutes: number | null }
  | { type: "something_else"; skip: string[] }
  | { type: "status" }
  | { type: "later" }
  | { type: "not_today" }
  | { type: "add_exam"; title: string; subjectName: string | null; date: string }   // date: YYYY-MM-DD
  | { type: "dismiss" }
  | { type: "set_proactive"; enabled: boolean }
  // What the learner said a subject covers, or how they usually study, as it
  // was shown back to them. Saved by product/setup.ts when they confirm.
  | { type: "save_setup"; subjectName: string | null; topics: string[]; dailyMinutes: number | null; studyTime: StudyTime | null };

export interface PromptOption {
  id:     string;      // short, unique within the prompt: "a", "b", …
  label:  string;
  action: OptionAction;
}

export type PromptKind =
  | "start"            // a recommendation with Start buttons
  | "session"          // a running session: Pause / Resume / End
  | "session_outcome"  // "How did it go?"
  | "nudge"            // a proactive message
  | "confirm_exam"
  | "confirm_setup"    // "Add these topics to Operating Systems?"
  | "pick_minutes"     // a range of time, asked back as a choice
  | "clarify"
  | "settings";

// How long a prompt can still be answered. After that a tap is told it is
// closed and a typed "yes" is no longer read against it.
export const PROMPT_TTL_MINUTES: Record<PromptKind, number> = {
  start:           180,
  session:         240,
  session_outcome: 120,
  nudge:           720,
  confirm_exam:    30,
  confirm_setup:   30,
  pick_minutes:    15,
  clarify:         15,
  settings:        30,
};

export interface PromptSpec {
  kind:    PromptKind;
  options: PromptOption[];
}

// ── Outbound ──────────────────────────────────────────────────────────────────

export interface TelegramReply {
  text:    string;
  prompt?: PromptSpec;
  // A plain link button ("Open Nova"). No callback, no state.
  link?:   { label: string; path: string };
}

export interface InlineButton {
  text:           string;
  callback_data?: string;
  url?:           string;
}

export type SendResult =
  | { ok: true; messageId: number }
  | {
      ok:   false;
      // blocked: the learner blocked the bot or deleted the chat.
      // unknown: no answer came back, so the message may or may not have arrived.
      kind: "blocked" | "rate_limited" | "bad_request" | "server" | "unknown";
      retryAfterSeconds?: number;
      detail: string;
    };

export interface TelegramClient {
  sendMessage(chatId: string, text: string, buttons?: InlineButton[][]): Promise<SendResult>;
  answerCallback(callbackId: string, text?: string): Promise<void>;
  clearButtons(chatId: string, messageId: number): Promise<void>;
  setChatCommands(chatId: string, commands: Array<{ command: string; description: string }>): Promise<void>;
}

// ── One line per turn ─────────────────────────────────────────────────────────
// What happened to an update, without its content. `correlationId` appears on
// every log line the turn produces.

export type FailureCategory =
  | "none" | "understanding_failed" | "understanding_malformed" | "response_failed"
  | "operation_failed" | "send_failed" | "rate_limited" | "budget_exhausted"
  | "busy" | "stale_prompt" | "forged_callback" | "internal";

export interface TurnTrace {
  correlationId: string;
  surface:       "telegram";
  type:          TelegramEvent["kind"];
  command:       string | null;
  profileId:     string | null;
  understanding: { attempted: boolean; ok: boolean; ms: number; confidence: number | null; kind: string | null; request: string | null; clarity: string | null; changeOfMind: boolean; intent: string | null; estInputTokens: number };
  decision:      string | null;
  operation:     { name: string | null; ok: boolean | null };
  evidence:      { kinds: string[]; consolidationQueued: boolean };
  response:      { generated: boolean; ok: boolean | null; ms: number; fallback: boolean };
  send:          { status: "sent" | "failed" | "skipped"; messageId: number | null; failure: string | null };
  promptId:      string | null;
  failure:       FailureCategory;
  textLength:    number;
  totalMs:       number;
}
