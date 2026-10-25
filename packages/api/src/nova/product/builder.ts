// ─── Build with Nova: the conversation and its proposal ───────────────────────
// The only reader and writer of NovaWorkspaceDraft. A draft is one
// conversation with Nova about something the learner wants to organise, and
// the proposal it leads to. It owns no learning data: approving a version
// creates the workspace through workspaces.ts (subjects, topics, dates,
// tasks and notes, each through its own writer, in one transaction).
//
//   discovery ─▶ drafting ─▶ awaiting_approval ─▶ building ─▶ ready
//        ▲           │               │  ▲            │
//        └───────────┘               ▼  │            ▼
//                                 drafting        failed ─▶ (retry)
//
// The rules that hold here, each with a test:
//   - Nothing the learner has is written before approval. A turn writes only
//     this row.
//   - A learner message is answered by one model job, run after the request
//     returns (the page polls). One job at a time per draft: claiming one is
//     a conditional write. A job writes only while the row still carries its
//     jobId, so a cancelled or superseded job changes nothing.
//   - A job's proposal is applied only if the plan is still the version it
//     started from. When the learner edited it meanwhile, their edit stays
//     and Nova says so.
//   - Every change to the plan makes a new version. Approval names one; only
//     the current version can be approved, and the server builds its own
//     stored copy, checked again, never the page's.
//   - Approving twice builds once: the move to "building" is conditional,
//     and the workspace is created under a key made from the draft and the
//     version.
//   - The learner is the one behind the session. A draft or workspace id
//     from the request is used only together with their profile.

import { createHash, randomUUID } from "crypto";
import { prisma } from "@repo/db/client";
import { dayKey, resolveTimezone } from "../engines/learner-calendar";
import { learnerKey } from "./learner-key";
import { loadLearningContexts, loadSignupAnswers } from "../adapters/account-preferences-adapter";
import type { ReplyLanguage } from "../types/understanding.types";
import { WORKING_ON_LABEL, weeklyHoursLabel } from "./onboarding-options";
import type { LearningContext } from "./learning-context";
import { ensureSetupProfile, subjectNames } from "./setup";
import { checkWorkspacePlan, planCounts, type WorkspacePlan } from "./workspace-plan";
import { checkFiles, writeBuilderChanges, writeBuilderPlan } from "./workspace-generation";
import type { LlmAttachment } from "../../services/llmProviders";
import { readBuilderTurn } from "./builder-conversation";
import { changeResource, createWorkspace, recentWorkspaceTitles, resourceCandidates, resourceDetail, similarWorkspaces, studiedTopicIds, workspaceDetail, workspaceSummaries } from "./workspaces";
import { bareOps, changeCounts, checkChanges, decideResource, matchResources, readChangeSet, withinAsk } from "./builder-changes";
import {
  DECLINE_REPLY, MESSAGE_MAX, TALKING, canMove, decideStep, type Step, describeChanges, emptyBrief, isPendingLive, learnerWords, message,
  needsReply, nextBrief, planChanges, readBrief, readMessages, readPending, replyWithQuestion, spoken, withMessages, holdsLine,
} from "./builder-state";
import type { BriefFact, BuilderBrief, BuilderMessage, BuilderResponse, ChangeSet, DraftFailure, DraftFile, DraftListView, DraftStatus, DraftView, PendingJob, ResourceRef } from "./builder.types";
import type { WorkspaceCounts } from "./workspaces.types";

export const OPEN_DRAFTS_MAX = 50;
// Files one conversation may hold, in number and in bytes (one message
// carries at most FILES_MAX files of FILES_TOTAL_BYTES together).
export const DRAFT_FILES_MAX = 6;
export const DRAFT_FILE_BYTES_MAX = 12 * 1024 * 1024;
const KEY_MIN = 8, KEY_MAX = 64;
const CONVERSATION_FOR_PLAN = 24;

type Read = typeof readBuilderTurn;
type Write = typeof writeBuilderPlan;
type WriteChanges = typeof writeBuilderChanges;
export interface BuilderDeps { read?: Read; write?: Write; writeChanges?: WriteChanges }

// A model job the route runs after answering.
export interface BuilderJob { draftId: string; jobId: string; kind: PendingJob["kind"]; change: string | null }

const ROW = {
  id: true, profileId: true, status: true, origin: true, title: true, messages: true, brief: true, plan: true, version: true,
  pending: true, jobId: true, failure: true, targetWorkspaceId: true, targetSubjectIds: true, changes: true, workspaceId: true, builtVersion: true, updatedAt: true,
} as const;
type Row = {
  id: string; profileId: string; status: string; origin: string; title: string | null; messages: unknown; brief: unknown; plan: unknown;
  version: number; pending: unknown; jobId: string | null; failure: unknown; targetWorkspaceId: string | null; targetSubjectIds: string[];
  changes: unknown; workspaceId: string | null; builtVersion: number | null; updatedAt: Date;
};

// What of theirs this conversation works on, from the row: a workspace (one
// it was pointed at, found from their words, or built itself), or subjects
// that belong to none. null: it is shaping something new.
function refOf(row: Pick<Row, "targetWorkspaceId" | "targetSubjectIds">): Pick<ResourceRef, "workspaceId" | "subjectIds"> | null {
  if (row.targetWorkspaceId) return { workspaceId: row.targetWorkspaceId, subjectIds: [] };
  return row.targetSubjectIds.length ? { workspaceId: null, subjectIds: row.targetSubjectIds } : null;
}

const json = (v: unknown) => v as object;
// "No job" and "no failure" are stored as {}: the readers take it as none,
// and it needs no database null for a Json column.
const NONE = {} as object;
const statusOf = (s: string): DraftStatus =>
  (["discovery", "drafting", "awaiting_approval", "building", "ready", "failed", "cancelled"] as const).find(x => x === s) ?? "discovery";
const planOf = (raw: unknown): WorkspacePlan | null => (raw && typeof raw === "object" && !Array.isArray(raw) ? raw as WorkspacePlan : null);
function failureOf(raw: unknown): DraftFailure | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const stage = f.stage === "reply" || f.stage === "drafting" || f.stage === "building" ? f.stage : null;
  return stage && typeof f.message === "string" ? { stage, message: f.message, change: typeof f.change === "string" ? f.change : null } : null;
}

const validKey = (v: unknown): v is string =>
  typeof v === "string" && v.length >= KEY_MIN && v.length <= KEY_MAX && [...v].every(c => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "-" || c === "_");

const textOf = (v: unknown): string => (typeof v === "string" ? v.split("\r").join("").trim().slice(0, MESSAGE_MAX) : "");

async function profileOf(platformChatId: string): Promise<{ id: string; timezone: string | null; goals: string[] } | null> {
  const user = await prisma.messengerUser.findUnique({ where: learnerKey(platformChatId), select: { novaAcademicProfile: { select: { id: true, timezone: true, goals: true } } } });
  return user?.novaAcademicProfile ?? null;
}

// The learner key a profile is reached by (its chat id, or web:<user>), for
// the readers that take one.
async function chatOfProfile(profileId: string): Promise<string | null> {
  const p = await prisma.novaAcademicProfile.findUnique({ where: { id: profileId }, select: { user: { select: { platformChatId: true } } } });
  return p?.user?.platformChatId ?? null;
}

async function rowOf(profileId: string, id: unknown): Promise<Row | null> {
  if (typeof id !== "string" || id.length === 0 || id.length > 64) return null;
  return prisma.novaWorkspaceDraft.findFirst({ where: { id, profileId }, select: ROW });
}

// ── Shared files ──────────────────────────────────────────────────────────────
// The bytes are read only for a model job; every view lists names and sizes.

async function filesListed(draftId: string): Promise<DraftFile[]> {
  const rows = await prisma.novaWorkspaceDraftFile.findMany({ where: { draftId }, select: { id: true, name: true, mimeType: true, size: true, pages: true }, orderBy: { createdAt: "asc" } });
  return rows;
}

async function filesForModel(draftId: string): Promise<{ files: LlmAttachment[]; pages: Record<string, number | null> }> {
  const rows = await prisma.novaWorkspaceDraftFile.findMany({ where: { draftId }, select: { name: true, mimeType: true, bytes: true, pages: true }, orderBy: { createdAt: "asc" } });
  return {
    files: rows.map(r => ({ name: r.name, mimeType: r.mimeType, data: Buffer.from(r.bytes).toString("base64") })),
    pages: Object.fromEntries(rows.map(r => [r.name, r.pages])),
  };
}

type Checked = { ok: true; files: Array<LlmAttachment & { pages: number | null; size: number }> } | { ok: false; message: string };

// Files sent with a message: checked by their bytes (checkFiles), then
// against what the conversation already holds. A name it already has is
// numbered, so every file is one source.
async function checkShared(raw: unknown, draftId: string | null): Promise<Checked> {
  if (raw === undefined || raw === null || (Array.isArray(raw) && raw.length === 0)) return { ok: true, files: [] };
  const checked = checkFiles(raw);
  if (!checked.ok) return { ok: false, message: checked.message };
  const held = draftId ? await prisma.novaWorkspaceDraftFile.findMany({ where: { draftId }, select: { name: true, size: true } }) : [];
  if (held.length + checked.files.length > DRAFT_FILES_MAX) return { ok: false, message: `A conversation can hold up to ${DRAFT_FILES_MAX} files. Start a new one for more.` };
  const added = checked.files.map(f => ({ ...f, size: Buffer.from(f.data, "base64").length, pages: checked.pages[f.name] ?? null }));
  if (held.reduce((n, f) => n + f.size, 0) + added.reduce((n, f) => n + f.size, 0) > DRAFT_FILE_BYTES_MAX) {
    return { ok: false, message: `Files in one conversation can add up to ${DRAFT_FILE_BYTES_MAX / 1024 / 1024} MB.` };
  }
  const names = new Set(held.map(f => f.name));
  for (const f of added) {
    let name = f.name, i = 2;
    while (names.has(name)) name = `${f.name} (${i++})`;
    names.add(name);
    f.name = name;
  }
  return { ok: true, files: added };
}

const fileRows = (draftId: string, files: Array<LlmAttachment & { pages: number | null; size: number }>) =>
  files.map(f => ({ draftId, name: f.name, mimeType: f.mimeType, bytes: Buffer.from(f.data, "base64"), size: f.size, pages: f.pages }));

// Built or cancelled: the files have done their job and are not kept.
const dropFiles = (draftId: string) => prisma.novaWorkspaceDraftFile.deleteMany({ where: { draftId } });

// ── What Kivo already knows (never asked again) ───────────────────────────────

const CONTEXT_WORDS: Record<LearningContext, string> = { school: "school student", college: "university student", working: "working professional", other: "something else" };

async function knownFacts(platformChatId: string, profile: { id: string; goals: string[] }): Promise<BriefFact[]> {
  return (await signupContext(platformChatId, profile)).known;
}

// What they said at sign-up, read once: the facts Nova is told, and the
// language they chose for it.
async function signupContext(platformChatId: string, profile: { id: string; goals: string[] }): Promise<{ known: BriefFact[]; language: ReplyLanguage | null }> {
  const [contexts, signup, subjects, workspaces] = await Promise.all([
    loadLearningContexts(platformChatId).catch(() => [] as LearningContext[]),
    loadSignupAnswers(platformChatId).catch(() => null),
    subjectNames(profile.id, 12),
    recentWorkspaceTitles(profile.id, 6),
  ]);
  const out: BriefFact[] = [];
  if (contexts.length) out.push({ label: "What they do", value: contexts.map(c => CONTEXT_WORDS[c]).join(", ") });
  const working = signup?.workingOn ? [...signup.workingOn.selected.map(id => WORKING_ON_LABEL[id]), ...signup.workingOn.custom] : [];
  if (working.length) out.push({ label: "Working on (said at sign-up)", value: working.join("; ") });
  if (signup?.weeklyHours) out.push({ label: "Time a week (their sign-up estimate)", value: weeklyHoursLabel(signup.weeklyHours) });
  if (profile.goals.length) out.push({ label: "Goals", value: profile.goals.join("; ") });
  if (subjects.length) out.push({ label: "Subjects already in Kivo", value: subjects.join(", ") });
  if (workspaces.length) out.push({ label: "Workspaces already in Kivo", value: workspaces.map(w => w.title).join(", ") });
  return { known: out.slice(0, 8), language: signup?.language ?? null };
}

// What a draft works on, in short, for the model.
async function outlineOf(platformChatId: string, profileId: string, ref: Pick<ResourceRef, "workspaceId" | "subjectIds"> | null) {
  if (!ref) return null;
  const d = await resourceDetail(platformChatId, profileId, ref);
  return d ? { title: d.title, subjects: d.subjects.map(s => s.name), tasks: d.tasks.map(t => t.title), notes: d.notes.map(n => n.title) } : null;
}

// Their workspaces and subjects by name, for the model to recognise one.
const resourceNames = (c: Awaited<ReturnType<typeof resourceCandidates>>): string[] =>
  [...c.workspaces.map(w => `${w.title} (workspace)`), ...c.subjects.map(x => `${x.name}${x.code ? ` [${x.code}]` : ""} (subject)`)];

// ── The view ──────────────────────────────────────────────────────────────────

async function viewOf(row: Row, now: Date, counts: WorkspaceCounts | null = null): Promise<DraftView> {
  const status = statusOf(row.status);
  const plan = planOf(row.plan);
  const pending = readPending(row.pending);
  const messages = readMessages(row.messages);
  const ids = [row.targetWorkspaceId, row.workspaceId].filter((x): x is string => Boolean(x));
  // What it works on, as stored now: its target, or what it built.
  const ref = refOf(row) ?? (row.workspaceId ? { workspaceId: row.workspaceId, subjectIds: [] } : null);
  const platformChatId = ref ? await chatOfProfile(row.profileId) : null;
  const [summaries, similar, files, current] = await Promise.all([
    workspaceSummaries(row.profileId, ids),
    status === "awaiting_approval" && plan && !refOf(row) ? similarWorkspaces(row.profileId, plan) : Promise.resolve([]),
    filesListed(row.id),
    ref && platformChatId ? resourceDetail(platformChatId, row.profileId, ref, now) : Promise.resolve(null),
  ]);
  return {
    id: row.id, status, origin: row.origin === "telegram" ? "telegram" : "web",
    title: row.title, messages, brief: readBrief(row.brief), plan, version: row.version,
    pending: isPendingLive(pending, now) ? pending : null,
    failure: failureOf(row.failure),
    files,
    target: summaries.find(w => w.id === row.targetWorkspaceId) ?? null,
    resource: ref && current ? { kind: current.workspace ? "workspace" : "subjects", workspaceId: current.workspace?.id ?? null, subjectIds: current.subjects.map(x => x.id), title: current.title } : null,
    current,
    changes: readChangeSet(row.changes),
    workspace: summaries.find(w => w.id === row.workspaceId) ?? null,
    builtVersion: row.builtVersion,
    needsReply: TALKING.includes(status) && needsReply(messages, pending, now),
    similar, counts, updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getDraft(platformChatId: string, id: unknown, now = new Date()): Promise<DraftView | null> {
  const profile = await profileOf(platformChatId);
  const row = profile ? await rowOf(profile.id, id) : null;
  return row ? viewOf(row, now) : null;
}

export async function listDrafts(platformChatId: string): Promise<DraftListView> {
  const profile = await profileOf(platformChatId);
  if (!profile) return { status: "ready", drafts: [] };
  const rows = (await prisma.novaWorkspaceDraft.findMany({
    where: { profileId: profile.id, status: { not: "cancelled" } },
    select: { id: true, status: true, title: true, origin: true, updatedAt: true, messages: true, plan: true, targetWorkspaceId: true, targetSubjectIds: true },
    orderBy: { updatedAt: "desc" }, take: 30,
  })).filter(r => !onlyDeclined(r));
  return { status: "ready", drafts: rows.map(r => ({ id: r.id, status: statusOf(r.status), title: r.title, origin: r.origin === "telegram" ? "telegram" : "web", updatedAt: r.updatedAt.toISOString() })) };
}

// A conversation that only ever asked for things this page does not do (an
// essay, a reminder): nothing in it to come back to, so it is not listed.
function onlyDeclined(r: { messages: unknown; plan: unknown; targetWorkspaceId: string | null; targetSubjectIds: string[] }): boolean {
  if (planOf(r.plan) || r.targetWorkspaceId || r.targetSubjectIds.length) return false;
  const nova = readMessages(r.messages).filter(m => m.role === "nova");
  return nova.length > 0 && nova.every(m => m.text === DECLINE_REPLY);
}

// The open drafts and built workspaces, in one line each, for Nova's chat
// context on Telegram and the web: what the learner is building, so a later
// conversation does not start from nothing. Titles only, never the plan.
export async function builderContextLines(profileId: string): Promise<string[]> {
  const [drafts, workspaces] = await Promise.all([
    prisma.novaWorkspaceDraft.findMany({ where: { profileId, status: { in: ["discovery", "drafting", "awaiting_approval", "failed"] }, title: { not: null } }, select: { title: true, status: true }, orderBy: { updatedAt: "desc" }, take: 2 }),
    recentWorkspaceTitles(profileId, 3),
  ]);
  return [
    ...workspaces.map(w => `Workspace they built in Kivo: ${w.title}${w.summary ? ` (${w.summary.slice(0, 140)})` : ""}.`),
    ...drafts.map(d => `Workspace they are still shaping with Nova on the web (${d.status === "awaiting_approval" ? "a proposal is waiting for their approval" : "not proposed yet"}): ${d.title}. Nothing of it exists until they approve it there.`),
  ];
}

// ── Starting ──────────────────────────────────────────────────────────────────

export interface StartInput {
  clientKey:          unknown;
  // Their opening message, if they typed one.
  text?:              unknown;
  // PDFs or photos shared with it: [{ name, data (base64) }].
  files?:             unknown;
  // An existing workspace of theirs to improve.
  targetWorkspaceId?: unknown;
}

export type StartResult =
  | { ok: true; draft: DraftView; job: BuilderJob | null }
  | { ok: false; error: "invalid" | "not_found" | "not_ready" | "too_many"; message: string };

export async function startDraft(platformChatId: string, input: StartInput, now = new Date(), opts: { origin?: "web" | "telegram"; claim?: boolean } = {}): Promise<StartResult> {
  if (!validKey(input.clientKey)) return { ok: false, error: "invalid", message: "That request is missing its key. Reload and try again." };
  const ensured = await ensureSetupProfile(platformChatId);
  if (!ensured) return { ok: false, error: "not_ready", message: "Connect Nova first." };
  const profileId = ensured.profileId;

  const existing = await prisma.novaWorkspaceDraft.findUnique({ where: { profileId_clientKey: { profileId, clientKey: input.clientKey } }, select: ROW });
  if (existing) return { ok: true, draft: await viewOf(existing, now), job: null };

  let target: string | null = null;
  if (input.targetWorkspaceId !== undefined && input.targetWorkspaceId !== null) {
    const found = typeof input.targetWorkspaceId === "string" ? await workspaceSummaries(profileId, [input.targetWorkspaceId]) : [];
    if (found.length === 0) return { ok: false, error: "not_found", message: "That workspace isn't one of yours." };
    target = found[0]!.id;
  }
  if (await prisma.novaWorkspaceDraft.count({ where: { profileId, status: { in: ["discovery", "drafting", "awaiting_approval", "failed"] } } }) >= OPEN_DRAFTS_MAX) {
    return { ok: false, error: "too_many", message: `You have ${OPEN_DRAFTS_MAX} conversations open. Finish or cancel one first.` };
  }

  const text = textOf(input.text);
  const shared = await checkShared(input.files, null);
  if (!shared.ok) return { ok: false, error: "invalid", message: shared.message };
  const claim = (opts.claim ?? true) && (text !== "" || shared.files.length > 0);
  const jobId = claim ? randomUUID() : null;
  const pending: PendingJob | null = claim ? { kind: "reply", stage: "reading", startedAt: now.toISOString(), baseVersion: 0 } : null;
  const brief: BuilderBrief = { ...emptyBrief(), known: await knownFacts(platformChatId, { id: profileId, goals: (await profileOf(platformChatId))?.goals ?? [] }) };
  try {
    const opening = text || shared.files.length ? [message("user", text, now, shared.files.length ? { files: shared.files.map(f => ({ name: f.name, pages: f.pages })) } : {})] : [];
    const row = await prisma.$transaction(async tx => {
      const made = await tx.novaWorkspaceDraft.create({
        data: {
          profileId, clientKey: input.clientKey as string, origin: opts.origin ?? "web", status: "discovery",
          messages: json(opening), brief: json(brief),
          targetWorkspaceId: target, pending: pending ? json(pending) : undefined, jobId,
        },
        select: ROW,
      });
      if (shared.files.length) await tx.novaWorkspaceDraftFile.createMany({ data: fileRows(made.id, shared.files) });
      return made;
    });
    return { ok: true, draft: await viewOf(row, now), job: jobId ? { draftId: row.id, jobId, kind: "reply", change: null } : null };
  } catch (err) {
    // The same start twice at once: the other made it.
    if ((err as { code?: string } | null)?.code === "P2002") {
      const made = await prisma.novaWorkspaceDraft.findUnique({ where: { profileId_clientKey: { profileId, clientKey: input.clientKey } }, select: ROW });
      if (made) return { ok: true, draft: await viewOf(made, now), job: null };
    }
    throw err;
  }
}

// A conversation begun in chat (Telegram, or the web's Nova box): the
// learner's words open a draft, and nothing else happens until they open it
// on the web, where Nova answers. The same words on the same day open the
// same draft, so a repeated message is not a second conversation.
export async function openDraftFromChat(platformChatId: string, text: string, now = new Date(), origin: "web" | "telegram" = "telegram"): Promise<string | null> {
  const words = textOf(text);
  if (!words) return null;
  const key = `chat-${createHash("sha256").update(`${now.toISOString().slice(0, 10)}\n${words.toLowerCase()}`).digest("hex").slice(0, 40)}`;
  const started = await startDraft(platformChatId, { clientKey: key, text: words }, now, { origin, claim: false });
  return started.ok ? started.draft.id : null;
}

// ── A message ─────────────────────────────────────────────────────────────────

export type ClaimResult =
  | { ok: true; draft: DraftView; job: BuilderJob }
  | { ok: false; error: "invalid" | "not_found" | "busy" | "closed"; message: string; draft?: DraftView };

// The learner said something (or opened a draft that waits for Nova's
// answer: `resume`). Claims the draft's one job; the route runs it.
export async function postMessage(platformChatId: string, id: unknown, body: { text?: unknown; resume?: unknown; files?: unknown }, now = new Date()): Promise<ClaimResult> {
  const profile = await profileOf(platformChatId);
  const row = profile ? await rowOf(profile.id, id) : null;
  if (!row) return { ok: false, error: "not_found", message: "That conversation isn't one of yours." };
  const status = statusOf(row.status);
  if (status === "cancelled") return { ok: false, error: "closed", message: "This conversation was cancelled.", draft: await viewOf(row, now) };
  if (status === "building" || (status === "drafting" && isPendingLive(readPending(row.pending), now)) || isPendingLive(readPending(row.pending), now)) {
    return { ok: false, error: "busy", message: "Nova is still on your last message.", draft: await viewOf(row, now) };
  }
  const messages = readMessages(row.messages);
  const text = textOf(body.text);
  const shared = await checkShared(body.files, row.id);
  if (!shared.ok) return { ok: false, error: "invalid", message: shared.message, draft: await viewOf(row, now) };
  if (!text && shared.files.length === 0 && !(body.resume === true && needsReply(messages, null, now))) return { ok: false, error: "invalid", message: "Say something first." };
  const said = text || shared.files.length ? [message("user", text, now, shared.files.length ? { files: shared.files.map(f => ({ name: f.name, pages: f.pages })) } : {})] : [];
  return claim(row, now, { kind: "reply", change: null }, said, shared.files);
}

async function claim(row: Row, now: Date, job: { kind: PendingJob["kind"]; change: string | null }, added: BuilderMessage[], files: Array<LlmAttachment & { pages: number | null; size: number }> = []): Promise<ClaimResult> {
  const jobId = randomUUID();
  const pending: PendingJob = { kind: job.kind, stage: job.kind === "reply" ? "reading" : "writing", startedAt: now.toISOString(), baseVersion: row.version };
  const status = statusOf(row.status);
  const proposed = Boolean(planOf(row.plan) && !refOf(row)) || Boolean(readChangeSet(row.changes));
  // A stale drafting job (its process went away) leaves the draft where it was.
  const back: DraftStatus = status === "drafting" ? (proposed ? "awaiting_approval" : "discovery") : status;
  // A built conversation goes on, about what it built: its workspace is now
  // what it changes (refOf), and the next proposal is a change set to it.
  const nextStatus: DraftStatus = job.kind === "reply" ? (back === "failed" ? (proposed ? "awaiting_approval" : "discovery") : back === "ready" ? "discovery" : back) : "drafting";
  const goingOn = status === "ready" ? { targetWorkspaceId: row.targetWorkspaceId ?? row.workspaceId, changes: NONE } : {};
  // The claim and the files it brings are one write: a refused claim keeps no file.
  const claimed = await prisma.$transaction(async tx => {
    const done = await tx.novaWorkspaceDraft.updateMany({
      where: { id: row.id, profileId: row.profileId, updatedAt: row.updatedAt },
      data: {
        messages: json(withMessages(readMessages(row.messages), ...added)), pending: json(pending), jobId, failure: NONE,
        status: nextStatus, ...goingOn,
      },
    });
    if (done.count === 1 && files.length) await tx.novaWorkspaceDraftFile.createMany({ data: fileRows(row.id, files) });
    return done;
  });
  const fresh = await prisma.novaWorkspaceDraft.findFirst({ where: { id: row.id, profileId: row.profileId }, select: ROW });
  if (claimed.count !== 1 || !fresh) return { ok: false, error: "busy", message: "Nova is still on your last message.", ...(fresh ? { draft: await viewOf(fresh, now) } : {}) };
  return { ok: true, draft: await viewOf(fresh, now), job: { draftId: row.id, jobId, ...job } };
}

// Try the failed step again: Nova's answer, or the proposal it was writing.
// A failed build is retried by approving again.
export async function retryDraft(platformChatId: string, id: unknown, now = new Date()): Promise<ClaimResult> {
  const profile = await profileOf(platformChatId);
  const row = profile ? await rowOf(profile.id, id) : null;
  if (!row) return { ok: false, error: "not_found", message: "That conversation isn't one of yours." };
  const failure = failureOf(row.failure);
  if (isPendingLive(readPending(row.pending), now)) return { ok: false, error: "busy", message: "Nova is still working on it.", draft: await viewOf(row, now) };
  if (!failure || failure.stage === "building") return { ok: false, error: "invalid", message: failure ? "Approve again to retry building it." : "Nothing failed here.", draft: await viewOf(row, now) };
  if (failure.stage === "reply") return claim(row, now, { kind: "reply", change: null }, []);
  return claim(row, now, { kind: planOf(row.plan) || readChangeSet(row.changes) ? "revise" : "draft", change: failure.change ?? null }, []);
}

// ── Running a job (after the request has been answered) ───────────────────────

const DRAFT_FAILED = "Nova couldn't write the proposal just now. Nothing was created or lost; try again.";
const REPLY_FAILED = "Nova couldn't answer just now. Your message is kept; try again.";

export async function runJob(platformChatId: string, job: BuilderJob, deps: BuilderDeps = {}, now = new Date()): Promise<void> {
  const profile = await profileOf(platformChatId);
  const row = profile ? await rowOf(profile.id, job.draftId) : null;
  if (!profile || !row || row.jobId !== job.jobId) return;
  try {
    if (job.kind === "reply") await runTurn(platformChatId, profile, row, job, deps, now);
    else if (refOf(row)) await runChanges(platformChatId, profile, row, job, job.change ?? lastLearnerText(row), deps, now);
    else await runDraft(platformChatId, profile, row, job, job.change, deps, now);
  } catch (err) {
    console.error("[nova/builder] job failed:", (err as Error)?.name ?? "error");
    await settle(row.id, job.jobId, {
      status: (planOf(row.plan) && !refOf(row)) || readChangeSet(row.changes) ? "awaiting_approval" : "discovery",
      failure: { stage: job.kind === "reply" ? "reply" : "drafting", message: job.kind === "reply" ? REPLY_FAILED : DRAFT_FAILED, change: job.change },
      add: [message("nova", job.kind === "reply" ? REPLY_FAILED : DRAFT_FAILED, new Date(), { kind: "error" })],
    });
  }
}

// The job's last write. Only while the row still carries the job's id.
async function settle(id: string, jobId: string, change: {
  status?: DraftStatus; failure?: DraftFailure | null; add?: BuilderMessage[]; brief?: BuilderBrief; title?: string | null;
  plan?: { plan: WorkspacePlan; version: number; baseVersion: number };
  // A change set to what it works on, applied like a plan: only on the version the job started from.
  changes?: { set: ChangeSet; version: number; baseVersion: number };
  // Something of theirs found from their words: what this conversation works on from now.
  target?: Pick<ResourceRef, "workspaceId" | "subjectIds">;
}): Promise<"applied" | "stale_plan" | "gone"> {
  const row = await prisma.novaWorkspaceDraft.findFirst({ where: { id, jobId }, select: { messages: true, status: true } });
  if (!row) return "gone";
  const data = {
    messages: json(withMessages(readMessages(row.messages), ...(change.add ?? []))),
    pending: NONE, jobId: null,
    ...(change.failure !== undefined ? { failure: change.failure ? json(change.failure) : NONE } : {}),
    ...(change.brief ? { brief: json(change.brief) } : {}),
    ...(change.title !== undefined ? { title: change.title } : {}),
    ...(change.status && canMove(statusOf(row.status), change.status) ? { status: change.status } : {}),
    ...(change.target ? { targetWorkspaceId: change.target.workspaceId, targetSubjectIds: change.target.workspaceId ? [] : change.target.subjectIds } : {}),
  };
  if (change.changes) {
    const applied = await prisma.novaWorkspaceDraft.updateMany({
      where: { id, jobId, version: change.changes.baseVersion },
      data: { ...data, changes: json(change.changes.set), version: change.changes.version },
    });
    return applied.count === 1 ? "applied" : "stale_plan";
  }
  if (change.plan) {
    const applied = await prisma.novaWorkspaceDraft.updateMany({
      where: { id, jobId, version: change.plan.baseVersion },
      data: { ...data, plan: json(change.plan.plan), version: change.plan.version },
    });
    return applied.count === 1 ? "applied" : "stale_plan";
  }
  const done = await prisma.novaWorkspaceDraft.updateMany({ where: { id, jobId }, data });
  return done.count === 1 ? "applied" : "gone";
}

function proposalSummary(plan: WorkspacePlan): { milestones: string[]; tasks: string[]; topics: string[]; dates: string[] } {
  return {
    milestones: plan.phases.map(p => p.name),
    tasks: plan.tasks.map(t => t.title),
    topics: plan.subjects.flatMap(s => s.topics.map(t => t.name)),
    dates: plan.dates.map(d => `${d.title} ${d.day}`),
  };
}

// The learner's last words in the conversation: the change asked for, when
// the model said none.
function lastLearnerText(row: Pick<Row, "messages">): string {
  const last = [...readMessages(row.messages)].reverse().find(m => m.role === "user" && m.text);
  return last?.text ?? "Apply what the learner asked for.";
}

async function runTurn(platformChatId: string, profile: { id: string; timezone: string | null; goals: string[] }, row: Row, job: BuilderJob, deps: BuilderDeps, now: Date) {
  const plan = planOf(row.plan);
  const changes = readChangeSet(row.changes);
  let ref = refOf(row);
  const before = readBrief(row.brief);
  const messages = readMessages(row.messages);
  const [{ known, language }, candidates] = await Promise.all([signupContext(platformChatId, profile), resourceCandidates(profile.id)]);
  const today = dayKey(now, resolveTimezone(profile.timezone));
  const existing = await outlineOf(platformChatId, profile.id, ref);
  const shared = await filesForModel(row.id);
  const reading = await (deps.read ?? readBuilderTurn)({
    today, messages: spoken(messages), brief: before, known, files: shared.files, pages: shared.pages, language,
    proposal: plan && !ref ? { version: row.version, title: plan.title, ...proposalSummary(plan) } : null,
    existing: existing ? { title: existing.title, subjects: existing.subjects, tasks: existing.tasks } : null,
    changes: changes ? changes.ops.map(o => o.says) : null,
    resources: resourceNames(candidates),
  });
  if (!reading) {
    await settle(row.id, job.jobId, { failure: { stage: "reply", message: REPLY_FAILED }, add: [message("nova", REPLY_FAILED, new Date(), { kind: "error" })] });
    return;
  }

  // Not what this page does: said by code, and nothing is opened, proposed or counted.
  if (reading.next === "decline") {
    await settle(row.id, job.jobId, { failure: null, add: [message("nova", DECLINE_REPLY, new Date(), { kind: "chat" })] });
    return;
  }

  // Something of theirs, named in a conversation that works on nothing yet:
  // code finds it among their own records before anything new is proposed.
  let found: ResourceRef | null = null;
  let note: string | null = null;
  if (!ref && !plan) {
    const r = decideResource(reading.resource, candidates);
    if (r.type === "choose" || r.type === "missing") {
      const brief = { ...nextBrief(before, reading, { type: "ask", question: r.question }), known, choices: r.type === "choose" ? r.names : [] };
      await settle(row.id, job.jobId, { brief, failure: null, add: [message("nova", r.question, new Date(), { kind: "question" })] });
      return;
    }
    if (r.type === "found") {
      found = r.ref;
      ref = { workspaceId: r.ref.workspaceId, subjectIds: r.ref.subjectIds };
      if (r.intent === "open") {
        const brief = { ...nextBrief(before, reading, { type: "chat" }), known, choices: [], title: r.ref.title };
        const text = `Here's ${r.ref.title} as it is in Kivo now, on the right. Tell me what you'd like to add or change; nothing changes until you approve it.`;
        await settle(row.id, job.jobId, { brief, title: r.ref.title, target: ref, failure: null, add: [message("nova", text, new Date(), { kind: "chat" })] });
        return;
      }
    } else if (reading.resource?.intent === "new") {
      const same = matchResources(reading.resource.name, candidates);
      if (same.length) note = `This will be a new workspace, separate from your ${same.slice(0, 2).map(x => x.name).join(" and ")}: nothing there changes.`;
    }
  }

  // Found and asked to change: propose the change against what is there.
  const step: Step = found ? { type: "draft", reason: "ready" } : decideStep({ plan: ref ? null : plan, brief: before, improving: Boolean(ref), changes: Boolean(changes) }, reading);
  const brief = { ...nextBrief(before, reading, step), known, choices: [] as string[], touches: reading.touches, ...(found ? { title: found.title } : {}) };
  const title = found?.title ?? row.title ?? reading.title ?? brief.title;
  const notes = note ? [message("nova", note, new Date(), { kind: "notice" })] : [];

  if (step.type === "ask" || step.type === "chat") {
    // Asked once: in the model's words, or as code settled on it when the reply asks nothing.
    const text = step.type === "ask" ? (step.overruled ? step.question : replyWithQuestion(reading.reply, step.question)) : reading.reply;
    await settle(row.id, job.jobId, { brief, title, failure: null, add: [message("nova", text, new Date(), { kind: step.type === "ask" ? "question" : "chat" }), ...notes] });
    return;
  }

  // Draft or revise: say what Nova will do, mark the job's stage, then write.
  const intro = found
    ? `I found ${found.title} in your Kivo. I'll propose the changes on the right, against what's there now; nothing changes until you approve them.`
    : step.type === "draft" && step.reason === "enough_questions" && !plan
      ? "I have enough to sketch a first version. I'll put it on the right; correct anything that's off."
      : reading.reply;
  const moved = await prisma.novaWorkspaceDraft.updateMany({
    where: { id: row.id, jobId: job.jobId },
    data: {
      status: "drafting", brief: json(brief), title,
      messages: json(withMessages(messages, message("nova", intro, new Date(), { kind: "chat" }), ...notes)),
      // The version the learner's message was sent on, not the one now:
      // an edit made since then is newer than anything this job writes.
      pending: json({ kind: plan || changes ? "revise" : "draft", stage: "writing", startedAt: now.toISOString(), baseVersion: readPending(row.pending)?.baseVersion ?? row.version } satisfies PendingJob),
      ...(found ? { targetWorkspaceId: found.workspaceId, targetSubjectIds: found.workspaceId ? [] : found.subjectIds } : {}),
    },
  });
  if (moved.count !== 1) return;
  const fresh = await rowOf(profile.id, row.id);
  if (!fresh || fresh.jobId !== job.jobId) return;
  if (ref) await runChanges(platformChatId, profile, fresh, job, step.type === "revise" ? step.change : (reading.change ?? lastLearnerText(fresh)), deps, now);
  else await runDraft(platformChatId, profile, fresh, job, step.type === "revise" ? step.change : null, deps, now);
}

// A change set to what the conversation works on: operations on its records
// by id, checked against them as they are now (builder-changes.ts). Written
// only to the draft; the records change on approval.
async function runChanges(platformChatId: string, profile: { id: string; timezone: string | null; goals: string[] }, row: Row, job: BuilderJob, change: string, deps: BuilderDeps, now: Date) {
  const ref = refOf(row);
  const before = readChangeSet(row.changes);
  const brief = readBrief(row.brief);
  const messages = spoken(readMessages(row.messages));
  const today = dayKey(now, resolveTimezone(profile.timezone));
  const baseVersion = readPending(row.pending)?.baseVersion ?? row.version;
  const fallback: DraftStatus = before ? "awaiting_approval" : "discovery";
  const [current, studied] = await Promise.all([ref ? resourceDetail(platformChatId, profile.id, ref, now) : Promise.resolve(null), studiedTopicIds(profile.id)]);
  if (!current) {
    const gone = "That isn't in your Kivo any more, so there's nothing to change. Start a new conversation to build it again.";
    await settle(row.id, job.jobId, { status: fallback, failure: null, add: [message("nova", gone, new Date(), { kind: "error" })] });
    return;
  }
  const written = await (deps.writeChanges ?? writeBuilderChanges)({
    today, kind: brief.kind, facts: brief.facts,
    current: {
      title: current.title, subjects: current.subjects,
      tasks: current.tasks.map(t => ({ id: t.id, title: t.title, status: t.status, dueDay: t.dueDay, priority: t.priority, topicName: t.topicName })),
      dates: current.dates.map(d => ({ id: d.id, title: d.title, day: d.day })), notes: current.notes.map(n => n.title),
    },
    proposed: before ? bareOps(before) : null, change,
    conversation: messages.slice(-CONVERSATION_FOR_PLAN).map(m => ({ role: m.role, text: m.text })),
    files: (await filesForModel(row.id)).files,
  });
  if (!written.ok) {
    await settle(row.id, job.jobId, { status: fallback, failure: { stage: "drafting", message: written.message, change }, add: [message("nova", written.message, new Date(), { kind: "error" })] });
    return;
  }
  // Only the kinds of record the request is about: "add two topics" brings no tasks, notes or dates.
  const set = withinAsk(checkChanges(written.ops, current, { today, studied }), brief.touches ?? [], current);
  if (set.ops.length === 0) {
    const text = `I couldn't turn that into a change to ${current.title}${set.dropped.length ? `: ${set.dropped.slice(0, 3).join("; ")}` : ""}. Nothing is proposed; could you say it another way?`;
    await settle(row.id, job.jobId, { status: fallback, failure: null, brief: { ...brief, dropped: set.dropped }, add: [message("nova", text, new Date(), { kind: "chat" })] });
    return;
  }
  const version = baseVersion + 1;
  const listed = set.ops.slice(0, 8).map(o => `- ${o.says}`).join("\n");
  const text = [
    `${before ? `Version ${version} of the changes to ${current.title}` : `Here's what I'd change in ${current.title}`}: ${changeCounts(set)}.`,
    listed + (set.ops.length > 8 ? `\n- and ${set.ops.length - 8} more` : ""),
    ...(set.dropped.length ? [`Left out: ${set.dropped.slice(0, 3).join("; ")}.`] : []),
    "Everything else stays as it is. Nothing changes until you approve it.",
  ].join("\n\n");
  const result = await settle(row.id, job.jobId, {
    status: "awaiting_approval", failure: null, brief: { ...brief, dropped: set.dropped },
    add: [message("nova", text, new Date(), { kind: before ? "revision" : "proposal", version })],
    changes: { set, version, baseVersion },
  });
  if (result === "stale_plan") {
    await settle(row.id, job.jobId, { status: fallback, add: [message("nova", `You changed the proposed changes while I was writing, so I kept yours. Ask again if you still want: ${change.slice(0, 200)}`, new Date(), { kind: "notice" })] });
  }
}

async function runDraft(platformChatId: string, profile: { id: string; timezone: string | null; goals: string[] }, row: Row, job: BuilderJob, change: string | null, deps: BuilderDeps, now: Date) {
  const before = planOf(row.plan);
  const brief = readBrief(row.brief);
  const messages = spoken(readMessages(row.messages));
  const today = dayKey(now, resolveTimezone(profile.timezone));
  const baseVersion = readPending(row.pending)?.baseVersion ?? row.version;
  const existing = await outlineOf(platformChatId, profile.id, refOf(row));
  const written = await (deps.write ?? writeBuilderPlan)({
    today, kind: brief.kind, facts: brief.facts, known: brief.known, assumptions: brief.assumptions, suggestions: brief.suggestions,
    conversation: messages.slice(-CONVERSATION_FOR_PLAN).map(m => ({ role: m.role, text: m.text })),
    learnerText: learnerWords(messages),
    current: before,
    change: before ? change ?? "Apply what the learner said last." : null,
    existing,
    files: (await filesForModel(row.id)).files,
  });
  const fallback: DraftStatus = before ? "awaiting_approval" : "failed";
  if (!written.ok) {
    await settle(row.id, job.jobId, {
      status: fallback, failure: { stage: "drafting", message: written.message, change },
      add: [message("nova", written.message, new Date(), { kind: "error" })],
    });
    return;
  }

  const plan = written.plan;
  const version = baseVersion + 1;
  const counts = planCounts(plan);
  const target = existing ? ` It adds to ${existing.title}: nothing there is changed or removed.` : "";
  const text = before
    ? `Version ${version} is ready. ${describeChanges(planChanges(before, plan))}${target} Approve this version to build it, or keep refining.`
    : `Here's a first proposal: ${plan.title}. ${holdsLine(brief.kind, { ...counts, phases: plan.phases.length })}.${target} Nothing is created until you approve it. Edit anything on the right, or tell me what's off.`;
  const result = await settle(row.id, job.jobId, {
    status: "awaiting_approval", failure: null, title: plan.title,
    brief: { ...brief, dropped: written.dropped, title: plan.title },
    add: [message("nova", text, new Date(), { kind: before ? "revision" : "proposal", version })],
    plan: { plan, version, baseVersion },
  });
  if (result === "stale_plan") {
    // The learner edited the proposal while Nova wrote: their version stays.
    await settle(row.id, job.jobId, {
      status: before ? "awaiting_approval" : "discovery",
      add: [message("nova", `You changed the proposal while I was writing, so I kept your version.${change ? ` Ask again if you still want: ${change.slice(0, 200)}` : ""}`, new Date(), { kind: "notice" })],
    });
  }
}

// ── The learner's own edits ───────────────────────────────────────────────────

export async function editDraftPlan(platformChatId: string, id: unknown, body: { plan?: unknown; baseVersion?: unknown }, now = new Date()): Promise<BuilderResponse> {
  const profile = await profileOf(platformChatId);
  const row = profile ? await rowOf(profile.id, id) : null;
  if (!profile || !row) return { ok: false, error: "not_found", message: "That conversation isn't one of yours." };
  const status = statusOf(row.status);
  const stored = planOf(row.plan);
  if (!stored || !["awaiting_approval", "drafting", "failed"].includes(status)) {
    return { ok: false, error: "closed", message: status === "ready" ? "This one is built. Edit it in the Planner, Knowledge and Notes." : "There's no proposal to edit yet.", draft: await viewOf(row, now) };
  }
  if (body.baseVersion !== row.version) return { ok: false, error: "stale", message: "The proposal changed since you opened it. This is the newest version.", draft: await viewOf(row, now) };
  // Links stay only when the learner wrote them: in this conversation, or
  // already kept as theirs in the stored plan. The page's copy is not trusted.
  const ownLinks = [...stored.resources, ...stored.phases.flatMap(p => p.resources)].filter(r => r.origin === "user" && r.url).map(r => r.url).join(" ");
  const checked = checkWorkspacePlan(body.plan, {
    today: dayKey(now, resolveTimezone(profile.timezone)),
    // Page references stay only for files shared in this conversation.
    files: (await filesListed(row.id)).map(f => f.name),
    userText: `${learnerWords(readMessages(row.messages))} ${ownLinks}`,
  });
  if (!checked.ok) return { ok: false, error: "invalid", message: checked.message, draft: await viewOf(row, now) };
  const plan = { ...checked.plan, kind: stored.kind, templateId: stored.templateId, templateVersion: stored.templateVersion };
  const saved = await prisma.novaWorkspaceDraft.updateMany({
    where: { id: row.id, profileId: profile.id, version: row.version, status: { in: ["awaiting_approval", "drafting", "failed"] } },
    data: { plan: json(plan), version: row.version + 1, title: plan.title, ...(status === "failed" ? { status: "awaiting_approval", failure: NONE } : {}) },
  });
  const fresh = await rowOf(profile.id, row.id);
  if (saved.count !== 1 || !fresh) return { ok: false, error: "stale", message: "The proposal changed since you opened it. This is the newest version.", ...(fresh ? { draft: await viewOf(fresh, now) } : {}) };
  return { ok: true, draft: await viewOf(fresh, now) };
}

// The learner leaves out some of the proposed changes: `keep` names the ones
// that stay, on the version they were looking at. What stays is checked again
// against the records. Leaving out all of them leaves nothing proposed.
export async function editDraftChanges(platformChatId: string, id: unknown, body: { keep?: unknown; baseVersion?: unknown }, now = new Date()): Promise<BuilderResponse> {
  const profile = await profileOf(platformChatId);
  const row = profile ? await rowOf(profile.id, id) : null;
  if (!profile || !row) return { ok: false, error: "not_found", message: "That conversation isn't one of yours." };
  const set = readChangeSet(row.changes);
  const ref = refOf(row);
  if (!set || !ref || !["awaiting_approval", "failed"].includes(statusOf(row.status))) return { ok: false, error: "closed", message: "There are no proposed changes to edit.", draft: await viewOf(row, now) };
  if (body.baseVersion !== row.version) return { ok: false, error: "stale", message: "The proposed changes were updated since you opened them. These are the newest.", draft: await viewOf(row, now) };
  if (!Array.isArray(body.keep) || !body.keep.every(k => typeof k === "string")) return { ok: false, error: "invalid", message: "That isn't a change Kivo can make." };
  const keep = new Set(body.keep as string[]);
  const current = await resourceDetail(platformChatId, profile.id, ref, now);
  if (!current) return { ok: false, error: "not_found", message: "That isn't in your Kivo any more." };
  const kept = checkChanges(bareOps({ ops: set.ops.filter(o => keep.has(o.id)), dropped: [] }), current, { today: dayKey(now, resolveTimezone(profile.timezone)), studied: await studiedTopicIds(profile.id) });
  const saved = await prisma.novaWorkspaceDraft.updateMany({
    where: { id: row.id, profileId: profile.id, version: row.version, jobId: null },
    data: kept.ops.length
      ? { changes: json({ ...kept, dropped: set.dropped }), version: row.version + 1, ...(statusOf(row.status) === "failed" ? { status: "awaiting_approval", failure: NONE } : {}) }
      : { changes: NONE, version: row.version + 1, status: "discovery", failure: NONE },
  });
  const fresh = await rowOf(profile.id, row.id);
  if (saved.count !== 1 || !fresh) return { ok: false, error: "stale", message: "The proposed changes were updated since you opened them. These are the newest.", ...(fresh ? { draft: await viewOf(fresh, now) } : {}) };
  return { ok: true, draft: await viewOf(fresh, now) };
}

// ── Approval ──────────────────────────────────────────────────────────────────

export interface ApproveInput { version?: unknown; addTo?: unknown; confirmAnother?: unknown }

export async function approveDraft(platformChatId: string, id: unknown, input: ApproveInput, now = new Date()): Promise<BuilderResponse> {
  const profile = await profileOf(platformChatId);
  const row = profile ? await rowOf(profile.id, id) : null;
  if (!profile || !row) return { ok: false, error: "not_found", message: "That conversation isn't one of yours." };
  const status = statusOf(row.status);
  // Approved before: what it built.
  if (status === "ready" && row.builtVersion === input.version) return { ok: true, draft: await viewOf(row, now) };
  if (status === "building") return { ok: false, error: "busy", message: "It's being built now.", draft: await viewOf(row, now) };
  const plan = planOf(row.plan);
  // A change set to something of theirs is what is approved there, not a plan.
  const ref = refOf(row);
  const set = ref ? readChangeSet(row.changes) : null;
  if ((!set && (!plan || ref)) || (status !== "awaiting_approval" && !(status === "failed" && failureOf(row.failure)?.stage === "building"))) {
    return { ok: false, error: "not_ready", message: status === "ready" ? "This one is already built." : "There's no proposal to approve yet.", draft: await viewOf(row, now) };
  }
  if (input.version !== row.version) return { ok: false, error: "stale", message: "The proposal changed after you looked at it. Review this version, then approve it.", draft: await viewOf(row, now) };
  if (isPendingLive(readPending(row.pending), now)) return { ok: false, error: "busy", message: "Nova is still changing this proposal. Approve once it's done.", draft: await viewOf(row, now) };

  const took = await prisma.novaWorkspaceDraft.updateMany({
    where: { id: row.id, profileId: profile.id, version: row.version, status: { in: ["awaiting_approval", "failed"] } },
    data: { status: "building", failure: NONE },
  });
  if (took.count !== 1) {
    const fresh = await rowOf(profile.id, row.id);
    return fresh && statusOf(fresh.status) === "ready" && fresh.builtVersion === row.version
      ? { ok: true, draft: await viewOf(fresh, now) }
      : { ok: false, error: "busy", message: "It's being built now.", ...(fresh ? { draft: await viewOf(fresh, now) } : {}) };
  }

  const back = async (data: Record<string, unknown>, add: BuilderMessage[] = []) => {
    const current = await rowOf(profile.id, row.id);
    await prisma.novaWorkspaceDraft.updateMany({
      where: { id: row.id, status: "building" },
      data: { ...data, ...(add.length && current ? { messages: json(withMessages(readMessages(current.messages), ...add)) } : {}) },
    });
    const fresh = await rowOf(profile.id, row.id);
    return fresh!;
  };

  if (ref && set) {
    let changed: Awaited<ReturnType<typeof changeResource>>;
    try {
      changed = await changeResource(platformChatId, { ref, set, key: `d${row.id}v${row.version}`.slice(0, 60) }, now);
    } catch (err) {
      console.error("[nova/builder] change failed:", (err as Error)?.name ?? "error");
      const message_ = "Applying the changes didn't work, and nothing was changed. Try approving again.";
      const fresh = await back({ status: "failed", failure: json({ stage: "building", message: message_ }) }, [message("nova", message_, new Date(), { kind: "error" })]);
      return { ok: false, error: "failed", message: message_, draft: await viewOf(fresh, now) };
    }
    if (!changed.ok) {
      // The records moved on since the changes were proposed: Nova proposes
      // them again against what is there (Try again), rather than approving again.
      const failure = changed.error === "changed"
        ? { stage: "drafting", message: changed.message, change: "Propose the same changes again against the records as they are now." }
        : { stage: "building", message: changed.message };
      const fresh = await back({ status: "failed", failure: json(failure) }, [message("nova", changed.message, new Date(), { kind: "error" })]);
      return { ok: false, error: changed.error === "changed" ? "stale" : changed.error === "not_found" ? "not_found" : changed.error === "too_many" ? "too_many" : "failed", message: changed.message, draft: await viewOf(fresh, now) };
    }
    const c = changed.counts;
    const said = `Done: ${changed.detail.title} is updated (${[c.added && `${c.added} added`, c.changed && `${c.changed} changed`, c.removed && `${c.removed} removed`].filter(Boolean).join(", ") || "nothing new; it was all there already"}). Everything else is as it was. See it on the Knowledge Map, Planner and Notes.`;
    const fresh = await back(
      { status: "ready", workspaceId: ref.workspaceId ?? row.workspaceId, builtVersion: row.version, failure: NONE, changes: NONE, ...(ref.workspaceId ? {} : { targetSubjectIds: changed.subjectIds }) },
      [message("nova", said, new Date(), { kind: "built", version: row.version })],
    );
    await dropFiles(row.id);
    return { ok: true, draft: await viewOf(fresh, now) };
  }

  let result: Awaited<ReturnType<typeof createWorkspace>>;
  try {
    result = await createWorkspace(platformChatId, {
      plan: plan!, clientKey: `d-${row.id}-v${row.version}`.slice(0, KEY_MAX),
      addTo: typeof input.addTo === "string" ? input.addTo : undefined,
      confirmAnother: input.confirmAnother === true,
    }, now);
  } catch (err) {
    console.error("[nova/builder] build failed:", (err as Error)?.name ?? "error");
    const message_ = "Building it didn't work, and nothing was created. Try approving again.";
    const fresh = await back({ status: "failed", failure: json({ stage: "building", message: message_ }) }, [message("nova", message_, new Date(), { kind: "error" })]);
    return { ok: false, error: "failed", message: message_, draft: await viewOf(fresh, now) };
  }

  if (!result.ok) {
    const fresh = await back({ status: "failed", failure: json({ stage: "building", message: result.message }) }, [message("nova", `${result.message} Nothing was created.`, new Date(), { kind: "error" })]);
    return { ok: false, error: result.error === "too_many" ? "too_many" : result.error === "not_found" ? "not_found" : "failed", message: result.message, draft: await viewOf(fresh, now) };
  }
  if (result.status === "similar") {
    // Not built: they choose first (add to one, or create another).
    const fresh = await back({ status: "awaiting_approval" });
    return { ok: true, draft: { ...(await viewOf(fresh, now)), similar: result.similar } };
  }

  const counts = result.status === "exists" ? null : result.counts;
  const said = counts
    ? `${result.status === "updated" ? `Added to ${result.workspace.title}` : `${result.workspace.title} is built`}: ${holdsLine(readBrief(row.brief).kind, { subjects: counts.subjectsAdded, topics: counts.topicsAdded, phases: 0, tasks: counts.tasksAdded, notes: counts.notesAdded, dates: counts.datesAdded }) || "nothing new (you had all of it)"}. It's in your Planner, Knowledge and Notes now.`
    : `${result.workspace.title} was already built from this version.`;
  const fresh = await back(
    { status: "ready", workspaceId: result.workspace.id, builtVersion: row.version, failure: NONE },
    [message("nova", said, new Date(), { kind: "built", version: row.version })],
  );
  await dropFiles(row.id);
  return { ok: true, draft: await viewOf(fresh, now, counts) };
}

// Stopping: nothing was created, and a job still running writes nothing.
export async function cancelDraft(platformChatId: string, id: unknown, now = new Date()): Promise<BuilderResponse> {
  const profile = await profileOf(platformChatId);
  const row = profile ? await rowOf(profile.id, id) : null;
  if (!profile || !row) return { ok: false, error: "not_found", message: "That conversation isn't one of yours." };
  // Proposed changes to something of theirs: discarding them leaves the
  // conversation going (and its records as they are).
  if (refOf(row) && readChangeSet(row.changes)) {
    const done = await prisma.novaWorkspaceDraft.updateMany({
      where: { id: row.id, profileId: profile.id, status: { in: ["awaiting_approval", "failed", "drafting"] } },
      data: {
        changes: NONE, status: "discovery", pending: NONE, jobId: null, failure: NONE, version: row.version + 1,
        messages: json(withMessages(readMessages(row.messages), message("nova", "Discarded the proposed changes. Nothing was changed.", now, { kind: "notice" }))),
      },
    });
    const fresh = await rowOf(profile.id, row.id);
    if (done.count !== 1 || !fresh) return { ok: false, error: "closed", message: "Those changes can't be discarded now.", ...(fresh ? { draft: await viewOf(fresh, now) } : {}) };
    return { ok: true, draft: await viewOf(fresh, now) };
  }
  const done = await prisma.novaWorkspaceDraft.updateMany({
    where: { id: row.id, profileId: profile.id, status: { in: ["discovery", "drafting", "awaiting_approval", "failed"] } },
    data: { status: "cancelled", pending: NONE, jobId: null },
  });
  if (done.count === 1) await dropFiles(row.id);
  const fresh = await rowOf(profile.id, row.id);
  if (done.count !== 1) return { ok: false, error: "closed", message: statusOf(row.status) === "building" ? "It's being built now, so it can't be cancelled." : "This one can't be cancelled.", ...(fresh ? { draft: await viewOf(fresh, now) } : {}) };
  return { ok: true, draft: await viewOf(fresh!, now) };
}

// Deleting a conversation removes the conversation and its shared files, and
// nothing else: what it built or changed (the workspace, its subjects,
// topics, tasks, notes and dates) is the learner's and stays everywhere it
// shows. Nothing points from those records to the draft. Not while it is
// being built.
export async function deleteDraft(platformChatId: string, id: unknown): Promise<{ ok: true } | { ok: false; error: "not_found" | "busy"; message: string }> {
  const profile = await profileOf(platformChatId);
  const row = profile ? await rowOf(profile.id, id) : null;
  if (!profile || !row) return { ok: false, error: "not_found", message: "That conversation isn't one of yours." };
  const done = await prisma.novaWorkspaceDraft.deleteMany({ where: { id: row.id, profileId: profile.id, status: { not: "building" } } });
  if (done.count !== 1) return { ok: false, error: "busy", message: "It's being built right now. Delete it once that's done." };
  return { ok: true };
}

// The live workspace a draft built (or any workspace of theirs).
export async function liveWorkspace(platformChatId: string, workspaceId: unknown, now = new Date()) {
  const profile = await profileOf(platformChatId);
  if (!profile || typeof workspaceId !== "string") return null;
  return workspaceDetail(platformChatId, profile.id, workspaceId, now);
}
