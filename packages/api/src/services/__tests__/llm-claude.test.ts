// ─── Claude as the provider: selection, request building, reply reading ───────
import {
  CLAUDE_DEFAULT_FAST,
  CLAUDE_DEFAULT_MAIN,
  CLAUDE_FALLBACK_BETA,
  CLAUDE_JSON_INSTRUCTION,
  CLAUDE_THINKING_HEADROOM,
  TRUNCATED,
  buildClaudeRequest,
  claudeEffortFor,
  claudeModelFor,
  readClaudeMessage,
  selectProvider,
} from "../llmProviders";

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

describe("provider selection with an Anthropic key", () => {
  it("uses Claude first when it has a key, under either name; LLM_PROVIDER still wins", () => {
    expect(selectProvider(env({ ANTHROPIC_API_KEY: "a", GEMINI_API_KEY: "g", OPENAI_API_KEY: "o" }))).toBe("anthropic");
    expect(selectProvider(env({ CLAUDE_API_KEY: "a" }))).toBe("anthropic");
    expect(selectProvider(env({ ANTHROPIC_API_KEY: "a", LLM_PROVIDER: "gemini" }))).toBe("gemini");
    expect(selectProvider(env({ LLM_PROVIDER: "claude" }))).toBe("anthropic");
    expect(selectProvider(env({ GEMINI_API_KEY: "g" }))).toBe("gemini");
  });
});

describe("tiers", () => {
  it("the fast tier is Haiku at low effort, the main tier Opus at medium; both overridable", () => {
    expect(claudeModelFor("gpt-4o-mini", env({}))).toBe(CLAUDE_DEFAULT_FAST);
    expect(claudeModelFor("gpt-4o", env({}))).toBe(CLAUDE_DEFAULT_MAIN);
    expect(claudeModelFor(undefined, env({}))).toBe(CLAUDE_DEFAULT_MAIN);
    expect([CLAUDE_DEFAULT_FAST, CLAUDE_DEFAULT_MAIN]).toEqual(["claude-haiku-5-5", "claude-opus-5-5"]);
    expect(claudeModelFor("gpt-4o", env({ ANTHROPIC_MODEL_MAIN: "claude-sonnet-5-5" }))).toBe("claude-sonnet-5-5");
    expect(claudeModelFor("claude-haiku-5-5", env({}))).toBe("claude-haiku-5-5");
    expect(claudeEffortFor("gpt-4o-mini", env({}))).toBe("low");
    expect(claudeEffortFor("gpt-4o", env({}))).toBe("medium");
    expect(claudeEffortFor("gpt-4o", env({ ANTHROPIC_EFFORT_MAIN: "HIGH" }))).toBe("high");
    expect(claudeEffortFor("gpt-4o", env({ ANTHROPIC_EFFORT_MAIN: "ultra" }))).toBe("medium");
  });
});

describe("the request", () => {
  it("leaves room for thinking, sets effort, and asks Opus for the server-side refusal fallback", () => {
    const r = buildClaudeRequest({ prompt: "Hi", systemInstruction: "Be brief.", maxOutputTokens: 5 }, "claude-opus-5-5", "medium");
    expect(r.max_tokens).toBe(5 + CLAUDE_THINKING_HEADROOM);
    expect(r.system).toBe("Be brief.");
    expect(r.output_config).toEqual({ effort: "medium" });
    expect(r.betas).toEqual([CLAUDE_FALLBACK_BETA]);
    expect(r.fallbacks).toBe("default");
    expect("thinking" in r).toBe(false);
    const haiku = buildClaudeRequest({ prompt: "Hi" }, "claude-haiku-5-5", "low");
    expect("fallbacks" in haiku || "betas" in haiku).toBe(false);
    expect("system" in haiku).toBe(false);
  });

  it("puts files before the instruction, as a PDF document or an image, and says JSON in the system prompt", () => {
    const r = buildClaudeRequest({
      prompt: "Transcribe these.", json: true, systemInstruction: "You transcribe.",
      attachments: [{ name: "notes.pdf", mimeType: "application/pdf", data: "UERG" }, { name: "page.png", mimeType: "image/png", data: "iVBO" }],
    }, "claude-opus-5-5", "medium");
    const content = r.messages[0]!.content as Array<{ type: string; source?: { media_type: string } }>;
    expect(content.map(b => b.type)).toEqual(["document", "image", "text"]);
    expect(content[0]!.source!.media_type).toBe("application/pdf");
    expect(content[1]!.source!.media_type).toBe("image/png");
    expect(r.system).toBe(`You transcribe.\n\n${CLAUDE_JSON_INSTRUCTION}`);
  });
});

describe("the reply", () => {
  const msg = (content: Array<{ type: string; text?: string; thinking?: string }>, stop_reason: string) =>
    ({ content, stop_reason, model: "claude-opus-5-5" }) as unknown as Parameters<typeof readClaudeMessage>[0];

  it("reads the text blocks and skips thinking", () => {
    expect(readClaudeMessage(msg([{ type: "thinking", thinking: "" }, { type: "text", text: " ok " }], "end_turn"))).toBe("ok");
    expect(readClaudeMessage(msg([{ type: "text", text: "```json\n{\"a\":1}\n```" }], "end_turn"), { json: true })).toBe("{\"a\":1}");
  });

  it("a refusal, a cut-off JSON reply and an empty reply are errors", () => {
    expect(() => readClaudeMessage(msg([], "refusal"))).toThrow("declined");
    expect(() => readClaudeMessage(msg([{ type: "text", text: "{\"a\":" }], "max_tokens"), { json: true })).toThrow(TRUNCATED);
    expect(() => readClaudeMessage(msg([{ type: "thinking", thinking: "" }], "max_tokens"))).toThrow(TRUNCATED);
    expect(() => readClaudeMessage(msg([], "end_turn"))).toThrow("no text");
    // Plain text cut at its limit is still returned: callers without JSON accept it.
    expect(readClaudeMessage(msg([{ type: "text", text: "partial" }], "max_tokens"))).toBe("partial");
  });
});
