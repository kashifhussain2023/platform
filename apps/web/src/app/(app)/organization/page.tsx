'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DepartmentSection } from '@/features/organization/components/DepartmentSection';
import { SecurityPolicyForm } from '@/features/organization/components/SecurityPolicyForm';
import { TeamSection } from '@/features/organization/components/TeamSection';
import { useCanManageOrg } from '@/features/organization/hooks';
import { useSessionStore } from '@/stores/session.store';

export default function OrganizationPage() {
  const router = useRouter();
  const accessToken = useSessionStore((s) => s.accessToken);
  const canManage = useCanManageOrg();

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
          <h1 className="text-2xl font-semibold">Organization</h1>
          <p className="mt-1 text-sm text-gray-500">
            Departments, teams and security policy.
            {!canManage && ' You have read-only access.'}
          </p>
        </div>
        <Link href="/dashboard" className="text-sm font-medium text-brand-700">
          ← Dashboard
        </Link>
      </header>

      <div className="space-y-8">
        <DepartmentSection />
        <TeamSection />
        <SecurityPolicyForm />
      </div>
    </main>
  );
}
