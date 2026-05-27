export function buildSystemState(processed: any, context: any) {
  return {
    mode: context.mode,
    emotion: processed.emotion,
    intent: processed.intent,
    triggers: processed.triggers,
    persona: context.user.persona,
    tone: context.user.tonePreference,
  };
}