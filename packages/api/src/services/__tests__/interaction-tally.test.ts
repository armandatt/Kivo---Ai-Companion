// Every model call reaches usage accounting: an interaction hands all of its
// calls over once when it ends (returned or threw), calls in contexts
// narrowed inside it are part of it (Telegram's reading, wording and
// rewording), and a call made under no interaction is handed over alone.

import {
  emitLlmCall, flushLlmCalls, setInteractionSink, setLlmCallSink, startInteraction, withUsageContext,
  type InteractionEnd, type LlmCall,
} from "../llm-usage";

const call = (over: Partial<LlmCall> = {}): LlmCall => ({
  provider: "anthropic", model: "claude-haiku-5-5", attempts: 1, outcome: "success", failureCategory: null, latencyMs: 5, at: new Date(),
  usage: { inputTokens: 1_000, outputTokens: 100, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, ...over,
});

let ends: InteractionEnd[] = [];
beforeEach(() => {
  ends = [];
  setLlmCallSink(async () => undefined);
  setInteractionSink(async end => { ends.push(end); });
});
afterAll(() => { setLlmCallSink("database"); setInteractionSink("accounting"); });

describe("interaction tally", () => {
  it("hands every call of one interaction over once, with the context each was made in", async () => {
    await startInteraction({ feature: "other", surface: "telegram" }, async () => {
      await withUsageContext({ feature: "telegram_understanding", learner: "123" }, async () => emitLlmCall(call()));
      await withUsageContext({ feature: "telegram_reply" }, async () => emitLlmCall(call()));
      await withUsageContext({ feature: "telegram_rewording" }, async () => emitLlmCall(call()));
    });
    await flushLlmCalls();
    expect(ends).toHaveLength(1);
    expect(ends[0]!.events.map(e => e.context.feature)).toEqual(["telegram_understanding", "telegram_reply", "telegram_rewording"]);
    expect(new Set(ends[0]!.events.map(e => e.context.interactionId)).size).toBe(1);
    expect(ends[0]!.failed).toBe(false);
  });

  it("says when the work failed, and still hands its calls over", async () => {
    await expect(startInteraction({ feature: "notes_tutor", surface: "web" }, async () => {
      emitLlmCall(call({ outcome: "failed", failureCategory: "timeout" }));
      throw new Error("boom");
    })).rejects.toThrow("boom");
    await flushLlmCalls();
    expect(ends).toHaveLength(1);
    expect(ends[0]!.failed).toBe(true);
    expect(ends[0]!.events[0]!.outcome).toBe("failed");
  });

  it("hands over nothing for an interaction with no call and no reservation", async () => {
    await startInteraction({ feature: "today_copilot", surface: "web" }, async () => undefined);
    await flushLlmCalls();
    expect(ends).toHaveLength(0);
  });

  it("hands over a call made under no interaction on its own", async () => {
    emitLlmCall(call());
    await flushLlmCalls();
    expect(ends).toHaveLength(1);
    expect(ends[0]!.events).toHaveLength(1);
  });

  it("keeps two interactions running at once apart", async () => {
    await Promise.all([
      startInteraction({ feature: "notes_tutor", surface: "web", learner: "a" }, async () => { emitLlmCall(call()); await new Promise(r => setTimeout(r, 5)); emitLlmCall(call()); }),
      startInteraction({ feature: "notes_editor", surface: "web", learner: "b" }, async () => { emitLlmCall(call()); }),
    ]);
    await flushLlmCalls();
    expect(ends.map(e => e.events.length).sort()).toEqual([1, 2]);
    for (const e of ends) expect(new Set(e.events.map(x => x.context.learner)).size).toBe(1);
  });

  it("records nothing when accounting is switched off", async () => {
    process.env.USAGE_ACCOUNTING = "off";
    try {
      await startInteraction({ feature: "notes_tutor", surface: "web" }, async () => emitLlmCall(call()));
      await flushLlmCalls();
      expect(ends).toHaveLength(0);
    } finally { delete process.env.USAGE_ACCOUNTING; }
  });
});
