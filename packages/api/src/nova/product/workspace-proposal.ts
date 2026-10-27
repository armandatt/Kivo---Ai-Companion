// ─── Proposing a workspace ────────────────────────────────────────────────────
// What the template library's preview and "Create with Nova" ask for: a
// checked WorkspacePlan to show, edit and approve. Nothing is stored here;
// creating it is workspaces.ts, on the learner's click.
//
//   a template, as it is   planFromTemplate on the learner's inputs. No model.
//   a template, adapted    the learner asked Nova to personalise it: one plan
//                          call with the template as its base.
//   a request              one call reads it (CreationIntent), code routes it
//                          (workspace-routing.ts), and a plan call follows
//                          only when the route needs one.
//
// usesModel says, before any work, whether a body will call a model, so the
// route meters exactly those (billing allowance) and nothing else.

import { prisma } from "@repo/db/client";
import { dayKey, resolveTimezone } from "../engines/learner-calendar";
import { learnerKey } from "./learner-key";
import { loadLearningContexts, loadSignupAnswers } from "../adapters/account-preferences-adapter";
import { templateById, TEMPLATE_CATEGORIES, type TemplateCategory } from "./templates";
import { planFromTemplate, type TemplateInputs } from "./workspace-plan";
import { routeRequest, NOT_CREATING, type CreationIntent } from "./workspace-routing";
import { checkFiles, readCreationIntent, writeWorkspacePlan, REQUEST_MAX, type PlanRequest } from "./workspace-generation";
import { similarWorkspaces } from "./workspaces";
import type { ProposeResponse, WorkspaceSummary } from "./workspaces.types";

export interface ProposeBody {
  // From the library: a template and what its form asked for.
  templateId?:  unknown;
  inputs?:      unknown;
  // "Personalise with Nova": words that adapt the template.
  personalize?: unknown;
  // From "Create with Nova": the request and its files.
  request?:     unknown;
  files?:       unknown;
  // Where the learner was looking in the library.
  category?:    unknown;
}

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.split("\r").join("").trim().slice(0, max) : "");

export function usesModel(body: ProposeBody): boolean {
  return text(body.request, REQUEST_MAX) !== "" || text(body.personalize, REQUEST_MAX) !== "" || (Array.isArray(body.files) && body.files.length > 0);
}

async function learner(platformChatId: string, now: Date) {
  const user = await prisma.messengerUser.findUnique({
    where:  learnerKey(platformChatId),
    select: { novaAcademicProfile: { select: { id: true, timezone: true, subjects: { select: { name: true }, orderBy: { createdAt: "asc" }, take: 30 } } } },
  });
  const profile = user?.novaAcademicProfile ?? null;
  return { profileId: profile?.id ?? null, today: dayKey(now, resolveTimezone(profile?.timezone ?? null)), subjects: profile?.subjects.map(s => s.name) ?? [] };
}

type Deps = { read?: typeof readCreationIntent; write?: typeof writeWorkspacePlan };

export async function proposeWorkspace(platformChatId: string, body: ProposeBody, now = new Date(), deps: Deps = {}): Promise<ProposeResponse> {
  const who = await learner(platformChatId, now);
  const category: TemplateCategory | null = TEMPLATE_CATEGORIES.find(c => c === body.category) ?? null;
  const similarTo = async (plan: { templateId: string | null; title: string }) => (who.profileId ? similarWorkspaces(who.profileId, plan) : []);

  const template = typeof body.templateId === "string" ? templateById(body.templateId) : null;
  if (body.templateId !== undefined && !template) return { ok: false, error: "invalid", message: "That template doesn't exist." };

  // A template applied as it is: the learner's inputs, no model.
  const inputs = (body.inputs && typeof body.inputs === "object" ? body.inputs : {}) as TemplateInputs;
  const personalize = text(body.personalize, REQUEST_MAX);
  if (template && !personalize) {
    const applied = planFromTemplate(template, inputs, { today: who.today, category: category ?? undefined });
    if (!applied.ok) return { ok: false, error: "invalid", message: applied.message };
    return { ok: true, route: "use", reason: `From the ${template.name} template.`, plan: applied.plan, dropped: [], similar: await similarTo(applied.plan) };
  }

  const files = checkFiles(body.files);
  if (!files.ok) return { ok: false, error: "files", message: files.message };
  const request = text(body.request, REQUEST_MAX) || personalize;
  if (!request && files.files.length === 0) return { ok: false, error: "invalid", message: "Say what you want to set up, or add a file." };

  // What Kivo knows that may shape the plan.
  const [contexts, signup] = await Promise.all([loadLearningContexts(platformChatId).catch(() => []), loadSignupAnswers(platformChatId)]);
  const base: Omit<PlanRequest, "intent" | "decision"> = {
    request: request || "Build a workspace from the attached files.", files: files.files, today: who.today,
    learningFor: contexts, weeklyHours: signup.weeklyHours?.hours ?? null, subjectsHeld: who.subjects, category,
  };
  const write = deps.write ?? writeWorkspacePlan;

  // "Personalise with Nova" on a template: it is the base; the words adapt it.
  if (template) {
    const intent: CreationIntent = { ...NOT_CREATING, creating: true, outcome: template.outcome, subject: text((inputs as { name?: unknown }).name, 80) || null, specific: true };
    const plan = await write({ ...base, intent, decision: { action: "adapt", template, reason: `Built on the ${template.name} template, personalised by Nova.` } });
    return finish(plan, "adapt", `Built on the ${template.name} template, personalised by Nova.`, similarTo);
  }

  const intent = await (deps.read ?? readCreationIntent)({ request: base.request, fileNames: files.files.map(f => f.name), today: who.today });
  if (!intent) return { ok: false, error: "unavailable", message: "Nova couldn't read that just now. Your request is still here; try again." };
  // Files given with a request are a request to build from them.
  const decision = routeRequest(files.files.length > 0 ? { ...intent, creating: true } : intent, { hasFiles: files.files.length > 0, category });
  if (decision.action === "not_creation") {
    return { ok: true, route: "not_creation", message: "That reads as a question rather than something to set up, so nothing was made. Ask Nova from Today, or say what you'd like created." };
  }
  if (decision.action === "clarify") return { ok: true, route: "clarify", question: decision.question };
  if (decision.action === "use") {
    const applied = planFromTemplate(decision.template, { name: intent.subject ?? undefined, date: intent.date ?? undefined }, { today: who.today, category: category ?? undefined });
    // A date that does not fit is left for the learner to add.
    const fallback = applied.ok ? applied : planFromTemplate(decision.template, { name: intent.subject ?? undefined }, { today: who.today, category: category ?? undefined });
    if (!fallback.ok) return { ok: true, route: "clarify", question: decision.template.namePrompt ?? "What should it be called?" };
    return { ok: true, route: "use", reason: decision.reason, plan: fallback.plan, dropped: [], similar: await similarTo(fallback.plan) };
  }
  const plan = await write({ ...base, intent, decision });
  return finish(plan, decision.action, decision.reason, similarTo);
}

async function finish(
  plan: Awaited<ReturnType<typeof writeWorkspacePlan>>,
  route: "adapt" | "custom", reason: string,
  similarTo: (p: { templateId: string | null; title: string }) => Promise<WorkspaceSummary[]>,
): Promise<ProposeResponse> {
  if (!plan.ok) return { ok: false, error: "unavailable" in plan ? "unavailable" : "bad_output", message: plan.message };
  return { ok: true, route, reason, plan: plan.plan, dropped: plan.dropped, similar: await similarTo(plan.plan) };
}
