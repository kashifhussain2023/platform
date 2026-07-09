'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CurrentPlanCard } from '@/features/billing/components/CurrentPlanCard';
import { PlanCatalog } from '@/features/billing/components/PlanCatalog';
import { UsageSummary } from '@/features/billing/components/UsageSummary';
import { useSessionStore } from '@/stores/session.store';

export default function BillingPage() {
  const router = useRouter();
  const accessToken = useSessionStore((s) => s.accessToken);

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
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">Account</p>
          <h1 className="text-2xl font-semibold">Billing &amp; Subscription</h1>
        </div>
        <Link href="/dashboard" className="text-sm font-medium text-brand-700">
          ← Dashboard
        </Link>
      </header>

      <div className="space-y-10">
        <div className="grid gap-4 lg:grid-cols-2">
          <CurrentPlanCard />
          <UsageSummary />
        </div>

        <section id="plans">
          <h2 className="mb-3 text-sm font-medium text-gray-500">Plans</h2>
          <PlanCatalog />
        </section>
      </div>
    </main>
  );
}
