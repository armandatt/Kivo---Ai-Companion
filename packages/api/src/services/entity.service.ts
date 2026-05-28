import { parseDate } from "chrono-node";


export function extractEntities(text: string, intent: string) {
  const date = parseDate(text);
  const durationMin = extractFocusDuration(text);
  const timeShiftMin = extractTimeShift(text);
  const deadlineLabel = intent === "deadline_set" ? extractDeadlineLabel(text) : null;

  return {
    date,
    goal: intent === "goal_set" ? text : null,
    deadline: deadlineLabel && date ? { label: deadlineLabel, dueAt: date } : null,
    focusDurationMin: durationMin,
    timeShiftMin,
  };
}

function extractFocusDuration(text: string) {
  const minuteMatch = text.match(/\b(\d{1,3})\s*(min|mins|minute|minutes)\b/);
  const hourMatch = text.match(/\b(\d{1,2})\s*(hour|hours|hr|hrs)\b/);

  if (minuteMatch) return Number(minuteMatch[1]);
  if (hourMatch) return Number(hourMatch[1]) * 60;

  if (text.includes("50")) return 50;
  if (text.includes("90")) return 90;

  return 25;
}

function extractDeadlineLabel(text: string) {
  return text
    .replace(/\b(due|deadline|by|on|at)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTimeShift(text: string) {
  const hourMatch = text.match(/\b(\d{1,2})\s*(hour|hours|hr|hrs)\b/);
  const minuteMatch = text.match(/\b(\d{1,3})\s*(min|mins|minute|minutes)\b/);

  if (hourMatch) return Number(hourMatch[1]) * 60;
  if (minuteMatch) return Number(minuteMatch[1]);

  return null;
}
