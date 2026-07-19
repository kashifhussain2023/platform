import type { Plan, SubscriptionStatus } from '@vaep/types';
import type { Subscription } from '@prisma/client';

/**
 * Swappable billing backend (mirrors the auth AuthProvider / embeddings
 * EmbeddingProvider pattern). The active implementation is chosen by the
 * `BILLING_PROVIDER` env var and provided as a singleton under the
 * BILLING_PROVIDER_TOKEN DI token. The default MockBillingProvider makes NO
 * external calls (offline-first); StripeBillingProvider is opt-in.
 */
export interface BillingProvider {
  /** Provider identifier persisted on the subscription row ("mock" | "stripe"). */
  readonly name: string;

  /**
   * Ensure a billing customer exists for the company, returning its external id
   * (or null when the provider has no external concept). Called when a default
   * subscription is first created.
   */
  ensureCustomer(company: BillingCompany): Promise<EnsureCustomerResult>;

  /**
   * Apply a plan change to a subscription. Mock switches immediately; Stripe
   * creates a hosted Checkout Session for the target plan's price and returns its
   * `checkoutUrl` WITHOUT changing the local plan (the webhook confirms it).
   */
  changePlan(
    subscription: Subscription,
    plan: Plan,
  ): Promise<ChangePlanResult>;

  /**
   * Verify + parse a provider webhook into a normalized event, or null for an
   * event we ignore. OPTIONAL — providers without webhooks (mock) omit it, and
   * the route then answers 400. Implementations MUST throw on an unverifiable
   * signature so the route returns 400.
   */
  parseWebhookEvent?(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<BillingWebhookEvent | null>;

  /**
   * A hosted page where the company can manage payment methods, see past
   * invoices, and cancel — none of which this app builds its own UI for
   * (founder-market-readiness-audit.md §8). OPTIONAL — a provider with no
   * such concept (mock) omits it; BillingService then returns url: null and
   * the frontend explains billing management isn't available in mock mode.
   */
  createPortalSession?(
    externalCustomerId: string,
  ): Promise<{ url: string } | null>;
}

/** Minimal company shape a provider needs to create/lookup a customer. */
export interface BillingCompany {
  id: string;
  name?: string;
}

export interface EnsureCustomerResult {
  externalCustomerId: string | null;
}

/** Fields a provider resolves for a plan change; folded into the DB row. */
export interface ChangePlanResult {
  plan: Plan;
  status: SubscriptionStatus;
  externalCustomerId?: string | null;
  externalSubscriptionId?: string | null;
  currentPeriodEnd?: Date | null;
  /** Hosted checkout URL (Stripe only; surfaced in the DTO). */
  checkoutUrl?: string | null;
}

/**
 * Normalized subscription-affecting webhook event. A provider's parseWebhookEvent
 * verifies the raw request and maps it to this shape; BillingService then applies
 * it to the local Subscription (resolving the tenant by companyId, else by the
 * stored external customer/subscription id).
 */
export interface BillingWebhookEvent {
  /** Raw provider event type (e.g. checkout.session.completed) — for logging. */
  type: string;
  companyId?: string | null;
  externalCustomerId?: string | null;
  externalSubscriptionId?: string | null;
  plan?: Plan | null;
  status?: SubscriptionStatus | null;
  currentPeriodEnd?: Date | null;
}

/** DI token for the active BillingProvider implementation. */
export const BILLING_PROVIDER_TOKEN = Symbol('BILLING_PROVIDER');
