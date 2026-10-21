// ─── Workspaces ───────────────────────────────────────────────────────────────
// The only reader and writer of NovaWorkspace. Creating a workspace writes
// its subjects, topics, dates, tasks and notes through their own owners
// (setup.ts, exams.ts, tasks.ts, notes.ts), all in one transaction with the
// workspace row: it is made whole or not at all.
//
//   - The plan is checked again here (checkWorkspacePlan): the page's copy is
//     the learner's edit, never trusted as it comes.
//   - One creation per clientKey (unique per learner): a double click, a
//     retry or a second tab gets the workspace that exists.
//   - A new workspace like one the learner has (same template, or same name)
//     is not made until they say so (confirmAnother); they may instead add
//     to the one they have.
//   - Adding to a workspace merges: subjects by name, topics once, tasks by
//     key, notes only where no note of theirs has that title. Nothing the
//     learner has is changed or removed.
//   - The learner is the one behind the session; a workspace id from the
//     request is used only together with their profile.
//
// The workspace row owns no learning data. Its subjects keep living in
// Knowledge, the Map and the Planner whatever happens to it.

import { prisma } from "@repo/db/client";
import { dayKey, resolveTimezone } from "../engines/learner-calendar";
import { checkWorkspacePlan, planWrites, type WorkspacePlan } from "./workspace-plan";
import { templateById } from "./templates";
import { declareWorkspaceSubjectsIn, ensureSetupProfile } from "./setup";
import { addDatesIn } from "./exams";
import { createTasksIn } from "./tasks";
import { createNotesIn } from "./notes";
import type { CreateWorkspaceResponse, WorkspaceSummary, WorkspacesView } from "./workspaces.types";

export const WORKSPACES_MAX = 100;
const KEY_MIN = 8, KEY_MAX = 64;

const SUMMARY_SELECT = { id: true, kind: true, templateId: true, title: true, summary: true, createdAt: true, subjectIds: true } as const;
type Row = { id: string; kind: string; templateId: string | null; title: string; summary: string | null; createdAt: Date; subjectIds: string[] };

async function summaries(profileId: string, rows: Row[]): Promise<WorkspaceSummary[]> {
  const ids = [...new Set(rows.flatMap(r => r.subjectIds))];
  const subjects = ids.length ? await prisma.novaSubject.findMany({ where: { profileId, id: { in: ids } }, select: { id: true, name: true } }) : [];
  return rows.map(r => ({
    id: r.id, kind: r.kind === "template" ? "template" : "custom", templateId: r.templateId,
    templateName: r.templateId ? templateById(r.templateId)?.name ?? null : null,
    title: r.title, summary: r.summary, createdAt: r.createdAt.toISOString(),
    subjects: r.subjectIds.flatMap(id => subjects.filter(s => s.id === id)),
  }));
}

export async function listWorkspaces(profileId: string): Promise<WorkspacesView> {
  const rows = await prisma.novaWorkspace.findMany({ where: { profileId }, select: SUMMARY_SELECT, orderBy: { createdAt: "desc" }, take: WORKSPACES_MAX });
  return { status: "ready", workspaces: await summaries(profileId, rows) };
}

// Workspaces of theirs a plan would repeat: made from the same template, or
// with the same name.
export async function similarWorkspaces(profileId: string, plan: Pick<WorkspacePlan, "templateId" | "title">): Promise<WorkspaceSummary[]> {
  const rows = await prisma.novaWorkspace.findMany({
    where: { profileId, OR: [...(plan.templateId ? [{ templateId: plan.templateId }] : []), { title: { equals: plan.title, mode: "insensitive" as const } }] },
    select: SUMMARY_SELECT, orderBy: { createdAt: "desc" }, take: 5,
  });
  return summaries(profileId, rows);
}

export interface CreateInput {
  plan:            unknown;
  clientKey:       unknown;
  // Add to this workspace of theirs instead of making a new one.
  addTo?:          unknown;
  // They have seen the similar ones and want another.
  confirmAnother?: unknown;
}

const validKey = (v: unknown): v is string =>
  typeof v === "string" && v.length >= KEY_MIN && v.length <= KEY_MAX && [...v].every(c => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "-" || c === "_");

export async function createWorkspace(platformChatId: string, input: CreateInput, now = new Date()): Promise<CreateWorkspaceResponse> {
  if (!validKey(input.clientKey)) return { ok: false, error: "invalid", message: "That request is missing its key. Reload and try again." };
  const ensured = await ensureSetupProfile(platformChatId);
  if (!ensured) return { ok: false, error: "not_ready", message: "Finish setting up with Nova first." };
  const { profileId } = ensured;
  const clientKey = input.clientKey;

  // The same request again: what it made.
  const before = await prisma.novaWorkspace.findUnique({ where: { profileId_clientKey: { profileId, clientKey } }, select: SUMMARY_SELECT });
  if (before) return { ok: true, status: "exists", workspace: (await summaries(profileId, [before]))[0]! };

  const today = dayKey(now, resolveTimezone(ensured.timezone));
  const raw = input.plan as Record<string, unknown> | null;
  // Sources and links the learner's own plan names are theirs to keep: the
  // files were read when the plan was proposed, and are not sent again.
  const files = Array.isArray(raw?.sources) ? (raw!.sources as Array<{ file?: unknown }>).map(s => (typeof s?.file === "string" ? s.file : "")).filter(Boolean) : [];
  const resources = [
    ...(Array.isArray(raw?.resources) ? raw!.resources : []),
    ...(Array.isArray(raw?.phases) ? (raw!.phases as Array<{ resources?: unknown }>).flatMap(p => (Array.isArray(p?.resources) ? p.resources : [])) : []),
  ] as Array<{ origin?: unknown; url?: unknown }>;
  const userText = resources.filter(r => r?.origin === "user" && typeof r.url === "string").map(r => r.url as string).join(" ");
  const checked = checkWorkspacePlan(input.plan, { today, files, userText });
  if (!checked.ok) return { ok: false, error: "invalid", message: checked.message };
  const plan = checked.plan;
  // A template id must name a template; otherwise it is the learner's own.
  if (plan.kind === "template" && (!plan.templateId || !templateById(plan.templateId))) { plan.kind = "custom"; plan.templateId = null; plan.templateVersion = null; }

  let target: { id: string; clientKey: string; subjectIds: string[] } | null = null;
  if (input.addTo !== undefined && input.addTo !== null) {
    if (typeof input.addTo !== "string") return { ok: false, error: "invalid", message: "That isn't one of your workspaces." };
    target = await prisma.novaWorkspace.findFirst({ where: { id: input.addTo, profileId }, select: { id: true, clientKey: true, subjectIds: true } });
    if (!target) return { ok: false, error: "not_found", message: "That workspace isn't one of yours." };
  } else if (input.confirmAnother !== true) {
    const similar = await similarWorkspaces(profileId, plan);
    if (similar.length > 0) return { ok: true, status: "similar", similar };
    if (await prisma.novaWorkspace.count({ where: { profileId } }) >= WORKSPACES_MAX) {
      return { ok: false, error: "too_many", message: `You have ${WORKSPACES_MAX} workspaces. Remove one before making another.` };
    }
  }

  const writes = planWrites(plan);
  // Tasks are keyed by the workspace they belong to, so adding the same plan
  // to it again makes nothing twice.
  const keyBase = target?.clientKey ?? clientKey;

  try {
    const result = await prisma.$transaction(async tx => {
      const subjects = await declareWorkspaceSubjectsIn(tx, profileId, writes.subjects);
      const idOf = (name: string | null) => (name ? subjects.ids.get(name.toLowerCase()) ?? null : null);
      const dates = await addDatesIn(tx, profileId, writes.dates.map(d => ({ title: d.title, subjectId: idOf(d.subject), kind: d.kind, day: d.day })), today, now);
      const tasks = await createTasksIn(tx, profileId, writes.tasks.map(t => ({
        title: t.title, priority: t.priority, subjectId: idOf(t.subject), topicName: t.topic, dueDay: t.dueDay,
        estimatedMinutes: t.estimatedMinutes, clientKey: `ws:${keyBase}:${t.key}`.slice(0, 120),
      })));
      if (!tasks.ok) throw new RefusedError("too_many", tasks.message);
      const notes = await createNotesIn(tx, profileId, writes.notes.map(n => ({ title: n.title, body: n.body, subjectId: idOf(n.subject), topicName: n.topic })));
      if (!notes.ok) throw new RefusedError("invalid", notes.message);
      const subjectIds = [...new Set([...(target?.subjectIds ?? []), ...subjects.ids.values()])];
      const row = target
        ? await tx.novaWorkspace.update({ where: { id: target.id }, data: { subjectIds }, select: SUMMARY_SELECT })
        : await tx.novaWorkspace.create({
            data: {
              profileId, kind: plan.kind, templateId: plan.templateId, templateVersion: plan.templateVersion, title: plan.title,
              summary: plan.summary || null, plan: plan as unknown as object, clientKey, subjectIds,
              sources: plan.sources.length ? (plan.sources as unknown as object) : undefined,
            },
            select: SUMMARY_SELECT,
          });
      return {
        row,
        counts: {
          subjectsAdded: subjects.subjectsAdded, topicsAdded: subjects.topicsAdded, datesAdded: dates.added, tasksAdded: tasks.added,
          notesAdded: notes.added, notesSkipped: notes.skipped, datesSkipped: dates.skipped.map(d => d.title),
        },
      };
    }, { timeout: 30_000, maxWait: 10_000 });
    return { ok: true, status: target ? "updated" : "created", workspace: (await summaries(profileId, [result.row]))[0]!, counts: result.counts };
  } catch (err) {
    if (err instanceof RefusedError) return { ok: false, error: err.code, message: err.message };
    // Two requests with one key at once: the other made it.
    if ((err as { code?: string } | null)?.code === "P2002") {
      const made = await prisma.novaWorkspace.findUnique({ where: { profileId_clientKey: { profileId, clientKey } }, select: SUMMARY_SELECT });
      if (made) return { ok: true, status: "exists", workspace: (await summaries(profileId, [made]))[0]! };
    }
    throw err;
  }
}

class RefusedError extends Error {
  constructor(readonly code: "too_many" | "invalid", message: string) { super(message); }
}

// Removing a workspace removes its record only. Its subjects, topics, notes
// and tasks are the learner's and stay; they are edited where they live.
export async function removeWorkspace(profileId: string, id: string): Promise<boolean> {
  return (await prisma.novaWorkspace.deleteMany({ where: { id, profileId } })).count === 1;
}
