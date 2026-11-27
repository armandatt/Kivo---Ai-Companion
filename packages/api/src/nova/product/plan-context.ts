// ─── Everything Kivo knows that should shape the learner's day (item 12) ────
// For "Propose a plan" and the plan Nova prepares at check-in: the learner as
// their own record has them, as plain fact lines for the planning model. Each
// line is read from a table they wrote to (or Nova recorded for them); none is
// inferred here. The copilot's usual context (dates, goals, the map's outline,
// open tasks, today's flow) comes on top of this.

import { prisma } from "@repo/db/client";
import { getAllTopicMasteries } from "../engines/knowledge-engine";
import { localHour, localMinute, resolveTimezone } from "../engines/learner-calendar";
import { loadAccountPreferences } from "../adapters/account-preferences-adapter";
import { loadNovaLearningDna } from "./learning-dna";
import { effectiveTopicStatus } from "./topic-status";

const DAY_MS = 86_400_000;
const TOPIC_LINES = 60;
const days = (from: Date, now: Date) => Math.max(0, Math.floor((now.getTime() - from.getTime()) / DAY_MS));
const two = (n: number) => String(n).padStart(2, "0");

export async function planContextLines(profileId: string, platformChatId: string, now = new Date()): Promise<string[]> {
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const [profile, prefs, dna, masteries, statuses, sessions, notes, pages] = await Promise.all([
    prisma.novaAcademicProfile.findUnique({ where: { id: profileId }, select: { timezone: true, dailyStudyMinutes: true, preferredStudyTime: true, user: { select: { displayName: true } } } }).catch(() => null),
    loadAccountPreferences(platformChatId).catch(() => null),
    loadNovaLearningDna(platformChatId, { now }).catch(() => null),
    getAllTopicMasteries(profileId, now).catch(() => []),
    prisma.novaTopicMastery.findMany({ where: { subject: { profileId }, archivedAt: null }, select: { id: true, status: true } }).catch(() => []),
    prisma.novaStudySession.findMany({ where: { profileId, status: "completed", sessionDate: { gte: weekAgo } }, orderBy: { sessionDate: "desc" }, take: 15, select: { sessionDate: true, durationMinutes: true, topicName: true, currentFocus: true, executionReport: true } }).catch(() => []),
    prisma.novaNote.findMany({ where: { profileId, updatedAt: { gte: weekAgo } }, orderBy: { updatedAt: "desc" }, take: 10, select: { title: true, topicName: true, updatedAt: true } }).catch(() => []),
    prisma.novaLearningEvent.findMany({ where: { profileId, eventType: "resource_saved", occurredAt: { gte: weekAgo } }, orderBy: { occurredAt: "desc" }, take: 8, select: { title: true, topicName: true } }).catch(() => [] as Array<{ title: string | null; topicName: string | null }>),
  ]);
  const lines: string[] = [];
  const zone = resolveTimezone(profile?.timezone ?? prefs?.timezone ?? null);
  const name = profile?.user?.displayName;
  lines.push(`LEARNER: ${name ? `${name}. ` : ""}Local time now ${two(localHour(now, zone))}:${two(localMinute(now, zone))}, ${now.toLocaleDateString("en-GB", { weekday: "long", timeZone: zone })}.`);
  if (profile?.dailyStudyMinutes) lines.push(`They said they usually have about ${profile.dailyStudyMinutes} minutes a day to study.`);
  if (profile?.preferredStudyTime) lines.push(`They said they usually study in the ${profile.preferredStudyTime}.`);
  if (prefs?.checkinTime) lines.push(`Their daily check-in is at ${prefs.checkinTime}.`);
  for (const c of prefs?.learningContexts ?? []) lines.push(`They are learning for: ${typeof c === "string" ? c : JSON.stringify(c)}.`);
  // How they actually study (Learning DNA), only conclusions with evidence behind them.
  if (dna && dna.status === "ready") for (const s of (dna as { signals: Array<{ headline: string | null; level: string; label: string }> }).signals) if (s.headline && s.level !== "unknown") lines.push(`How they study (${s.label}, ${s.level}): ${s.headline}.`);
  // The last week of study.
  for (const s of sessions) {
    const outcome = (s.executionReport as { outcome?: unknown } | null)?.outcome;
    lines.push(`Studied ${days(s.sessionDate, now) === 0 ? "today" : `${days(s.sessionDate, now)} day(s) ago`}: ${s.topicName ?? s.currentFocus ?? "focus time"}, ${s.durationMinutes} min${typeof outcome === "string" && outcome !== "unreported" ? `, felt ${outcome.replace("_", " ")}` : ""}.`);
  }
  if (!sessions.length) lines.push("No finished study session in the last seven days.");
  // Every topic as it stands: status, mastery estimate, review date, last studied.
  const status = new Map(statuses.map(s => [s.id, s.status]));
  const ranked = [...masteries].sort((a, b) => Number(b.reviewDueAt !== null && b.reviewDueAt <= now) - Number(a.reviewDueAt !== null && a.reviewDueAt <= now) || (b.lastStudied?.getTime() ?? 0) - (a.lastStudied?.getTime() ?? 0));
  for (const m of ranked.slice(0, TOPIC_LINES)) {
    const st = effectiveTopicStatus((status.get(m.topicId) as string | null | undefined) ?? null, m.reviewCount > 0 || m.lastStudied !== null);
    const due = m.reviewDueAt ? (m.reviewDueAt <= now ? "review due now" : `review in ${Math.ceil((m.reviewDueAt.getTime() - now.getTime()) / DAY_MS)} days`) : null;
    lines.push(`Topic ${m.topicName} (${m.subjectName}): ${st.replace("_", " ")}${m.reviewCount > 0 ? `, mastery estimate ${Math.round(m.masteryProbability * 100)}%` : ""}${due ? `, ${due}` : ""}${m.lastStudied ? `, last studied ${days(m.lastStudied, now)} day(s) ago` : ""}.`);
  }
  if (masteries.length > TOPIC_LINES) lines.push(`…and ${masteries.length - TOPIC_LINES} more topics.`);
  for (const n of notes) lines.push(`Note edited ${days(n.updatedAt, now)} day(s) ago: "${n.title}"${n.topicName ? ` (on ${n.topicName})` : ""}.`);
  for (const p of pages) if (p.title) lines.push(`Page saved this week: "${p.title}"${p.topicName ? ` (on ${p.topicName})` : ""}.`);
  return lines;
}
