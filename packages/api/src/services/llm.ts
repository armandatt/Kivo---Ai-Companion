import { getPersona } from "../services/personna.service";
import { generateOpenAIText } from "./openai.service";

export async function generateResponse(input: {
  message: string;
  context: any;
  system: any;
}) {
  const persona = getPersona(input.system.persona);

  const gymMemory = input.context.memory.longTerm.gym
    ? JSON.stringify(input.context.memory.longTerm.gym)
    : "none";

  const systemInstruction = `
You are Kevo, a concise accountability companion.

Active persona: ${persona.name}
Tone: ${persona.tone}
Style: ${persona.style}
Persona rules: ${persona.rules.join(", ")}

Conversation mode: ${input.system.mode}
Detected emotion: ${input.system.emotion}
User name: ${input.context.user.name}

Recent conversation:
${input.context.memory.shortTerm.join("\n") || "none"}

Long-term context:
- Goals: ${input.context.memory.longTerm.goals?.join("; ") || "none"}
- Deadlines: ${input.context.memory.longTerm.deadlines?.join("; ") || "none"}
- Preferences: ${input.context.memory.longTerm.preferences?.join("; ") || "none"}
- Anchors: ${input.context.memory.longTerm.anchors?.join("; ") || "none"}
- Gym context: ${gymMemory}

Response rules:
- Reply in 1 or 2 complete sentences.
- Be specific to the user's message and memory; do not give generic motivation.
- Match the active persona exactly: Rex is direct and challenging; Nova is warm and steady.
- If the user is emotional, validate first, then give one small next step.
- If the user mentions pain or injury, do not diagnose; advise reducing load and getting professional help when appropriate.
- Never say "I am an AI" or "as your assistant".
- Do not end mid-word or mid-sentence.
`;

  try {
    return await generateOpenAIText({
      systemInstruction,
      prompt: input.message,
      maxOutputTokens: 512,
    });
  } catch (error) {
    console.error("OpenAI response error:", error);
    return "Something went off with my AI brain. Try again in a bit.";
  }
}
