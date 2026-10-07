// ─── Study setup ──────────────────────────────────────────────────────────────
// The one place a learner's study setup is read and written: the subjects
// this term, what each covers, exam and deadline dates, how long a normal day
// allows and when they usually study. The setup page, the web chat and
// Telegram all end here, for the same learner, so there is one setup.
//
// Nothing is saved without the learner confirming it. A form shows a preview
// (previewSetup) and saves on confirm; a sentence becomes a proposal
// (proposeSetup, pure), is shown back, and is saved when they say yes.
//
// Saving merges and never duplicates: a subject, topic or exam already on
// record is left as it is, so the same setup saved twice is saved once.
// Nothing is guessed: a value the learner did not give stays unknown.
// The learner is whoever the key resolves to; nothing here takes an id from
// a client. No LLM call.

import { prisma } from "@repo/db/client";
import { isIsoDay } from "../brains/understanding-parser";
import { dayKey, resolveTimezone } from "../engines/learner-calendar";
import { statedDailyMinutes } from "../engines/study-snapshot";
import { declareTopics, normalizeTopicName, subjectsNamedIn } from "../engines/topic-mastery-engine";
import { nextSetupQuestion, setupGaps, type SetupFacts, type SetupGap } from "../interaction/initialization";
import { STUDY_TIMES, type SetupStatement, type StudyTime } from "../types/understanding.types";
import { addExam, EXAM_HORIZON_DAYS } from "./exams";
import { learnerKey } from "./learner-key";
import type { SetupChanges, SetupDraft, SetupIssue, SetupView } from "./setup.types";

export type { SetupChanges, SetupDraft, SetupIssue, SetupView } from "./setup.types";

export const SETUP_SUBJECT_CHOICES = 4;
export const MAX_SUBJECTS = 12;
export const MAX_TOPICS_IN_DRAFT = 40;
export const MAX_EXAMS_IN_DRAFT = 20;
const MIN_DAILY_MINUTES = 10;
const MAX_DAILY_MINUTES = 16 * 60;
const DAY_MS = 86_400_000;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const tidy = (v: unknown, max: number): string => typeof v === "string" ? normalizeTopicName(v).slice(0, max) : "";

// ── The whole setup, as a learner fills it in ─────────────────────────────────


// Shape, limits and vocabulary. Duplicates inside the draft are folded
// together. Anything that cannot be used is reported, never silently fixed
// into something else.
export function normalizeSetupDraft(raw: unknown, today: string): { draft: SetupDraft; issues: SetupIssue[] } {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const issues: SetupIssue[] = [];
  const subjects: SetupDraft["subjects"] = [];

  for (const item of Array.isArray(r["subjects"]) ? r["subjects"] : []) {
    const s    = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const name = tidy(s["name"], 80);
    if (name.length < 2) { if (name.length > 0 || Array.isArray(s["topics"]) && s["topics"].length > 0) issues.push({ field: "subjects", message: "A subject needs a name." }); continue; }
    let into = subjects.find(x => same(x.name, name));
    if (!into) {
      if (subjects.length >= MAX_SUBJECTS) { issues.push({ field: "subjects", message: `At most ${MAX_SUBJECTS} subjects.` }); break; }
      into = { name, topics: [] };
      subjects.push(into);
    }
    for (const t of Array.isArray(s["topics"]) ? s["topics"] : []) {
      const topic = tidy(t, 120);
      if (topic.length < 2 || same(topic, name) || into.topics.some(x => same(x, topic))) continue;
      if (into.topics.length >= MAX_TOPICS_IN_DRAFT) { issues.push({ field: `topics:${name}`, message: `At most ${MAX_TOPICS_IN_DRAFT} topics for ${name} at a time.` }); break; }
      into.topics.push(topic);
    }
  }

  const exams: SetupDraft["exams"] = [];
  for (const item of (Array.isArray(r["exams"]) ? r["exams"] : []).slice(0, MAX_EXAMS_IN_DRAFT)) {
    const e = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const subjectName = tidy(e["subjectName"], 80);
    const date = e["date"];
    if (!subjectName && !date) continue;
    if (!subjectName) { issues.push({ field: "exams", message: "An exam needs its subject." }); continue; }
    if (!isIsoDay(date)) { issues.push({ field: "exams", message: `The ${subjectName} exam needs a date.` }); continue; }
    if (date < today) { issues.push({ field: "exams", message: `The ${subjectName} exam date has passed.` }); continue; }
    if (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`) > EXAM_HORIZON_DAYS * DAY_MS) {
      issues.push({ field: "exams", message: `The ${subjectName} exam is more than a year away.` }); continue;
    }
    if (exams.some(x => same(x.subjectName, subjectName) && x.date === date)) continue;
    exams.push({ subjectName, date, title: tidy(e["title"], 80) || null });
  }

  let dailyMinutes: number | null = null;
  const daily = r["dailyMinutes"];
  if (daily !== null && daily !== undefined && daily !== "") {
    if (typeof daily === "number" && Number.isFinite(daily) && daily >= MIN_DAILY_MINUTES && daily <= MAX_DAILY_MINUTES) dailyMinutes = Math.round(daily);
    else issues.push({ field: "dailyMinutes", message: "Daily study time should be between 10 minutes and 16 hours." });
  }
  let studyTime: StudyTime | null = null;
  const when = r["studyTime"];
  if (when !== null && when !== undefined && when !== "") {
    studyTime = STUDY_TIMES.find(t => t === when) ?? null;
    if (!studyTime) issues.push({ field: "studyTime", message: "Usual study time is morning, afternoon, evening or night." });
  }

  return { draft: { subjects, exams, dailyMinutes, studyTime }, issues };
}

// ── What is on record ─────────────────────────────────────────────────────────


async function loadLearner(platformChatId: string) {
  return prisma.messengerUser.findUnique({
    where:  learnerKey(platformChatId),
    select: {
      id: true,
      novaAcademicProfile: {
        select: {
          id: true, onboardingComplete: true, timezone: true,
          preferredStudyTime: true, preferredStudyHoursPerDay: true, dailyStudyMinutes: true,
          subjects: {
            select:  { id: true, name: true, code: true, topics: { select: { name: true }, orderBy: { createdAt: "asc" } } },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });
}
type Learner = NonNullable<Awaited<ReturnType<typeof loadLearner>>>;

async function viewOf(learner: Learner, now: Date): Promise<SetupView> {
  const profile = learner.novaAcademicProfile;
  const exams = profile
    ? await prisma.novaExam.findMany({
        where:   { profileId: profile.id, scheduledAt: { gte: new Date(now.getTime() - DAY_MS) } },
        select:  { title: true, scheduledAt: true, subject: { select: { name: true } } },
        orderBy: { scheduledAt: "asc" },
      })
    : [];
  const subjects = (profile?.subjects ?? []).map(s => ({ name: s.name, topics: s.topics.map(t => t.name) }));
  const facts: SetupFacts = {
    subjects:      subjects.map(s => ({ name: s.name, topicCount: s.topics.length })),
    upcomingExams: exams.length,
    studyTime:     profile?.preferredStudyTime ?? null,
    dailyMinutes:  profile ? statedDailyMinutes(profile) : null,
  };
  return {
    subjects,
    exams:        exams.map(e => ({ subjectName: e.subject?.name ?? null, title: e.title, date: e.scheduledAt.toISOString().slice(0, 10) })),
    dailyMinutes: facts.dailyMinutes,
    studyTime:    facts.studyTime,
    complete:     subjects.some(s => s.topics.length > 0),
    missing:      setupGaps(facts),
    nextQuestion: nextSetupQuestion(facts)?.question ?? null,
  };
}

// null: nobody behind this key.
export async function loadSetup(platformChatId: string, now = new Date()): Promise<SetupView | null> {
  const learner = await loadLearner(platformChatId);
  return learner ? viewOf(learner, now) : null;
}

export async function loadSetupFacts(platformChatId: string, now = new Date()): Promise<SetupFacts | null> {
  const view = await loadSetup(platformChatId, now);
  if (!view) return null;
  return {
    subjects:      view.subjects.map(s => ({ name: s.name, topicCount: s.topics.length })),
    upcomingExams: view.exams.length,
    studyTime:     view.studyTime,
    dailyMinutes:  view.dailyMinutes,
  };
}

// ── Preview, then save ────────────────────────────────────────────────────────


// "replace": the draft is the learner's whole answer, so a routine value
// left empty means "not sure" and clears what was there (the setup page).
// "merge": the draft is one thing they said, and says nothing about the
// rest (a sentence in chat).
export type RoutineMode = "replace" | "merge";

function changesOf(view: SetupView, draft: SetupDraft, routine: RoutineMode): { changes: SetupChanges; issues: SetupIssue[] } {
  const issues: SetupIssue[] = [];
  const known = (name: string) => view.subjects.find(s => same(s.name, name)) ?? null;
  const newSubjects = draft.subjects.filter(s => !known(s.name)).map(s => s.name);
  if (view.subjects.length + newSubjects.length > MAX_SUBJECTS) issues.push({ field: "subjects", message: `At most ${MAX_SUBJECTS} subjects.` });

  const newTopics: SetupChanges["newTopics"] = [];
  let knownTopics = 0;
  for (const s of draft.subjects) {
    const have  = known(s.name)?.topics ?? [];
    const fresh = s.topics.filter(t => !have.some(h => same(h, t)));
    knownTopics += s.topics.length - fresh.length;
    if (fresh.length > 0) newTopics.push({ subject: known(s.name)?.name ?? s.name, topics: fresh });
  }

  const newExams: SetupChanges["newExams"] = [];
  let knownExams = 0;
  for (const e of draft.exams) {
    const subject = known(e.subjectName)?.name ?? draft.subjects.find(s => same(s.name, e.subjectName))?.name ?? null;
    if (!subject) { issues.push({ field: "exams", message: `${e.subjectName} is not one of your subjects.` }); continue; }
    const there = view.exams.some(x => x.subjectName !== null && same(x.subjectName, subject)
      && Math.abs(Date.parse(`${x.date}T00:00:00Z`) - Date.parse(`${e.date}T00:00:00Z`)) <= DAY_MS);
    if (there) knownExams++; else newExams.push({ subjectName: subject, date: e.date });
  }

  const to = <T,>(from: T | null, next: T | null) =>
    (routine === "replace" ? next !== from : next !== null && next !== from) ? { from, to: next } : null;

  return {
    issues,
    changes: {
      newSubjects, newTopics, knownTopics, newExams, knownExams,
      dailyMinutes: to(view.dailyMinutes, draft.dailyMinutes),
      studyTime:    to(view.studyTime, draft.studyTime),
      complete:     view.complete || newTopics.length > 0,
    },
  };
}

export type SetupPreview =
  | { status: "ok"; draft: SetupDraft; changes: SetupChanges; issues: SetupIssue[] }
  | { status: "not_ready" };

// What saving this would do. Reads only.
export async function previewSetup(platformChatId: string, raw: unknown, now = new Date(), routine: RoutineMode = "replace"): Promise<SetupPreview> {
  const learner = await loadLearner(platformChatId);
  if (!learner) return { status: "not_ready" };
  const today = dayKey(now, resolveTimezone(learner.novaAcademicProfile?.timezone ?? null));
  const { draft, issues } = normalizeSetupDraft(raw, today);
  const { changes, issues: more } = changesOf(await viewOf(learner, now), draft, routine);
  return { status: "ok", draft, changes, issues: [...issues, ...more] };
}

export type SaveSetupResult =
  | { status: "saved"; changes: SetupChanges; setup: SetupView }
  | { status: "invalid"; issues: SetupIssue[] }
  | { status: "not_ready" };

// Saves a confirmed setup. All of it or none of it: a draft with a problem
// is returned with the problem and nothing is written.
export async function saveSetup(platformChatId: string, raw: unknown, now = new Date(), routine: RoutineMode = "replace"): Promise<SaveSetupResult> {
  const preview = await previewSetup(platformChatId, raw, now, routine);
  if (preview.status !== "ok") return preview;
  if (preview.issues.length > 0) return { status: "invalid", issues: preview.issues };
  const { draft } = preview;
  const learner = (await loadLearner(platformChatId))!;

  const write = () => prisma.$transaction(async tx => {
    const profile = await tx.novaAcademicProfile.upsert({
      where:  { userId: learner.id },
      create: { userId: learner.id },
      update: {},
      select: { id: true, subjects: { select: { id: true, name: true } } },
    });
    let hasTopics = false;
    for (const s of draft.subjects) {
      const subject = profile.subjects.find(x => same(x.name, s.name))
        ?? await tx.novaSubject.create({ data: { profileId: profile.id, name: s.name }, select: { id: true, name: true } });
      if (s.topics.length > 0) { await declareTopics(tx, subject.id, s.topics); hasTopics = true; }
    }
    const complete = hasTopics || await tx.novaTopicMastery.count({ where: { subject: { profileId: profile.id } } }) > 0;
    const setDaily = routine === "replace" || draft.dailyMinutes !== null;
    const setTime  = routine === "replace" || draft.studyTime !== null;
    await tx.novaAcademicProfile.update({
      where: { id: profile.id },
      data:  {
        ...(setDaily ? {
          dailyStudyMinutes: draft.dailyMinutes,
          // The older column is kept in step. Unknown goes back to its default,
          // which statedDailyMinutes reads as "not said".
          preferredStudyHoursPerDay: draft.dailyMinutes !== null ? Math.round((draft.dailyMinutes / 60) * 100) / 100 : 3.0,
        } : {}),
        ...(setTime ? { preferredStudyTime: draft.studyTime } : {}),
        ...(complete ? { onboardingComplete: true, onboardingStep: "complete" } : {}),
      },
    });
  });

  // Two saves at the same moment (a double click, two tabs) can both try to
  // create the same row. The second finds it there on a second look.
  try {
    await write();
  } catch (err) {
    if ((err as { code?: string } | null)?.code !== "P2002") throw err;
    await write();
  }

  // Exams go through the one exam writer, which already refuses a duplicate.
  for (const e of draft.exams) {
    await addExam(platformChatId, { title: e.title ?? `${e.subjectName} exam`, subjectName: e.subjectName, date: e.date }, now);
  }

  const setup = await viewOf((await loadLearner(platformChatId))!, now);
  return { status: "saved", changes: preview.changes, setup };
}

// ── From a sentence ───────────────────────────────────────────────────────────

export interface SetupProposal {
  // Subjects the learner named that are not on record yet.
  newSubjects:    string[];
  // The subject the topics are for. More than one: the learner picks. A name
  // from newSubjects means "as a new subject".
  subjectChoices: string[];
  topics:         string[];
  dailyMinutes:   number | null;
  studyTime:      StudyTime | null;
}

export interface SetupChange {
  subjects?:    string[];          // new subjects to add
  subjectName:  string | null;     // the subject the topics are for
  topics:       string[];
  dailyMinutes: number | null;
  studyTime:    StudyTime | null;
}

// What could be saved from what was said. Topics need a subject: one the
// learner has, one they named in the same breath, or one they pick. Nova
// never files them under a subject of its own choosing.
export function proposeSetup(
  stated:   SetupStatement,
  subjects: Array<{ name: string; code?: string | null }>,
): SetupProposal | null {
  const has = (name: string) => subjects.some(s => same(s.name, name) || (s.code ? same(s.code, name) : false));
  const newSubjects: string[] = [];
  for (const raw of stated.subjects ?? []) {
    const name = tidy(raw, 80);
    if (name.length < 2 || has(name) || subjectsNamedIn(name, subjects).length > 0 || newSubjects.some(n => same(n, name))) continue;
    if (subjects.length + newSubjects.length >= MAX_SUBJECTS) break;
    newSubjects.push(name);
  }

  const topics = stated.topics.filter(t => !has(t) && !newSubjects.some(n => same(n, t)));
  let subjectChoices: string[] = [];
  if (topics.length > 0) {
    const said  = stated.subject ? tidy(stated.subject, 80) : "";
    const owned = said ? subjects.filter(s => same(s.name, said) || (s.code ? same(s.code, said) : false)) : [];
    const hinted = owned.length > 0 ? owned : said ? subjectsNamedIn(said, subjects) : [];
    const fresh = said ? newSubjects.find(n => same(n, said)) ?? null : null;
    if (hinted.length === 1) subjectChoices = [hinted[0]!.name];
    else if (fresh) subjectChoices = [fresh];
    else if (said.length >= 2 && subjects.length === 0) { subjectChoices = [said]; if (!newSubjects.some(n => same(n, said))) newSubjects.push(said); }
    else if (!said && subjects.length + newSubjects.length === 1) subjectChoices = [subjects[0]?.name ?? newSubjects[0]!];
    else subjectChoices = [...subjects.map(s => s.name), ...newSubjects].slice(0, SETUP_SUBJECT_CHOICES);
  }
  const keptTopics = subjectChoices.length > 0 ? topics : [];
  if (newSubjects.length === 0 && keptTopics.length === 0 && stated.dailyMinutes === null && stated.studyTime === null) return null;
  return { newSubjects, subjectChoices, topics: keptTopics, dailyMinutes: stated.dailyMinutes, studyTime: stated.studyTime };
}

export type ApplySetupResult =
  | { status: "saved"; subjectName: string | null; addedSubjects: string[]; added: string[]; existing: string[]; dailyMinutes: number | null; studyTime: StudyTime | null; complete: boolean }
  | { status: "not_ready" }          // nobody behind this key
  | { status: "unknown_subject" }    // the topics' subject is neither theirs nor one being added
  | { status: "invalid" };

// Saves what a learner confirmed in chat. The same writer as the setup page.
export async function applySetup(platformChatId: string, change: SetupChange, now = new Date()): Promise<ApplySetupResult> {
  const view = await loadSetup(platformChatId, now);
  if (!view) return { status: "not_ready" };
  const adding = (change.subjects ?? []).map(n => tidy(n, 80)).filter(n => n.length >= 2);
  const target = change.topics.length > 0 && change.subjectName !== null
    ? view.subjects.find(s => same(s.name, change.subjectName!))?.name ?? adding.find(n => same(n, change.subjectName!)) ?? null
    : null;
  if (change.topics.length > 0 && !target) return { status: "unknown_subject" };

  const draft = {
    subjects: [
      ...adding.filter(n => !target || !same(n, target)).map(name => ({ name, topics: [] as string[] })),
      ...(target ? [{ name: target, topics: change.topics }] : []),
    ],
    exams: [], dailyMinutes: change.dailyMinutes, studyTime: change.studyTime,
  };
  const saved = await saveSetup(platformChatId, draft, now, "merge");
  if (saved.status === "not_ready") return saved;
  if (saved.status === "invalid") return { status: "invalid" };
  const mine = saved.changes.newTopics.find(t => target !== null && same(t.subject, target))?.topics ?? [];
  return {
    status: "saved", subjectName: target, addedSubjects: saved.changes.newSubjects,
    added: mine, existing: change.topics.filter(t => !mine.some(m => same(m, t))),
    dailyMinutes: saved.changes.dailyMinutes?.to ?? null,
    studyTime:    (saved.changes.studyTime?.to as StudyTime | null | undefined) ?? null,
    complete:     saved.setup.complete,
  };
}

// A learner who has not finished setup still needs a profile row for the
// rest of setup to hang on. Created empty: it claims nothing.
export async function ensureSetupProfile(platformChatId: string): Promise<{ profileId: string; timezone: string | null; userId: string } | null> {
  const learner = await loadLearner(platformChatId);
  if (!learner) return null;
  const profile = learner.novaAcademicProfile
    ?? await prisma.novaAcademicProfile.upsert({ where: { userId: learner.id }, create: { userId: learner.id }, update: {}, select: { id: true, timezone: true } });
  return { profileId: profile.id, timezone: profile.timezone, userId: learner.id };
}
