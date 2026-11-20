// MCP-03 (21 Nov): notes an assistant made where the learner asked for Saved
// Pages, before Kivo Connect had save_page. READ ONLY: every query is a find;
// nothing is written, converted or deleted. scripts/reviewAccidentalPageNotes.ts
// runs it for one learner; a conversion is a separate step they approve.
//
// Evidence, strongest first: (1) Kivo Connect's own audit of create_note /
// capture_knowledge calls by a connected client (by name, e.g. ChatGPT), with
// the ids of the notes each created: only those are candidates, never a note
// the learner wrote; (2) the note is essentially a link (one to four http(s)
// addresses, little other text); (3) what happened since: edited after it was
// made, [[links]] in or out, filing, images, the page already in Saved Pages.

import { prisma } from "@repo/db/client";
import { getNote, noteStamps } from "../nova/product/notes";
import { findSavedPage } from "../nova/product/learning-events";

const URL_RE = /https?:\/\/[^\s)\]>"']+/g;

export async function reviewAccidentalPageNotes(userId: string, opts: { client?: string; since?: Date } = {}) {
  const client = (opts.client ?? "chatgpt").toLowerCase();
  const since = opts.since ?? new Date("2026-11-13T00:00:00Z");
  const m = await prisma.messengerUser.findFirst({ where: { platformChatId: `web:${userId}` }, select: { novaAcademicProfile: { select: { id: true } } } });
  const profileId = m?.novaAcademicProfile?.id;
  if (!profileId) return { found: false as const, reason: "no Nova profile" };

  const grants = await prisma.novaConnectGrant.findMany({ where: { userId }, select: { id: true, clientRowId: true, createdAt: true } });
  const clients = await prisma.novaConnectClient.findMany({ where: { id: { in: grants.map(g => g.clientRowId) } }, select: { id: true, name: true } });
  const clientName = new Map(clients.map(c => [c.id, c.name]));
  const grantClient = new Map(grants.map(g => [g.id, clientName.get(g.clientRowId) ?? "unknown"]));
  const matching = grants.filter(g => (grantClient.get(g.id) ?? "").toLowerCase().includes(client)).map(g => g.id);

  const audits = await prisma.novaConnectAudit.findMany({
    where: { userId, tool: { in: ["create_note", "capture_knowledge"] }, createdAt: { gte: since }, grantId: { in: matching } },
    orderBy: { createdAt: "asc" }, select: { id: true, tool: true, grantId: true, createdAt: true, resources: true, result: true },
  });
  type Item = { op?: string; status?: string; type?: string; id?: string; resource?: { type?: string; id?: string } };
  const created = new Map<string, { auditId: string; tool: string; client: string; at: Date }>();
  for (const a of audits) for (const src of [a.resources, a.result] as unknown[]) {
    for (const it of ((src as { items?: Item[] } | null)?.items ?? [])) {
      const type = it.type ?? it.resource?.type, id = it.id ?? it.resource?.id;
      if (type === "note" && id && (it.status === "created" || it.op === "create_note") && !created.has(id)) created.set(id, { auditId: a.id, tool: a.tool, client: grantClient.get(a.grantId ?? "") ?? "unknown", at: a.createdAt });
    }
  }

  const candidates = [];
  for (const [noteId, via] of created) {
    const n = await getNote(profileId, noteId);
    if (!n) { candidates.push({ noteId: `note:${noteId}`, via, status: "gone" as const, recommendation: "nothing to do: the note no longer exists" }); continue; }
    const urls = [...new Set(n.body.match(URL_RE) ?? [])];
    const rest = n.body.replace(URL_RE, "").replace(/[#>*_`\-\[\]()|:]/g, " ").replace(/\s+/g, " ").trim();
    if (!(urls.length > 0 && urls.length <= 4 && rest.length <= 400)) continue; // real writing: the learner's material
    const raw = await noteStamps(profileId, n.id);
    const editedAfterCreation = raw ? raw.updatedAt.getTime() - raw.createdAt.getTime() > 60_000 : false;
    const saved = await Promise.all(urls.map(u => findSavedPage(profileId, u)));
    const relationships = {
      filedUnder: n.subjectName ? `${n.subjectName}${n.topicName ? ` › ${n.topicName}` : ""}` : null,
      outgoingLinks: n.links.outgoing.map(l => l.title), backlinks: n.links.backlinks.map(l => l.title), images: raw?.images ?? 0,
    };
    const touched = editedAfterCreation || relationships.backlinks.length > 0 || relationships.outgoingLinks.length > 0 || relationships.images > 0;
    candidates.push({
      noteId: `note:${n.id}`, title: n.title, urls, otherText: rest.slice(0, 200), createdAt: raw?.createdAt ?? null, updatedAt: raw?.updatedAt ?? null,
      via, editedAfterCreation, relationships,
      alreadyInSavedPages: saved.map((p, i) => ({ url: urls[i]!, pageId: p ? `resource:${p.id}` : null })),
      recommendation: urls.length !== 1 ? "review: more than one address; decide page by page"
        : touched ? "review: edited, linked or added to since; keep the note, save the page alongside if wanted"
        : saved[0] ? "convert: the page is already in Saved Pages; the note only duplicates it (remove the note only with approval)"
        : "convert: save the page filed where the note is, then remove the note only with approval",
    });
  }
  return {
    found: true as const, mode: "read_only" as const, since: since.toISOString(), clientFilter: client,
    connections: grants.map(g => ({ grantId: g.id, client: grantClient.get(g.id) ?? "unknown", connectedAt: g.createdAt })),
    auditedNoteCreations: created.size, candidates,
  };
}
