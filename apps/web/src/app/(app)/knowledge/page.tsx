'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DocumentList } from '@/features/knowledge/components/DocumentList';
import { SearchPanel } from '@/features/knowledge/components/SearchPanel';
import { UploadPanel } from '@/features/knowledge/components/UploadPanel';
import { useSessionStore } from '@/stores/session.store';

export default function KnowledgePage() {
  const router = useRouter();
  const accessToken = useSessionStore((s) => s.accessToken);

  // Client-side route guard, same pattern as the dashboard.
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
          <p className="text-sm text-gray-500">Knowledge base</p>
          <h1 className="text-2xl font-semibold">Documents &amp; search</h1>
        </div>
        <Link href="/dashboard" className="text-sm font-medium text-brand-700">
          ← Dashboard
        </Link>
      </header>

      <div className="space-y-6">
        <UploadPanel />
        <DocumentList />
        <SearchPanel />
      </div>
    </main>
  );
}
