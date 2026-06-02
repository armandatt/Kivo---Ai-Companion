export async function runDecisionEngine(input: {
  message: string;
  processed: any;
  context: any;
  system: any;
}) {
  const { intent, triggers } = input.processed;

  // 🎯 FOCUS MODE
  if (intent === "focus_start" || triggers?.startFocus) {
    return {
      type: "focus_start",
      reply: "Alright. 25 minutes. No distractions. Start now.",
    };
  }

  // 📅 PLANNING

  if (intent === "planning") {
    return {
      type: "planner_ai",
      reply: null,
    };
  }

  if (intent === "deadline_set") {
    return {
      type: "deadline",
      reply: null,
    };
  }

  if (intent === "schedule_adjust") {
    return {
      type: "schedule_adjust",
      reply: null,
    };
  }

  if (intent === "checkin_schedule") {
    return { type: "checkin_schedule", reply: null };
  }

  if (intent === "checkin_cancel") {
    return { type: "checkin_cancel", reply: null };
  }

  if (intent === "rest_day") {
    return {
      type: "direct",
      reply: "Rest day logged. That does not break the streak. Recover properly.",
    };
  }

  if (intent === "streak_check" || intent === "progress_check") {
    return {
      type: "progress",
      reply: null,
    };
  }

  if (intent === "weekly_review") {
    return {
      type: "weekly_review",
      reply: null,
    };
  }

  if (intent === "completion") {
    return {
      type: "direct",
      reply: "Good. Mark that as evidence, not luck. What is the next clean step?",
    };
  }

  // 😔 EMOTIONAL SUPPORT OVERRIDE
  if (input.system.emotion === "negative") {
    return {
      type: "emotional",
      reply: null, // let LLM handle tone
    };
  }

  // 🔄 DEFAULT → LLM
  return {
    type: "llm",
    reply: null,
  };
}
