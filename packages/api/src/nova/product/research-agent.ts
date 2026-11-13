// ─── The research agent: one decision, and what the workspace holds ───────────
// Two calls from the extension's Research mode (rules: research-agent-rules.ts):
//
//   context  before a task: the learner's subjects, topics and notes relevant
//            to the objective, from the same workspace intelligence every
//            capture uses (knowledge-placement.ts): keyword evidence, never
//            the whole workspace. Also sent back with each step, bounded.
//   step     one model call: which tool next. The reply is checked here
//            (parseAction); an unusable reply is asked for again once, then
//            answered as a failure the extension shows.
//
// Nothing here writes. Findings are saved by the learner, through Capture
// (capture-drafts.ts) and its placement: the same path as a passage they
// select themselves.

import { generateOpenAIText } from "../../services/openai.service";
import { keyTerms } from "../../connect/similarity";
import { rankPlaces, placeLabel } from "./knowledge-placement-rules";
import { relatedNotes, workspacePlaces } from "./knowledge-placement";
import { parseAction, parseStepInput, RESEARCH_LIMITS, RESEARCH_SYSTEM, stepPrompt, type AgentAction } from "./research-agent-rules";

export const RESEARCH_STEP_DEADLINE_MS = 25_000;

export interface ResearchContext {
  places: Array<{ subjectId: string; topicId: string | null; path: string[] }>;
  notes: Array<{ id: string; title: string; filed: string | null; overlap: string }>;
  summary: string;   // the bounded block each step carries
}

export async function researchContext(profileId: string, objective: string): Promise<ResearchContext> {
  const goal = objective.slice(0, RESEARCH_LIMITS.objectiveChars);
  const [{ places }, notes] = await Promise.all([
    workspacePlaces(profileId),
    relatedNotes(profileId, { title: goal, text: keyTerms(goal, 10).join(" "), context: null, domain: null }, 10).catch(() => []),
  ]);
  const ranked = rankPlaces({ title: goal, text: goal, context: null, domain: null }, places, 10);
  const subjects = [...new Set(places.filter(p => p.topicId === null).map(p => placeLabel(p)))].slice(0, 25);
  const lines = [
    subjects.length ? `Subjects: ${subjects.join("; ")}` : "No subjects yet.",
    ranked.length ? `Most relevant places: ${ranked.map(r => placeLabel(r.place)).join("; ")}` : "No subject or topic matches the objective by name.",
    notes.length ? `Related notes: ${notes.map(n => `"${n.title}"${n.subjectName ? ` (in ${[n.subjectName, n.topicName].filter(Boolean).join(" › ")})` : ""}`).join("; ")}` : "No notes match the objective.",
  ];
  return {
    places: ranked.map(r => ({ subjectId: r.place.subjectId, topicId: r.place.topicId, path: [...r.place.subjectPath, ...r.place.topicPath] })),
    notes: notes.map(n => ({ id: n.id, title: n.title, filed: n.subjectName ? [n.subjectName, n.topicName].filter(Boolean).join(" › ") : null, overlap: n.overlap })),
    summary: lines.join("\n").slice(0, RESEARCH_LIMITS.workspaceChars),
  };
}

export type StepResult =
  | { ok: true; thought: string; action: AgentAction }
  | { ok: false; error: "invalid" | "unavailable" | "unusable"; message: string };

export async function researchStep(raw: unknown, generate: typeof generateOpenAIText = generateOpenAIText): Promise<StepResult> {
  const input = parseStepInput(raw);
  if (!input) return { ok: false, error: "invalid", message: "Kivo needs a research objective." };
  // Out of steps: the model writes up what it has; nothing else is allowed.
  const last = input.stepsLeft <= 0;
  const prompt = last ? `${stepPrompt(input)}\n\nNO STEPS LEFT: reply with the finish tool now, from the findings kept.` : stepPrompt(input);
  let lastReason = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let reply: string;
    try {
      reply = await generate({
        model: "gpt-4o", systemInstruction: RESEARCH_SYSTEM, json: true, maxOutputTokens: 1_600, deadlineMs: RESEARCH_STEP_DEADLINE_MS,
        prompt: attempt === 0 ? prompt : `${prompt}\n\nYour previous reply could not be used (${lastReason}). Reply with one JSON object using one of the tools.`,
      });
    } catch (err) {
      console.error("[nova:research] model unavailable:", (err as Error).name);
      return { ok: false, error: "unavailable", message: "Kivo's model didn't answer. Resume to try again." };
    }
    const parsed = parseAction(typeof reply === "string" ? reply : "");
    if (parsed.ok && last && parsed.action.tool !== "finish") return { ok: true, thought: "No steps left.", action: { tool: "finish", args: { summary: "Kivo reached the step limit for this task before it finished. The findings it kept are listed with their sources.", concepts: [], gaps: [] } } };
    if (parsed.ok) return parsed;
    lastReason = parsed.reason;
  }
  return { ok: false, error: "unusable", message: "Kivo couldn't decide the next step. Resume to try again." };
}
