'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { InstalledSkillList } from '@/features/skills/components/InstalledSkillList';
import { SkillCatalog } from '@/features/skills/components/SkillCatalog';
import { useSessionStore } from '@/stores/session.store';

export default function SkillsPage() {
  const router = useRouter();
  const accessToken = useSessionStore((s) => s.accessToken);

  // Client-side route guard, same pattern as the knowledge page.
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
          <p className="text-sm text-gray-500">Integrations</p>
          <h1 className="text-2xl font-semibold">Skills</h1>
        </div>
        <Link href="/dashboard" className="text-sm font-medium text-brand-700">
          ← Dashboard
        </Link>
      </header>

      <div className="space-y-6">
        <SkillCatalog />
        <div>
          <h2 className="mb-3 text-sm font-medium text-gray-500">
            Installed skills
          </h2>
          <InstalledSkillList />
        </div>
      </div>
    </main>
  );
}
