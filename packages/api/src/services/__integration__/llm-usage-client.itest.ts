/**
 * The one LLM client describes every call it makes — through the real
 * generateOpenAIText and the real Anthropic SDK, with only the network stood
 * in for (no request leaves the machine, no key is needed).
 *
 * What it proves: each way a call can end becomes one usage event with the
 * provider, the model that answered and the usage the provider reported
 * (null when it reported none); an aborted stream keeps the counts it had
 * seen, marked partial; a request over the price tier is never sent; and the
 * daily meter's listener sees exactly what it saw before.
 *
 *   npx tsx --test src/services/__integration__/llm-usage-client.itest.ts
 */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Set, even to nothing, so the client's .env loader adds no real key.
for (const k of ["GEMINI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "ANTHROPIC_MODEL_FAST", "ANTHROPIC_MODEL_MAIN", "GEMINI_MODEL_FAST", "GEMINI_MODEL_MAIN", "AI_USAGE_EVENTS_DISABLED"]) process.env[k] = "";

// Every request goes to `answer`, set by each test. Installed before the SDK
// makes its client, which keeps the fetch it finds.
type Answer = (url: string, init: RequestInit) => Promise<Response>;
let answer: Answer = async () => { throw new Error("no network in this test"); };
const requests: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  requests.push(url);
  return answer(url, init ?? {});
}) as typeof fetch;

const { generateOpenAIText } = await import("../openai.service.js");
const { flushLlmCalls, meterLlmUsage, setLlmCallSink, startInteraction } = await import("../llm-usage.js");
type Event = Parameters<Parameters<typeof setLlmCallSink>[0] & Function>[0];

let events: Event[] = [];
beforeEach(() => {
  events = []; requests.length = 0;
  setLlmCallSink(async e => { events.push(e); });
  process.env.LLM_PROVIDER = "anthropic"; process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.GEMINI_API_KEY = ""; process.env.OPENAI_API_KEY = "";
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

// An Anthropic message stream, as server-sent events. `holdUntil`: send
// these and then nothing more until the request is aborted (the caller's
// deadline), when the connection errors as a real one would.
function sse(events: Array<[string, unknown]>, holdUntil?: AbortSignal | null): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    start(c) {
      for (const [type, data] of events) c.enqueue(enc.encode(`event: ${type}\ndata: ${JSON.stringify({ type, ...data as object })}\n\n`));
      if (holdUntil === undefined) return c.close();
      const cut = () => c.error(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
      if (!holdUntil || holdUntil.aborted) return cut();
      holdUntil.addEventListener("abort", cut, { once: true });
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
const MODEL = "claude-haiku-5-5-20261015";
const start = (usage: Record<string, unknown>) => ["message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: MODEL, content: [], stop_reason: null, stop_sequence: null, usage } }] as [string, unknown];
const text = (t: string): Array<[string, unknown]> => [
  ["content_block_start", { index: 0, content_block: { type: "text", text: "" } }],
  ["content_block_delta", { index: 0, delta: { type: "text_delta", text: t } }],
  ["content_block_stop", { index: 0 }],
];
const end = (stop: string, output: number): Array<[string, unknown]> => [["message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: output } }], ["message_stop", {}]];
const USAGE = { input_tokens: 1200, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }, inference_geo: "global", service_tier: "standard" };

async function run(input: Parameters<typeof generateOpenAIText>[0]) {
  const meter: Array<{ inputTokens: number | null; outputTokens: number | null; model: string }> = [];
  let error: unknown = null;
  const reply = await meterLlmUsage(u => { meter.push(u); }, () => generateOpenAIText(input)).catch(e => { error = e; return null; });
  await flushLlmCalls();
  return { reply, error, meter };
}

test("Claude, an answer: the model that answered, the usage it reported, success; the meter gets what it always got", async () => {
  answer = async () => sse([start(USAGE), ...text("Hello"), ...end("end_turn", 80)]);
  const { reply, meter } = await startInteraction({ feature: "notes_tutor", surface: "web", learner: "web:u1", isAllowanceCounted: true }, () => run({ prompt: "hi", model: "gpt-4o" }));
  assert.equal(reply, "Hello");
  assert.deepEqual(meter, [{ provider: "anthropic", model: MODEL, inputTokens: 1200, outputTokens: 80 }]);
  assert.equal(events.length, 1);
  const e = events[0]!;
  assert.equal(e.provider, "anthropic");
  assert.equal(e.model, MODEL);
  assert.equal(e.outcome, "success");
  assert.equal(e.failureCategory, null);
  assert.deepEqual([e.usage.inputTokens, e.usage.outputTokens, e.usage.cacheCreationInputTokens, e.usage.cacheReadInputTokens], [1200, 80, 0, 0]);
  assert.deepEqual([e.context.feature, e.context.surface, e.context.learner, e.context.isAllowanceCounted], ["notes_tutor", "web", "web:u1", true]);
  assert.ok(requests.every(u => u.startsWith("https://api.anthropic.com/")), "only the stand-in network was used");
});

test("Claude, cache tokens are kept as reported, with the 5-minute / 1-hour split", async () => {
  answer = async () => sse([start({ ...USAGE, input_tokens: 40, cache_creation_input_tokens: 3000, cache_read_input_tokens: 9000, cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 2000 } }), ...text("ok"), ...end("end_turn", 5)]);
  await run({ prompt: "hi" });
  const u = events[0]!.usage;
  assert.deepEqual([u.inputTokens, u.cacheCreationInputTokens, u.cacheReadInputTokens, u.cacheCreation5mTokens, u.cacheCreation1hTokens], [40, 3000, 9000, 1000, 2000]);
});

test("Claude, an answer that can't be used: failed as invalid_response, with the usage the provider billed", async () => {
  answer = async () => sse([start(USAGE), ...text("{\"a\":"), ...end("max_tokens", 300)]);
  const { error, meter } = await run({ prompt: "hi", json: true });
  assert.ok(error);
  assert.equal(meter.length, 1);
  assert.equal(events[0]!.outcome, "failed");
  assert.equal(events[0]!.failureCategory, "invalid_response");
  assert.equal(events[0]!.usage.outputTokens, 300);
});

test("Claude, a refusal is its own category", async () => {
  answer = async () => sse([start(USAGE), ...end("refusal", 3)]);
  await run({ prompt: "hi" });
  assert.equal(events[0]!.failureCategory, "refusal");
});

test("Claude, a provider error before any token: the category, and no usage (null, not 0)", async () => {
  answer = async () => json(429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } }, { "x-should-retry": "false" });
  const { error, meter } = await run({ prompt: "hi" });
  assert.match(String(error), /Claude request failed/);
  assert.equal(meter.length, 0);
  const e = events[0]!;
  assert.deepEqual([e.outcome, e.failureCategory], ["failed", "rate_limited"]);
  assert.deepEqual([e.usage.inputTokens, e.usage.outputTokens, e.usage.cacheCreationInputTokens, e.usage.cacheReadInputTokens], [null, null, null, null]);
});

test("Claude, overloaded (529) and a server error are told apart", async () => {
  answer = async () => json(529, { type: "error", error: { type: "overloaded_error", message: "busy" } }, { "x-should-retry": "false" });
  await run({ prompt: "hi" });
  answer = async () => json(500, { type: "error", error: { type: "api_error", message: "oops" } }, { "x-should-retry": "false" });
  await run({ prompt: "hi" });
  assert.deepEqual(events.map(e => e.failureCategory), ["overloaded", "provider_error"]);
});

test("Claude, a stream cut off at the deadline: timeout, with the counts it had seen marked partial", async () => {
  answer = async (_url, init) => sse([start({ ...USAGE, input_tokens: 3000, output_tokens: 1 }), ...text("Partly"), ["message_delta", { delta: { stop_reason: null, stop_sequence: null }, usage: { output_tokens: 15 } }]], init.signal ?? null);
  const { error } = await run({ prompt: "hi", deadlineMs: 400 });
  assert.ok(error);
  const e = events[0]!;
  assert.deepEqual([e.outcome, e.failureCategory], ["failed", "timeout"]);
  assert.equal(e.usage.inputTokens, 3000);
  assert.equal(e.usage.outputTokens, 15);
  assert.equal(e.usage.partial, true);
});

test("Claude, over the price tier: counted (free), not sent, nothing billed", async () => {
  answer = async url => url.includes("count_tokens") ? json(200, { input_tokens: 150_000 }) : sse([start(USAGE), ...end("end_turn", 1)]);
  const { error } = await run({ prompt: "x".repeat(200_000) });
  assert.ok(error);
  assert.ok(requests.every(u => u.includes("count_tokens")), "the message itself was never sent");
  const e = events[0]!;
  assert.deepEqual([e.outcome, e.failureCategory, e.attempts, e.usage.inputTokens, e.usage.outputTokens], ["not_sent", "over_price_tier", 0, 0, 0]);
});

test("no key: not sent, as config", async () => {
  process.env.ANTHROPIC_API_KEY = "";
  await run({ prompt: "hi" });
  assert.deepEqual([events[0]!.provider, events[0]!.outcome, events[0]!.failureCategory], ["anthropic", "not_sent", "config"]);
  assert.equal(requests.length, 0);
});

test("several calls in one interaction: several events, one interaction id", async () => {
  answer = async () => sse([start(USAGE), ...text("ok"), ...end("end_turn", 5)]);
  await startInteraction({ feature: "build_with_nova", surface: "web", learner: "web:u2" }, async () => {
    await generateOpenAIText({ prompt: "read it" });
    await generateOpenAIText({ prompt: "write the plan" });
  });
  await flushLlmCalls();
  assert.equal(events.length, 2);
  assert.equal(new Set(events.map(e => e.context.interactionId)).size, 1);
  assert.deepEqual(events.map(e => e.context.feature), ["build_with_nova", "build_with_nova"]);
});

test("Gemini: a retried call is one event with its attempts, and thinking counted as output", async () => {
  process.env.LLM_PROVIDER = "gemini"; process.env.GEMINI_API_KEY = "g";
  const replies = [json(503, { error: { message: "overloaded" } }), json(200, {
    candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 20, thoughtsTokenCount: 10 },
  })];
  answer = async () => replies.shift()!;
  const { reply, meter } = await run({ prompt: "hi", model: "gpt-4o-mini" });
  assert.equal(reply, "ok");
  assert.deepEqual([meter[0]!.inputTokens, meter[0]!.outputTokens], [500, 20], "the meter's counts are unchanged");
  const e = events[0]!;
  assert.deepEqual([e.provider, e.outcome, e.attempts, e.usage.inputTokens, e.usage.outputTokens], ["gemini", "success", 2, 500, 30]);
});

test("Gemini: a refused request is one failed event with its status's category", async () => {
  process.env.LLM_PROVIDER = "gemini"; process.env.GEMINI_API_KEY = "g";
  answer = async () => json(400, { error: { message: "bad" } });
  await run({ prompt: "hi" });
  const e = events[0]!;
  assert.deepEqual([e.provider, e.outcome, e.failureCategory, e.attempts, e.usage.inputTokens], ["gemini", "failed", "request_error", 1, null]);
});

test("OpenAI: the model the response names, cached input separated", async () => {
  process.env.LLM_PROVIDER = "openai"; process.env.OPENAI_API_KEY = "o";
  answer = async () => json(200, {
    model: "gpt-4o-2024-08-06", choices: [{ message: { content: "fine" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 900, completion_tokens: 12, prompt_tokens_details: { cached_tokens: 100 } },
  });
  await run({ prompt: "hi", model: "gpt-4o" });
  const e = events[0]!;
  assert.deepEqual([e.provider, e.model, e.outcome, e.usage.inputTokens, e.usage.outputTokens, e.usage.cacheReadInputTokens], ["openai", "gpt-4o-2024-08-06", "success", 800, 12, 100]);
});

test("a recorder that fails never fails the call", async () => {
  setLlmCallSink(async () => { throw new Error("database down"); });
  answer = async () => sse([start(USAGE), ...text("still here"), ...end("end_turn", 5)]);
  const { reply, error } = await run({ prompt: "hi" });
  assert.equal(reply, "still here");
  assert.equal(error, null);
});
