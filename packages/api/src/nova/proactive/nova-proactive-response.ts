// ─── Proactive wording ────────────────────────────────────────────────────────
// Words a message Nova has already decided to send. The decision, the facts
// and the register arrive from code; this only phrases them. It is the one
// model call in the proactive pipeline, and the pipeline does not depend on
// it: when the model is unavailable, the same facts go out as a plain line.

import { generateOpenAIText } from "../../services/openai.service";
import { NOVA_STATIC_LAYER } from "../brains/prompts/nova-static-layer.prompt";
import { registerLine, type Register } from "../decision/register";
import type { ProactiveType } from "../types/proactive.types";

export interface ProactiveWordingInput {
  type:        ProactiveType;
  studentName: string | null;
  // What the message rests on, at most three lines, each a fact on record:
  // "Operating Systems exam is tomorrow", "Recommended now: Deadlocks, 25 min".
  facts:       string[];
  register:    Register;
  // Behavioural lines from the onboarding signal, if enabled. How to deliver,
  // never how hard to push.
  operatingStyle: string[];
  hasStartButton: boolean;
  // Something in the learner's life is limiting study right now. The message
  // gives the fact (an exam date) and asks for nothing.
  informOnly?: boolean;
}

// Said to the model for an inform-only message. An instruction, so it lives
// in the prompt and never among the facts, which can be sent as they are.
const INFORM_ONLY = "Something in their life is limiting their study right now. Give them the date, plainly and kindly, and nothing more: do not ask them to study, do not suggest a session, do not mention what is limiting them.";

const INSTRUCTIONS: Record<ProactiveType, string> = {
  exam_countdown:       "An exam is close. Name it and when it is. Say the one thing worth doing today. Calm and direct, no alarm.",
  review_due:           "Topics are due for review. Name the one recommended. Say a short retrieval pass is enough.",
  missed_plan_recovery: "They have not studied for a few days. Do not mention guilt or the gap as a failure. Make starting small and easy.",
  daily_nudge:          "It is around the time they study and nothing is done yet today. Point at the one recommended thing.",
};

export function proactiveFallback(input: ProactiveWordingInput): string {
  const lead: Record<ProactiveType, string> = {
    exam_countdown:       "Exam check.",
    review_due:           "Review is due.",
    missed_plan_recovery: "Easy way back in.",
    daily_nudge:          "Good time for a session.",
  };
  // Informing only: the one fact, and no recommendation.
  const facts = input.informOnly ? input.facts.slice(0, 1) : input.facts.slice(0, 2);
  return [input.informOnly ? "For your calendar." : lead[input.type], ...facts.map(f => `${f}.`)].join(" ");
}

export async function wordProactiveMessage(
  input: ProactiveWordingInput,
  // Test seam; production calls the model.
  generate?: typeof generateOpenAIText,
): Promise<{ text: string; generated: boolean }> {
  const context = [
    "## Proactive Mentor Context",
    "Mode: PROACTIVE. The student has not written; Nova is starting the conversation.",
    input.studentName ? `Student: ${input.studentName}` : null,
    "",
    "## Facts on record (use at most two; state nothing that is not here)",
    ...input.facts.slice(0, 3).map(f => `- ${f}`),
    ...(input.operatingStyle.length > 0 ? ["", "## How this student likes coaching delivered", ...input.operatingStyle.map(l => `- ${l}`)] : []),
  ].filter(l => l !== null).join("\n");

  const prompt = [
    `Reason for the message: ${input.type}`,
    `Instruction: ${input.informOnly ? INFORM_ONLY : INSTRUCTIONS[input.type]}`,
    registerLine(input.register),
    input.hasStartButton ? "A Start button is attached under the message, so do not ask them to reply." : null,
    "At most two sentences. Plain text only: no JSON, no labels, no quotes, no questions that need an answer.",
  ].filter(Boolean).join("\n");

  try {
    const request = { model: "gpt-4o", systemInstruction: `${NOVA_STATIC_LAYER}\n\n${context}`, prompt, maxOutputTokens: 200 };
    const raw  = generate ? await generate(request) : await generateOpenAIText(request);
    const text = raw.trim();
    // The static layer asks for JSON in conversation; here plain text was
    // asked for. If JSON came back anyway, take its reply.
    if (text.startsWith("{")) {
      try {
        const reply = (JSON.parse(text) as { reply?: unknown }).reply;
        if (typeof reply === "string" && reply.trim()) return { text: reply.trim().slice(0, 600), generated: true };
      } catch { /* fall through to the plain line */ }
      return { text: proactiveFallback(input), generated: false };
    }
    if (!text) return { text: proactiveFallback(input), generated: false };
    return { text: text.slice(0, 600), generated: true };
  } catch (err) {
    console.error("[nova:proactive] wording failed, sending the plain line:", (err as Error).message);
    return { text: proactiveFallback(input), generated: false };
  }
}
