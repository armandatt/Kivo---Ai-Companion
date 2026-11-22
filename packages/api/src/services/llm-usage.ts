// ─── Token usage of model calls ───────────────────────────────────────────────
// The model client (openai.service.ts) reports how many tokens each call used
// when the provider says; a caller that wants to know runs its work inside
// meterLlmUsage and is told. Calls made outside a meter report to no one, so
// nothing changes for code that does not ask (Rex included).
//
// Separately, every call is also described as an event (emitLlmCall): who it
// was for, which feature and surface asked, what the provider reported and how
// it ended. The entry points say who and what (withUsageContext); the client
// says the rest. Events are measurement only: the daily allowance never reads
// them, and writing one can never fail or slow a model call.

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface LlmUsage {
  provider:      "gemini" | "openai" | "anthropic";
  model:         string;
  inputTokens:   number | null;
  outputTokens:  number | null;
}

const listeners = new AsyncLocalStorage<(usage: LlmUsage) => void>();

// Meters nest: a meter inside another (a route measuring one step inside a
// counted task) sees every call, and so does the one outside it.
export function meterLlmUsage<T>(onUsage: (usage: LlmUsage) => void, work: () => Promise<T>): Promise<T> {
  const outer = listeners.getStore();
  const both = outer ? (usage: LlmUsage) => { try { outer(usage); } catch { /* never breaks a call */ } onUsage(usage); } : onUsage;
  return listeners.run(both, work);
}

export function reportLlmUsage(usage: LlmUsage): void {
  const listener = listeners.getStore();
  if (!listener) return;
  try { listener(usage); } catch { /* a meter must never break a model call */ }
}

// ── Who and what a call is for ────────────────────────────────────────────────

// Every feature that calls a model, named where it is entered, never guessed
// from a route. The Knowledge Map calls none.
export const USAGE_FEATURES = [
  "nova_chat", "nova_setup",
  "build_with_nova", "create_with_nova", "subject_studio", "today_copilot",
  "notes_tutor", "notes_editor", "notes_assist", "notes_proposal", "notes_import", "paper_import",
  "telegram_understanding", "telegram_reply", "telegram_rewording", "telegram_onboarding", "telegram_first_use",
  "extension_ask_nova", "extension_agent", "extension_intent", "capture_placement",
  "saved_page_processing", "saved_page_retry", "scheduled_nova_message",
  "rex", "other",
] as const;
export type UsageFeature = typeof USAGE_FEATURES[number];

export const USAGE_SURFACES = ["web", "telegram", "extension", "background", "script", "unknown"] as const;
export type UsageSurface = typeof USAGE_SURFACES[number];

export interface UsageContext {
  feature:            UsageFeature;
  surface:            UsageSurface;
  interactionId:      string;
  requestId:          string | null;
  // Who it was for. The meter key when the entry point knows it; else the
  // learner (platformChatId) or their profile, resolved when written.
  usageKey:           string | null;
  learner:            string | null;
  profileId:          string | null;
  isBackground:       boolean;
  // Whether this call is inside a request the daily allowance counted.
  isAllowanceCounted: boolean;
  // The interaction's calls, for usage accounting when it ends
  // (billing/accounting/nova.ts). Shared by every context narrowed inside it.
  tally?:             InteractionTally;
}

// What one interaction did, handed to accounting when it ends: every model
// call made inside it (each with the context it was made in), whether the
// work failed, and the reservation its entry point made, if any.
export interface InteractionTally {
  events:      LlmCallEvent[];
  reservation: Promise<string | null> | null;
}
export interface InteractionEnd { context: UsageContext; events: LlmCallEvent[]; failed: boolean; reservation: Promise<string | null> | null }

const contexts = new AsyncLocalStorage<UsageContext>();

// A call made under no entry point at all: recorded, and visibly unattributed.
const UNATTRIBUTED = { feature: "other", surface: "unknown", requestId: null, usageKey: null, learner: null, profileId: null, isBackground: false, isAllowanceCounted: false } as const;

export function currentUsageContext(): UsageContext | undefined {
  return contexts.getStore();
}

// A new learner action or job: its own interaction id, nothing inherited
// but what is given.
// When it ends (returned or threw), its calls go to usage accounting.
export function startInteraction<T>(context: Partial<Omit<UsageContext, "interactionId" | "tally">> & Pick<UsageContext, "feature" | "surface">, work: () => Promise<T>): Promise<T> {
  const tally: InteractionTally = { events: [], reservation: null };
  const ctx: UsageContext = { ...UNATTRIBUTED, ...context, interactionId: randomUUID(), tally };
  return contexts.run(ctx, async () => {
    let failed = false;
    try {
      return await work();
    } catch (err) {
      failed = true;
      throw err;
    } finally {
      endInteraction({ context: ctx, events: tally.events, failed, reservation: tally.reservation });
    }
  });
}

// Narrows the current interaction (a different feature for one call, say)
// and keeps its id. With no interaction open, starts one.
export function withUsageContext<T>(context: Partial<Omit<UsageContext, "interactionId">>, work: () => Promise<T>): Promise<T> {
  const parent = contexts.getStore();
  return contexts.run({ ...UNATTRIBUTED, ...parent, ...context, interactionId: parent?.interactionId ?? randomUUID() }, work);
}

// Fills in who the open interaction is for once the entry point knows (a
// webhook learns the chat only after reading the update). Contexts already
// narrowed inside it keep what they had.
export function annotateUsage(context: Partial<Pick<UsageContext, "learner" | "requestId" | "usageKey" | "profileId">>): void {
  const store = contexts.getStore();
  if (store) Object.assign(store, context);
}

// ── What the client observed ──────────────────────────────────────────────────

export type LlmOutcome = "success" | "failed" | "not_sent";
export type LlmFailure =
  | "rate_limited" | "overloaded" | "provider_error" | "request_error" | "auth" | "timeout" | "aborted" | "network"
  | "invalid_response" | "refusal" | "over_price_tier" | "config" | "unknown";

// Normalised across providers. Every count is what the provider reported, or
// null when it reported nothing: a missing count is never a zero.
export interface NormalizedUsage {
  inputTokens:              number | null;  // uncached input
  outputTokens:             number | null;  // includes thinking where the provider bills it as output
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens:     number | null;
  // Anthropic's split of cache writes by lifetime, when it gives one.
  cacheCreation5mTokens?:   number | null;
  cacheCreation1hTokens?:   number | null;
  // Anything that changes the price list that applies.
  inferenceGeo?:            string | null;
  serviceTier?:             string | null;
  speed?:                   string | null;
  // The call ended before the provider's final count (an aborted stream):
  // these are the counts seen so far, a lower bound.
  partial?:                 boolean;
}

export const NO_USAGE: NormalizedUsage = { inputTokens: null, outputTokens: null, cacheCreationInputTokens: null, cacheReadInputTokens: null };
export const NOTHING_SENT: NormalizedUsage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };

export interface LlmCall {
  provider:         LlmUsage["provider"];
  model:            string;
  usage:            NormalizedUsage;
  attempts:         number | null;
  outcome:          LlmOutcome;
  failureCategory:  LlmFailure | null;
  latencyMs:        number;
  at:               Date;
}

export type LlmCallEvent = LlmCall & { context: UsageContext };
type Sink = (event: LlmCallEvent) => Promise<void>;

// Production writes each event to Postgres (billing/usage-events.ts, loaded
// on first use so this file stays free of the database). Tests set their own.
const databaseSink: Sink = async event => {
  const { writeUsageEvent } = await import("../billing/usage-events");
  await writeUsageEvent(event);
};
let sink: Sink | null = databaseSink;
export function setLlmCallSink(next: Sink | null | "database"): void {
  sink = next === "database" ? databaseSink : next;
}

const pending = new Set<Promise<void>>();
let lastFailureLog = 0;

// Hands the call to the sink without waiting for it. A failure to record is
// logged (by kind only, at most once a minute) and never reaches the caller.
export function emitLlmCall(call: LlmCall): void {
  if (process.env.AI_USAGE_EVENTS_DISABLED === "true" || !sink) {
    const store = contexts.getStore();
    if (store?.tally) store.tally.events.push({ ...call, context: store });
    return;
  }
  const context = contexts.getStore() ?? { ...UNATTRIBUTED, interactionId: randomUUID() };
  const event: LlmCallEvent = { ...call, context };
  // Accounting: the interaction settles it when it ends; a call made under
  // no interaction is settled on its own, so none is left out.
  if (context.tally) context.tally.events.push(event);
  else endInteraction({ context, events: [event], failed: false, reservation: null });
  let write: Promise<void>;
  try {
    write = sink(event);
  } catch (err) {
    write = Promise.reject(err);
  }
  const tracked: Promise<void> = write.catch(err => {
    const now = Date.now();
    if (now - lastFailureLog > 60_000) {
      lastFailureLog = now;
      console.error(`[llm-usage] usage event not recorded: ${(err as Error)?.name ?? "error"}`);
    }
  }).finally(() => { pending.delete(tracked); });
  pending.add(tracked);
}

// ── Interactions, to usage accounting ─────────────────────────────────────────
// Production settles each ended interaction on the usage ledger
// (billing/accounting/nova.ts, loaded on first use). Tests set their own.
type InteractionSink = (end: InteractionEnd) => Promise<void>;
const accountingSink: InteractionSink = async end => {
  const { settleInteraction } = await import("../billing/accounting/nova");
  await settleInteraction(end);
};
let interactionSink: InteractionSink | null = accountingSink;
export function setInteractionSink(next: InteractionSink | null | "accounting"): void {
  interactionSink = next === "accounting" ? accountingSink : next;
}

function endInteraction(end: InteractionEnd): void {
  if (!interactionSink || process.env.USAGE_ACCOUNTING === "off") return;
  if (end.events.length === 0 && !end.reservation) return;
  let settle: Promise<void>;
  try {
    settle = interactionSink(end);
  } catch (err) {
    settle = Promise.reject(err);
  }
  const tracked: Promise<void> = settle.catch(err => {
    const now = Date.now();
    if (now - lastFailureLog > 60_000) {
      lastFailureLog = now;
      console.error(`[llm-usage] interaction not settled: ${(err as Error)?.name ?? "error"}`);
    }
  }).finally(() => { pending.delete(tracked); });
  pending.add(tracked);
}

// Waits for every event handed over so far (tests; shutdown).
export async function flushLlmCalls(): Promise<void> {
  while (pending.size > 0) await Promise.all([...pending]);
}
