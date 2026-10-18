// ─── Billing: what the API routes call ────────────────────────────────────────
// Trials, the account's billing view, checkout, the billing portal and the
// provider's webhooks. The account is always the signed-in user, passed in by
// the route from the session; no id from a request body is ever used to
// decide whose plan something is. Pro is granted only by a verified provider
// event (or Kivo's own trial), never by a visit to a success page.

import { prisma } from "@repo/db/client";
import { PLANS, PAID_PLANS, type PlanKey } from "./plans";
import { appUrl, planForProduct, providerConfig, purchasable, trialDays, type ProviderConfig } from "./config";
import { entitlementForUser } from "./entitlements";
import { usageToday } from "./usage";
import { decideSync, type ProviderSubscription } from "./subscription-sync";
import { InvalidSignatureError, type BillingProvider } from "./provider";
import { polarProvider } from "./polar";

const DAY = 86_400_000;
const isUniqueViolation = (err: unknown) => (err as { code?: string } | null)?.code === "P2002";

export type BillingError =
  | "not_configured" | "invalid_plan" | "plan_unavailable" | "already_subscribed"
  | "no_subscription" | "not_eligible" | "provider_failed";

export type Result<T> = { ok: true } & T | { ok: false; error: BillingError; message: string };

const fail = (error: BillingError, message: string) => ({ ok: false as const, error, message });

// The provider, when it is configured. Tests pass their own.
export function defaultProvider(): { provider: BillingProvider; config: ProviderConfig } | null {
  const cfg = providerConfig();
  return cfg.ok ? { provider: polarProvider(cfg.config), config: cfg.config } : null;
}

// ── The account's billing, for its settings page ──
export async function billingView(userId: string, now = new Date(), env = process.env) {
  const [ent, sub, trial] = await Promise.all([
    entitlementForUser(userId, now),
    prisma.billingSubscription.findUnique({ where: { userId } }),
    prisma.billingTrial.findUnique({ where: { userId } }),
  ]);
  const usage = await usageToday(ent.usageKey, now);
  const cfg = providerConfig(env);
  return {
    plan:    ent.plan,
    source:  ent.source,
    planKey: ent.planKey,
    until:   ent.until?.toISOString() ?? null,
    subscription: sub ? {
      planKey:           sub.planKey,
      status:            sub.status,
      currentPeriodEnd:  sub.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      canceledAt:        sub.canceledAt?.toISOString() ?? null,
    } : null,
    trial: trial ? { startedAt: trial.startedAt.toISOString(), endsAt: trial.endsAt.toISOString(), active: now < trial.endsAt } : null,
    trialEligible: ent.trialEligible,
    trialDays: trialDays(env),
    usage: { today: usage.requests, limit: ent.allowance.dailyRequests },
    // Plans that can be bought now. With no provider configured, none.
    purchasable: cfg.ok ? PAID_PLANS.filter(p => purchasable(p, cfg.config, env)) : [],
    providerReady: cfg.ok,
  };
}

// ── Kivo's free trial ──
// Once per account. Two requests at once make one trial: the second meets
// the first's row (the account id is the key) and gets it back.
export async function startTrial(userId: string, now = new Date(), env = process.env): Promise<Result<{ endsAt: string; created: boolean }>> {
  const days = trialDays(env);
  if (days === 0) return fail("not_eligible", "There is no free trial right now.");
  const [trial, sub] = await Promise.all([
    prisma.billingTrial.findUnique({ where: { userId } }),
    prisma.billingSubscription.findUnique({ where: { userId }, select: { id: true } }),
  ]);
  if (trial) return { ok: true, endsAt: trial.endsAt.toISOString(), created: false };
  if (sub) return fail("not_eligible", "The free trial is for new accounts. You can upgrade to Pro instead.");
  try {
    const made = await prisma.billingTrial.create({
      data: { userId, planKey: "pro_monthly", startedAt: now, endsAt: new Date(now.getTime() + days * DAY) },
    });
    return { ok: true, endsAt: made.endsAt.toISOString(), created: true };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const existing = await prisma.billingTrial.findUniqueOrThrow({ where: { userId } });
    return { ok: true, endsAt: existing.endsAt.toISOString(), created: false };
  }
}

// ── Checkout ──
// Only Kivo's own plans, by key: the product id comes from the server's
// config, never from the browser, and so does the price.
export async function startCheckout(input: {
  userId: string; plan: unknown; ip: string | null; now?: Date
  provider?: { provider: BillingProvider; config: ProviderConfig } | null
}): Promise<Result<{ url: string }>> {
  if (typeof input.plan !== "string" || !PAID_PLANS.includes(input.plan as PlanKey)) return fail("invalid_plan", "That isn't one of Kivo's plans.");
  const plan = input.plan as PlanKey;
  const p = input.provider === undefined ? defaultProvider() : input.provider;
  if (!p) return fail("not_configured", "Payments aren't set up yet. Please try again later.");
  if (!purchasable(plan, p.config)) return fail("plan_unavailable", `${PLANS[plan].name} can't be bought yet.`);

  const ent = await entitlementForUser(input.userId, input.now);
  if (ent.source === "subscription" || ent.source === "grace") {
    return fail("already_subscribed", "You already have Pro. Manage it from your billing page.");
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: input.userId }, select: { id: true, email: true, name: true } });
  const base = p.config.appUrl || appUrl();
  try {
    const { url } = await p.provider.createCheckout({
      plan, productId: p.config.products[plan]!, user, ip: input.ip,
      successUrl: `${base}/settings/billing?checkout=success`,
      returnUrl:  `${base}/settings/billing`,
    });
    return { ok: true, url };
  } catch (err) {
    console.error(`[billing] checkout failed: ${(err as Error).name}`);
    return fail("provider_failed", "Couldn't open checkout. Please try again in a minute.");
  }
}

// ── The provider's billing portal: cancel, change card, invoices ──
export async function openPortal(input: { userId: string; provider?: { provider: BillingProvider; config: ProviderConfig } | null }): Promise<Result<{ url: string }>> {
  const p = input.provider === undefined ? defaultProvider() : input.provider;
  if (!p) return fail("not_configured", "Payments aren't set up yet.");
  const sub = await prisma.billingSubscription.findUnique({ where: { userId: input.userId }, select: { id: true } });
  if (!sub) return fail("no_subscription", "There is no subscription to manage yet.");
  try {
    const { url } = await p.provider.portalUrl(input.userId, `${p.config.appUrl || appUrl()}/settings/billing`);
    return { ok: true, url };
  } catch (err) {
    console.error(`[billing] portal failed: ${(err as Error).name}`);
    return fail("provider_failed", "Couldn't open the billing portal. Please try again in a minute.");
  }
}

// ── Webhooks ──
// Verified against the raw body, recorded by the provider's event id, and
// applied once. A repeat of a processed event is acknowledged and skipped; a
// failed one is tried again on the provider's retry. Subscription changes for
// one account are applied one at a time under a row lock, and the provider's
// modified time keeps a late delivery from undoing a newer state.
export async function handleWebhook(input: {
  rawBody: string; headers: Record<string, string>; now?: Date
  provider?: { provider: BillingProvider; config: ProviderConfig } | null
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const now = input.now ?? new Date();
  const p = input.provider === undefined ? defaultProvider() : input.provider;
  if (!p) return { status: 503, body: { error: "not_configured" } };

  let event;
  try {
    event = await p.provider.verifyWebhook(input.rawBody, input.headers);
  } catch (err) {
    if (err instanceof InvalidSignatureError) return { status: 403, body: { error: "invalid_signature" } };
    console.error(`[billing] webhook could not be read: ${(err as Error).name}`);
    return { status: 400, body: { error: "unreadable" } };
  }
  if (!event.id) return { status: 400, body: { error: "missing_event_id" } };

  // Record the delivery; a repeat of one already done is a no-op.
  const seen = await prisma.billingWebhookEvent.findUnique({ where: { id: event.id } });
  if (seen && (seen.status === "processed" || seen.status === "ignored")) return { status: 200, body: { duplicate: true } };
  if (!seen) {
    try {
      await prisma.billingWebhookEvent.create({ data: { id: event.id, provider: p.provider.name, type: event.type, status: "received" } });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // The same delivery is being handled right now: let the provider retry.
      return { status: 409, body: { error: "in_progress" } };
    }
  } else {
    await prisma.billingWebhookEvent.update({ where: { id: event.id }, data: { attempts: { increment: 1 }, status: "received", error: null } });
  }

  try {
    let subscription: ProviderSubscription | null = event.subscription;
    let type = event.type;
    // An order or refund about a subscription: read the subscription itself,
    // the provider's current record, rather than inferring it.
    if (!subscription && event.subscriptionId && (type.startsWith("order.") || type.startsWith("refund."))) {
      subscription = await p.provider.fetchSubscription(event.subscriptionId);
      type = subscription.status === "canceled" && subscription.ended_at ? "subscription.revoked" : "subscription.updated";
    }
    const outcome = subscription ? await applySubscription(subscription, type, p.config, now) : "ignored";
    await prisma.billingWebhookEvent.update({ where: { id: event.id }, data: { status: outcome === "applied" ? "processed" : "ignored", processedAt: new Date() } });
    return { status: 200, body: { ok: true, outcome } };
  } catch (err) {
    const label = (err as Error).name || "Error";
    await prisma.billingWebhookEvent.update({ where: { id: event.id }, data: { status: "failed", error: label } }).catch(() => undefined);
    console.error(`[billing] webhook ${event.type} failed: ${label}`);
    return { status: 500, body: { error: "failed" } };
  }
}

async function applySubscription(incoming: ProviderSubscription, eventType: string, config: ProviderConfig, now: Date): Promise<"applied" | "ignored"> {
  const planKey = planForProduct(incoming.product_id, config);
  const attempt = () => prisma.$transaction(async tx => {
    // Serialise changes to this account's row.
    const userId = incoming.customer?.external_id ?? (typeof incoming.metadata?.kivo_user_id === "string" ? incoming.metadata.kivo_user_id : null);
    if (userId) await tx.$queryRaw`SELECT 1 FROM "BillingSubscription" WHERE "userId" = ${userId} FOR UPDATE`;
    const stored = userId
      ? await tx.billingSubscription.findUnique({ where: { userId }, select: { providerSubscriptionId: true, providerModifiedAt: true, status: true } })
      : null;
    const decision = decideSync({ incoming, eventType, planKey, stored, now });
    if (decision.action === "ignore") return "ignored" as const;
    // The account must exist: an event for an unknown account grants nothing.
    const user = await tx.user.findUnique({ where: { id: decision.data.userId }, select: { id: true } });
    if (!user) return "ignored" as const;
    const { userId: uid, ...data } = decision.data;
    await tx.billingSubscription.upsert({ where: { userId: uid }, create: { userId: uid, ...data }, update: data });
    return "applied" as const;
  });
  try {
    return await attempt();
  } catch (err) {
    // Two first events for one account: both tried to create the row.
    if (isUniqueViolation(err)) return await attempt();
    throw err;
  }
}
