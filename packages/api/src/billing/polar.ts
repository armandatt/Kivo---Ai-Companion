// ─── Polar ────────────────────────────────────────────────────────────────────
// Kivo's BillingProvider on Polar's official SDK (@polar-sh/sdk, API version
// 2026-10). The account is Polar's "external customer": Kivo's user id, set at
// checkout, so every subscription and portal session is found by it and no
// email is trusted to say who someone is. Webhooks are verified by the SDK
// against the raw body (Standard Webhooks: webhook-id, -timestamp,
// -signature), which also rejects replays outside its time tolerance.

import { createPolar, webhooks } from "@polar-sh/sdk/2026-10";
import type { ProviderConfig } from "./config";
import { InvalidSignatureError, type BillingProvider, type CheckoutRequest, type VerifiedEvent } from "./provider";
import type { ProviderSubscription } from "./subscription-sync";

type PolarClient = ReturnType<typeof createPolar>;

export function polarProvider(config: ProviderConfig, client: PolarClient = createPolar({ accessToken: config.accessToken, environment: config.server })): BillingProvider {
  return {
    name: "polar",

    async createCheckout(req: CheckoutRequest) {
      const checkout = await client.checkouts.create({
        products:             [req.productId],
        external_customer_id: req.user.id,
        customer_email:       req.user.email,
        customer_name:        req.user.name,
        customer_ip_address:  req.ip,
        success_url:          req.successUrl,
        return_url:           req.returnUrl,
        // Kivo runs its own no-card trial; the provider's trial is off.
        allow_trial:          false,
        metadata:             { kivo_user_id: req.user.id, kivo_plan: req.plan },
      });
      return { url: checkout.url };
    },

    async portalUrl(userId: string, returnUrl: string) {
      const session = await client.customerSessions.create({ external_customer_id: userId, return_url: returnUrl });
      return { url: session.customer_portal_url };
    },

    async fetchSubscription(id: string) {
      return await client.subscriptions.get(id) as unknown as ProviderSubscription;
    },

    async verifyWebhook(rawBody: string, headers: Record<string, string>): Promise<VerifiedEvent> {
      let payload: { type: string; data?: unknown };
      try {
        payload = await webhooks.validateEvent(rawBody, headers, config.webhookSecret) as unknown as { type: string; data?: unknown };
      } catch (err) {
        if (err instanceof webhooks.PolarWebhookVerificationError) throw new InvalidSignatureError("invalid webhook signature");
        // An event type this SDK version does not know: verified, but nothing to do.
        if (err instanceof webhooks.PolarWebhookUnknownTypeError) return { id: headers["webhook-id"] ?? "", type: "unknown", subscription: null, subscriptionId: null };
        throw err;
      }
      const data = (payload.data ?? null) as Record<string, unknown> | null;
      const isSubscription = payload.type.startsWith("subscription.");
      return {
        id:             headers["webhook-id"] ?? "",
        type:           payload.type,
        subscription:   isSubscription ? data as unknown as ProviderSubscription : null,
        subscriptionId: isSubscription ? (data?.id as string | undefined) ?? null : (data?.subscription_id as string | null | undefined) ?? null,
      };
    },
  };
}
