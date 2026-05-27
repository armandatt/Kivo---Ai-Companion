import { detectIntent } from "../services/intent.service";
import { detectEmotion } from "../services/emotion.service";
import { extractEntities } from "../services/entity.service";

export function processMessage(text: string) {
  const cleanedText = text.toLowerCase().trim();

  const intent = detectIntent(cleanedText);
  const emotion = detectEmotion(cleanedText);
  const entities = extractEntities(cleanedText, intent);

  return {
    cleanedText,
    intent,
    emotion,
    entities,
    triggers: {
      startFocus: intent === "focus_start",
      planning: intent === "planning",
      saveDeadline: intent === "deadline_set",
      emotional: intent === "emotional_trigger",
    },
  };
}