'use client';

import { useState } from 'react';
import type { WorkflowRunDto } from '@vaep/types';
import { useWorkflowRun, useWorkflowRuns } from '../hooks';
import { RUN_STATUS_STYLES } from '../labels';
import { RunSteps } from './RunSteps';

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** One past run's summary row; click to expand its step-by-step trace. */
function RunRow({
  run,
  expanded,
  onToggle,
}: {
  run: WorkflowRunDto;
  expanded: boolean;
  onToggle: () => void;
}) {
  // Poll only the expanded run's detail (steps aren't included in the list response).
  const { data: detail } = useWorkflowRun(expanded ? run.id : null);

  return (
    <li className="rounded-xl border border-white/[0.07] bg-white/[0.02]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="min-w-0">
          <p className="text-sm text-zinc-300">{formatWhen(run.createdAt)}</p>
          {run.error && (
            <p className="mt-0.5 truncate text-xs text-red-400">{run.error}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="inline-block rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs font-medium text-zinc-400">
            {run.source}
          </span>
          {run.dryRun && (
            <span className="inline-block rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-400">
              DRY RUN
            </span>
          )}
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${RUN_STATUS_STYLES[run.status]}`}
          >
            {run.status}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-white/[0.06] p-4">
          <RunSteps steps={detail?.steps ?? []} />
        </div>
      )}
    </li>
  );
}

/** Past runs for a workflow — the backend already tracked this; it just had no screen. */
export function PastRunsPanel({ workflowId }: { workflowId: string }) {
  const { data: runs, isLoading } = useWorkflowRuns(workflowId);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
      <h2 className="mb-3 text-sm font-medium text-zinc-400">Past Runs</h2>
      {isLoading ? (
        <p className="text-sm text-zinc-500">Loading past runs…</p>
      ) : !runs || runs.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No runs yet — use Run above to try this workflow.
        </p>
      ) : (
        <ul className="space-y-2">
          {runs.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              expanded={expandedId === run.id}
              onToggle={() =>
                setExpandedId((cur) => (cur === run.id ? null : run.id))
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}
