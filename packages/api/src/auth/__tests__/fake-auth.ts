// An in-memory stand-in for the four tables the auth services touch, plus a
// mailer that keeps what it was asked to send. Not a test file itself.

import type { AuthDb, AuthDeps } from "../auth-deps";
import type { AuthEmail } from "../auth-email";

type Row = Record<string, any>;

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      if ("lt" in expected) return actual < expected.lt;
      if ("lte" in expected) return actual <= expected.lte;
      if ("gt" in expected) return actual > expected.gt;
      if ("gte" in expected) return actual >= expected.gte;
    }
    if (actual instanceof Date && expected instanceof Date) return actual.getTime() === expected.getTime();
    return actual === expected;
  });
}

function apply(row: Row, data: Row) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && "increment" in value) row[key] += value.increment;
    else row[key] = value;
  }
}

function uniqueViolation() {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

export interface FakeAuth {
  deps: AuthDeps;
  users: Row[];
  accounts: Row[];
  pending: Row[];
  resetTokens: Row[];
  throttles: Row[];
  consents: Row[];
  sent: AuthEmail[];
  /** What the fake database stamps on new rows. */
  clock: { now: Date };
  /** Make the mailer report a failed delivery. */
  mail: { working: boolean };
  /** The last verification code that was emailed. */
  lastCode(): string;
  /** The token in the last reset link that was emailed. */
  lastResetToken(): string;
}

export function fakeAuth(seed: { users?: Row[]; accounts?: Row[] } = {}): FakeAuth {
  const state = {
    users: (seed.users ?? []).map((user): Row => ({
      name: null,
      image: null,
      password: null,
      emailVerified: null,
      userProfile: null,
      ...user,
    })),
    accounts: [...(seed.accounts ?? [])] as Row[],
    pending: [] as Row[],
    resetTokens: [] as Row[],
    throttles: [] as Row[],
    consents: [] as Row[],
  };
  const sent: AuthEmail[] = [];
  const clock = { now: new Date("2026-10-11T10:00:00Z") };
  const mail = { working: true };
  let ids = 0;
  const nextId = (prefix: string) => `${prefix}${++ids}`;
  let queue: Promise<unknown> = Promise.resolve();

  const withAccounts = (user: Row) => ({
    ...user,
    accounts: state.accounts.filter((account) => account.userId === user.id && account.provider === "google"),
  });

  const db: AuthDb = {
    user: {
      async findUnique({ where }) {
        const user = state.users.find((row) => matches(row, where as Row));
        return user ? (withAccounts(user) as any) : null;
      },
      async create({ data }) {
        const row = data as Row;
        if (state.users.some((user) => user.email === row.email)) throw uniqueViolation();
        const user = { id: nextId("u"), name: null, image: null, password: null, emailVerified: null, userProfile: null, ...row };
        state.users.push(user);
        return { ...user } as any;
      },
      async update({ where, data }) {
        const user = state.users.find((row) => matches(row, where as Row));
        if (!user) throw new Error("User not found");
        apply(user, data as Row);
        return { ...user } as any;
      },
    },
    account: {
      async findUnique({ where }) {
        const key = (where as Row).provider_providerAccountId;
        const account = state.accounts.find((row) => matches(row, key));
        if (!account) return null;
        const user = state.users.find((row) => row.id === account.userId);
        return { ...account, user: user ? { ...user } : undefined } as any;
      },
      async create({ data }) {
        const row = data as Row;
        if (state.accounts.some((a) => a.provider === row.provider && a.providerAccountId === row.providerAccountId)) {
          throw uniqueViolation();
        }
        const account = { id: nextId("acc"), ...row };
        state.accounts.push(account);
        return account as any;
      },
    },
    pendingSignup: {
      async findUnique({ where }) {
        const row = state.pending.find((pending) => matches(pending, where as Row));
        return row ? ({ ...row } as any) : null;
      },
      async create({ data }) {
        const row: Row = { id: nextId("p"), attempts: 0, createdAt: clock.now, ...(data as Row) };
        if (state.pending.some((pending) => pending.tokenHash === row.tokenHash)) throw uniqueViolation();
        state.pending.push(row);
        return { ...row } as any;
      },
      async updateMany({ where, data }) {
        const rows = state.pending.filter((pending) => matches(pending, where as Row));
        rows.forEach((row) => apply(row, data as Row));
        return { count: rows.length };
      },
      async deleteMany({ where }) {
        const rows = state.pending.filter((pending) => matches(pending, where as Row));
        state.pending = state.pending.filter((pending) => !rows.includes(pending));
        return { count: rows.length };
      },
    },
    passwordResetToken: {
      async findUnique({ where }) {
        const row = state.resetTokens.find((token) => matches(token, where as Row));
        return row ? ({ ...row } as any) : null;
      },
      async create({ data }) {
        const row = { id: nextId("t"), used: false, createdAt: clock.now, ...(data as Row) };
        state.resetTokens.push(row);
        return { ...row } as any;
      },
      async updateMany({ where, data }) {
        const rows = state.resetTokens.filter((token) => matches(token, where as Row));
        rows.forEach((row) => apply(row, data as Row));
        return { count: rows.length };
      },
    },
    legalConsent: {
      async create({ data }) {
        const row = { id: nextId("c"), createdAt: clock.now, ...(data as Row) };
        state.consents.push(row);
        return { ...row };
      },
    },
    authThrottle: {
      async findUnique({ where }) {
        const row = state.throttles.find((throttle) => matches(throttle, where as Row));
        return row ? ({ ...row } as any) : null;
      },
      async create({ data }) {
        const row: Row = { ...(data as Row) };
        if (state.throttles.some((throttle) => throttle.key === row.key)) throw uniqueViolation();
        state.throttles.push(row);
        return { ...row } as any;
      },
      async updateMany({ where, data }) {
        const rows = state.throttles.filter((throttle) => matches(throttle, where as Row));
        rows.forEach((row) => apply(row, data as Row));
        return { count: rows.length };
      },
      async deleteMany({ where }) {
        const rows = state.throttles.filter((throttle) => matches(throttle, where as Row));
        state.throttles = state.throttles.filter((throttle) => !rows.includes(throttle));
        return { count: rows.length };
      },
    },
    // All or nothing, like the real thing: a throw restores every table.
    // Transactions run one after another, which is what the row locks of the
    // guarded writes amount to in Postgres.
    $transaction(fn) {
      const run = async () => {
        const snapshot = structuredClone({ ...state });
        try {
          return await fn(db);
        } catch (error) {
          Object.assign(state, snapshot);
          throw error;
        }
      };
      const result = queue.then(run, run);
      queue = result.catch(() => undefined);
      return result;
    },
  };

  const deps: AuthDeps = {
    db,
    // Recognisably not the password, and cheap. bcrypt itself is exercised in login.test.ts.
    hashPassword: async (password) => `hashed(${password})`,
    verifyPassword: async (password, hash) => hash === `hashed(${password})`,
    sendEmail: async (email) => {
      if (!mail.working) return false;
      sent.push(email);
      return true;
    },
    appUrl: () => "https://kivo.test",
  };

  return {
    deps,
    get users() { return state.users; },
    get accounts() { return state.accounts; },
    get pending() { return state.pending; },
    get resetTokens() { return state.resetTokens; },
    get throttles() { return state.throttles; },
    get consents() { return state.consents; },
    sent,
    clock,
    mail,
    lastCode() {
      const match = [...sent].reverse().map((email) => email.text.match(/\b(\d{8})\b/)).find(Boolean);
      if (!match) throw new Error("No code has been emailed");
      return match[1]!;
    },
    lastResetToken() {
      const match = [...sent].reverse().map((email) => email.text.match(/token=([0-9a-f]{64})/)).find(Boolean);
      if (!match) throw new Error("No reset link has been emailed");
      return match[1]!;
    },
  };
}

export function minutesAfter(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}
