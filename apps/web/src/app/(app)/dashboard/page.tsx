'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { AnalyticsRange } from '@vaep/types';
import { Button } from '@/components/ui/Button';
import { ActivityPanel } from '@/features/analytics/components/ActivityPanel';
import { KpiTable } from '@/features/analytics/components/KpiTable';
import { StatTile } from '@/features/analytics/components/StatTile';
import { useOverview } from '@/features/analytics/hooks';
import {
  RANGE_OPTIONS,
  formatCurrency,
  formatHours,
  formatNumber,
  formatPercent,
} from '@/features/analytics/labels';
import { useApprovals } from '@/features/approvals/hooks';
import { useCurrentUser, useLogout } from '@/features/auth/hooks';
import { useCurrentCompany } from '@/features/tenant/hooks';
import { useSessionStore } from '@/stores/session.store';

/** Greeting that adapts to the local time of day. */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardPage() {
  const router = useRouter();
  const accessToken = useSessionStore((s) => s.accessToken);
  const { data: me, isLoading } = useCurrentUser();
  const { data: company } = useCurrentCompany();
  const { data: pendingApprovals } = useApprovals('PENDING');
  const logout = useLogout();

  const [range, setRange] = useState<AnalyticsRange>('7d');
  const { data: overview, isLoading: overviewLoading } = useOverview(range);

  // Client-side route guard for this slice (server middleware comes later).
  useEffect(() => {
    if (!accessToken) {
      router.replace('/login');
    }
  }, [accessToken, router]);

  if (!accessToken) {
    return null;
  }

  const onLogout = async () => {
    await logout.mutateAsync();
    router.replace('/login');
  };

  const user = me?.user;
  const activeCompany = company ?? me?.company;
  const pendingCount = pendingApprovals?.length ?? overview?.pendingApprovals ?? 0;

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">
            {activeCompany?.name ?? 'Workspace'}
          </p>
          <h1 className="text-2xl font-semibold">
            {greeting()}
            {user?.name ? `, ${user.name.split(' ')[0]}` : ''}
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/employees" className="text-sm font-medium text-brand-700">
            Employees
          </Link>
          <Link href="/skills" className="text-sm font-medium text-brand-700">
            Skills
          </Link>
          <Link href="/workflows" className="text-sm font-medium text-brand-700">
            Workflows
          </Link>
          <Link
            href="/approvals"
            className="flex items-center gap-1.5 text-sm font-medium text-brand-700"
          >
            Approvals
            {pendingCount > 0 && (
              <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700">
                {pendingCount}
              </span>
            )}
          </Link>
          <Link href="/knowledge" className="text-sm font-medium text-brand-700">
            Knowledge
          </Link>
          <Link href="/marketplace" className="text-sm font-medium text-brand-700">
            Marketplace
          </Link>
          <Link href="/billing" className="text-sm font-medium text-brand-700">
            Billing
          </Link>
          <Button variant="ghost" onClick={onLogout} disabled={logout.isPending}>
            {logout.isPending ? 'Signing out…' : 'Log out'}
          </Button>
        </div>
      </header>

      {/* Range selector */}
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-500">Operations overview</h2>
        <div className="flex gap-1 rounded-lg border border-gray-200 bg-white p-1">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setRange(opt.value)}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                range === opt.value
                  ? 'bg-brand-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI tile row */}
      <section className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Tasks Completed"
          value={overviewLoading ? '—' : formatNumber(overview?.tasksCompleted ?? 0)}
          helper="tool + message + workflow"
          estimate
        />
        <StatTile
          label="Hours Saved"
          value={overviewLoading ? '—' : formatHours(overview?.hoursSaved ?? 0)}
          helper="~10 min/task"
          estimate
        />
        <StatTile
          label="Cost Savings"
          value={overviewLoading ? '—' : formatCurrency(overview?.costSavings ?? 0)}
          helper="@ $25/hr"
          estimate
        />
        <StatTile
          label="Success Rate"
          value={overviewLoading ? '—' : formatPercent(overview?.successRate ?? null)}
          helper="tools + workflows"
        />
        <Link href="/approvals" className="contents">
          <StatTile
            label="Pending Approvals"
            value={
              overviewLoading ? '—' : formatNumber(overview?.pendingApprovals ?? 0)
            }
            helper="review queue →"
          />
        </Link>
        <StatTile
          label="Active Employees"
          value={overviewLoading ? '—' : formatNumber(overview?.activeEmployees ?? 0)}
          helper={
            overview ? `of ${formatNumber(overview.employees)} hired` : undefined
          }
        />
      </section>

      {/* Per-employee KPIs + activity feed */}
      <div className="grid gap-8 lg:grid-cols-5">
        <section className="lg:col-span-3">
          <h2 className="mb-3 text-sm font-medium text-gray-500">
            Employee performance
          </h2>
          <KpiTable range={range} />
        </section>
        <section className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-medium text-gray-500">
            Today&rsquo;s AI activity
          </h2>
          <ActivityPanel range={range} />
        </section>
      </div>

      {isLoading && (
        <p className="mt-8 text-sm text-gray-500">Loading your profile…</p>
      )}
    </main>
  );
}
