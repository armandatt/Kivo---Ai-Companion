// ─── First-use wording ────────────────────────────────────────────────────────
// Words the first message of a newly connected chat. What it says was decided
// in interaction/first-use.ts; this only phrases those facts in the learner's
// register. One model call, and the message does not depend on it: when the
// model is unavailable, or returns nothing usable, the plain sentence goes out.

import { generateOpenAIText } from "../../services/openai.service";
import { registerLine, type Register } from "../decision/register";
import type { FirstUse } from "../interaction/first-use";
import { languageLine, type ReplyLanguage } from "../interaction/language";
import { NOVA_STATIC_LAYER } from "./prompts/nova-static-layer.prompt";

export interface FirstUseWordingInput {
  decision:       FirstUse;
  studentName:    string | null;
  register:       Register;
  operatingStyle: string[];
  hasButtons:     boolean;
  // Absent: English.
  language?:      ReplyLanguage;
}

export async function wordFirstUse(
  input: FirstUseWordingInput,
  // Test seam; production calls the model.
  generate?: typeof generateOpenAIText,
): Promise<{ text: string; generated: boolean }> {
  const { decision } = input;
  const plain = { text: decision.fallback, generated: false };
  // Nothing to word: a setup question is asked as it is written.
  if (decision.facts.length === 0 || !decision.instruction) return plain;

  const context = [
    "## First message in a newly connected chat",
    "The student has just connected this chat to their account. They have not written anything yet. Nova already knows their study record.",
    input.studentName ? `Student: ${input.studentName}` : null,
    "",
    "## Facts on record (state nothing that is not here)",
    ...decision.facts.map(f => `- ${f}`),
    ...(input.operatingStyle.length > 0 ? ["", "## How this student likes coaching delivered", ...input.operatingStyle.map(l => `- ${l}`)] : []),
  ].filter(l => l !== null).join("\n");

  const prompt = [
    `Instruction: ${decision.instruction}`,
    registerLine(input.register),
    languageLine(input.language ?? "english"),
    input.hasButtons ? "Buttons for the next step are attached under the message, so do not list options or ask them to type anything in particular." : null,
    "Do not mention commands, menus, slash commands or how to use this chat. Do not state a date, a duration, a number or a circumstance that is not in the facts.",
    "At most four short sentences, with a blank line between the greeting and the rest. Plain text only: no JSON, no labels, no quotes.",
  ].filter(Boolean).join("\n");

  try {
    const request = { model: "gpt-4o", systemInstruction: `${NOVA_STATIC_LAYER}\n\n${context}`, prompt, maxOutputTokens: 220 };
    const raw  = generate ? await generate(request) : await generateOpenAIText(request);
    let text = raw.trim();
    // The static layer asks for JSON in conversation; here plain text was
    // asked for. If JSON came back anyway, take its reply.
    if (text.startsWith("{")) {
      try {
        const reply = (JSON.parse(text) as { reply?: unknown }).reply;
        text = typeof reply === "string" ? reply.trim() : "";
      } catch { text = ""; }
    }
    // A reply that teaches a command is not the message that was decided.
    if (!text || text.includes("/today") || text.includes("/focus") || text.includes("/status") || text.includes("/help")) return plain;
    return { text: text.slice(0, 700), generated: true };
  } catch (err) {
    console.error("[nova:first-use] wording failed, sending the plain message:", (err as Error).message);
    return plain;
  }
}
