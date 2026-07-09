'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { WorkflowForm } from '@/features/workflows/components/WorkflowForm';
import { WorkflowList } from '@/features/workflows/components/WorkflowList';
import { useSessionStore } from '@/stores/session.store';

export default function WorkflowsPage() {
  const router = useRouter();
  const accessToken = useSessionStore((s) => s.accessToken);

  // Client-side route guard, same pattern as the other feature pages.
  useEffect(() => {
    if (!accessToken) {
      router.replace('/login');
    }
  }, [accessToken, router]);

  if (!accessToken) {
    return null;
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">Automation</p>
          <h1 className="text-2xl font-semibold">Workflows</h1>
        </div>
        <Link href="/dashboard" className="text-sm font-medium text-brand-700">
          ← Dashboard
        </Link>
      </header>

      <div className="space-y-6">
        <WorkflowForm />
        <WorkflowList />
      </div>
    </main>
  );
}
