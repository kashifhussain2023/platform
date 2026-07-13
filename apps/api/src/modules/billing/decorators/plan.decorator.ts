import { SetMetadata } from '@nestjs/common';
import type { Plan } from '@vaep/types';

/** Metadata key holding the plans allowed to invoke a handler. */
export const PLAN_KEY = 'requiredPlans';

/**
 * Restrict a route to companies on one of the given plans, evaluated by
 * PlanGuard. A handler with NO @RequirePlan metadata is open to any plan
 * (mirrors how @Roles/RolesGuard treats an absent decorator).
 */
export const RequirePlan = (...plans: Plan[]) => SetMetadata(PLAN_KEY, plans);
