// ─── LLM providers ────────────────────────────────────────────────────────────
// Request building and response parsing for each provider the single LLM
// client (openai.service.ts) can talk to. Pure: no network, no env loading,
// so it can be unit-tested.
//
// Callers across the codebase ask for OpenAI model names ("gpt-4o-mini",
// "gpt-4o"). Those are treated as a TIER, not a literal model, so the same
// call sites work on any provider.

export type LlmProvider = "openai" | "gemini";

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

// LLM_PROVIDER wins when set. Otherwise: Gemini if it has a key, else OpenAI.
export function selectProvider(env: NodeJS.ProcessEnv): LlmProvider {
  const explicit = (env.LLM_PROVIDER ?? "").toLowerCase().trim();
  if (explicit === "gemini" || explicit === "openai") return explicit;
  return geminiKey(env) ? "gemini" : "openai";
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

  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    body: {
      ...(req.systemInstruction
        ? { systemInstruction: { parts: [{ text: req.systemInstruction }] } }
        : {}),
      contents: [{ role: "user", parts: [{ text: req.prompt }] }],
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
}

// Gemini likes to wrap JSON in a markdown fence. When the WHOLE reply is one
// fenced block, return its contents. A normal text reply is left untouched.
export function unwrapSingleFence(text: string): string {
  const m = text.match(/^```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)\n?```$/);
  return m ? m[1]!.trim() : text;
}

export function parseGeminiResponse(data: GeminiResponse, model: string): string {
  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the request: ${data.promptFeedback.blockReason}`);
  }
  const candidate = data.candidates?.[0];
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
