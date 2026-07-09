'use client';

import { usePlans, useSubscription } from '../hooks';
import { STATUS_BADGE, STATUS_LABEL, formatPrice } from '../labels';

/** Header card: the company's current plan, price and status. */
export function CurrentPlanCard() {
  const { data: subscription, isLoading } = useSubscription();
  const { data: plans } = usePlans();

  if (isLoading || !subscription) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <p className="text-sm text-gray-500">Loading subscription…</p>
      </div>
    );
  }

  const plan = plans?.find((p) => p.plan === subscription.plan);
  const name = plan?.name ?? subscription.plan;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500">Current plan</p>
          <h2 className="mt-1 text-2xl font-semibold text-gray-900">{name}</h2>
          {plan && (
            <p className="mt-1 text-sm text-gray-500">
              {formatPrice(plan.priceMonthlyUsd)}
              {plan.priceMonthlyUsd !== null && plan.priceMonthlyUsd > 0
                ? ' / month'
                : ''}
            </p>
          )}
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_BADGE[subscription.status]}`}
        >
          {STATUS_LABEL[subscription.status]}
        </span>
      </div>
      <p className="mt-4 text-xs text-gray-400">
        Billed via {subscription.provider}. Prices are illustrative.
      </p>
    </div>
  );
}
