// ─── LLM provider selection, request building and response parsing ────────────
import {
  GEMINI_DEFAULT_FAST,
  GEMINI_DEFAULT_MAIN,
  GEMINI_FALLBACK_MODEL,
  GEMINI_OUTPUT_HEADROOM,
  geminiAttemptPlan,
  buildGeminiRequest,
  geminiModelFor,
  isRetryableStatus,
  mayBeThinkingConfigRejection,
  parseGeminiResponse,
  retryDelayMs,
  shouldDisableThinking,
  selectProvider,
  tierFor,
  unwrapSingleFence,
} from "../llmProviders";

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

describe("provider selection", () => {
  it("uses Gemini when it has a key, OpenAI otherwise", () => {
    expect(selectProvider(env({ GEMINI_API_KEY: "g" }))).toBe("gemini");
    expect(selectProvider(env({ GEMINI_API_KEY: "g", OPENAI_API_KEY: "o" }))).toBe("gemini");
    expect(selectProvider(env({ OPENAI_API_KEY: "o" }))).toBe("openai");
    expect(selectProvider(env({}))).toBe("openai");
  });

  it("LLM_PROVIDER overrides the automatic choice", () => {
    expect(selectProvider(env({ LLM_PROVIDER: "openai", GEMINI_API_KEY: "g" }))).toBe("openai");
    expect(selectProvider(env({ LLM_PROVIDER: "GEMINI" }))).toBe("gemini");
    expect(selectProvider(env({ LLM_PROVIDER: "something-else", GEMINI_API_KEY: "g" }))).toBe("gemini");
  });
});

describe("model mapping", () => {
  it("treats the OpenAI model name as a tier", () => {
    expect(tierFor("gpt-4o-mini")).toBe("fast");
    expect(tierFor("gpt-4o")).toBe("main");
    expect(tierFor("gpt-5")).toBe("main");
    expect(tierFor(undefined)).toBe("main");
  });

  it("maps every model the codebase asks for onto a Gemini model", () => {
    expect(geminiModelFor("gpt-4o-mini", env({}))).toBe(GEMINI_DEFAULT_FAST);
    expect(geminiModelFor("gpt-4o", env({}))).toBe(GEMINI_DEFAULT_MAIN);
    expect(geminiModelFor(undefined, env({}))).toBe(GEMINI_DEFAULT_MAIN);
  });

  it("defaults both tiers to a Lite model, the only one usable on a free key", () => {
    expect(GEMINI_DEFAULT_FAST).toMatch(/lite/);
    expect(GEMINI_DEFAULT_MAIN).toMatch(/lite/);
  });

  it("ignores OPENAI_MODEL, and honours the Gemini overrides", () => {
    const e = env({ OPENAI_MODEL: "gpt-5", GEMINI_MODEL_FAST: "gemini-x-lite", GEMINI_MODEL_MAIN: "gemini-x" });
    expect(geminiModelFor("gpt-4o-mini", e)).toBe("gemini-x-lite");
    expect(geminiModelFor(undefined, e)).toBe("gemini-x");
  });

  it("takes an explicit Gemini model literally", () => {
    expect(geminiModelFor("gemini-2.5-pro", env({}))).toBe("gemini-2.5-pro");
  });
});

describe("Gemini request", () => {
  it("sends the system instruction and the prompt in Gemini's shape", () => {
    const { url, body } = buildGeminiRequest(
      { prompt: "hello", systemInstruction: "be brief" }, "gemini-flash-latest", { disableThinking: true },
    );
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent");
    expect(body).toMatchObject({
      systemInstruction: { parts: [{ text: "be brief" }] },
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
    });
    expect(url).not.toMatch(/key=/);   // the key travels in a header, never the URL
  });

  it("gives a tiny output cap room to breathe: a 3-token cap must still produce an answer", () => {
    const { body } = buildGeminiRequest({ prompt: "yes or no?", maxOutputTokens: 3 }, "m", { disableThinking: true });
    expect(body["generationConfig"]).toEqual({
      maxOutputTokens: 3 + GEMINI_OUTPUT_HEADROOM,
      thinkingConfig:  { thinkingBudget: 0 },
    });
  });

  it("can omit the thinking setting for a model that rejects it", () => {
    const { body } = buildGeminiRequest({ prompt: "x", maxOutputTokens: 80 }, "m", { disableThinking: false });
    expect(body["generationConfig"]).toEqual({ maxOutputTokens: 80 + GEMINI_OUTPUT_HEADROOM });
  });

  it("sends no generationConfig when there is nothing to configure", () => {
    const { body } = buildGeminiRequest({ prompt: "x" }, "m", { disableThinking: false });
    expect(body).not.toHaveProperty("generationConfig");
    expect(body).not.toHaveProperty("systemInstruction");
  });
});

describe("Gemini response", () => {
  const ok = (text: string) => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] });

  it("returns the text", () => {
    expect(parseGeminiResponse(ok("  Train first.  "), "m")).toBe("Train first.");
  });

  it("joins parts and drops hidden reasoning", () => {
    expect(parseGeminiResponse({
      candidates: [{ content: { parts: [{ text: "let me think", thought: true }, { text: "Go " }, { text: "now." }] } }],
    }, "m")).toBe("Go now.");
  });

  it("unwraps JSON that arrives inside a markdown fence, as callers expect raw JSON", () => {
    const fenced = '```json\n{"intent":"study_report","emotion":"neutral"}\n```';
    expect(JSON.parse(parseGeminiResponse(ok(fenced), "m"))).toEqual({ intent: "study_report", emotion: "neutral" });
  });

  it("leaves ordinary text alone, even when it contains a code block", () => {
    const text = "Here is the idea:\n```\nx = 1\n```\nGot it?";
    expect(unwrapSingleFence(text)).toBe(text);
  });

  it("throws on empty content so the caller's fallback runs", () => {
    expect(() => parseGeminiResponse({ candidates: [{ content: { parts: [] }, finishReason: "MAX_TOKENS" }] }, "m"))
      .toThrow(/empty content \(finishReason: MAX_TOKENS, model: m\)/);
    expect(() => parseGeminiResponse({}, "m")).toThrow(/empty content/);
  });

  it("throws when the request was blocked", () => {
    expect(() => parseGeminiResponse({ promptFeedback: { blockReason: "SAFETY" } }, "m")).toThrow(/blocked.*SAFETY/);
  });
});

describe("error handling decisions", () => {
  it("sends the thinking-off setting only to models that accept it", () => {
    // Verified live: Flash-Lite rejects thinkingBudget 0 with a bare 400.
    expect(shouldDisableThinking("gemini-flash-lite-latest")).toBe(false);
    expect(shouldDisableThinking("gemini-3.5-flash-lite")).toBe(false);
    expect(shouldDisableThinking("gemini-flash-latest")).toBe(true);
  });

  it("treats a 400 as a possible thinking rejection only if the setting was sent", () => {
    expect(mayBeThinkingConfigRejection(400, true)).toBe(true);
    expect(mayBeThinkingConfigRejection(400, false)).toBe(false);   // a real bad request
    expect(mayBeThinkingConfigRejection(503, true)).toBe(false);
  });

  it("retries rate limits, server errors and retired models, not bad requests or bad keys", () => {
    expect([404, 429, 500, 503].every(isRetryableStatus)).toBe(true);
    expect([400, 401, 403].some(isRetryableStatus)).toBe(false);
  });

  it("waits as long as a rate limit asks, within reason", () => {
    const msg = "You exceeded your current quota...\nPlease retry in 6.209502925s.";
    expect(retryDelayMs(429, msg)).toBe(6460);
    expect(retryDelayMs(429, "Please retry in 58s.")).toBe(10_000);   // capped
    expect(retryDelayMs(429, "quota")).toBe(2000);
    expect(retryDelayMs(503, "high demand")).toBe(800);
  });

  it("tries the chosen model twice, then falls back to Google's alias", () => {
    expect(geminiAttemptPlan("gemini-3.5-flash-lite")).toEqual(["gemini-3.5-flash-lite", "gemini-3.5-flash-lite", GEMINI_FALLBACK_MODEL]);
    expect(geminiAttemptPlan(GEMINI_FALLBACK_MODEL)).toEqual([GEMINI_FALLBACK_MODEL, GEMINI_FALLBACK_MODEL]);
  });
});
