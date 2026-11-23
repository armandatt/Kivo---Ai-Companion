// ─── Image/attachment storage on the ledger (a measured gauge) ───────────────
// Storage is not consumed and refunded like credits: it is what the account
// holds now. Each measurement reads the stored bytes from the modules that
// own them (note images, Build with Nova's waiting files) and is written as
// one `gauge` entry; the balance holds the latest measurement. Ordinary text
// (notes, maps, saved pages) is not counted: it has abuse limits, not a
// storage allowance (master brief §6).
//
// What counts: the bytes of note images (stored in Postgres, NovaNoteImage)
// and of files waiting in Build with Nova conversations (deleted when the
// draft is built or cancelled). Not counted: note text, maps, tasks, saved
// pages' metadata, or anything else ordinary.
//
// An upload is admitted before it is stored (admitStorage): its bytes are
// reserved against the measured total plus every other upload in flight, by
// one guarded write, so concurrent uploads cannot pass the allowance
// together; then the reservation is released and the total measured again.
// Enforcing (USAGE_ACCOUNTING=enforce, storage_bytes), an upload that would
// pass the allowance is refused. Nothing stored is ever refused, deleted or
// hidden: over the allowance (after a downgrade, say), everything stays
// readable and exportable, and only new uploads wait.

import { noteImageBytes } from "../../nova/product/note-images";
import { draftFileBytes } from "../../nova/product/builder";
import { entitlementForLearner } from "../entitlements";
import { randomUUID } from "crypto";
import { gauge, refund, reserve } from "./ledger";
import type { Tier } from "./rules";
import { accountingFault, accountingMode, enforcing, targetFor } from "./targets";

export async function measureStorage(input: { platformChatId: string; profileId: string; now?: Date }): Promise<{ bytes: number; over: boolean } | null> {
  if (accountingMode() === "off") return null;
  try {
    const now = input.now ?? new Date();
    const [images, files] = await Promise.all([noteImageBytes(input.profileId), draftFileBytes(input.profileId)]);
    const bytes = images + files;
    const ent = await entitlementForLearner(input.platformChatId, now);
    const t = await targetFor(ent.usageKey, "storage_bytes", now);
    const { over } = await gauge(t, { units: bytes, key: `measure:${input.profileId}:${now.getTime()}`, detail: `images=${images};draft_files=${files}` });
    return { bytes, over };
  } catch (err) {
    accountingFault("storage.measure", err);
    return null;
  }
}

export interface StorageRefusal { code: "storage_allowance_exhausted"; tier: Tier; usedBytes: number; limitBytes: number }
export interface StorageAdmission { refused: StorageRefusal | null; release: () => Promise<void> }

export async function admitStorage(input: { platformChatId: string; profileId: string; bytes: number; now?: Date }): Promise<StorageAdmission> {
  const done = async () => { await measureStorage(input).then(() => undefined); };
  if (accountingMode() === "off") return { refused: null, release: async () => undefined };
  try {
    const now = input.now ?? new Date();
    const measured = await measureStorage({ ...input, now });
    const ent = await entitlementForLearner(input.platformChatId, now);
    const t = await targetFor(ent.usageKey, "storage_bytes", now);
    const enforce = enforcing("storage_bytes");
    const r = await reserve(t, { units: Math.max(0, Math.round(input.bytes)), idempotencyKey: `upload:${randomUUID()}`, feature: "upload", reason: "upload", mode: enforce ? "enforce" : "shadow", ttlMs: 10 * 60_000, now });
    if (!r.ok) return { refused: { code: "storage_allowance_exhausted", tier: t.tier, usedBytes: measured?.bytes ?? r.used, limitBytes: r.limit }, release: async () => undefined };
    return {
      refused: null,
      release: async () => {
        try { await refund(r.reservationId, { reason: "upload_finished" }); } catch (err) { accountingFault("storage.release", err); }
        await done();
      },
    };
  } catch (err) {
    accountingFault("storage.admit", err);
    return { refused: null, release: done };
  }
}

// Bytes a request will store, from its base64 payloads (3 bytes per 4
// characters); an image given by address counts at the largest an image may
// be, since its size is known only once fetched.
export function incomingBytes(images: unknown, perUrlBytes: number): number {
  if (!Array.isArray(images)) return 0;
  let total = 0;
  for (const img of images) {
    const o = img as { data?: unknown; url?: unknown } | string | null;
    if (typeof o === "string") total += Math.floor(o.length * 3 / 4);
    else if (o && typeof o.data === "string") total += Math.floor(o.data.length * 3 / 4);
    else if (o && typeof o.url === "string") total += perUrlBytes;
  }
  return total;
}
