'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { NodeList } from '@/features/workflows/components/NodeList';
import { RunPanel } from '@/features/workflows/components/RunPanel';
import { useWorkflow } from '@/features/workflows/hooks';
import { useSessionStore } from '@/stores/session.store';

export default function WorkflowEditorPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const accessToken = useSessionStore((s) => s.accessToken);
  const workflowId = params.id;
  const { data: workflow, isLoading } = useWorkflow(workflowId);

  // Client-side route guard.
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
      <header className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">Workflow</p>
          <h1 className="text-2xl font-semibold">
            {workflow?.name ?? 'Loading…'}
          </h1>
        </div>
        <Link href="/workflows" className="text-sm font-medium text-brand-700">
          ← Workflows
        </Link>
      </header>

      {isLoading || !workflow ? (
        <p className="text-sm text-gray-500">Loading workflow…</p>
      ) : (
        <div className="space-y-6">
          <NodeList workflow={workflow} />
          <RunPanel workflowId={workflow.id} />
        </div>
      )}
    </main>
  );
}
