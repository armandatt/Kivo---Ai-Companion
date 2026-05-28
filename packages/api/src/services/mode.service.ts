export function detectMode({ emotion, intent }: any) {
  if (intent === "focus_start") return "focus";
  if (intent === "planning" || intent === "deadline_set") return "planning";

  if (emotion === "negative") return "emotional";

  if (emotion === "positive") return "hype";

  return "normal";
}
