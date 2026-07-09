'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { EmployeeTemplateList } from '@/features/marketplace/components/EmployeeTemplateList';
import { WorkflowTemplateList } from '@/features/marketplace/components/WorkflowTemplateList';
// Skills section reuses the existing Skills catalog + install flow (no duplication).
import { SkillCatalog } from '@/features/skills/components/SkillCatalog';
import { useSessionStore } from '@/stores/session.store';

export default function MarketplacePage() {
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
          <p className="text-sm text-gray-500">Expand</p>
          <h1 className="text-2xl font-semibold">Marketplace</h1>
        </div>
        <Link href="/dashboard" className="text-sm font-medium text-brand-700">
          ← Dashboard
        </Link>
      </header>

      <div className="space-y-10">
        <section>
          <h2 className="mb-3 text-sm font-medium text-gray-500">AI Employees</h2>
          <EmployeeTemplateList />
        </section>

        <section>
          <h2 className="mb-3 text-sm font-medium text-gray-500">
            Workflow Templates
          </h2>
          <WorkflowTemplateList />
        </section>

        <section>
          <h2 className="mb-3 text-sm font-medium text-gray-500">Skills</h2>
          <SkillCatalog />
        </section>
      </div>
    </main>
  );
}
