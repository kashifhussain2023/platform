'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DlqPanel } from '@/features/admin/components/DlqPanel';
import { useCanManageSystem } from '@/features/admin/hooks';
import { useSessionStore } from '@/stores/session.store';

/**
 * Admin system health page (Unit C): the DLQ + connector-circuit panel. Gated to
 * authenticated OWNER/ADMIN (same client-side guard pattern as /organization); the
 * API enforces the role too.
 */
export default function AdminHealthPage() {
  const router = useRouter();
  const accessToken = useSessionStore((s) => s.accessToken);
  const canManage = useCanManageSystem();

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
          <h1 className="text-2xl font-semibold">System health</h1>
          <p className="mt-1 text-sm text-gray-500">
            Background-job dead-letter queue and connector circuit breakers.
          </p>
        </div>
        <Link href="/dashboard" className="text-sm font-medium text-brand-700">
          ← Dashboard
        </Link>
      </header>

      {canManage ? (
        <DlqPanel />
      ) : (
        <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You need an OWNER or ADMIN role to view system health.
        </p>
      )}
    </main>
  );
}
