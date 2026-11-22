// ─── Image/attachment storage on the ledger (a measured gauge) ───────────────
// Storage is not consumed and refunded like credits: it is what the account
// holds now. Each measurement reads the stored bytes from the modules that
// own them (note images, Build with Nova's waiting files) and is written as
// one `gauge` entry; the balance holds the latest measurement. Ordinary text
// (notes, maps, saved pages) is not counted: it has abuse limits, not a
// storage allowance (master brief §6).
//
// Measured after an image upload (the note-images route) and by the shadow
// report for every account. Nothing is refused, deleted or hidden: over the
// allowance is recorded as `storage_allowance_exhausted` for review.

import { noteImageBytes } from "../../nova/product/note-images";
import { draftFileBytes } from "../../nova/product/builder";
import { entitlementForLearner } from "../entitlements";
import { gauge } from "./ledger";
import { accountingFault, accountingMode, targetFor } from "./targets";

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
