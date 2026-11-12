// ─── Collections of saved pages ───────────────────────────────────────────────
// The only reader and writer of NovaResourceCollection. A collection is a
// name the learner gives a group of saved pages ("System Design", "Read
// later"); a page is in at most one (learning-events.ts organizeResource puts
// it there, after ownsCollection here says the collection is theirs). Tags do
// the rest. A collection is not a subject: it plans nothing, moves no
// mastery, and is not on the Knowledge Map.
//
// Deleting one deletes no page: its pages are in no collection afterwards
// (the foreign key's SET NULL).

import { prisma } from "@repo/db/client";
import type { CollectionResponse, ResourceCollectionRef } from "./learning-events.types";

export const COLLECTION_NAME_MAX = 60;
export const COLLECTIONS_MAX = 100;

const SAVED_TYPES = ["resource_saved", "selection_saved"];

const tidy = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const t = [...raw].map(ch => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch)).join("").split(" ").filter(Boolean).join(" ");
  return t && t.length <= COLLECTION_NAME_MAX ? t : null;
};
export const collectionKey = (name: string) => name.toLowerCase();

const fail = (error: Extract<CollectionResponse, { ok: false }>["error"], message: string): CollectionResponse => ({ ok: false, error, message });

export async function listCollections(profileId: string): Promise<Array<ResourceCollectionRef & { count: number }>> {
  const rows = await prisma.novaResourceCollection.findMany({
    where: { profileId }, orderBy: { name: "asc" },
    select: { id: true, name: true, _count: { select: { resources: { where: { eventType: { in: SAVED_TYPES } } } } } },
  });
  return rows.map(r => ({ id: r.id, name: r.name, count: r._count.resources }));
}

export async function ownsCollection(profileId: string, id: string): Promise<boolean> {
  if (typeof id !== "string" || id.length > 64) return false;
  return (await prisma.novaResourceCollection.count({ where: { id, profileId } })) === 1;
}

const isUnique = (err: unknown) => (err as { code?: string } | null)?.code === "P2002";

export async function createCollection(profileId: string, raw: unknown): Promise<CollectionResponse> {
  const name = tidy((raw as { name?: unknown } | null)?.name);
  if (!name) return fail("invalid", `Give the collection a name, up to ${COLLECTION_NAME_MAX} characters.`);
  // The same name again (any case) is the collection they have: a double click makes one.
  const existing = await prisma.novaResourceCollection.findUnique({ where: { profileId_nameKey: { profileId, nameKey: collectionKey(name) } }, select: { id: true, name: true } });
  if (existing) return { ok: true, collections: await listCollections(profileId), collection: existing };
  if (await prisma.novaResourceCollection.count({ where: { profileId } }) >= COLLECTIONS_MAX) return fail("too_many", `Up to ${COLLECTIONS_MAX} collections. Use tags for finer groups.`);
  try {
    const made = await prisma.novaResourceCollection.create({ data: { profileId, name, nameKey: collectionKey(name) }, select: { id: true, name: true } });
    return { ok: true, collections: await listCollections(profileId), collection: made };
  } catch (err) {
    if (!isUnique(err)) throw err;
    const again = await prisma.novaResourceCollection.findUnique({ where: { profileId_nameKey: { profileId, nameKey: collectionKey(name) } }, select: { id: true, name: true } });
    return { ok: true, collections: await listCollections(profileId), ...(again ? { collection: again } : {}) };
  }
}

export async function renameCollection(profileId: string, id: string, raw: unknown): Promise<CollectionResponse> {
  const name = tidy((raw as { name?: unknown } | null)?.name);
  if (!name) return fail("invalid", `Give the collection a name, up to ${COLLECTION_NAME_MAX} characters.`);
  const other = await prisma.novaResourceCollection.findUnique({ where: { profileId_nameKey: { profileId, nameKey: collectionKey(name) } }, select: { id: true } });
  if (other && other.id !== id) return fail("exists", "You already have a collection with that name.");
  try {
    const done = await prisma.novaResourceCollection.updateMany({ where: { id, profileId }, data: { name, nameKey: collectionKey(name) } });
    if (done.count === 0) return fail("not_found", "That collection isn't one of yours.");
  } catch (err) {
    if (isUnique(err)) return fail("exists", "You already have a collection with that name.");
    throw err;
  }
  return { ok: true, collections: await listCollections(profileId), collection: { id, name } };
}

// The collection goes; its pages stay saved, in no collection.
export async function deleteCollection(profileId: string, id: string): Promise<CollectionResponse> {
  const done = await prisma.novaResourceCollection.deleteMany({ where: { id, profileId } });
  if (done.count === 0) return fail("not_found", "That collection isn't one of yours.");
  return { ok: true, collections: await listCollections(profileId) };
}
