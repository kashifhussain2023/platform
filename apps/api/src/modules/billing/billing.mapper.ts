import type { Subscription } from '@prisma/client';
import type { SubscriptionDto } from '@vaep/types';

/** Prisma row → public DTO mapper for the billing module. */
export function toSubscriptionDto(s: Subscription): SubscriptionDto {
  return {
    id: s.id,
    companyId: s.companyId,
    plan: s.plan,
    status: s.status,
    provider: s.provider,
    currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}
