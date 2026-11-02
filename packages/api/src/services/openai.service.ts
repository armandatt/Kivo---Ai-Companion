import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  anthropicKey,
  buildClaudeRequest,
  claudePromptLimit,
  needsExactCount,
  OVER_PRICE_TIER,
  roughClaudeInputTokens,
  claudeEffortFor,
  claudeModelFor,
  readClaudeMessage,
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
  attemptTimeoutMs,
  mayWait,
  selectProvider,
  shouldDisableThinking,
  TRUNCATED,
  type GeminiResponse,
  type LlmRequest,
  openAIUserContent,
  claudeUsageOf,
  geminiUsageOf,
  openaiUsageOf,
  llmFailureOf,
  statusInMessage,
} from "./llmProviders";
import { emitLlmCall, NO_USAGE, NOTHING_SENT, reportLlmUsage, type LlmFailure, type NormalizedUsage } from "./llm-usage";

// What one call saw, filled in by the provider's function as it goes: the
// model that answered (or was asked), the usage the provider reported, how
// many attempts it took when the client itself retries, and why it failed
// when the provider's own error says more than the error thrown.
interface Seen { model: string; usage: NormalizedUsage; attempts: number | null; failure?: LlmFailure }

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

      // A variable that is set, even to nothing, is not replaced (as dotenv
      // does): a test that blanks a key must not get the file's key back.
      if (!key || process.env[key] !== undefined) continue;

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
  | { ok: true; text: string; usage: NormalizedUsage }
  | { ok: false; retryable: boolean; error: string; waitMs?: number; failure: LlmFailure; usage?: NormalizedUsage };

async function callGemini(input: LlmRequest, model: string, apiKey: string, timeoutMs: number = GEMINI_TIMEOUT_MS): Promise<GeminiAttempt> {
  const disableThinking = shouldDisableThinking(model) && !thinkingNotConfigurable.has(model);
  const { url, body } = buildGeminiRequest(input, model, { disableThinking });

  let res: Response;
  try {
    res = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // Timeout or network failure: worth another attempt.
    const name = (err as Error).name;
    return { ok: false, retryable: true, error: `no response (${name})`, failure: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
  }
  const data = await res.json().catch(() => ({})) as GeminiResponse;

  if (res.ok) {
    const usage = geminiUsageOf(data.usageMetadata);
    try {
      const text = parseGeminiResponse(data, model, { json: input.json });
      reportLlmUsage({ provider: "gemini", model, inputTokens: data.usageMetadata?.promptTokenCount ?? null, outputTokens: data.usageMetadata?.candidatesTokenCount ?? null });
      return { ok: true, text, usage };
    } catch (err) {
      // Answered and billed, but nothing usable came back.
      return { ok: false, retryable: false, error: (err as Error).message, failure: llmFailureOf(err) === "refusal" ? "refusal" : "invalid_response", usage };
    }
  }
  if (mayBeThinkingConfigRejection(res.status, disableThinking)) {
    thinkingNotConfigurable.add(model);
    return { ok: false, retryable: true, error: "thinking setting rejected", failure: "request_error" };
  }
  return {
    ok: false,
    retryable: isRetryableStatus(res.status),
    error: `${res.status}: ${(data.error?.message ?? "no error message").split("\n")[0]}`,
    waitMs: retryDelayMs(res.status, data.error?.message),
    failure: llmFailureOf({ status: res.status }),
  };
}

async function generateWithGemini(input: LlmRequest, apiKey: string, seen: Seen): Promise<string> {
  const model = geminiModelFor(input.model, process.env);
  seen.model = model;

  // The chosen model twice, then Google's fallback alias. An overloaded or
  // retired model degrades to a working one instead of a failed turn.
  const plan = geminiAttemptPlan(model);

  let lastError = "not attempted";
  const started = Date.now();
  for (let i = 0; i < plan.length; i++) {
    // A caller with a deadline gets its answer, or its failure, inside it.
    const timeoutMs = attemptTimeoutMs(input.deadlineMs, Date.now() - started, input.attemptMs ?? GEMINI_TIMEOUT_MS);
    if (timeoutMs === null) { lastError = `${lastError}; out of time after ${Date.now() - started}ms`; seen.failure = "timeout"; break; }
    seen.attempts = i + 1;
    seen.model = plan[i]!;
    const attempt = await callGemini(input, plan[i]!, apiKey, timeoutMs);
    if (attempt.ok) { seen.usage = attempt.usage; return attempt.text; }
    seen.failure = attempt.failure;
    if (attempt.usage) seen.usage = attempt.usage;

    lastError = `model ${plan[i]}: ${attempt.error}`;
    if (!attempt.retryable) break;
    // A rate limit is per model family and applies to the fallback too, so
    // it is always waited out; other errors only pause before a same-model retry.
    if (i < plan.length - 1 && (attempt.waitMs! > 800 || plan[i + 1] === plan[i])) {
      const waitMs = attempt.waitMs ?? 800;
      if (!mayWait(input.deadlineMs, Date.now() - started, waitMs)) { lastError = `${lastError}; no time to wait ${waitMs}ms and retry`; seen.failure ??= "timeout"; break; }
      await sleep(waitMs);
    }
  }
  throw new Error(`Gemini request failed (${lastError})`);
}

async function generateWithOpenAI(input: LlmRequest, apiKey: string, seen: Seen): Promise<string> {
  const model = input.model ?? (process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL);
  seen.model = model;
  seen.attempts = 1;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    ...(input.deadlineMs !== undefined ? { signal: AbortSignal.timeout(input.deadlineMs) } : {}),
    body: JSON.stringify({
      model,
      messages: [
        ...(input.systemInstruction
          ? [{ role: "system", content: input.systemInstruction }]
          : []),
        { role: "user", content: openAIUserContent(input) },
      ],
      // Only send max_completion_tokens when the caller explicitly requests a cap.
      // Omitting it for main LLM calls lets gpt-5 (reasoning model) allocate tokens
      // freely between CoT and output — prevents finish_reason:length empty responses.
      ...(input.maxOutputTokens !== undefined
        ? { max_completion_tokens: input.maxOutputTokens }
        : {}),
      ...(input.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  const data = await res.json() as {
    model?: string;
    choices?: Array<{ message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }>;
    error?: { message?: string };
    usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  };
  if (res.ok) reportLlmUsage({ provider: "openai", model, inputTokens: data.usage?.prompt_tokens ?? null, outputTokens: data.usage?.completion_tokens ?? null });
  if (typeof data.model === "string" && data.model) seen.model = data.model;
  seen.usage = openaiUsageOf(data.usage);

  if (!res.ok) {
    seen.failure = llmFailureOf({ status: res.status });
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
  if (input.json && choice?.finish_reason === "length") throw new Error(`OpenAI: ${TRUNCATED} (model: ${model})`);

  if (!text) {
    // Reasoning models (gpt-5, o-series) can exhaust max_completion_tokens on CoT
    // and return empty content. Log for visibility, throw so callers use their fallback.
    console.error("[OpenAI] empty response — finish_reason:", choice?.finish_reason, "| model:", model);
    throw new Error(`OpenAI returned empty content (finish_reason: ${choice?.finish_reason ?? "unknown"})`);
  }

  return text;
}

// The SDK's error classes set no `name`, and a bundler may rename classes:
// they are told apart by instanceof, and named for llmFailureOf.
function sdkErrorShape(err: unknown): { name: string; status?: number; message: string } | unknown {
  if (!(err instanceof Anthropic.APIError)) return err;
  const name = err instanceof Anthropic.APIUserAbortError ? "APIUserAbortError"
    : err instanceof Anthropic.APIConnectionTimeoutError ? "APIConnectionTimeoutError"
    : err instanceof Anthropic.APIConnectionError ? "APIConnectionError"
    : "APIError";
  return { name, status: err.status, message: err.message };
}

// One client per key, made on first use.
let claude: { key: string; client: Anthropic } | null = null;
function claudeClient(apiKey: string): Anthropic {
  if (!claude || claude.key !== apiKey) claude = { key: apiKey, client: new Anthropic({ apiKey }) };
  return claude.client;
}

async function generateWithClaude(input: LlmRequest, apiKey: string, seen: Seen): Promise<string> {
  const model = claudeModelFor(input.model, process.env);
  seen.model = model;
  const params = buildClaudeRequest(input, model, claudeEffortFor(input.model, process.env));
  // A caller with a deadline gets its answer, or its failure, inside it: the
  // SDK's own retries (429, 5xx, connection) run until the deadline cuts them
  // off. Without one, an attempt may take as long as long work needs.
  // Streamed and collected whole: large caps would otherwise hit HTTP timeouts.
  const options = input.deadlineMs !== undefined
    ? { timeout: Math.min(input.attemptMs ?? input.deadlineMs, input.deadlineMs), maxRetries: 2, signal: AbortSignal.timeout(input.deadlineMs) }
    : { timeout: input.attemptMs ?? 10 * 60_000, maxRetries: 2 };
  const started = Date.now();
  // Inside the cheaper price tier, or not sent at all. Text is guessed
  // cautiously; files and long text are counted by the API first (free).
  const limit = claudePromptLimit(process.env);
  let inputTokens = roughClaudeInputTokens(input);
  if (needsExactCount(input, limit)) {
    try {
      const counted = await claudeClient(apiKey).beta.messages.countTokens(
        { model, messages: params.messages, ...(params.system ? { system: params.system } : {}) },
        { ...options, maxRetries: 1 },
      );
      inputTokens = counted.input_tokens;
    } catch (err) {
      // Counting is a safeguard, not a gate on the work: without it the guess stands.
      console.error("[llm:claude] count_tokens failed:", (err as Error).message.split("\n")[0]);
    }
  }
  if (inputTokens > limit) {
    console.error(`[llm:claude] not sent: ${inputTokens} input tokens > ${limit} (model ${model})`);
    throw new Error(`Claude: ${OVER_PRICE_TIER} (${inputTokens} tokens > ${limit}). Send fewer or shorter files.`);
  }
  let stream: ReturnType<Anthropic["beta"]["messages"]["stream"]> | null = null;
  try {
    stream = claudeClient(apiKey).beta.messages.stream(params, options);
    if (input.onText) stream.on("text", input.onText);
    const msg = await stream.finalMessage();
    reportLlmUsage({ provider: "anthropic", model: msg.model, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens });
    seen.model = msg.model;
    seen.usage = claudeUsageOf(msg.usage);
    return readClaudeMessage(msg, { json: input.json });
  } catch (err) {
    // Cut off before the final message: what the stream had counted so far
    // (input from its start, output to its last update), marked partial.
    if (seen.usage === NO_USAGE) {
      const sofar = stream?.currentMessage;
      if (sofar) { seen.model = sofar.model || seen.model; seen.usage = claudeUsageOf(sofar.usage, true); }
      seen.failure = llmFailureOf(sdkErrorShape(err), input.deadlineMs !== undefined && Date.now() - started >= input.deadlineMs - 25);
    }
    if (err instanceof Anthropic.APIError) {
      const status = err.status ?? (input.deadlineMs !== undefined && Date.now() - started >= input.deadlineMs ? "out of time" : "no response");
      throw new Error(`Claude request failed (model ${model}: ${status} ${(err.message ?? "").split("\n")[0]})`);
    }
    throw err;
  }
}

export async function generateOpenAIText(input: {
  prompt: string;
  systemInstruction?: string;
  maxOutputTokens?: number;
  model?: string;             // an OpenAI model name, used as a tier on other providers
  deadlineMs?: number;        // the longest the caller will wait, retries included
  attemptMs?: number;         // one attempt's limit, for long work (see LlmRequest)
  attachments?: LlmRequest["attachments"];
  json?: boolean;             // one JSON object back (see LlmRequest)
  onText?: LlmRequest["onText"];  // the reply's text as it is written (see LlmRequest)
}) {
  loadPackageEnv();
  const provider = selectProvider(process.env);
  const at = new Date();
  const started = Date.now();
  const seen: Seen = { model: input.model ?? "unknown", usage: NO_USAGE, attempts: null };

  // Every call, answered or not, is one usage event (llm-usage.ts). Its
  // context says who and what; this says what happened.
  try {
    let text: string;
    if (provider === "anthropic") {
      const apiKey = anthropicKey(process.env);
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
      text = await generateWithClaude(input, apiKey, seen);
    } else if (provider === "gemini") {
      const apiKey = geminiKey(process.env);
      if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
      text = await generateWithGemini(input, apiKey, seen);
    } else {
      const apiKey = openaiKey(process.env);
      if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
      text = await generateWithOpenAI(input, apiKey, seen);
    }
    emitLlmCall({ provider, model: seen.model, usage: seen.usage, attempts: seen.attempts, outcome: "success", failureCategory: null, latencyMs: Date.now() - started, at });
    return text;
  } catch (err) {
    // The provider's own error when one was seen; else the error thrown
    // (a reply that could not be read, a refusal, a missing key).
    const thrown = llmFailureOf(err, input.deadlineMs !== undefined && Date.now() - started >= input.deadlineMs - 25);
    const failure = thrown === "unknown" || thrown === "provider_error" ? seen.failure ?? statusFailure(err) ?? thrown : thrown;
    const notSent = failure === "over_price_tier" || failure === "config";
    emitLlmCall({
      provider, model: seen.model, usage: notSent ? NOTHING_SENT : seen.usage, attempts: notSent ? 0 : seen.attempts,
      outcome: notSent ? "not_sent" : "failed", failureCategory: failure, latencyMs: Date.now() - started, at,
    });
    throw err;
  }
}

// "Gemini request failed (model m: 503: …)": the status the client wrote.
const statusFailure = (err: unknown): LlmFailure | null => {
  const status = statusInMessage((err as Error)?.message ?? "");
  return status === null ? null : llmFailureOf({ status });
};

// The same call, told the reply's text as it is written (see LlmRequest onText).
export const withTextStream = (onText: NonNullable<LlmRequest["onText"]>): typeof generateOpenAIText =>
  input => generateOpenAIText({ ...input, onText });
