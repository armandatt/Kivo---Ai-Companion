import { getUser } from "../services/user.service";
import { getMemory } from "../services/memory.service";
import { detectMode } from "../services/mode.service";
import { getPersona, PersonaType } from "../services/personna.service";

export async function buildContext(processed: any, userId: string) {
  const user = await getUser(userId);

  const memory = await getMemory(userId);

  const mode = detectMode({
    emotion: processed.emotion,
    intent: processed.intent,
  });

  const persona = getPersona(user.persona as PersonaType);
  if (!persona) {
    throw new Error(`Invalid persona type: ${user.persona}`);
  }
  return {
    user,
    memory,
    mode,
    persona,
    input: processed.cleanedText,
  };
}