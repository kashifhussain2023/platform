import { apiClient } from '@/lib/apiClient';
import type {
  ChangePlanDto,
  PlanDto,
  SubscriptionDto,
  UsageDto,
} from '@vaep/types';

/** The code-defined plan catalog. */
export async function getPlans(): Promise<PlanDto[]> {
  const { data } = await apiClient.get<PlanDto[]>('/billing/plans');
  return data;
}

/** Current subscription (server auto-creates the default if missing). */
export async function getSubscription(): Promise<SubscriptionDto> {
  const { data } = await apiClient.get<SubscriptionDto>('/billing/subscription');
  return data;
}

/** On-the-fly usage snapshot + plan limit + soft over-limit flag. */
export async function getUsage(): Promise<UsageDto> {
  const { data } = await apiClient.get<UsageDto>('/billing/usage');
  return data;
}

/** Change plan (mock: immediate switch). */
export async function changePlan(body: ChangePlanDto): Promise<SubscriptionDto> {
  const { data } = await apiClient.post<SubscriptionDto>(
    '/billing/subscription',
    body,
  );
  return data;
}
