// ─── Every API route, by what it costs ───────────────────────────────────────
// apps/api/proxy.ts classifies each request with `classify` and checks it
// against the baseline policy of its category before the route runs. The
// routes with a real cost (a model call, an upload, a .kivo file, an MCP
// tool) also check their own feature policy inside the route (rateGate), with
// the account behind the request.
//
// Order matters: the first match wins, so specific entries come before the
// area entries at the end. `endpoints.test.ts` lists every route file in
// apps/api/app and fails if one is unclassified, or if a route that calls a
// model, takes an upload or runs MCP tools is classified as an ordinary read
// or write.

import type { Category } from "./policies";

type Methods = "*" | readonly string[];
interface Route { pattern: RegExp; category: Category | "crud"; methods?: Methods; note: string }

const ID = "[^/]+";
const r = (path: string) => new RegExp(`^${path}/?$`);

export const ROUTES: readonly Route[] = [
  // Never limited: health checks, discovery, signed webhooks, the cron entry.
  { pattern: r("/api/health(?:/scheduler)?"), category: "exempt", note: "Render's health check" },
  { pattern: /^\/\.well-known\//, category: "exempt", note: "OAuth discovery documents (static)" },
  { pattern: r("/api/billing/webhook"), category: "exempt", note: "Polar's signed webhook: refusing it loses payment events" },
  { pattern: r("/api/checkin"), category: "exempt", note: "Manual scheduler tick, behind CRON_SECRET" },

  { pattern: r("/api/telegram"), category: "webhook", note: "Telegram's webhook; per-chat limits live in the channel store" },

  // Signing in, and credentials made from nothing.
  { pattern: r("/api/(?:login|logout|signup|signup/verify|signup/resend|forgot-password|reset-password)"), category: "auth", note: "Auth (the web app's auth proxy)" },
  { pattern: r("/api/auth/google(?:/callback)?"), category: "auth", note: "Google sign-in" },
  { pattern: r("/api/settings/password-reset"), category: "auth", note: "Sends a reset email" },
  { pattern: r("/api/nova/extension/connect"), category: "auth", note: "Pairing code → extension credential" },
  { pattern: r("/api/oauth/(?:register|token|revoke)"), category: "oauth", note: "Kivo Connect OAuth" },

  { pattern: r("/api/mcp"), category: "mcp", note: "Kivo Connect MCP endpoint" },

  // Browser agent.
  { pattern: r("/api/nova/extension/agent/(?:start|step|workspace)"), category: "agent", note: "Browser agent" },

  // Model calls.
  { pattern: r("/api/nova/message"), category: "ai", note: "A Nova turn" },
  { pattern: r(`/api/nova/notes/${ID}/(?:assist|tutor|edit)`), category: "ai", note: "Notes tutor, editor, assist" },
  { pattern: r("/api/nova/notes/(?:propose|import|papers|papers/preview)"), category: "ai", note: "Draft with Nova, transcription, papers" },
  { pattern: r("/api/nova/(?:subjects|workspaces)/propose"), category: "ai", note: "Study and workspace proposals" },
  { pattern: r("/api/nova/day/copilot"), category: "ai", note: "Today's Nova" },
  { pattern: r("/api/nova/builder"), category: "ai", methods: ["POST"], note: "Build with Nova: a new plan" },
  { pattern: r(`/api/nova/builder/${ID}/(?:messages|retry)`), category: "ai", note: "Build with Nova turns" },
  { pattern: r("/api/nova/extension/(?:ask|intent|captures/place)"), category: "ai", note: "Ask Nova, side-panel intent, filing" },
  { pattern: r(`/api/nova/drafts/${ID}/place`), category: "ai", note: "Filing a draft passage" },
  { pattern: r(`/api/nova/learning-events/${ID}/process`), category: "ai", note: "Re-reading a saved page" },
  { pattern: r("/api/nova/session"), category: "ai", methods: ["POST"], note: "Session commands; ending one runs the session's reading" },
  { pattern: r("/api/coach"), category: "ai", note: "Rex coach (legacy)" },
  { pattern: r("/api/nova/notes/source-frame"), category: "ai", note: "Fetches another site's headers" },

  // Files.
  { pattern: r("/api/nova/notes/images"), category: "upload", methods: ["POST"], note: "Image into a note" },
  { pattern: r("/api/nova/portable/import(?:/preview)?"), category: "import", methods: ["POST"], note: ".kivo upload and import" },
  { pattern: r(`/api/nova/portable/import/${ID}`), category: "import", note: "Resume an import" },
  { pattern: r("/api/nova/portable/export"), category: "export", note: ".kivo export" },
  { pattern: r("/api/nova/portable/notes/import"), category: "import", methods: ["POST"], note: "A .kivo note or a PDF: preview and import" },
  { pattern: r("/api/nova/portable/notes/export"), category: "export", note: "One note as .kivo or PDF" },

  { pattern: /^\/api\/billing(?:\/(?:checkout|portal|trial))?\/?$/, category: "billing", note: "Plan, checkout, portal" },

  // Everything else: reads and ordinary writes, by method.
  { pattern: /^\/api\/nova\//, category: "crud", note: "Nova's pages: reads and small writes" },
  { pattern: /^\/api\/connect\//, category: "crud", note: "Settings › AI assistants and consent" },
  { pattern: r("/api/(?:creature|creature/evolution|creature-rename|dashboard|delete-account|focus|goals|home|insights|insights/weekly-reviews|journey|me|memory|nav|onboarding|personality|planner|progress|settings|settings/notifications|usage)"), category: "crud", note: "Account and legacy pages" },
  { pattern: r("/api/telegram/(?:check-connection|generate-token)"), category: "crud", note: "Telegram linking from the web" },
];

export interface Classified { category: Category; explicit: boolean; note: string }

const READS = new Set(["GET", "HEAD", "OPTIONS"]);

export function classify(method: string, pathname: string): Classified {
  const m = method.toUpperCase();
  for (const route of ROUTES) {
    if (!route.pattern.test(pathname)) continue;
    if (route.methods && route.methods !== "*" && !route.methods.includes(m)) continue;
    const category = route.category === "crud" ? (READS.has(m) ? "read" : "write") : route.category;
    return { category, explicit: true, note: route.note };
  }
  // Not a route Kivo has (it will 404), or one added without an entry here.
  return { category: READS.has(m) ? "read" : "write", explicit: false, note: "unclassified" };
}

/**
 * The baseline policy for a request: its category's, except that a request
 * with no session or credential outside sign-in is counted per address.
 */
export function baselinePolicy(category: Category, authenticated: boolean): string | null {
  switch (category) {
    case "exempt": return null;
    case "auth": return "base.auth";
    case "oauth": return "base.oauth";
    case "webhook": return "base.webhook";
    case "mcp": return "base.mcp";
    default:
      if (!authenticated) return "base.anonymous";
      return `base.${category}`;
  }
}
