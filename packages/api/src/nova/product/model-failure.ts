// ─── When a model call does not give Nova an answer ──────────────────────────
// One place that says what went wrong with a model call, for every Nova
// surface that calls the model directly (the note editor and tutor, Today's
// Nova, the study proposal, Build with Nova). Pure apart from the log line.
//
// Why this exists: each surface used to turn every failure into one sentence,
// and some of them ("try saying it another way") blamed the learner's words for
// what was a rate limit, a timeout or a reply cut off. Infrastructure is never
// the learner's fault, and a request is never refused as unclear because the
// provider was busy. The categories are the LLM client's own (llm-usage.ts
// LlmFailure), read from the error with llmFailureOf.
//
// What is logged: the surface, the operation, the category, whether it can be
// retried, the time taken and counts. Never the learner's words, a note's text,
// a prompt or a reply.

import { llmFailureOf } from "../../services/llmProviders";

// What the learner is told, by kind. `unreadable` is a reply that came back
// but could not be used (malformed JSON, cut off): the request itself was fine.
export type ModelProblem = "busy" | "timeout" | "unreadable" | "too_large" | "unavailable" | "declined";

export interface ModelFailure {
  problem: ModelProblem;
  // The client's own category (rate_limited, overloaded, timeout, ...), for logs.
  category: string;
  // A retry in a moment may work. A configuration fault or a request that is
  // too big will not.
  retryable: boolean;
  message: string;
}

const MESSAGES: Record<ModelProblem, string> = {
  busy:        "Nova's model is busy right now, so nothing was done. Try again in a moment.",
  timeout:     "Nova took too long to answer, so nothing was done. Try again in a moment.",
  unreadable:  "Nova's answer came back incomplete, so nothing was done. Try again.",
  too_large:   "That is too much for Nova to read at once, so nothing was done. Choose a smaller passage or fewer files.",
  unavailable: "Nova isn't available right now, so nothing was done. Try again later.",
  declined:    "Nova couldn't help with that request, so nothing was done.",
};

export function modelFailure(err: unknown, pastDeadline = false): ModelFailure {
  const category = llmFailureOf(err, pastDeadline);
  const problem: ModelProblem =
    category === "rate_limited" || category === "overloaded" || category === "provider_error" || category === "network" ? "busy"
    : category === "timeout" || category === "aborted" ? "timeout"
    : category === "invalid_response" ? "unreadable"
    : category === "over_price_tier" ? "too_large"
    : category === "refusal" ? "declined"
    : category === "auth" || category === "config" || category === "request_error" ? "unavailable"
    // Unknown: most likely a transient failure, and a retry costs the learner nothing.
    : "busy";
  return { problem, category, retryable: problem === "busy" || problem === "timeout" || problem === "unreadable", message: MESSAGES[problem] };
}

// A reply that arrived but could not be read is its own failure, not the
// learner's request being unclear.
export const unreadableReply = (): ModelFailure => ({ problem: "unreadable", category: "invalid_response", retryable: true, message: MESSAGES.unreadable });

export const failureMessage = (problem: ModelProblem): string => MESSAGES[problem];

// One structured line per failure. `meta` takes counts and ids only.
export function logModelFailure(surface: string, operation: string, failure: ModelFailure, meta: Record<string, string | number | boolean | null> = {}): void {
  console.error(JSON.stringify({ layer: "nova_model", event: "failed", surface, operation, problem: failure.problem, category: failure.category, retryable: failure.retryable, ...meta }));
}

// One structured line for how a request's context was put together: sizes and
// counts, never content. Makes a long conversation's growth visible in logs.
export function logContext(surface: string, meta: Record<string, string | number | boolean | null>): void {
  console.log(JSON.stringify({ layer: "nova_context", surface, ...meta }));
}

// The JSON object in a model's reply, or null. Tries each "{" in turn, so
// a sentence before the object does not hide it.
export function jsonObjectIn(raw: string): Record<string, unknown> | null {
  const end = raw.lastIndexOf("}");
  for (let at = raw.indexOf("{"); at !== -1 && at < end; at = raw.indexOf("{", at + 1)) {
    try {
      const o = JSON.parse(raw.slice(at, end + 1)) as unknown;
      if (o && typeof o === "object" && !Array.isArray(o)) return o as Record<string, unknown>;
    } catch { /* the next one */ }
  }
  return null;
}

// Time left for one more attempt inside a caller's deadline.
export const timeLeft = (deadlineMs: number, startedAt: number, now = Date.now()): number => deadlineMs - (now - startedAt);
