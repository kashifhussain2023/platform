'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { UserForm } from '@/features/users/components/UserForm';
import { UserList } from '@/features/users/components/UserList';
import { useCanManageUsers } from '@/features/users/hooks';
import { useSessionStore } from '@/stores/session.store';

export default function TeamPage() {
  const router = useRouter();
  const accessToken = useSessionStore((s) => s.accessToken);
  const canManage = useCanManageUsers();

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
          <h1 className="text-2xl font-semibold">Team &amp; Access</h1>
        </div>
        <Link href="/dashboard" className="text-sm font-medium text-brand-700">
          ← Dashboard
        </Link>
      </header>

      <div className="space-y-8">
        {/* Mutating controls are OWNER/ADMIN only; members see a read-only roster. */}
        {canManage && <UserForm />}
        <section>
          <h2 className="mb-3 text-sm font-medium text-gray-500">Team members</h2>
          <UserList />
        </section>
      </div>
    </main>
  );
}
