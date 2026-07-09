'use client';

import Link from 'next/link';
import type { WorkflowDto } from '@vaep/types';
import { Button } from '@/components/ui/Button';
import {
  useActivateWorkflow,
  useDeactivateWorkflow,
  useDeleteWorkflow,
  useWorkflows,
} from '../hooks';
import { WORKFLOW_STATUS_STYLES } from '../labels';

/** The tenant's workflows with activate/deactivate + delete (optimistic) + open. */
export function WorkflowList() {
  const { data: workflows, isLoading } = useWorkflows();
  const activate = useActivateWorkflow();
  const deactivate = useDeactivateWorkflow();
  const del = useDeleteWorkflow();

  if (isLoading) {
    return <p className="text-sm text-gray-500">Loading workflows…</p>;
  }

  if (!workflows || workflows.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No workflows yet. Create one above to get started.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
      {workflows.map((workflow: WorkflowDto) => {
        const isTemp = workflow.id.startsWith('temp_');
        const nodes = workflow.definition?.nodes ?? [];
        const nodeCount = nodes.length;
        const canActivate = nodes.some((n) => n.type !== 'TRIGGER');
        return (
          <li
            key={workflow.id}
            className="flex items-center justify-between gap-4 px-4 py-3"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium">{workflow.name}</p>
                <span
                  className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${WORKFLOW_STATUS_STYLES[workflow.status]}`}
                >
                  {workflow.status}
                </span>
              </div>
              <p className="text-xs text-gray-500">
                {nodeCount} step{nodeCount === 1 ? '' : 's'}
                {workflow.description ? ` · ${workflow.description}` : ''}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {workflow.status === 'ACTIVE' ? (
                <Button
                  variant="ghost"
                  onClick={() => deactivate.mutate(workflow.id)}
                  disabled={isTemp || deactivate.isPending}
                >
                  Deactivate
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  onClick={() => activate.mutate(workflow.id)}
                  disabled={isTemp || !canActivate || activate.isPending}
                  title={
                    canActivate ? undefined : 'Add a step before activating'
                  }
                >
                  Activate
                </Button>
              )}
              <Link
                href={`/workflows/${workflow.id}`}
                className="inline-flex items-center justify-center rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
                aria-disabled={isTemp}
              >
                Open
              </Link>
              <Button
                variant="ghost"
                onClick={() => del.mutate(workflow.id)}
                disabled={isTemp || del.isPending}
              >
                Delete
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
