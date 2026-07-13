'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/app-shell/AppShell';
import { useAppShellProps } from '@/components/app-shell/useAppShellProps';
import { DocumentList } from '@/features/knowledge/components/DocumentList';
import { SearchPanel } from '@/features/knowledge/components/SearchPanel';
import { UploadPanel } from '@/features/knowledge/components/UploadPanel';
import { useSessionStore } from '@/stores/session.store';

export default function KnowledgePage() {
  const router = useRouter();
  const accessToken = useSessionStore((s) => s.accessToken);
  const shellProps = useAppShellProps();

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
    <AppShell {...shellProps}>
      <h1 className="mb-8 pt-2 text-2xl font-bold text-white">Knowledge Base</h1>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="order-2 lg:order-1 lg:col-span-2">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">Documents</h2>
          <DocumentList />
        </section>
        <div className="order-1 space-y-6 lg:order-2">
          <UploadPanel />
          <SearchPanel />
        </div>
      </div>
    </AppShell>
  );
}
