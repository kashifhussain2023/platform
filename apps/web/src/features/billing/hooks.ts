'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  ChangePlanDto,
  PlanDto,
  SubscriptionDto,
  UsageDto,
} from '@vaep/types';
import type { NormalizedApiError } from '@/lib/apiClient';
import { useSessionStore } from '@/stores/session.store';
import { changePlan, getPlans, getSubscription, getUsage } from './api';

export const billingKeys = {
  all: ['billing'] as const,
  plans: ['billing', 'plans'] as const,
  subscription: ['billing', 'subscription'] as const,
  usage: ['billing', 'usage'] as const,
};

/** The plan catalog (static per deploy). */
export function usePlans() {
  const accessToken = useSessionStore((s) => s.accessToken);
  return useQuery<PlanDto[], NormalizedApiError>({
    queryKey: billingKeys.plans,
    queryFn: getPlans,
    enabled: Boolean(accessToken),
    staleTime: 5 * 60 * 1000,
  });
}

/** Current subscription. */
export function useSubscription() {
  const accessToken = useSessionStore((s) => s.accessToken);
  return useQuery<SubscriptionDto, NormalizedApiError>({
    queryKey: billingKeys.subscription,
    queryFn: getSubscription,
    enabled: Boolean(accessToken),
  });
}

/** On-the-fly usage snapshot. */
export function useUsage() {
  const accessToken = useSessionStore((s) => s.accessToken);
  return useQuery<UsageDto, NormalizedApiError>({
    queryKey: billingKeys.usage,
    queryFn: getUsage,
    enabled: Boolean(accessToken),
  });
}

interface ChangePlanContext {
  previous: SubscriptionDto | undefined;
}

/**
 * Change plan. With the mock provider the switch is immediate (optimistic:
 * patch the cached plan, roll back on error). With Stripe the response carries a
 * hosted `checkoutUrl` and the switch only applies after the webhook confirms —
 * so we roll back the optimistic patch and redirect the browser to checkout.
 * Refetches subscription + usage on settle (limits shift with the plan).
 */
export function useChangePlan() {
  const qc = useQueryClient();
  return useMutation<
    SubscriptionDto,
    NormalizedApiError,
    ChangePlanDto,
    ChangePlanContext
  >({
    mutationFn: changePlan,
    onMutate: async ({ plan }) => {
      await qc.cancelQueries({ queryKey: billingKeys.subscription });
      const previous = qc.getQueryData<SubscriptionDto>(
        billingKeys.subscription,
      );
      if (previous) {
        qc.setQueryData<SubscriptionDto>(billingKeys.subscription, {
          ...previous,
          plan,
        });
      }
      return { previous };
    },
    onSuccess: (data, _vars, context) => {
      // Stripe: nothing changed server-side yet — undo the optimistic patch and
      // send the user to the hosted checkout page (webhook applies the switch).
      if (data.checkoutUrl) {
        rollback(qc, context);
        window.location.href = data.checkoutUrl;
      }
    },
    onError: (_err, _vars, context) => {
      rollback(qc, context);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: billingKeys.subscription });
      void qc.invalidateQueries({ queryKey: billingKeys.usage });
    },
  });
}

function rollback(qc: QueryClient, context?: ChangePlanContext) {
  if (context?.previous) {
    qc.setQueryData(billingKeys.subscription, context.previous);
  }
}
