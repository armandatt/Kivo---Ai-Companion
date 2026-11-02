// ─── One usage shape for every provider, and why a call failed ────────────────
import { claudeUsageOf, geminiUsageOf, llmFailureOf, OVER_PRICE_TIER, openaiUsageOf, statusInMessage, TRUNCATED } from "../llmProviders";

describe("usage, normalised", () => {
  it("Claude: counts as reported, cache split kept, pricing conditions kept; missing counts are null, never 0", () => {
    expect(claudeUsageOf({
      input_tokens: 1200, output_tokens: 340, cache_creation_input_tokens: 900, cache_read_input_tokens: 5000,
      cache_creation: { ephemeral_5m_input_tokens: 900, ephemeral_1h_input_tokens: 0 }, inference_geo: "global", service_tier: "standard", speed: null,
    })).toEqual({
      inputTokens: 1200, outputTokens: 340, cacheCreationInputTokens: 900, cacheReadInputTokens: 5000,
      cacheCreation5mTokens: 900, cacheCreation1hTokens: 0, inferenceGeo: "global", serviceTier: "standard", speed: null,
    });
    const bare = claudeUsageOf({ input_tokens: 10, output_tokens: 2, cache_creation_input_tokens: null, cache_read_input_tokens: null });
    expect(bare).toMatchObject({ inputTokens: 10, outputTokens: 2, cacheCreationInputTokens: null, cacheReadInputTokens: null, cacheCreation5mTokens: null });
    expect(claudeUsageOf(null)).toEqual({ inputTokens: null, outputTokens: null, cacheCreationInputTokens: null, cacheReadInputTokens: null });
    expect(claudeUsageOf({ input_tokens: 800, output_tokens: 3 }, true)).toMatchObject({ inputTokens: 800, outputTokens: 3, partial: true });
    expect(claudeUsageOf(undefined, true)).toMatchObject({ inputTokens: null, partial: true });
  });

  it("Gemini: cached tokens are taken out of the prompt count, thinking is output", () => {
    expect(geminiUsageOf({ promptTokenCount: 1000, cachedContentTokenCount: 600, candidatesTokenCount: 50, thoughtsTokenCount: 30 }))
      .toEqual({ inputTokens: 400, outputTokens: 80, cacheCreationInputTokens: null, cacheReadInputTokens: 600 });
    expect(geminiUsageOf({ promptTokenCount: 1000, candidatesTokenCount: 50 })).toMatchObject({ inputTokens: 1000, outputTokens: 50, cacheReadInputTokens: null });
    expect(geminiUsageOf({})).toMatchObject({ inputTokens: null, outputTokens: null });
    expect(geminiUsageOf(undefined).inputTokens).toBeNull();
  });

  it("OpenAI: cached tokens are taken out of the prompt count", () => {
    expect(openaiUsageOf({ prompt_tokens: 1000, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 256 } }))
      .toEqual({ inputTokens: 744, outputTokens: 20, cacheCreationInputTokens: null, cacheReadInputTokens: 256 });
    expect(openaiUsageOf(undefined).outputTokens).toBeNull();
  });

  it("a nonsense count is not a count", () => {
    expect(claudeUsageOf({ input_tokens: -5, output_tokens: Number.NaN }).inputTokens).toBeNull();
    expect(claudeUsageOf({ input_tokens: -5, output_tokens: Number.NaN }).outputTokens).toBeNull();
  });
});

describe("why a call failed", () => {
  const sdk = (name: string, status?: number) => Object.assign(new Error("x"), { name, status });
  it("from the SDK's classes and statuses", () => {
    expect(llmFailureOf(sdk("RateLimitError", 429))).toBe("rate_limited");
    expect(llmFailureOf(sdk("InternalServerError", 529))).toBe("overloaded");
    expect(llmFailureOf(sdk("InternalServerError", 500))).toBe("provider_error");
    expect(llmFailureOf(sdk("BadRequestError", 400))).toBe("request_error");
    expect(llmFailureOf(sdk("AuthenticationError", 401))).toBe("auth");
    expect(llmFailureOf(sdk("APIConnectionError"))).toBe("network");
    expect(llmFailureOf(sdk("APIConnectionTimeoutError"))).toBe("timeout");
    expect(llmFailureOf(sdk("APIUserAbortError"), true)).toBe("timeout");
    expect(llmFailureOf(sdk("APIUserAbortError"), false)).toBe("aborted");
    expect(llmFailureOf(sdk("TimeoutError"))).toBe("timeout");
  });

  it("from the client's own errors", () => {
    expect(llmFailureOf(new Error(`Claude: ${OVER_PRICE_TIER} (120000 tokens > 100000)`))).toBe("over_price_tier");
    expect(llmFailureOf(new Error(`Claude: ${TRUNCATED} (model: m)`))).toBe("invalid_response");
    expect(llmFailureOf(new Error("Claude returned no text (stop_reason: end_turn, model: m)"))).toBe("invalid_response");
    expect(llmFailureOf(new Error("Claude declined the request (model: m)"))).toBe("refusal");
    expect(llmFailureOf(new Error("ANTHROPIC_API_KEY is not set"))).toBe("config");
    expect(llmFailureOf(new Error("something else"))).toBe("unknown");
    expect(llmFailureOf(null)).toBe("unknown");
  });

  it("reads a status the client wrote into its message", () => {
    expect(statusInMessage("Gemini request failed (model m: 503: overloaded)")).toBe(503);
    expect(statusInMessage("Gemini request failed (model m: no response (TimeoutError))")).toBeNull();
  });
});
