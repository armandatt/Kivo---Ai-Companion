import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildGeminiRequest,
  geminiKey,
  geminiModelFor,
  GEMINI_TIMEOUT_MS,
  geminiAttemptPlan,
  isRetryableStatus,
  mayBeThinkingConfigRejection,
  openaiKey,
  parseGeminiResponse,
  retryDelayMs,
  selectProvider,
  shouldDisableThinking,
  type GeminiResponse,
  type LlmRequest,
} from "./llmProviders";

const DEFAULT_OPENAI_MODEL = "gpt-5";
const __dirname = dirname(fileURLToPath(import.meta.url));
let packageEnvLoaded = false;

function loadPackageEnv() {
  if (packageEnvLoaded) return;
  packageEnvLoaded = true;

  try {
    const envPath = resolve(__dirname, "../../.env");
    const env = readFileSync(envPath, "utf8");

    for (const line of env.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const separator = trimmed.indexOf("=");
      if (separator === -1) continue;

      const key = trimmed.slice(0, separator).trim();
      const rawValue = trimmed.slice(separator + 1).trim();

      if (!key || process.env[key]) continue;

      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  } catch {
    // The API app can also provide these env vars directly.
  }
}

// ─── The one LLM client ───────────────────────────────────────────────────────
// Every model call in the codebase goes through generateOpenAIText(). The name
// is historical: it now talks to whichever provider is configured.
//
//   LLM_PROVIDER=gemini|openai   explicit choice
//   otherwise                    Gemini if GEMINI_API_KEY is set, else OpenAI
//
// Callers pass OpenAI model names; llmProviders.ts maps them to a tier.

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Models that rejected "thinkingBudget: 0". Remembered for the process so the
// extra round-trip happens once per model, not once per call.
const thinkingNotConfigurable = new Set<string>();

// One attempt against one model. Returns the text, or a reason to try again.
type GeminiAttempt =
  | { ok: true; text: string }
  | { ok: false; retryable: boolean; error: string; waitMs?: number };

async function callGemini(input: LlmRequest, model: string, apiKey: string): Promise<GeminiAttempt> {
  const disableThinking = shouldDisableThinking(model) && !thinkingNotConfigurable.has(model);
  const { url, body } = buildGeminiRequest(input, model, { disableThinking });

  let res: Response;
  try {
    res = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
  } catch (err) {
    // Timeout or network failure: worth another attempt.
    return { ok: false, retryable: true, error: `no response (${(err as Error).name})` };
  }
  const data = await res.json().catch(() => ({})) as GeminiResponse;

  if (res.ok) {
    try {
      return { ok: true, text: parseGeminiResponse(data, model) };
    } catch (err) {
      return { ok: false, retryable: false, error: (err as Error).message };
    }
  }
  if (mayBeThinkingConfigRejection(res.status, disableThinking)) {
    thinkingNotConfigurable.add(model);
    return { ok: false, retryable: true, error: "thinking setting rejected" };
  }
  return {
    ok: false,
    retryable: isRetryableStatus(res.status),
    error: `${res.status}: ${(data.error?.message ?? "no error message").split("\n")[0]}`,
    waitMs: retryDelayMs(res.status, data.error?.message),
  };
}

async function generateWithGemini(input: LlmRequest, apiKey: string): Promise<string> {
  const model = geminiModelFor(input.model, process.env);

  // The chosen model twice, then Google's fallback alias. An overloaded or
  // retired model degrades to a working one instead of a failed turn.
  const plan = geminiAttemptPlan(model);

  let lastError = "not attempted";
  for (let i = 0; i < plan.length; i++) {
    const attempt = await callGemini(input, plan[i]!, apiKey);
    if (attempt.ok) return attempt.text;

    lastError = `model ${plan[i]}: ${attempt.error}`;
    if (!attempt.retryable) break;
    // A rate limit is per model family and applies to the fallback too, so
    // it is always waited out; other errors only pause before a same-model retry.
    if (i < plan.length - 1 && (attempt.waitMs! > 800 || plan[i + 1] === plan[i])) await sleep(attempt.waitMs ?? 800);
  }
  throw new Error(`Gemini request failed (${lastError})`);
}

async function generateWithOpenAI(input: LlmRequest, apiKey: string): Promise<string> {
  const model = input.model ?? (process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        ...(input.systemInstruction
          ? [{ role: "system", content: input.systemInstruction }]
          : []),
        { role: "user", content: input.prompt },
      ],
      // Only send max_completion_tokens when the caller explicitly requests a cap.
      // Omitting it for main LLM calls lets gpt-5 (reasoning model) allocate tokens
      // freely between CoT and output — prevents finish_reason:length empty responses.
      ...(input.maxOutputTokens !== undefined
        ? { max_completion_tokens: input.maxOutputTokens }
        : {}),
    }),
  });

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }>;
    error?: { message?: string };
  };

  if (!res.ok) {
    throw new Error(
      data.error?.message || `OpenAI request failed with status ${res.status}`
    );
  }

  const choice  = data.choices?.[0];
  const text    = choice?.message?.content?.trim();
  const refusal = choice?.message?.refusal;

  if (refusal) {
    throw new Error(`OpenAI refused the request: ${refusal}`);
  }

  if (!text) {
    // Reasoning models (gpt-5, o-series) can exhaust max_completion_tokens on CoT
    // and return empty content. Log for visibility, throw so callers use their fallback.
    console.error("[OpenAI] empty response — finish_reason:", choice?.finish_reason, "| model:", model);
    throw new Error(`OpenAI returned empty content (finish_reason: ${choice?.finish_reason ?? "unknown"})`);
  }

  return text;
}

export async function generateOpenAIText(input: {
  prompt: string;
  systemInstruction?: string;
  maxOutputTokens?: number;
  model?: string;             // an OpenAI model name, used as a tier on other providers
}) {
  loadPackageEnv();
  const provider = selectProvider(process.env);

  if (provider === "gemini") {
    const apiKey = geminiKey(process.env);
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    return generateWithGemini(input, apiKey);
  }

  const apiKey = openaiKey(process.env);
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  return generateWithOpenAI(input, apiKey);
}
