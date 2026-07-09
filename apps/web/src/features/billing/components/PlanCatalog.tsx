'use client';

import type { Plan } from '@vaep/types';
import { Button } from '@/components/ui/Button';
import { useChangePlan, usePlans, useSubscription } from '../hooks';
import { changeLabel, formatLimit, formatPrice } from '../labels';

/** Plan catalog cards with a per-plan Upgrade/Change action (optimistic). */
export function PlanCatalog() {
  const { data: plans, isLoading } = usePlans();
  const { data: subscription } = useSubscription();
  const changePlan = useChangePlan();

  if (isLoading || !plans) {
    return <p className="text-sm text-gray-500">Loading plans…</p>;
  }

  const current = subscription?.plan;
  const pendingPlan = changePlan.isPending
    ? (changePlan.variables?.plan as Plan | undefined)
    : undefined;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {plans.map((plan) => {
        const isCurrent = current === plan.plan;
        const label = current ? changeLabel(current, plan.plan) : 'Choose';
        return (
          <div
            key={plan.plan}
            className={`flex flex-col rounded-lg border bg-white p-5 ${
              isCurrent ? 'border-brand-500 ring-1 ring-brand-500' : 'border-gray-200'
            }`}
          >
            <div className="flex items-baseline justify-between">
              <h3 className="text-lg font-semibold text-gray-900">{plan.name}</h3>
              {isCurrent && (
                <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700">
                  Current
                </span>
              )}
            </div>
            <p className="mt-2 text-2xl font-semibold text-gray-900">
              {formatPrice(plan.priceMonthlyUsd)}
              {plan.priceMonthlyUsd !== null && plan.priceMonthlyUsd > 0 && (
                <span className="text-sm font-normal text-gray-400"> /mo</span>
              )}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              {formatLimit(plan.maxEmployees)} AI employees
            </p>

            <ul className="mt-4 flex-1 space-y-1.5 text-sm text-gray-600">
              {plan.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-brand-500">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            <Button
              className="mt-5 w-full"
              variant={isCurrent ? 'ghost' : 'primary'}
              disabled={isCurrent || changePlan.isPending}
              onClick={() => changePlan.mutate({ plan: plan.plan })}
            >
              {pendingPlan === plan.plan ? 'Switching…' : label}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
