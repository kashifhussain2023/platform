'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/app-shell/AppShell';
import { useAppShellProps } from '@/components/app-shell/useAppShellProps';
import { NodeList } from '@/features/workflows/components/NodeList';
import { RunPanel } from '@/features/workflows/components/RunPanel';
import { TriggerPanel } from '@/features/workflows/components/TriggerPanel';
import { useWorkflow } from '@/features/workflows/hooks';
import { useSessionStore } from '@/stores/session.store';

export default function WorkflowEditorPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const accessToken = useSessionStore((s) => s.accessToken);
  const shellProps = useAppShellProps();
  const workflowId = params.id;
  const { data: workflow, isLoading } = useWorkflow(workflowId);
  const searchParams = useSearchParams();
  const unresolvedIds = (searchParams.get('unresolved') ?? '').split(',').filter(Boolean);
  const [dismissed, setDismissed] = useState(false);

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
    <AppShell {...shellProps}>
      <div className="mb-6 flex items-center justify-between gap-4 pt-2">
        <div>
          <p className="text-sm text-zinc-500">Workflow</p>
          <h1 className="text-2xl font-bold text-white">
            {workflow?.name ?? 'Loading…'}
          </h1>
        </div>
        <Link
          href="/workflows"
          className="text-sm font-medium text-zinc-400 transition-colors hover:text-white"
        >
          ← Workflows
        </Link>
      </div>

      {!dismissed && unresolvedIds.length > 0 && workflow && (
        <div className="mb-6 flex items-start justify-between gap-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
          <p className="text-sm text-amber-400">
            AI couldn&apos;t confidently fill in{' '}
            {unresolvedIds
              .map((id) => workflow.definition.nodes.find((n) => n.id === id)?.name ?? id)
              .join(', ')}
            . Open that step below and choose a tool before activating.
          </p>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="shrink-0 text-sm text-amber-400 hover:text-amber-300"
          >
            Dismiss
          </button>
        </div>
      )}

      {isLoading || !workflow ? (
        <p className="text-sm text-zinc-500">Loading workflow…</p>
      ) : (
        <div className="space-y-6">
          <NodeList workflow={workflow} />
          <TriggerPanel
            workflow={workflow}
            canActivate={(workflow.definition?.nodes ?? []).some(
              (n) => n.type !== 'TRIGGER',
            )}
          />
          <RunPanel
            workflowId={workflow.id}
            canRun={(workflow.definition?.nodes ?? []).some(
              (n) => n.type !== 'TRIGGER',
            )}
          />
        </div>
      )}
    </AppShell>
  );
}
