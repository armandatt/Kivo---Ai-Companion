// Connecting Telegram from the web app. The linking itself (tokens, expiry,
// who a chat belongs to) is proven against Postgres in nova-lifecycle.itest.ts
// and nova-telegram.itest.ts; this holds the web side to using that one
// mechanism, showing the right state, and never standing in Nova's way.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { telegramBotUrl } from "../product/telegram-connection";
import { routeAccess } from "../product/companion";

const repo = (file: string) => readFileSync(join(__dirname, "../../../../..", file), "utf8");
const hook     = repo("apps/web/components/nova/use-telegram-link.ts");
const ui       = repo("apps/web/components/nova/telegram-connect.tsx");
const settings = repo("apps/web/app/(dashboard)/settings/page.tsx");
const home     = repo("apps/web/components/nova/nova-home.tsx");
const check    = repo("apps/api/telegram/check-connection/route.ts");
const generate = repo("apps/api/telegram/generate-token/route.ts");

describe("where the bot is", () => {
  it("is a link only when the bot's name is known", () => {
    expect(telegramBotUrl("KivoNovaBot")).toBe("https://t.me/KivoNovaBot");
    expect(telegramBotUrl("@Kivo_Nova_bot")).toBe("https://t.me/Kivo_Nova_bot");
    for (const unknown of [null, undefined, "", "YourBotName", "bot", "has space", "evil.example/x", "a".repeat(40)]) {
      expect(telegramBotUrl(unknown)).toBeNull();
    }
  });
});

describe("the one way to connect", () => {
  it("the page asks the existing routes and nothing else", () => {
    expect(hook).toContain("fetch('/api/telegram/generate-token', { method: 'POST' })");
    expect(hook).toContain("fetch('/api/telegram/check-connection', { cache: 'no-store' })");
    expect((hook + ui + settings).match(/fetch\('([^']+)'/g)!.sort()).toEqual([
      "fetch('/api/nova/companion'", "fetch('/api/telegram/check-connection'", "fetch('/api/telegram/generate-token'",
    ]);
  });
  it("the link is opened, never shown or kept", () => {
    expect(ui).toContain("<a href={link.deeplink} target=\"_blank\" rel=\"noopener noreferrer\"");
    expect(ui).not.toMatch(/\{link\.deeplink\}\s*</);          // not rendered as text
    expect(hook + ui).not.toMatch(/data\.token|\.token\b|localStorage|clipboard/);
    expect(hook + ui).not.toMatch(/Storage\.setItem\([^)]*deeplink/);
  });
  it("the server still decides who is linking: the session, with a 15-minute token", () => {
    expect(generate).toContain("const session = await getSession()");
    expect(generate).toContain("15 * 60_000");
    expect(generate).not.toMatch(/req\.|body|searchParams/);
    expect(check).toContain("where: { userId: session.userId }");
    expect(check).not.toMatch(/req\.|body|searchParams|telegramConnectToken|telegramChatId/);
  });
  it("the bot's link is given only once there is a chat to open", () => {
    expect(check).toContain("const botUrl    = connected ? telegramBotUrl(await getTelegramBotName()) : null");
  });
});

describe("what the learner sees", () => {
  it("disconnected: the Telegram section with its description and Connect Telegram", () => {
    expect(ui).toContain(">Telegram</h2>");
    expect(ui).toContain("Take {companion} with you. Talk to your {mentor}, start sessions, check what to study, and get useful nudges from Telegram.");
    expect(ui).toContain("Connect Telegram");
    expect(settings).toContain("<TelegramSettings companion={companion} />");
  });
  it("connected: the connected state and Open Telegram, with no Connect button", () => {
    const connected = ui.slice(ui.indexOf("link.connection.connected ? ("), ui.indexOf(") : (", ui.indexOf("link.connection.connected ? (")));
    expect(connected).toContain("Telegram connected");
    expect(connected).toContain("{companion} is ready on Telegram.");
    expect(connected).toContain("Open Telegram");
    expect(connected).not.toContain("Connect Telegram");
  });
  it("there is no Disconnect, because nothing unlinks a chat safely yet", () => {
    expect(ui + settings).not.toMatch(/Disconnect|unlink/i);
    expect(repo("packages/api/src/nova/telegram/telegram-link.ts")).not.toMatch(/export (async )?function unlink/);
  });
  it("while the answer is not known, neither state is claimed", () => {
    expect(ui).toContain("link.connection === null ? (");
    expect(hook).toContain("useState<TelegramConnection | null>(null)");
  });
});

describe("the Home card", () => {
  it("appears only when the server has said there is no chat", () => {
    expect(ui).toContain("if (dismissed || link.connection === null || link.connection.connected) return null");
    expect(ui).toContain("Take Nova with you");
    expect(ui).toContain("Your mentor is also available on Telegram.");
  });
  it("can be closed, and closing it saves nothing to the account", () => {
    expect(ui).toContain("aria-label=\"Dismiss\"");
    expect(ui).toContain("window.sessionStorage.setItem(DISMISSED, '1')");
    expect(ui.match(/fetch\(/g)).toBeNull();
  });
  it("sits below the plan and replaces nothing on the page", () => {
    expect(home.indexOf("<TelegramCard")).toBeGreaterThan(home.indexOf("<RecommendationCard"));
    expect(home).not.toMatch(/connection|telegramConnected/);
  });
});

describe("Telegram stays optional", () => {
  it("no Nova page is gated on it", () => {
    const page = repo("apps/web/app/(dashboard)/home/page.tsx");
    expect(page).not.toMatch(/useTelegramLink|check-connection|telegramConnected/);
    for (const path of ["/home", "/planner", "/focus", "/knowledge", "/notes", "/progress", "/learning-dna", "/settings"]) {
      expect(routeAccess("nova", path)).toBe("render");
    }
    expect(routeAccess("rex", "/settings")).toBe("render");
  });
  it("a failed connection check is not treated as a disconnection or an error page", () => {
    expect(hook).toContain("if (!res.ok) return");
  });
});
