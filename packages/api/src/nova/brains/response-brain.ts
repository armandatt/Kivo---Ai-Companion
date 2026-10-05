// ─── Response Brain ────────────────────────────────────────────────────────────
// SKILL.md §5.3 — gpt-4o, expression only.
// Receives: static layer + dynamic context + micro-prompt.
// Produces: ResponseBrainOutput (reply + structured updates).
// NEVER receives raw user text without understanding context.
// NEVER makes routing decisions.
// Owner: Response Brain.

import { generateOpenAIText } from "../../services/openai.service";
import type { ResponseBrainOutput, ReasoningMode } from "../types/response.types";
import { NOVA_STATIC_LAYER } from "./prompts/nova-static-layer.prompt";

// ── Output parser ──────────────────────────────────────────────────────────────

const VALID_REASONING_MODES = new Set<string>([
  "reflective", "direct", "analytical", "socratic",
  "empathetic", "celebratory", "challenging", "grounding",
]);

function parseResponseBrainOutput(raw: string, fallbackReply: string): ResponseBrainOutput {
  let parsed: Record<string, unknown>;
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return buildFallback(fallbackReply);
  }

  const reply = typeof parsed["reply"] === "string" ? parsed["reply"].trim() : fallbackReply;
  if (!reply) return buildFallback(fallbackReply);

  const reasoningMode = typeof parsed["reasoningMode"] === "string" && VALID_REASONING_MODES.has(parsed["reasoningMode"])
    ? parsed["reasoningMode"] as ReasoningMode
    : "direct";

  const confidence = typeof parsed["confidence"] === "number"
    ? Math.max(0, Math.min(1, parsed["confidence"]))
    : 0.7;

  const stateUpdates = parsed["stateUpdates"] && typeof parsed["stateUpdates"] === "object"
    ? parsed["stateUpdates"] as ResponseBrainOutput["stateUpdates"]
    : undefined;

  const investigationUpdate = parsed["investigationUpdate"] ?? null;
  const followUpCheck       = parsed["followUpCheck"] ?? null;

  return {
    reply,
    reasoningMode,
    confidence,
    stateUpdates,
    investigationUpdate:   investigationUpdate as ResponseBrainOutput["investigationUpdate"],
    followUpCheck:         followUpCheck as ResponseBrainOutput["followUpCheck"],
  };
}

function buildFallback(reply: string): ResponseBrainOutput {
  return {
    reply:             reply || "Let me check in with you on that.",
    reasoningMode:     "empathetic",
    confidence:        0.3,
    stateUpdates:      undefined,
    investigationUpdate: null,
    followUpCheck:     null,
  };
}

// ── Response Brain call ───────────────────────────────────────────────────────

export async function runResponseBrain(
  dynamicLayer: string,  // assembled by Context Builder (≤ 2,000 tokens)
  microPrompt:  string,  // selected intervention + evidence (≤ 300 tokens)
): Promise<ResponseBrainOutput> {
  const fullSystemPrompt = `${NOVA_STATIC_LAYER}\n\n${dynamicLayer}`;
  const fallbackReply    = "I hear you. Tell me more.";

  const raw = await generateOpenAIText({
    model:             "gpt-4o",
    systemInstruction: fullSystemPrompt,
    prompt:            microPrompt,
    maxOutputTokens:   800,
  });

  return parseResponseBrainOutput(raw, fallbackReply);
}
