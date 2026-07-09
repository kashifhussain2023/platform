'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useApprovals } from '@/features/approvals/hooks';
import { useCurrentUser, useLogout } from '@/features/auth/hooks';
import { useCurrentCompany } from '@/features/tenant/hooks';
import { useSessionStore } from '@/stores/session.store';

export default function DashboardPage() {
  const router = useRouter();
  const accessToken = useSessionStore((s) => s.accessToken);
  const { data: me, isLoading } = useCurrentUser();
  const { data: company } = useCurrentCompany();
  const { data: pendingApprovals } = useApprovals('PENDING');
  const logout = useLogout();

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

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">Workspace</p>
          <h1 className="text-2xl font-semibold">
            {activeCompany?.name ?? 'Loading…'}
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/employees"
            className="text-sm font-medium text-brand-700"
          >
            Employees
          </Link>
          <Link href="/skills" className="text-sm font-medium text-brand-700">
            Skills
          </Link>
          <Link
            href="/workflows"
            className="text-sm font-medium text-brand-700"
          >
            Workflows
          </Link>
          <Link
            href="/approvals"
            className="flex items-center gap-1.5 text-sm font-medium text-brand-700"
          >
            Approvals
            {pendingApprovals && pendingApprovals.length > 0 && (
              <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700">
                {pendingApprovals.length}
              </span>
            )}
          </Link>
          <Link
            href="/knowledge"
            className="text-sm font-medium text-brand-700"
          >
            Knowledge
          </Link>
          <Button variant="ghost" onClick={onLogout} disabled={logout.isPending}>
            {logout.isPending ? 'Signing out…' : 'Log out'}
          </Button>
        </div>
      </header>

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading your profile…</p>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="mb-2 text-sm font-medium text-gray-500">Signed in as</h2>
            <p className="text-lg font-medium">{user?.name}</p>
            <p className="text-sm text-gray-600">{user?.email}</p>
            <span className="mt-2 inline-block rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700">
              {user?.role}
            </span>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="mb-2 text-sm font-medium text-gray-500">Company</h2>
            <p className="text-lg font-medium">{activeCompany?.name}</p>
            <p className="text-sm text-gray-600">/{activeCompany?.slug}</p>
          </div>
        </section>
      )}
    </main>
  );
}
