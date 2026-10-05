// ─── Telegram transport safety ────────────────────────────────────────────────
import { prisma } from "@repo/db/client";
import {
  admitTelegramUpdate,
  claimTelegramUpdate,
  purgeProcessedTelegramUpdates,
  UPDATE_RETENTION_DAYS,
  verifyTelegramSecret,
} from "../telegramTransport.service";

type Row = Record<string, any>;

// Stand-in for the table's primary key: a second insert of an id fails with
// Prisma's unique-violation code, exactly as Postgres does.
function installUpdateTable() {
  const seen = new Set<bigint>();
  (prisma as Row).processedTelegramUpdate = {
    create: jest.fn(async ({ data }: Row) => {
      if (seen.has(data.updateId)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      seen.add(data.updateId);
      return data;
    }),
  };
  return seen;
}

beforeEach(() => {
  installUpdateTable();
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("secret token", () => {
  it("accepts the configured secret", () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = "s3cret-token";
    expect(verifyTelegramSecret("s3cret-token")).toBe("ok");
  });

  it("rejects a wrong, differently sized, or missing secret", () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = "s3cret-token";
    expect(verifyTelegramSecret("s3cret-tokem")).toBe("rejected");
    expect(verifyTelegramSecret("short")).toBe("rejected");
    expect(verifyTelegramSecret(null)).toBe("rejected");
  });

  it("a request with a bad secret is refused with 401 and never claims an update", async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = "s3cret-token";
    const admission = await admitTelegramUpdate({ secretHeader: "wrong", updateId: 1001 });
    expect(admission).toEqual({ admit: false, status: 401, reason: "bad_secret" });
    expect((prisma as Row).processedTelegramUpdate.create).not.toHaveBeenCalled();
  });

  it("with no secret configured, requests pass (existing webhooks keep working)", async () => {
    expect(verifyTelegramSecret(null)).toBe("not_configured");
    expect((await admitTelegramUpdate({ secretHeader: null, updateId: 1002 })).admit).toBe(true);
  });
});

describe("update_id deduplication", () => {
  it("the first delivery is claimed, a repeat is a duplicate", async () => {
    expect(await claimTelegramUpdate(5001)).toBe("claimed");
    expect(await claimTelegramUpdate(5001)).toBe("duplicate");
    expect(await claimTelegramUpdate(5002)).toBe("claimed");
  });

  it("a duplicate update is answered 200 and not admitted", async () => {
    await admitTelegramUpdate({ secretHeader: null, updateId: 7001 });
    expect(await admitTelegramUpdate({ secretHeader: null, updateId: 7001 }))
      .toEqual({ admit: false, status: 200, reason: "duplicate_update" });
  });

  it("a duplicate update does not run the pipeline twice", async () => {
    const pipeline = jest.fn(async () => "reply");

    // The webhook handler's shape: admit, then process.
    async function handleWebhook(body: { update_id: number }) {
      const admission = await admitTelegramUpdate({ secretHeader: null, updateId: body.update_id });
      if (!admission.admit) return admission.status;
      await pipeline();
      return 200;
    }

    const update = { update_id: 9001 };
    expect(await handleWebhook(update)).toBe(200);
    expect(await handleWebhook(update)).toBe(200);   // Telegram's retry
    expect(await Promise.all([handleWebhook({ update_id: 9002 }), handleWebhook({ update_id: 9002 })])).toEqual([200, 200]);

    expect(pipeline).toHaveBeenCalledTimes(2);       // once per distinct update
  });

  it("an update without a usable id is processed, not dropped", async () => {
    expect(await claimTelegramUpdate(undefined)).toBe("no_update_id");
    expect((await admitTelegramUpdate({ secretHeader: null, updateId: undefined })).admit).toBe(true);
  });

  it("if the dedup store is down the message is still processed", async () => {
    (prisma as Row).processedTelegramUpdate.create = jest.fn(async () => { throw new Error("connection refused"); });
    expect(await claimTelegramUpdate(8001)).toBe("unavailable");
    expect((await admitTelegramUpdate({ secretHeader: null, updateId: 8001 })).admit).toBe(true);
  });
});

describe("retention", () => {
  const NOW = new Date("2026-03-10T10:00:00Z");
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

  // A table with receivedAt, a primary key, and deleteMany.
  function installTable(rows: Array<{ updateId: bigint; receivedAt: Date }>) {
    (prisma as Row).processedTelegramUpdate = {
      create: async ({ data }: Row) => {
        if (rows.some(r => r.updateId === data.updateId)) throw Object.assign(new Error("dup"), { code: "P2002" });
        rows.push({ updateId: data.updateId, receivedAt: new Date() });
        return data;
      },
      deleteMany: async ({ where }: Row) => {
        const keep = rows.filter(r => !(r.receivedAt < where.receivedAt.lt));
        const count = rows.length - keep.length;
        rows.splice(0, rows.length, ...keep);
        return { count };
      },
    };
    return rows;
  }

  it("deletes only rows older than the retention window", async () => {
    const rows = installTable([
      { updateId: 1n, receivedAt: daysAgo(UPDATE_RETENTION_DAYS + 1) },
      { updateId: 2n, receivedAt: daysAgo(30) },
      { updateId: 3n, receivedAt: daysAgo(UPDATE_RETENTION_DAYS - 1) },
      { updateId: 4n, receivedAt: daysAgo(0) },
    ]);
    expect(await purgeProcessedTelegramUpdates(NOW)).toBe(2);
    expect(rows.map(r => r.updateId)).toEqual([3n, 4n]);
  });

  it("the window comfortably covers Telegram's retry period", () => {
    expect(UPDATE_RETENTION_DAYS).toBeGreaterThanOrEqual(2);
  });

  it("cleanup does not weaken dedup for anything inside the window", async () => {
    installTable([{ updateId: 500n, receivedAt: daysAgo(1) }]);
    await purgeProcessedTelegramUpdates(NOW);
    expect(await claimTelegramUpdate(500)).toBe("duplicate");   // still remembered
    expect(await claimTelegramUpdate(501)).toBe("claimed");
  });
});
