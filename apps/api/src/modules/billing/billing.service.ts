import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  ChangePlanDto,
  PlanDto,
  SubscriptionDto,
  UsageDto,
} from '@vaep/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  BILLING_PROVIDER_TOKEN,
  type BillingProvider,
} from './billing.provider';
import { toSubscriptionDto } from './billing.mapper';
import { PLAN_LIST, maxEmployeesFor } from './billing.plans';

/**
 * Billing & Subscription (Steps 1 + 13). One subscription per company; every
 * company gets a default STARTER/ACTIVE subscription at registration (and older
 * companies self-heal on read). Plan changes go through the swappable
 * BillingProvider (mock by default). Usage is computed ON THE FLY from existing
 * data (no usage table) and plan limits are SOFT — surfaced but never enforced.
 * Every query is scoped by companyId (from the JWT).
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(BILLING_PROVIDER_TOKEN)
    private readonly provider: BillingProvider,
  ) {}

  /** The code-defined plan catalog. */
  plans(): PlanDto[] {
    return [...PLAN_LIST];
  }

  /**
   * Create a default STARTER/ACTIVE subscription if the company has none.
   * Idempotent: safe to call at registration AND on every read (self-heal).
   */
  async ensureDefaultSubscription(companyId: string): Promise<SubscriptionDto> {
    const existing = await this.prisma.subscription.findUnique({
      where: { companyId },
    });
    if (existing) {
      return toSubscriptionDto(existing);
    }
    const { externalCustomerId } = await this.provider.ensureCustomer({
      id: companyId,
    });
    try {
      const created = await this.prisma.subscription.create({
        data: {
          companyId,
          plan: 'STARTER',
          status: 'ACTIVE',
          provider: this.provider.name,
          externalCustomerId,
        },
      });
      return toSubscriptionDto(created);
    } catch (err) {
      // Lost a create race (unique companyId) — return the winner.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const row = await this.prisma.subscription.findUniqueOrThrow({
          where: { companyId },
        });
        return toSubscriptionDto(row);
      }
      throw err;
    }
  }

  /** Current subscription (auto-creating the default if missing). */
  getSubscription(companyId: string): Promise<SubscriptionDto> {
    return this.ensureDefaultSubscription(companyId);
  }

  /** Change plan via the provider, then persist the resolved fields. */
  async changePlan(
    companyId: string,
    dto: ChangePlanDto,
  ): Promise<SubscriptionDto> {
    await this.ensureDefaultSubscription(companyId);
    const current = await this.prisma.subscription.findUniqueOrThrow({
      where: { companyId },
    });
    const result = await this.provider.changePlan(current, dto.plan);
    const updated = await this.prisma.subscription.update({
      where: { companyId },
      data: {
        plan: result.plan,
        status: result.status,
        externalSubscriptionId:
          result.externalSubscriptionId ?? current.externalSubscriptionId,
        currentPeriodEnd:
          result.currentPeriodEnd ?? current.currentPeriodEnd,
      },
    });
    const dtoOut = toSubscriptionDto(updated);
    // Surface a hosted checkout url when a provider returns one (Stripe; TODO).
    if (result.checkoutUrl) {
      dtoOut.checkoutUrl = result.checkoutUrl;
    }
    return dtoOut;
  }

  /**
   * On-the-fly usage snapshot. `tasks` reuses the analytics definition
   * (SkillExecution SUCCESS + assistant Messages + WorkflowRun COMPLETED).
   * `tokens`/`voiceMinutes` are placeholders (real metering = TODO).
   * `overEmployeeLimit` is a SOFT, informational flag.
   */
  async usage(companyId: string): Promise<UsageDto> {
    const subscription = await this.ensureDefaultSubscription(companyId);
    const plan = subscription.plan;

    const [
      employees,
      installedSkills,
      toolSuccess,
      assistantMessages,
      workflowCompleted,
    ] = await Promise.all([
      this.prisma.aiEmployee.count({ where: { companyId } }),
      this.prisma.installedSkill.count({ where: { companyId } }),
      this.prisma.skillExecution.count({
        where: { companyId, status: 'SUCCESS' },
      }),
      this.prisma.message.count({ where: { companyId, role: 'ASSISTANT' } }),
      this.prisma.workflowRun.count({
        where: { companyId, status: 'COMPLETED' },
      }),
    ]);

    const maxEmployees = maxEmployeesFor(plan);
    return {
      plan,
      maxEmployees,
      employees,
      installedSkills,
      tasks: toolSuccess + assistantMessages + workflowCompleted,
      tokens: 0,
      voiceMinutes: 0,
      overEmployeeLimit: maxEmployees !== null && employees > maxEmployees,
    };
  }
}
