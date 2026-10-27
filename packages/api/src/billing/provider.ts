// ─── The payment provider, as billing sees it ─────────────────────────────────
// The few things Kivo needs from a payment provider, so the rest of billing
// does not know which one it is. Polar implements it (polar.ts). Adding a
// provider that takes UPI means a second implementation of this interface;
// plans, entitlements, trials and the meter stay as they are.

import type { PlanKey } from "./plans";
import type { ProviderSubscription } from "./subscription-sync";

export interface CheckoutRequest {
  plan:      PlanKey;
  productId: string;
  user:      { id: string; email: string; name: string | null };
  ip:        string | null;
  successUrl: string;
  returnUrl:  string;
}

// A verified webhook delivery. `subscription` is set for subscription events
// and for an order that belongs to one (a refund, say), when the provider
// gives its id.
export interface VerifiedEvent {
  id:            string;
  type:          string;
  subscription:  ProviderSubscription | null;
  subscriptionId: string | null;
}

export class InvalidSignatureError extends Error {}

export interface BillingProvider {
  name: "polar";
  createCheckout(req: CheckoutRequest): Promise<{ url: string }>;
  portalUrl(userId: string, returnUrl: string): Promise<{ url: string }>;
  fetchSubscription(id: string): Promise<ProviderSubscription>;
  // Throws InvalidSignatureError when the delivery is not the provider's.
  verifyWebhook(rawBody: string, headers: Record<string, string>): Promise<VerifiedEvent>;
}
