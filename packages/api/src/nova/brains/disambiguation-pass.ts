// ─── Disambiguation Pass ───────────────────────────────────────────────────────
// SKILL.md §5.4 — optional second Understanding Brain call.
// Fires ONLY when ambiguityScore > 0.80 AND topic is null AND
// routingSignal would have triggered knowledge/planning/retention engine.
// Returns refined AcademicUnderstanding or original if refinement fails.
// Owner: Understanding Brain (same brain, second pass).

import { generateOpenAIText } from "../../services/openai.service.js";
import type { AcademicUnderstanding } from "../types/understanding.types.js";

const DISAMBIGUATION_SYSTEM_PROMPT = `You are a clarification module. The student's message was ambiguous. Based on the conversation context provided, determine:
1. What subject or topic is most likely being discussed?
2. What is the most likely intent?

Return JSON only:
{
  "topic": string | null,
  "topicConfidence": 0.0-1.0,
  "intent": string,
  "ambiguityScore": 0.0-1.0
}

Use the same intent values as before. If still unclear, keep ambiguityScore above 0.6.`;

export async function runDisambiguationPass(
  original:            AcademicUnderstanding,
  conversationHistory: Array<{ role: "user" | "nova"; text: string }>,
  knownSubjects:       string[],
): Promise<AcademicUnderstanding> {
  // Gate: only fire when needed
  const needsDisambiguation =
    original.ambiguityScore > 0.80 &&
    original.topic === null &&
    ["knowledge_engine", "planning_engine", "retention_engine"].includes(original.routingSignal);

  if (!needsDisambiguation) return original;

  const subjectList = knownSubjects.length > 0
    ? `The student's subjects: ${knownSubjects.join(", ")}.`
    : "No subjects registered yet.";

  const history = conversationHistory.slice(-5)
    .map(t => `${t.role === "user" ? "Student" : "Nova"}: ${t.text}`)
    .join("\n");

  const prompt = `${subjectList}\n\nConversation:\n${history}\n\nThe last message "${original.rawText}" was ambiguous (score: ${original.ambiguityScore}). What was the student most likely talking about?`;

  try {
    const raw = await generateOpenAIText({
      model:             "gpt-4o-mini",
      systemInstruction: DISAMBIGUATION_SYSTEM_PROMPT,
      prompt,
      maxOutputTokens:   150,
    });

    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const refined = JSON.parse(cleaned) as Record<string, unknown>;

    return {
      ...original,
      topic:           refined["topic"] ? String(refined["topic"]) : original.topic,
      topicConfidence: typeof refined["topicConfidence"] === "number"
        ? refined["topicConfidence"]
        : original.topicConfidence,
      ambiguityScore:  typeof refined["ambiguityScore"] === "number"
        ? refined["ambiguityScore"]
        : original.ambiguityScore,
      intent:          typeof refined["intent"] === "string" && refined["intent"]
        ? refined["intent"] as AcademicUnderstanding["intent"]
        : original.intent,
    };
  } catch {
    // Disambiguation failed — return original, do not block pipeline
    return original;
  }
}
