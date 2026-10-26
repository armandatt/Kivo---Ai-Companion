// ─── LLM providers ────────────────────────────────────────────────────────────
// Request building and response parsing for each provider the single LLM
// client (openai.service.ts) can talk to. Pure: no network, no env loading,
// so it can be unit-tested.
//
// Callers across the codebase ask for OpenAI model names ("gpt-4o-mini",
// "gpt-4o"). Those are treated as a TIER, not a literal model, so the same
// call sites work on any provider.

import type Anthropic from "@anthropic-ai/sdk";

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

// ── Anthropic (Claude) ────────────────────────────────────────────────────────

// The fast tier (classification, short wording) is Claude Haiku 5.5; the main
// tier (replies, tutoring, plans, transcription) Claude Opus 5.5. Override with
// ANTHROPIC_MODEL_FAST / ANTHROPIC_MODEL_MAIN.
export const CLAUDE_DEFAULT_FAST = "claude-haiku-5-5";
export const CLAUDE_DEFAULT_MAIN = "claude-opus-5-5";

export function claudeModelFor(requestedModel: string | undefined, env: NodeJS.ProcessEnv): string {
  // A caller (or env) that already names a Claude model is taken literally.
  if (requestedModel && requestedModel.toLowerCase().startsWith("claude-")) return requestedModel;
  return tierFor(requestedModel) === "fast"
    ? (env.ANTHROPIC_MODEL_FAST || CLAUDE_DEFAULT_FAST)
    : (env.ANTHROPIC_MODEL_MAIN || CLAUDE_DEFAULT_MAIN);
}

// Both models think adaptively and cannot be switched to plain completion in
// a way that suits every call, so how much they think is set by effort: low
// on the fast tier (latency-bound calls with deadlines of a few seconds),
// medium on the main tier. ANTHROPIC_EFFORT_FAST / ANTHROPIC_EFFORT_MAIN
// override (low | medium | high | xhigh | max).
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type ClaudeEffort = (typeof EFFORTS)[number];
export function claudeEffortFor(requestedModel: string | undefined, env: NodeJS.ProcessEnv): ClaudeEffort {
  const fast = tierFor(requestedModel) === "fast";
  const raw = (fast ? env.ANTHROPIC_EFFORT_FAST : env.ANTHROPIC_EFFORT_MAIN)?.toLowerCase().trim();
  return (EFFORTS as readonly string[]).includes(raw ?? "") ? raw as ClaudeEffort : fast ? "low" : "medium";
}

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
  usageMetadata?:  { promptTokenCount?: number; candidatesTokenCount?: number };
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
