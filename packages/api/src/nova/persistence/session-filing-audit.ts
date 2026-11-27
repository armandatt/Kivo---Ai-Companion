// Bug batch 28 Nov, item 3: finished sessions that are not on a topic the map
// can show. Three kinds:
//   unassigned  completed, no topic (Quick Focus, a copilot focus item)
//   unmatched   a topic name that is none of the learner's topics in that subject
//   no_subject  a topic name with no subject
// A SAFE match is a session whose label (unassigned) or topic name (the other
// two) is exactly, ignoring case and spacing, the name of ONE of the learner's
// live topics. Only safe matches are ever written, and only with --apply:
// each by a conditional update on the row still being as it was read. Time,
// status and everything else stay as they are. Idempotent.

import { prisma } from "@repo/db/client";

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export interface FilingAuditRow {
  id: string; profileId: string; kind: "unassigned" | "unmatched" | "no_subject";
  label: string | null; topicName: string | null; minutes: number;
  match: { subjectId: string; topicName: string } | null;
}
export interface FilingAuditResult {
  completedSessions: number;
  unassigned: number; unmatched: number; noSubject: number;
  safeMatches: number; written: number;
  rows: FilingAuditRow[];
}

export async function auditSessionFiling(opts: { apply: boolean; profileId?: string }): Promise<FilingAuditResult> {
  const where = { status: "completed", ...(opts.profileId ? { profileId: opts.profileId } : {}) };
  const [sessions, topics] = await Promise.all([
    prisma.novaStudySession.findMany({ where, select: { id: true, profileId: true, subjectId: true, topicName: true, currentFocus: true, durationMinutes: true } }),
    prisma.novaTopicMastery.findMany({ where: { archivedAt: null, ...(opts.profileId ? { subject: { profileId: opts.profileId } } : {}) }, select: { name: true, subjectId: true, subject: { select: { profileId: true } } } }),
  ]);
  const byProfile = new Map<string, Array<{ name: string; subjectId: string }>>();
  for (const t of topics) byProfile.set(t.subject.profileId, [...(byProfile.get(t.subject.profileId) ?? []), { name: t.name, subjectId: t.subjectId }]);
  const one = (profileId: string, words: string | null, subjectId?: string | null) => {
    if (!words) return null;
    const hits = (byProfile.get(profileId) ?? []).filter(t => norm(t.name) === norm(words) && (!subjectId || t.subjectId === subjectId));
    return hits.length === 1 ? { subjectId: hits[0]!.subjectId, topicName: hits[0]!.name } : null;
  };

  const out: FilingAuditResult = { completedSessions: sessions.length, unassigned: 0, unmatched: 0, noSubject: 0, safeMatches: 0, written: 0, rows: [] };
  for (const s of sessions) {
    let kind: FilingAuditRow["kind"] | null = null;
    let match: FilingAuditRow["match"] = null;
    if (!s.topicName) { kind = "unassigned"; match = one(s.profileId, s.currentFocus); }
    else if (!s.subjectId) { kind = "no_subject"; match = one(s.profileId, s.topicName); }
    else if (!(byProfile.get(s.profileId) ?? []).some(t => t.subjectId === s.subjectId && t.name === s.topicName)) {
      kind = "unmatched"; match = one(s.profileId, s.topicName, s.subjectId) ?? one(s.profileId, s.topicName);
    }
    if (!kind) continue;
    if (kind === "unassigned") out.unassigned++; else if (kind === "unmatched") out.unmatched++; else out.noSubject++;
    if (match) out.safeMatches++;
    out.rows.push({ id: s.id, profileId: s.profileId, kind, label: s.currentFocus, topicName: s.topicName, minutes: s.durationMinutes, match });
    if (opts.apply && match) {
      const done = await prisma.novaStudySession.updateMany({
        where: { id: s.id, status: "completed", subjectId: s.subjectId, topicName: s.topicName },
        data:  { subjectId: match.subjectId, topicName: match.topicName },
      });
      out.written += done.count;
    }
  }
  return out;
}
