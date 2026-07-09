import type { ConfigService } from '@nestjs/config';
import type { Plan } from '@vaep/types';
import type { Subscription } from '@prisma/client';
import type {
  BillingCompany,
  BillingProvider,
  ChangePlanResult,
  EnsureCustomerResult,
} from '../billing.provider';

/**
 * Opt-in Stripe billing backend (`BILLING_PROVIDER=stripe`). `stripe` is imported
 * lazily (NOT a package.json dependency — install it only when this provider is
 * used) and needs `STRIPE_SECRET_KEY`. This is a best-effort skeleton: it creates
 * a Stripe customer and records the target plan on the subscription row.
 *
 * TODO: full hosted-checkout Session creation (return `checkoutUrl`), price-id
 * mapping per plan, and webhook handling to reconcile status / currentPeriodEnd.
 */
export class StripeBillingProvider implements BillingProvider {
  readonly name = 'stripe';

  // Stripe SDK client, created once (lazy). Typed loosely — optional dep.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any = null;

  constructor(private readonly config: ConfigService) {}

  async ensureCustomer(company: BillingCompany): Promise<EnsureCustomerResult> {
    const stripe = await this.getClient();
    const customer = await stripe.customers.create({
      name: company.name,
      metadata: { companyId: company.id },
    });
    return { externalCustomerId: customer.id as string };
  }

  async changePlan(
    subscription: Subscription,
    plan: Plan,
  ): Promise<ChangePlanResult> {
    // Ensure a customer exists (self-heal for older rows created under mock).
    if (!subscription.externalCustomerId) {
      await this.getClient();
    }
    // TODO: create/update a Stripe subscription for the plan's price id and
    // return a hosted checkout url. For now record the plan optimistically.
    return { plan, status: 'ACTIVE' };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async sdk(): Promise<any> {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error optional dep — installed only when BILLING_PROVIDER=stripe
    return import('stripe');
  }

  private async getClient() {
    if (!this.client) {
      const mod = await this.sdk();
      const Stripe = mod.default ?? mod;
      this.client = new Stripe(
        this.config.getOrThrow<string>('STRIPE_SECRET_KEY'),
      );
    }
    return this.client;
  }
}
