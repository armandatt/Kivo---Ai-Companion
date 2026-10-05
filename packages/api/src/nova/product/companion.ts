// ─── Which companion an account uses, and which pages it may see ──────────────
// Pure, no imports: the API (resolve-learner.ts) and the web app's dashboard
// layout both use it, so they cannot disagree about who is a Nova learner.

export type Companion = "nova" | "rex";

// The Telegram webhook routes on MessengerUser.persona, so a linked chat is
// the authority. Without one, the only signal is the persona chosen on the
// web, and an account that has not chosen another companion is Nova's.
export function companionOf(account: {
  primaryPersona:   string | null | undefined;
  hasLinkedChat:    boolean;
  // The linked chat's MessengerUser.persona. undefined: the chat has no row yet.
  messengerPersona: string | null | undefined;
}): Companion {
  if (!account.hasLinkedChat) {
    return account.primaryPersona && account.primaryPersona !== "nova" ? "rex" : "nova";
  }
  if (account.messengerPersona === undefined) return "nova";
  return account.messengerPersona === "nova" ? "nova" : "rex";
}

// ── Dashboard routes ──────────────────────────────────────────────────────────
// Nova's pages are listed; every other dashboard page is Rex's. A page added
// later is therefore closed to Nova learners until it is listed here, which
// is the safe default: Rex's fitness content never reaches a Nova learner by
// omission.

export const NOVA_ROUTES: ReadonlyArray<{ path: string; label: string }> = [
  { path: "/home",    label: "Today" },
  { path: "/planner", label: "Planner" },
  { path: "/focus",   label: "Focus" },
  { path: "/knowledge", label: "Knowledge" },
  { path: "/notes",   label: "Notes" },
  { path: "/progress", label: "Progress" },
];

// Shared account pages, the same for both companions.
const SHARED_ROUTES = ["/settings"];

// Pages that exist only for Nova.
const NOVA_ONLY_ROUTES = ["/focus", "/knowledge", "/notes"];

const under = (pathname: string, route: string) => pathname === route || pathname.startsWith(`${route}/`);

export type RouteAccess =
  | "render"            // this companion's page: show it
  | "nova_unavailable"  // a Rex page, opened by a Nova learner: Nova has no version yet
  | "not_for_rex";      // a Nova-only page, opened by a Rex account

export function routeAccess(companion: Companion, pathname: string): RouteAccess {
  if (SHARED_ROUTES.some(r => under(pathname, r))) return "render";
  if (companion === "nova") {
    return NOVA_ROUTES.some(r => under(pathname, r.path)) ? "render" : "nova_unavailable";
  }
  return NOVA_ONLY_ROUTES.some(r => under(pathname, r)) ? "not_for_rex" : "render";
}
