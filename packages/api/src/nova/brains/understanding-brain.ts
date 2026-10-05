// ─── Understanding Brain ──────────────────────────────────────────────────────
// SKILL.md §5.2 — gpt-4o-mini, classification only.
// Produces AcademicUnderstanding. Does NOT produce any reply text.
// Called once per orchestrator turn BEFORE any state computation.
// The Disambiguation Pass (if confidence < 0.80) can refine the output.
// Owner: Understanding Brain.

import { generateOpenAIText } from "../../services/openai.service";
import type { AcademicUnderstanding } from "../types/understanding.types";
import { parseUnderstandingResponse } from "./understanding-parser";
import { UNDERSTANDING_BRAIN_SYSTEM_PROMPT } from "./prompts/understanding-brain.prompt";

// ── Output parser ──────────────────────────────────────────────────────────────

// ── Understanding Brain call ───────────────────────────────────────────────────

export async function runUnderstandingBrain(
  userText:            string,
  conversationHistory: Array<{ role: "user" | "nova"; text: string }>,
): Promise<AcademicUnderstanding> {
  // Inject recent history (last 3 turns) for context
  const historySnippet = conversationHistory
    .slice(-3)
    .map(t => `${t.role === "user" ? "Student" : "Nova"}: ${t.text}`)
    .join("\n");

  const prompt = historySnippet
    ? `Recent conversation:\n${historySnippet}\n\nNow classify this new message:\n"${userText}"`
    : `Classify this message:\n"${userText}"`;

  const raw = await generateOpenAIText({
    model:            "gpt-4o-mini",
    systemInstruction: UNDERSTANDING_BRAIN_SYSTEM_PROMPT,
    prompt,
    maxOutputTokens:  450,
  });

  return parseUnderstandingResponse(raw, userText);
}
