'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Trash2, Workflow as WorkflowIcon } from 'lucide-react';
import type { WorkflowDto, WorkflowStatus } from '@vaep/types';
import {
  useActivateWorkflow,
  useDeactivateWorkflow,
  useDeleteWorkflow,
  useWorkflows,
} from '../hooks';
import { TRIGGER_TYPE_LABELS } from '../labels';

type StatusFilter = 'ALL' | WorkflowStatus;

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: 'All Workflows' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PAUSED', label: 'Paused' },
];

/** On/off pill switch wired straight to the activate/deactivate mutations. */
function StatusToggle({
  workflow,
  isTemp,
  canActivate,
  activate,
  deactivate,
}: {
  workflow: WorkflowDto;
  isTemp: boolean;
  canActivate: boolean;
  activate: ReturnType<typeof useActivateWorkflow>;
  deactivate: ReturnType<typeof useDeactivateWorkflow>;
}) {
  const isOn = workflow.status === 'ACTIVE';
  const pending = activate.isPending || deactivate.isPending;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      aria-label={isOn ? `Deactivate ${workflow.name}` : `Activate ${workflow.name}`}
      onClick={() =>
        isOn ? deactivate.mutate(workflow.id) : activate.mutate(workflow.id)
      }
      disabled={isTemp || pending || (!isOn && !canActivate)}
      title={!isOn && !canActivate ? 'Add a step before activating' : undefined}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        isOn ? 'bg-violet' : 'bg-white/10'
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
          isOn ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

/** The tenant's workflows with activate/deactivate + delete (optimistic) + open. */
export function WorkflowList() {
  const { data: workflows, isLoading } = useWorkflows();
  const activate = useActivateWorkflow();
  const deactivate = useDeactivateWorkflow();
  const del = useDeleteWorkflow();
  const [filter, setFilter] = useState<StatusFilter>('ALL');

  if (isLoading) {
    return <p className="text-sm text-zinc-500">Loading workflows…</p>;
  }

  if (!workflows || workflows.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        No workflows yet. Create one to get started.
      </p>
    );
  }

  const visible = workflows.filter((w) => filter === 'ALL' || w.status === filter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
              filter === f.value
                ? 'bg-violet text-white'
                : 'border border-white/[0.1] text-zinc-400 hover:text-white'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-zinc-500">No workflows match this filter.</p>
      ) : (
        <ul className="space-y-3">
          {visible.map((workflow: WorkflowDto) => {
            const isTemp = workflow.id.startsWith('temp_');
            const nodes = workflow.definition?.nodes ?? [];
            const nodeCount = nodes.length;
            const canActivate = nodes.some((n) => n.type !== 'TRIGGER');
            return (
              <li
                key={workflow.id}
                className="flex items-center gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 transition-colors hover:border-white/[0.14]"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet/20 text-violet-secondary">
                  <WorkflowIcon className="h-5 w-5" />
                </span>

                <Link
                  href={`/workflows/${workflow.id}`}
                  className="min-w-0 flex-1"
                  aria-disabled={isTemp}
                >
                  <p className="truncate font-bold text-white">{workflow.name}</p>
                  <p className="mt-0.5 truncate text-xs text-zinc-400">
                    Trigger · {TRIGGER_TYPE_LABELS[workflow.triggerType]}
                  </p>
                  <p className="truncate text-xs text-zinc-500">
                    Steps · {nodeCount} action{nodeCount === 1 ? '' : 's'}
                    {workflow.description ? ` · ${workflow.description}` : ''}
                  </p>
                </Link>

                <div className="flex shrink-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={() => del.mutate(workflow.id)}
                    disabled={isTemp || del.isPending}
                    aria-label={`Delete ${workflow.name}`}
                    className="rounded-lg p-1.5 text-zinc-600 transition-colors hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <StatusToggle
                    workflow={workflow}
                    isTemp={isTemp}
                    canActivate={canActivate}
                    activate={activate}
                    deactivate={deactivate}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
