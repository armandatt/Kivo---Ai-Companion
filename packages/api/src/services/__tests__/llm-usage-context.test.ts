// ─── Usage events: who and what a model call is for, and handing it over ──────
import {
  annotateUsage, currentUsageContext, emitLlmCall, flushLlmCalls, meterLlmUsage, NO_USAGE, reportLlmUsage,
  setLlmCallSink, startInteraction, withUsageContext, type LlmCall, type LlmCallEvent,
} from "../llm-usage";

const call = (over: Partial<LlmCall> = {}): LlmCall => ({
  provider: "anthropic", model: "claude-haiku-5-5", usage: NO_USAGE, attempts: null,
  outcome: "success", failureCategory: null, latencyMs: 12, at: new Date("2026-11-03T10:00:00Z"), ...over,
});

let seen: LlmCallEvent[] = [];
beforeEach(() => { seen = []; setLlmCallSink(async e => { seen.push(e); }); delete process.env.AI_USAGE_EVENTS_DISABLED; });
afterAll(() => setLlmCallSink("database"));

describe("the context an entry point gives", () => {
  it("a call under no entry point is recorded, visibly unattributed", async () => {
    emitLlmCall(call());
    await flushLlmCalls();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.context).toMatchObject({ feature: "other", surface: "unknown", isBackground: false, isAllowanceCounted: false, usageKey: null, learner: null });
    expect(seen[0]!.context.interactionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("several calls in one interaction share its id; a narrower feature keeps it", async () => {
    await startInteraction({ feature: "telegram_understanding", surface: "telegram", learner: "123", isAllowanceCounted: true }, async () => {
      emitLlmCall(call());
      await withUsageContext({ feature: "telegram_reply", isAllowanceCounted: false }, async () => { emitLlmCall(call()); });
      emitLlmCall(call());
    });
    await flushLlmCalls();
    expect(seen.map(e => [e.context.feature, e.context.isAllowanceCounted, e.context.learner])).toEqual([
      ["telegram_understanding", true, "123"], ["telegram_reply", false, "123"], ["telegram_understanding", true, "123"],
    ]);
    expect(new Set(seen.map(e => e.context.interactionId)).size).toBe(1);
  });

  it("a new interaction inherits nothing, and two at once never see each other's context", async () => {
    await startInteraction({ feature: "rex", surface: "background", isBackground: true }, async () => {
      await startInteraction({ feature: "scheduled_nova_message", surface: "telegram", learner: "9", isBackground: true }, async () => { emitLlmCall(call()); });
    });
    const tick = () => new Promise(r => setTimeout(r, 1));
    await Promise.all([
      startInteraction({ feature: "notes_tutor", surface: "web", learner: "web:a" }, async () => { await tick(); emitLlmCall(call()); }),
      startInteraction({ feature: "today_copilot", surface: "web", learner: "web:b" }, async () => { await tick(); emitLlmCall(call()); }),
    ]);
    await flushLlmCalls();
    expect(seen[0]!.context).toMatchObject({ feature: "scheduled_nova_message", learner: "9" });
    const byLearner = Object.fromEntries(seen.slice(1).map(e => [e.context.learner, e.context.feature]));
    expect(byLearner).toEqual({ "web:a": "notes_tutor", "web:b": "today_copilot" });
    expect(new Set(seen.map(e => e.context.interactionId)).size).toBe(3);
  });

  it("an entry point that learns who it is for later fills it in", async () => {
    await startInteraction({ feature: "rex", surface: "telegram" }, async () => {
      expect(currentUsageContext()?.learner).toBeNull();
      annotateUsage({ learner: "555", requestId: "telegram:1" });
      emitLlmCall(call());
    });
    await flushLlmCalls();
    expect(seen[0]!.context).toMatchObject({ learner: "555", requestId: "telegram:1", feature: "rex" });
  });
});

describe("handing an event over", () => {
  it("never fails or waits for the call: a sink that throws or rejects is logged once and dropped", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    setLlmCallSink(() => { throw new Error("db down"); });
    expect(() => emitLlmCall(call())).not.toThrow();
    setLlmCallSink(async () => { throw new Error("db down"); });
    expect(() => emitLlmCall(call())).not.toThrow();
    await flushLlmCalls();
    expect(error.mock.calls.filter(c => String(c[0]).includes("usage event not recorded")).length).toBeLessThanOrEqual(1);
    expect(String(error.mock.calls[0]?.[0] ?? "")).not.toContain("db down");
    error.mockRestore();
  });

  it("AI_USAGE_EVENTS_DISABLED=true stops events and nothing else", async () => {
    process.env.AI_USAGE_EVENTS_DISABLED = "true";
    const metered: unknown[] = [];
    await meterLlmUsage(u => metered.push(u), async () => {
      emitLlmCall(call());
      reportLlmUsage({ provider: "anthropic", model: "m", inputTokens: 1, outputTokens: 2 });
    });
    await flushLlmCalls();
    expect(seen).toHaveLength(0);
    expect(metered).toHaveLength(1);
  });

  it("the daily meter's listener is unchanged: it sees reportLlmUsage, not events", async () => {
    const metered: unknown[] = [];
    await meterLlmUsage(u => metered.push(u), async () => { emitLlmCall(call()); });
    await flushLlmCalls();
    expect(metered).toHaveLength(0);
    expect(seen).toHaveLength(1);
  });
});
