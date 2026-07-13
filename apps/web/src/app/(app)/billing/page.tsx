'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/app-shell/AppShell';
import { useAppShellProps } from '@/components/app-shell/useAppShellProps';
import { CurrentPlanCard } from '@/features/billing/components/CurrentPlanCard';
import { PlanCatalog } from '@/features/billing/components/PlanCatalog';
import { UsageSummary } from '@/features/billing/components/UsageSummary';
import { useSessionStore } from '@/stores/session.store';

export default function BillingPage() {
  const router = useRouter();
  const accessToken = useSessionStore((s) => s.accessToken);
  const shellProps = useAppShellProps();

  // Client-side route guard, same pattern as the other app pages.
  useEffect(() => {
    if (!accessToken) {
      router.replace('/login');
    }
  }, [accessToken, router]);

  if (!accessToken) {
    return null;
  }

  return (
    <AppShell {...shellProps}>
      <div className="mb-8 pt-2">
        <h1 className="text-2xl font-bold text-white">Billing</h1>
        <p className="mt-1 text-sm text-zinc-400">Manage your subscription and billing.</p>
      </div>

      <div className="space-y-10">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <CurrentPlanCard />
          </div>
          <div className="lg:col-span-2">
            <UsageSummary />
          </div>
        </div>

        <section id="plans">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">Plans</h2>
          <PlanCatalog />
        </section>
      </div>
    </AppShell>
  );
}
