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

// Google's moving aliases, so a model retirement does not break the app.
// Override with GEMINI_MODEL_FAST / GEMINI_MODEL_MAIN.
export const GEMINI_DEFAULT_FAST = "gemini-flash-lite-latest";
export const GEMINI_DEFAULT_MAIN = "gemini-flash-latest";

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

// A 400 that complains about the thinking setting means this model does not
// accept "thinkingBudget: 0". The client then retries once without it.
export function isThinkingConfigRejection(status: number, message: string | undefined): boolean {
  return status === 400 && /thinking/i.test(message ?? "");
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 503;
}
