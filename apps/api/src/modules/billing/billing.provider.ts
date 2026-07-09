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
   * creates/updates the remote subscription (best-effort) and MAY return a
   * hosted `checkoutUrl` (TODO: full checkout/webhook flow).
   */
  changePlan(
    subscription: Subscription,
    plan: Plan,
  ): Promise<ChangePlanResult>;
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
  externalSubscriptionId?: string | null;
  currentPeriodEnd?: Date | null;
  /** Hosted checkout URL (Stripe only; surfaced in the DTO). */
  checkoutUrl?: string | null;
}

/** DI token for the active BillingProvider implementation. */
export const BILLING_PROVIDER_TOKEN = Symbol('BILLING_PROVIDER');
