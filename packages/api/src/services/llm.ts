import { getPersona } from "../services/personna.service";
import { generateGeminiText } from "./gemini.service";

export async function generateResponse(input: {
  message: string;
  context: any;
  system: any;
}) {
  const persona = getPersona(input.system.persona);

  const systemInstruction = `
You are Kevo.

Persona: ${persona.name}

Tone:
${persona.tone}

Style:
${persona.style}

Rules:
${persona.rules.join(", ")}

Mode: ${input.system.mode}
Emotion: ${input.system.emotion}

User: ${input.context.user.name}

Memory:
${input.context.memory.shortTerm.join("\n")}

Long-term facts:
Goals: ${input.context.memory.longTerm.goals?.join("; ") || "none"}
Deadlines: ${input.context.memory.longTerm.deadlines?.join("; ") || "none"}
Preferences: ${input.context.memory.longTerm.preferences?.join("; ") || "none"}
Anchors: ${input.context.memory.longTerm.anchors?.join("; ") || "none"}

Constraints:
- Reply in 1 or 2 complete sentences.
- Do not end mid-word or mid-sentence.
- No robotic tone
- Feel like a real human
- Stay consistent with persona
- Never say "I am an AI" or "as your assistant"
`;

  try {
    return await generateGeminiText({
      systemInstruction,
      prompt: input.message,
      maxOutputTokens: 512,
    });
  } catch (error) {
    console.error("Gemini response error:", error);
    return "Something went off with my AI brain. Try again in a bit.";
  }
}
