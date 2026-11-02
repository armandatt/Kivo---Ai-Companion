// ─── LLM providers ────────────────────────────────────────────────────────────
// Request building and response parsing for each provider the single LLM
// client (openai.service.ts) can talk to. Pure: no network, no env loading,
// so it can be unit-tested.
//
// Callers across the codebase ask for OpenAI model names ("gpt-4o-mini",
// "gpt-4o"). Those are treated as a TIER, not a literal model, so the same
// call sites work on any provider.

import type Anthropic from "@anthropic-ai/sdk";
import { NO_USAGE, type LlmFailure, type NormalizedUsage } from "./llm-usage";

export type LlmProvider = "openai" | "gemini" | "anthropic";

export interface LlmRequest {
  prompt:             string;
  systemInstruction?: string;
  maxOutputTokens?:   number;
  model?:             string;   // the model the caller asked for (an OpenAI name)
  // The longest the caller will wait for an answer, across every attempt and
  // every pause between attempts. Absent: the provider's own timeouts and
  // retries apply. A chat turn sets it so a slow or rate-limited provider
  // fails in time for the turn to answer without it.
  deadlineMs?:        number;
  // How long one attempt may run, when the provider's default is too short
  // for the work (a plan written from a document). Still inside deadlineMs.
  attemptMs?:         number;
  // Files the model reads with the prompt: PDFs and images, as base64. Both
  // providers read them natively (Gemini inline data; OpenAI image and file
  // parts), scanned pages included. The caller checks type and size first.
  attachments?:       LlmAttachment[];
  // The reply must be one JSON object: the provider's JSON output mode is
  // asked for (OpenAI response_format, Gemini responseMimeType), and a reply
  // cut off at its length limit is an error (TRUNCATED), never half an object.
  json?:              boolean;
  // Told each piece of the reply's text as it is written, for a page that
  // shows it as it comes. Only Claude's client gives pieces; on the others this
  // is never called. The returned text is still the answer.
  onText?:            (delta: string) => void;
}

// Said in the error when a reply stopped at its length limit, so a caller
// can tell "too long" from "unavailable" (isTruncated).
export const TRUNCATED = "the reply was cut off at its length limit";
export const isTruncated = (err: unknown): boolean => err instanceof Error && err.message.includes(TRUNCATED);

export interface LlmAttachment {
  name:     string;
  mimeType: string;   // application/pdf, image/png, image/jpeg, image/webp
  data:     string;   // base64, no data: prefix
}

// The user turn's content for OpenAI's chat API: text alone, or text with
// image and file parts.
export function openAIUserContent(req: LlmRequest): string | Array<Record<string, unknown>> {
  if (!req.attachments || req.attachments.length === 0) return req.prompt;
  return [
    { type: "text", text: req.prompt },
    ...req.attachments.map(a => a.mimeType === "application/pdf"
      ? { type: "file", file: { filename: a.name, file_data: `data:${a.mimeType};base64,${a.data}` } }
      : { type: "image_url", image_url: { url: `data:${a.mimeType};base64,${a.data}` } }),
  ];
}

// An attempt shorter than this cannot succeed, so it is not started.
export const MIN_ATTEMPT_MS = 1_000;

// How long the next attempt may run, given the caller's deadline and the time
// already spent. null: no time for another attempt.
export function attemptTimeoutMs(deadlineMs: number | undefined, elapsedMs: number, providerTimeoutMs: number): number | null {
  if (deadlineMs === undefined) return providerTimeoutMs;
  const left = deadlineMs - elapsedMs;
  return left < MIN_ATTEMPT_MS ? null : Math.min(providerTimeoutMs, left);
}

// Whether a pause before the next attempt still leaves time for that attempt.
export function mayWait(deadlineMs: number | undefined, elapsedMs: number, waitMs: number): boolean {
  return deadlineMs === undefined || deadlineMs - elapsedMs - waitMs >= MIN_ATTEMPT_MS;
}

// ── Provider selection ────────────────────────────────────────────────────────

export function geminiKey(env: NodeJS.ProcessEnv): string | undefined {
  return env.GEMINI_API_KEY || env.GOOGLE_API_KEY || undefined;
}

export function openaiKey(env: NodeJS.ProcessEnv): string | undefined {
  return env.OPENAI_API_KEY || env.OPEN_API_KEY || undefined;
}

export function anthropicKey(env: NodeJS.ProcessEnv): string | undefined {
  return env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY || undefined;
}

// LLM_PROVIDER wins when set ("anthropic" or "claude", "gemini", "openai").
// Otherwise the first provider with a key: Anthropic, then Gemini, then OpenAI.
export function selectProvider(env: NodeJS.ProcessEnv): LlmProvider {
  const explicit = (env.LLM_PROVIDER ?? "").toLowerCase().trim();
  if (explicit === "gemini" || explicit === "openai" || explicit === "anthropic") return explicit;
  if (explicit === "claude") return "anthropic";
  if (anthropicKey(env)) return "anthropic";
  return geminiKey(env) ? "gemini" : "openai";
}

// What this process will call, by name only, for GET /api/health: the
// provider, whether that provider's key is set (never the key), and the
// model each tier maps to. OpenAI is sent the caller's own model name, so its
// tiers name the names Kivo's callers pass.
export interface LlmSelection {
  provider:   LlmProvider;
  keyPresent: boolean;
  fast:       string;
  main:       string;
  effort?:    { fast: ClaudeEffort; main: ClaudeEffort };
  promptTokensMax?: number;
}
export function describeLlmSelection(env: NodeJS.ProcessEnv): LlmSelection {
  const provider = selectProvider(env);
  if (provider === "anthropic") return {
    provider, keyPresent: Boolean(anthropicKey(env)),
    fast: claudeModelFor("gpt-4o-mini", env), main: claudeModelFor("gpt-4o", env),
    effort: { fast: claudeEffortFor("gpt-4o-mini", env), main: claudeEffortFor("gpt-4o", env) },
    promptTokensMax: claudePromptLimit(env),
  };
  if (provider === "gemini") return { provider, keyPresent: Boolean(geminiKey(env)), fast: geminiModelFor("gpt-4o-mini", env), main: geminiModelFor("gpt-4o", env) };
  return { provider, keyPresent: Boolean(openaiKey(env)), fast: "gpt-4o-mini", main: "gpt-4o" };
}

// ── Anthropic (Claude) ────────────────────────────────────────────────────────

// Both tiers are Claude Haiku 5.5 (the owner's choice, 26 Oct: fast and
// cheap: $0.10 / $0.50 per million input / output tokens for a prompt of up
// to 100,000 tokens). ANTHROPIC_MODEL_FAST / ANTHROPIC_MODEL_MAIN override,
// e.g. claude-sonnet-5-5 or claude-opus-5-5 for the main tier.
export const CLAUDE_DEFAULT_FAST = "claude-haiku-5-5";
export const CLAUDE_DEFAULT_MAIN = "claude-haiku-5-5";

export function claudeModelFor(requestedModel: string | undefined, env: NodeJS.ProcessEnv): string {
  // A caller (or env) that already names a Claude model is taken literally.
  if (requestedModel && requestedModel.toLowerCase().startsWith("claude-")) return requestedModel;
  return tierFor(requestedModel) === "fast"
    ? (env.ANTHROPIC_MODEL_FAST || CLAUDE_DEFAULT_FAST)
    : (env.ANTHROPIC_MODEL_MAIN || CLAUDE_DEFAULT_MAIN);
}

// Thinking stays adaptive and how much the model thinks is set by effort:
// low on both tiers (the owner's choice: cheapest and fastest; on simple
// requests the model may skip thinking entirely). ANTHROPIC_EFFORT_FAST /
// ANTHROPIC_EFFORT_MAIN override (low | medium | high | xhigh | max).
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type ClaudeEffort = (typeof EFFORTS)[number];
export function claudeEffortFor(requestedModel: string | undefined, env: NodeJS.ProcessEnv): ClaudeEffort {
  const fast = tierFor(requestedModel) === "fast";
  const raw = (fast ? env.ANTHROPIC_EFFORT_FAST : env.ANTHROPIC_EFFORT_MAIN)?.toLowerCase().trim();
  return (EFFORTS as readonly string[]).includes(raw ?? "") ? raw as ClaudeEffort : "low";
}

// ── Staying inside the cheaper price tier ─────────────────────────────────────
// Claude Haiku 5.5 has two rate cards chosen by prompt length: up to 100,000
// input tokens $0.10 / $0.50 per million; above, $0.50 / $2.50 (five times).
// A request is never sent above the limit: it fails with a plain error that
// says so, and the caller's own failure path answers (nothing is cut down to
// fit, so nothing is answered from half the material). Only files and very
// long text get near it; ANTHROPIC_PROMPT_TOKENS_MAX moves the limit.
export const CLAUDE_PROMPT_TOKENS_MAX = 100_000;
export const OVER_PRICE_TIER = "the request is over the prompt-size limit";
export const isOverPriceTier = (err: unknown): boolean => err instanceof Error && err.message.includes(OVER_PRICE_TIER);

export function claudePromptLimit(env: NodeJS.ProcessEnv): number {
  const n = Number(env.ANTHROPIC_PROMPT_TOKENS_MAX);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : CLAUDE_PROMPT_TOKENS_MAX;
}

// A cautious guess from text length (about 3 characters a token, so it
// overestimates English). Files are not guessed: a request with files is
// counted by the API (count_tokens, free) before it is sent.
export function roughClaudeInputTokens(req: Pick<LlmRequest, "prompt" | "systemInstruction">): number {
  return Math.ceil(((req.prompt?.length ?? 0) + (req.systemInstruction?.length ?? 0)) / 3);
}

// Whether a request must be counted exactly before it is sent: it carries
// files, or its text alone could be more than half the limit.
export const needsExactCount = (req: Pick<LlmRequest, "prompt" | "systemInstruction" | "attachments">, limit: number): boolean =>
  (req.attachments?.length ?? 0) > 0 || roughClaudeInputTokens(req) > limit / 2;

// Thinking counts toward max_tokens. Callers size their caps for the answer
// alone (some as small as a few tokens), so the cap sent always leaves room.
export const CLAUDE_THINKING_HEADROOM = 4096;
export const CLAUDE_DEFAULT_MAX_TOKENS = 16000;

// Claude has no "any JSON object" mode without a schema, and prefill is not
// accepted; callers already describe the object they want, so this says it
// once more and the reply is unwrapped from a fence if one comes back.
export const CLAUDE_JSON_INSTRUCTION = "Reply with one JSON object only: no prose before or after it, no Markdown code fences.";

// Claude Opus 5.5's safety classifiers can decline a request; "default"
// re-runs a declined request server-side on the model Anthropic recommends
// for that kind of refusal. Haiku has no server-side fallback.
export const CLAUDE_FALLBACK_BETA = "server-side-fallback-2026-07-01";
const takesServerFallback = (model: string) => model.startsWith("claude-opus-") || model.startsWith("claude-fable-") || model === "claude-sonnet-5-5";

export function buildClaudeRequest(req: LlmRequest, model: string, effort: ClaudeEffort): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming {
  const system = [req.systemInstruction, req.json ? CLAUDE_JSON_INSTRUCTION : null].filter(Boolean).join("\n\n");
  // Files first, then the instruction that refers to them.
  const files: Anthropic.Beta.Messages.BetaContentBlockParam[] = (req.attachments ?? []).map(a => a.mimeType === "application/pdf"
    ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: a.data }, title: a.name }
    : { type: "image" as const, source: { type: "base64" as const, media_type: a.mimeType as "image/png" | "image/jpeg" | "image/webp", data: a.data } });
  return {
    model,
    max_tokens: (req.maxOutputTokens ?? CLAUDE_DEFAULT_MAX_TOKENS) + CLAUDE_THINKING_HEADROOM,
    ...(system ? { system } : {}),
    output_config: { effort },
    messages: [{ role: "user", content: [...files, { type: "text", text: req.prompt }] }],
    ...(takesServerFallback(model) ? { betas: [CLAUDE_FALLBACK_BETA], fallbacks: "default" as const } : {}),
  };
}

// The text of a reply, or why there is none. A refusal (after any fallback)
// and a JSON reply cut off at its limit are errors, never half an answer.
export function readClaudeMessage(msg: Pick<Anthropic.Beta.Messages.BetaMessage, "content" | "stop_reason" | "model">, opts: { json?: boolean } = {}): string {
  if (msg.stop_reason === "refusal") throw new Error(`Claude declined the request (model: ${msg.model})`);
  const text = msg.content.flatMap(b => (b.type === "text" ? [b.text] : [])).join("").trim();
  if (msg.stop_reason === "max_tokens" && (opts.json || !text)) throw new Error(`Claude: ${TRUNCATED} (model: ${msg.model})`);
  if (!text) throw new Error(`Claude returned no text (stop_reason: ${msg.stop_reason ?? "unknown"}, model: ${msg.model})`);
  return opts.json ? unwrapSingleFence(text) : text;
}

// ── Gemini ────────────────────────────────────────────────────────────────────

// Override with GEMINI_MODEL_FAST / GEMINI_MODEL_MAIN.
//
// Both tiers default to Flash-Lite. Measured on a free-tier key (Oct 2026):
//   gemini-3.5-flash-lite      about 1.0s, consistently
//   gemini-flash-lite-latest   about 1s, with occasional 5–30s spikes
//   full Flash models          mostly "high demand" 503s; 15–30s when they answer
// The full Flash models are unusable in a chat on a free key. On a paid key,
// set GEMINI_MODEL_MAIN=gemini-flash-latest for better replies.
export const GEMINI_DEFAULT_FAST = "gemini-3.5-flash-lite";
export const GEMINI_DEFAULT_MAIN = "gemini-3.5-flash-lite";

// Google's moving alias. Used when the chosen model fails or has been
// retired, so a model retirement degrades the app instead of breaking it.
export const GEMINI_FALLBACK_MODEL = "gemini-flash-lite-latest";

// One request may not hold a chat turn hostage.
// GEMINI_TIMEOUT_MS overrides it, for an evaluation run against a slow model.
export const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) > 0 ? Number(process.env.GEMINI_TIMEOUT_MS) : 12_000;

export type ModelTier = "fast" | "main";

// "gpt-4o-mini" and friends are the cheap classification tier; everything
// else (including no model at all) is the main reasoning/writing tier.
export function tierFor(requestedModel: string | undefined): ModelTier {
  return requestedModel && /mini|nano|lite/i.test(requestedModel) ? "fast" : "main";
}

export function geminiModelFor(requestedModel: string | undefined, env: NodeJS.ProcessEnv): string {
  // A caller (or env) that already names a Gemini model is taken literally.
  if (requestedModel && /^gemini-/i.test(requestedModel)) return requestedModel;
  return tierFor(requestedModel) === "fast"
    ? (env.GEMINI_MODEL_FAST || GEMINI_DEFAULT_FAST)
    : (env.GEMINI_MODEL_MAIN || GEMINI_DEFAULT_MAIN);
}

// Gemini models may spend output tokens on hidden reasoning before the answer.
// Callers cap output as low as 3 tokens (a yes/no classification), which would
// leave nothing for the answer. So the cap sent to Gemini always includes
// headroom, and reasoning is switched off where the model allows it.
export const GEMINI_OUTPUT_HEADROOM = 1024;

// Flash-Lite models do not reason by default and reject "thinkingBudget: 0"
// with a bare 400. The full Flash models accept it. So the setting is sent
// only to non-Lite models.
export function shouldDisableThinking(model: string): boolean {
  return !/lite/i.test(model);
}

export function buildGeminiRequest(
  req:   LlmRequest,
  model: string,
  opts:  { disableThinking: boolean },
): { url: string; body: Record<string, unknown> } {
  const generationConfig: Record<string, unknown> = {};
  if (req.maxOutputTokens !== undefined) {
    generationConfig["maxOutputTokens"] = req.maxOutputTokens + GEMINI_OUTPUT_HEADROOM;
  }
  if (opts.disableThinking) {
    generationConfig["thinkingConfig"] = { thinkingBudget: 0 };
  }
  if (req.json) generationConfig["responseMimeType"] = "application/json";

  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    body: {
      ...(req.systemInstruction
        ? { systemInstruction: { parts: [{ text: req.systemInstruction }] } }
        : {}),
      contents: [{ role: "user", parts: [
        { text: req.prompt },
        ...(req.attachments ?? []).map(a => ({ inlineData: { mimeType: a.mimeType, data: a.data } })),
      ] }],
      ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
    },
  };
}

export interface GeminiResponse {
  candidates?: Array<{
    content?:      { parts?: Array<{ text?: string; thought?: boolean }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?:          { code?: number; message?: string; status?: string };
  // Token counts, when Gemini reports them (llm-usage.ts meters them).
  usageMetadata?:  { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number; thoughtsTokenCount?: number };
}

// Gemini likes to wrap JSON in a markdown fence. When the WHOLE reply is one
// fenced block, return its contents. A normal text reply is left untouched.
export function unwrapSingleFence(text: string): string {
  const m = text.match(/^```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)\n?```$/);
  return m ? m[1]!.trim() : text;
}

export function parseGeminiResponse(data: GeminiResponse, model: string, opts: { json?: boolean } = {}): string {
  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the request: ${data.promptFeedback.blockReason}`);
  }
  const candidate = data.candidates?.[0];
  if (opts.json && candidate?.finishReason === "MAX_TOKENS") throw new Error(`Gemini: ${TRUNCATED} (model: ${model})`);
  const text = (candidate?.content?.parts ?? [])
    .filter(p => !p.thought)               // never surface hidden reasoning
    .map(p => p.text ?? "")
    .join("")
    .trim();

  if (!text) {
    throw new Error(
      `Gemini returned empty content (finishReason: ${candidate?.finishReason ?? "unknown"}, model: ${model})`,
    );
  }
  return unwrapSingleFence(text);
}

// A 400 on a request that carried the thinking setting may be that setting
// being rejected: the API's message is often just "invalid argument". The
// client retries once without it; a 400 that persists is a real error.
export function mayBeThinkingConfigRejection(status: number, sentThinkingConfig: boolean): boolean {
  return status === 400 && sentThinkingConfig;
}

// 404 is "this model is no longer available": no point repeating the same
// model, but the fallback alias will work.
export function isRetryableStatus(status: number): boolean {
  return status === 404 || status === 429 || status === 500 || status === 503;
}

// A 429 says how long to wait ("Please retry in 6.2s"). Waiting that long is
// better than failing a chat turn, up to a limit.
export const MAX_RATE_LIMIT_WAIT_MS = 10_000;

export function retryDelayMs(status: number, message: string | undefined): number {
  if (status !== 429) return 800;
  const m = (message ?? "").match(/retry in ([0-9.]+)\s*s/i);
  const asked = m ? Math.ceil(parseFloat(m[1]!) * 1000) + 250 : 2000;
  return Math.min(asked, MAX_RATE_LIMIT_WAIT_MS);
}

// Which models to try, in order: the chosen one twice, then the fallback alias
// once if it is a different model.
export function geminiAttemptPlan(model: string): string[] {
  return model === GEMINI_FALLBACK_MODEL ? [model, model] : [model, model, GEMINI_FALLBACK_MODEL];
}

// ── Usage and outcome, the same shape for every provider ──────────────────────
// For the usage events (llm-usage.ts emitLlmCall). Each count is what the
// provider reported, or null when it reported nothing. "input" is the
// uncached input on every provider: Gemini and OpenAI include cached tokens
// in their prompt count, so they are taken out of it.

const count = (n: unknown): number | null => typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.round(n) : null;

export function claudeUsageOf(usage: Partial<Anthropic.Beta.Messages.BetaUsage> | null | undefined, partial = false): NormalizedUsage {
  if (!usage) return { ...NO_USAGE, ...(partial ? { partial } : {}) };
  return {
    inputTokens:              count(usage.input_tokens),
    outputTokens:             count(usage.output_tokens),
    cacheCreationInputTokens: count(usage.cache_creation_input_tokens),
    cacheReadInputTokens:     count(usage.cache_read_input_tokens),
    cacheCreation5mTokens:    usage.cache_creation ? count(usage.cache_creation.ephemeral_5m_input_tokens) : null,
    cacheCreation1hTokens:    usage.cache_creation ? count(usage.cache_creation.ephemeral_1h_input_tokens) : null,
    inferenceGeo:             usage.inference_geo ?? null,
    serviceTier:              usage.service_tier ?? null,
    speed:                    usage.speed ?? null,
    ...(partial ? { partial } : {}),
  };
}

export function geminiUsageOf(meta: GeminiResponse["usageMetadata"] | null | undefined): NormalizedUsage {
  if (!meta) return NO_USAGE;
  const prompt = count(meta.promptTokenCount);
  const cached = count(meta.cachedContentTokenCount);
  const answer = count(meta.candidatesTokenCount);
  const thoughts = count(meta.thoughtsTokenCount);
  return {
    inputTokens:              prompt === null ? null : Math.max(0, prompt - (cached ?? 0)),
    // Gemini bills thinking as output, and counts it apart from the answer.
    outputTokens:             answer === null && thoughts === null ? null : (answer ?? 0) + (thoughts ?? 0),
    cacheCreationInputTokens: null,
    cacheReadInputTokens:     cached,
  };
}

export function openaiUsageOf(usage: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } | null | undefined): NormalizedUsage {
  if (!usage) return NO_USAGE;
  const prompt = count(usage.prompt_tokens);
  const cached = count(usage.prompt_tokens_details?.cached_tokens);
  return {
    inputTokens:              prompt === null ? null : Math.max(0, prompt - (cached ?? 0)),
    outputTokens:             count(usage.completion_tokens),
    cacheCreationInputTokens: null,
    cacheReadInputTokens:     cached,
  };
}

// Why a call failed, from the error itself (the SDK's classes and statuses,
// the client's own messages). `pastDeadline`: the caller's deadline had run
// out, so an abort is a timeout rather than someone stopping it.
export function llmFailureOf(err: unknown, pastDeadline = false): LlmFailure {
  if (isOverPriceTier(err)) return "over_price_tier";
  if (isTruncated(err)) return "invalid_response";
  const e = err as { name?: string; status?: number; message?: string } | null;
  const name = e?.name ?? "";
  const message = e?.message ?? "";
  if (message.includes("is not set")) return "config";
  if (message.includes("declined the request") || message.includes("refused the request") || message.includes("blocked the request")) return "refusal";
  if (message.includes("returned no text") || message.includes("returned empty content")) return "invalid_response";
  if (name === "APIUserAbortError" || name === "AbortError") return pastDeadline ? "timeout" : "aborted";
  if (name === "APIConnectionTimeoutError" || name === "TimeoutError") return "timeout";
  if (name === "APIConnectionError") return "network";
  const status = typeof e?.status === "number" ? e.status : null;
  if (status === 429) return "rate_limited";
  if (status === 529) return "overloaded";
  if (status === 401 || status === 403) return "auth";
  if (status !== null && status >= 500) return "provider_error";
  if (status !== null && status >= 400) return "request_error";
  return "unknown";
}

// The HTTP status of a Gemini or OpenAI failure from the client's own error
// text ("Gemini request failed (model m: 429: ...)").
export function statusInMessage(message: string): number | null {
  const m = message.match(/\b([45][0-9]{2}):/);
  return m ? Number(m[1]) : null;
}
