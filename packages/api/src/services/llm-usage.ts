// ─── Token usage of model calls ───────────────────────────────────────────────
// The model client (openai.service.ts) reports how many tokens each call used
// when the provider says; a caller that wants to know runs its work inside
// meterLlmUsage and is told. Calls made outside a meter report to no one, so
// nothing changes for code that does not ask (Rex included).

import { AsyncLocalStorage } from "node:async_hooks";

export interface LlmUsage {
  provider:      "gemini" | "openai" | "anthropic";
  model:         string;
  inputTokens:   number | null;
  outputTokens:  number | null;
}

const listeners = new AsyncLocalStorage<(usage: LlmUsage) => void>();

export function meterLlmUsage<T>(onUsage: (usage: LlmUsage) => void, work: () => Promise<T>): Promise<T> {
  return listeners.run(onUsage, work);
}

export function reportLlmUsage(usage: LlmUsage): void {
  const listener = listeners.getStore();
  if (!listener) return;
  try { listener(usage); } catch { /* a meter must never break a model call */ }
}
