// ─── Nova's browser agent: one decision, and what the workspace holds ─────────
// The calls the extension's agent makes (rules: browser-agent-rules.ts):
//
//   start      before a task: the learner's subjects, topics and notes
//              relevant to the objective, from the same workspace
//              intelligence every capture uses (knowledge-placement.ts):
//              keyword evidence, never the whole workspace. Sent back with
//              each step, bounded. (The route also issues the task's ticket
//              and counts the task once on the AI allowance.)
//   step       one model call: which tool next. The reply is checked here
//              (parseAction); an unusable reply is asked for again once, then
//              answered as a failure the extension shows.
//   workspace  read-only, no model: search the learner's notes, saved pages
//              and places (with what Kivo knows of each topic), or read one
//              note, through the services that own them (notes.ts,
//              learning-events.ts, the topic mastery engine).
//
// Nothing here writes. What the agent saves goes through Capture
// (capture-drafts.ts) and its placement, the same path as a passage the
// learner selects.

import { generateOpenAIText } from "../../services/openai.service";
import { keyTerms } from "../../connect/similarity";
import { getAllTopicMasteries } from "../engines/knowledge-engine";
import { rankPlaces, placeLabel, type Place } from "./knowledge-placement-rules";
import { relatedNotes, workspacePlaces } from "./knowledge-placement";
import { noteSources, searchNoteBodies } from "./notes";
import { loadLibrary, readLibraryQuery } from "./learning-events";
import { parseAction, parseStepInput, AGENT_LIMITS, AGENT_SYSTEM, stepPrompt, type AgentAction, type PlanStep } from "./browser-agent-rules";

export const AGENT_STEP_DEADLINE_MS = 25_000;

export interface AgentContext {
  places: Array<{ subjectId: string; topicId: string | null; path: string[] }>;
  notes: Array<{ id: string; title: string; filed: string | null; overlap: string }>;
  summary: string;   // the bounded block each step carries
}

interface Knowing { mastery: number; sessions: number }

// What Kivo has on record for a topic, said as what it is: an estimate from
// the learner's own sessions, or nothing yet (CLAUDE.md: Knowledge).
const knowingLine = (k: Knowing | undefined) =>
  !k || k.sessions === 0 ? "not studied in Kivo yet" : `Kivo's estimate from ${k.sessions} session${k.sessions === 1 ? "" : "s"}: ${Math.round(k.mastery * 100)}%`;

async function knowing(profileId: string): Promise<Map<string, Knowing>> {
  const all = await getAllTopicMasteries(profileId).catch(() => []);
  return new Map(all.map(t => [t.topicId, { mastery: t.masteryProbability, sessions: t.reviewCount }]));
}

const placeWithKnowing = (p: Place, known: Map<string, Knowing>) =>
  p.topicId ? `${placeLabel(p)} (${knowingLine(known.get(p.topicId))})` : placeLabel(p);

// `pageTitle`: the page the task starts on, whose words often say more about
// the subject than the request does ("Complete this quiz" on a Neural Networks quiz).
export async function agentContext(profileId: string, objective: string, pageTitle = ""): Promise<AgentContext> {
  const goal = `${objective.slice(0, AGENT_LIMITS.objectiveChars)} ${pageTitle.slice(0, 200)}`.trim();
  const [{ places }, notes, known] = await Promise.all([
    workspacePlaces(profileId),
    relatedNotes(profileId, { title: goal, text: keyTerms(goal, 10).join(" "), context: null, domain: null }, 10).catch(() => []),
    knowing(profileId),
  ]);
  const ranked = rankPlaces({ title: goal, text: goal, context: null, domain: null }, places, 10);
  // Notes filed under the best-matching topics belong to the task even when
  // they share no word with it (a note on ReLU, filed under Neural Networks,
  // for a "Neural Networks Quiz").
  const topics = ranked.filter(r => r.place.topicName).slice(0, 3).map(r => r.place);
  const filed = topics.length
    ? (await searchNoteBodies(profileId, [], { take: 40, bodyMax: 1, subjectIds: [...new Set(topics.map(t => t.subjectId))] }).catch(() => []))
        .filter(n => topics.some(t => t.subjectId === n.subjectId && t.topicName?.toLowerCase() === n.topicName?.trim().toLowerCase()) && !notes.some(r => r.id === n.id))
        .slice(0, 8)
    : [];
  const subjects = [...new Set(places.filter(p => p.topicId === null).map(p => placeLabel(p)))].slice(0, 25);
  const lines = [
    subjects.length ? `Subjects: ${subjects.join("; ")}` : "No subjects yet.",
    ranked.length ? `Most relevant places: ${ranked.map(r => placeWithKnowing(r.place, known)).join("; ")}` : "No subject or topic matches the objective by name.",
    notes.length ? `Related notes (read with read_note): ${notes.map(n => `"${n.title}" id ${n.id}${n.subjectName ? ` (in ${[n.subjectName, n.topicName].filter(Boolean).join(" › ")})` : ""}`).join("; ")}` : "No notes share the objective's words (workspace_search can look further).",
    filed.length ? `Notes filed under those topics (read with read_note): ${filed.map(n => `"${n.title}" id ${n.id} (in ${[n.subjectName, n.topicName].filter(Boolean).join(" › ")})`).join("; ")}` : "",
  ].filter(Boolean);
  return {
    places: ranked.map(r => ({ subjectId: r.place.subjectId, topicId: r.place.topicId, path: [...r.place.subjectPath, ...r.place.topicPath] })),
    notes: [
      ...notes.map(n => ({ id: n.id, title: n.title, filed: n.subjectName ? [n.subjectName, n.topicName].filter(Boolean).join(" › ") : null, overlap: n.overlap })),
      ...filed.map(n => ({ id: n.id, title: n.title, filed: [n.subjectName, n.topicName].filter(Boolean).join(" › "), overlap: "filed" })),
    ],
    summary: lines.join("\n").slice(0, AGENT_LIMITS.workspaceChars),
  };
}

// ── Workspace, read by the agent mid-task (no model) ──────────────────────────

export const WORKSPACE_NOTES = 6;
export const WORKSPACE_PAGES = 5;
const SNIPPET = 360;

/** The passage of a note around the first of the words it contains. */
export function snippetOf(body: string, terms: string[], size = SNIPPET): string {
  const lower = body.toLowerCase();
  let at = -1;
  for (const t of terms) { const i = lower.indexOf(t.toLowerCase()); if (i >= 0 && (at < 0 || i < at)) at = i; }
  const from = Math.max(0, at < 0 ? 0 : at - Math.floor(size / 3));
  const cut = body.slice(from, from + size).split("\n").map(l => l.trim()).filter(Boolean).join(" ");
  return `${from > 0 ? "…" : ""}${cut}${from + size < body.length ? "…" : ""}`;
}

export interface WorkspaceResult { kind: "search" | "note"; text: string; found: number; ids: string[] }

export async function agentWorkspaceSearch(learner: { profileId: string; platformChatId: string }, query: string): Promise<WorkspaceResult> {
  const q = query.trim().slice(0, AGENT_LIMITS.queryChars);
  const terms = keyTerms(q, 8);
  const words = terms.length ? terms : q.split(" ").filter(w => w.length > 2).slice(0, 6);
  const [notes, { places }, known, pages] = await Promise.all([
    words.length ? searchNoteBodies(learner.profileId, words, { take: 30, bodyMax: 20_000 }) : Promise.resolve([]),
    workspacePlaces(learner.profileId),
    knowing(learner.profileId),
    Promise.all([...new Set([q, words[0]].filter(Boolean))].slice(0, 2).map(term =>
      loadLibrary(learner.platformChatId, readLibraryQuery({ q: term, limit: String(WORKSPACE_PAGES) })).catch(() => null))),
  ]);
  // Notes holding more of the words first, then the newest.
  const scored = notes.map(n => {
    const hay = `${n.title} ${n.body}`.toLowerCase();
    return { n, hits: words.filter(w => hay.includes(w.toLowerCase())).length };
  }).sort((a, b) => b.hits - a.hits).slice(0, WORKSPACE_NOTES);
  const ranked = rankPlaces({ title: q, text: q, context: null, domain: null }, places, 6);
  const seen = new Set<string>();
  const saved = pages.flatMap(p => (p && p.status === "ready" ? p.items : [])).filter(r => (seen.has(r.id) ? false : (seen.add(r.id), true))).slice(0, WORKSPACE_PAGES);
  const lines: string[] = [`Search: "${q}"`];
  lines.push(ranked.length ? `Places: ${ranked.map(r => placeWithKnowing(r.place, known)).join("; ")}` : "Places: none match by name.");
  lines.push(scored.length
    ? `Notes:\n${scored.map(({ n }) => `- "${n.title}" (id ${n.id}${n.subjectName ? `, in ${[n.subjectName, n.topicName].filter(Boolean).join(" › ")}` : ""}): ${snippetOf(n.body, words)}`).join("\n")}`
    : "Notes: none match.");
  lines.push(saved.length
    ? `Saved pages:\n${saved.map(r => `- "${r.title}" ${r.url}${r.subjectName ? ` (in ${[r.subjectName, r.topicName].filter(Boolean).join(" › ")})` : ""}${r.description ? `: ${r.description.slice(0, 200)}` : r.excerpt ? `: ${r.excerpt.slice(0, 200)}` : ""}`).join("\n")}`
    : "Saved pages: none match.");
  return { kind: "search", text: lines.join("\n").slice(0, AGENT_LIMITS.dataChars), found: scored.length + saved.length + ranked.length, ids: scored.map(s => s.n.id) };
}

export async function agentReadNote(profileId: string, noteId: string): Promise<WorkspaceResult | null> {
  const src = await noteSources(profileId, noteId, { bodyMax: AGENT_LIMITS.dataChars - 600 });
  if (!src) return null;
  const n = src.note;
  const text = [
    `Note "${n.title}" (id ${n.id})${n.subjectName ? `, filed in ${[n.subjectName, n.topicName].filter(Boolean).join(" › ")}` : ", not filed"}${n.bodyLength > n.body.length ? `, first ${n.body.length} of ${n.bodyLength} characters` : ""}:`,
    n.body,
    src.related.length ? `Related notes: ${src.related.map(r => `"${r.title}" id ${r.id}`).join("; ")}` : "",
  ].filter(Boolean).join("\n");
  return { kind: "note", text: text.slice(0, AGENT_LIMITS.dataChars), found: 1, ids: [n.id] };
}

// ── One step ──────────────────────────────────────────────────────────────────

export type StepResult =
  | { ok: true; thought: string; plan: PlanStep[] | null; expect: string; action: AgentAction }
  | { ok: false; error: "invalid" | "unavailable" | "unusable"; message: string };

export async function agentStep(raw: unknown, generate: typeof generateOpenAIText = generateOpenAIText): Promise<StepResult> {
  const input = parseStepInput(raw);
  if (!input) return { ok: false, error: "invalid", message: "Nova needs something to do." };
  // Out of steps: the model writes up what it has; nothing else is allowed.
  const last = input.stepsLeft <= 0;
  const prompt = last ? `${stepPrompt(input)}\n\nNO STEPS LEFT: reply with the finish tool now: what is done, what is not.` : stepPrompt(input);
  let lastReason = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let reply: string;
    try {
      reply = await generate({
        model: "gpt-4o", systemInstruction: AGENT_SYSTEM, json: true, maxOutputTokens: 2_000, deadlineMs: AGENT_STEP_DEADLINE_MS,
        prompt: attempt === 0 ? prompt : `${prompt}\n\nYour previous reply could not be used (${lastReason}). Reply with one JSON object using one of the tools.`,
      });
    } catch (err) {
      console.error("[nova:agent] model unavailable:", (err as Error).name);
      return { ok: false, error: "unavailable", message: "Nova's model didn't answer. Resume to try again." };
    }
    const parsed = parseAction(typeof reply === "string" ? reply : "");
    if (parsed.ok && last && parsed.action.tool !== "finish") {
      return { ok: true, thought: "No steps left.", plan: parsed.plan, expect: "", action: { tool: "finish", args: { status: "partial", answer: "Nova reached the step limit for this task before it finished. What it did is listed in the steps; the findings it kept are below.", completed: [], remaining: [], concepts: [], gaps: [] } } };
    }
    if (parsed.ok) return parsed;
    lastReason = parsed.reason;
  }
  return { ok: false, error: "unusable", message: "Nova couldn't decide the next step. Resume to try again." };
}
