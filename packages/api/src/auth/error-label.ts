// ─── Auth: what an unexpected error may put in the log ────────────────────────
// No imports. The kind of error only: its class name and, when it has one, its
// short code (Prisma's P2002, Node's ECONNRESET). Never the message, the stack
// or the object itself, which can quote a query and with it an address, a
// hash or a token. Anything that does not look like an identifier is dropped.

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export function errorLabel(error: unknown): string {
  if (typeof error !== "object" || error === null) return "unknown";
  const { name, code } = error as { name?: unknown; code?: unknown };
  const kind = typeof name === "string" && IDENTIFIER.test(name) ? name : "Error";
  return typeof code === "string" && IDENTIFIER.test(code) ? `${kind} ${code}` : kind;
}
