// ─── Understanding Brain ──────────────────────────────────────────────────────
// SKILL.md §5.2 — gpt-4o-mini, classification only.
// Produces AcademicUnderstanding. Does NOT produce any reply text.
// Called once per orchestrator turn BEFORE any state computation.
// The Disambiguation Pass (if confidence < 0.80) can refine the output.
// Owner: Understanding Brain.

import { generateOpenAIText } from "../../services/openai.service";
import type { AcademicUnderstanding, UnderstandingContext } from "../types/understanding.types";
import { parseUnderstandingResponse } from "./understanding-parser";
import { UNDERSTANDING_BRAIN_SYSTEM_PROMPT } from "./prompts/understanding-brain.prompt";

// ── Output parser ──────────────────────────────────────────────────────────────

// ── Understanding Brain call ───────────────────────────────────────────────────

// A reading that has not arrived by now is not waited for: the turn answers
// without it, and says so.
export const UNDERSTANDING_DEADLINE_MS = Number(process.env.NOVA_UNDERSTANDING_DEADLINE_MS) > 0 ? Number(process.env.NOVA_UNDERSTANDING_DEADLINE_MS) : 6_000;

export async function runUnderstandingBrain(
  userText:            string,
  conversationHistory: Array<{ role: "user" | "nova"; text: string }>,
  // What Nova knows about the moment the message arrived in: the day, the
  // running session, the question it last asked. Without it a "yeah" or a
  // "done" cannot be read, and the request is left as "none".
  context?: UnderstandingContext,
): Promise<AcademicUnderstanding> {
  // Inject recent history (last 3 turns) for context
  const historySnippet = conversationHistory
    .slice(-3)
    .map(t => `${t.role === "user" ? "Student" : "Nova"}: ${t.text}`)
    .join("\n");

  const body = historySnippet
    ? `Recent conversation:\n${historySnippet}\n\nNow classify this new message:\n"${userText}"`
    : `Classify this message:\n"${userText}"`;
  const prompt = context ? `${contextBlock(context)}\n\n${body}` : body;

  const raw = await generateOpenAIText({
    model:            "gpt-4o-mini",
    systemInstruction: UNDERSTANDING_BRAIN_SYSTEM_PROMPT,
    prompt,
    maxOutputTokens:  600,
    deadlineMs:       UNDERSTANDING_DEADLINE_MS,
  });

  return parseUnderstandingResponse(raw, userText);
}

// Facts from Nova's records, in a block of their own so the model can tell
// them from what the student wrote.
export function contextBlock(context: UnderstandingContext): string {
  const session = context.session === "none"
    ? "none"
    : `${context.session}${context.sessionTopic ? ` on "${context.sessionTopic}"` : ""}`;
  const open = context.openPrompt
    ? `"${context.openPrompt.question}" with options: ${context.openPrompt.options.map(o => `${o.id} = ${o.label}`).join("; ")}`
    : "none";
  return [
    "Context (from Nova's records, not from the student):",
    `- Today: ${context.today}`,
    `- Study session: ${session}`,
    `- Open question from Nova: ${open}`,
  ].join("\n");
}
