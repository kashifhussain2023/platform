'use client';

import { useState } from 'react';
import type { WorkflowStepRunDto } from '@vaep/types';
import { Button } from '@/components/ui/Button';
import { useRunWorkflow, useWorkflowRun } from '../hooks';
import {
  NODE_ICONS,
  NODE_LABELS,
  NODE_TONES,
  RUN_STATUS_STYLES,
  STEP_STATUS_STYLES,
} from '../labels';

/** Pretty-print a step's output for the run log (bounded). */
function preview(value: unknown): string {
  if (value == null) {
    return '';
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return text.length > 800 ? `${text.slice(0, 800)}…` : text;
}

/**
 * Trigger a run (optional JSON trigger payload) and poll GET /workflows/runs/:id
 * while PENDING/RUNNING, showing each WorkflowStepRun's status + output (a live
 * run log). Save the workflow first so the run executes the latest steps.
 */
export function RunPanel({
  workflowId,
  canRun = true,
}: {
  workflowId: string;
  /** False when the saved workflow has no runnable steps (only a TRIGGER). */
  canRun?: boolean;
}) {
  const [triggerText, setTriggerText] = useState('{\n  "query": "refund policy"\n}');
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

  const run = useRunWorkflow(workflowId);
  const { data: current } = useWorkflowRun(runId);

  const onRun = () => {
    let trigger: Record<string, unknown> | undefined;
    const text = triggerText.trim();
    if (text) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          trigger = parsed as Record<string, unknown>;
        } else {
          setTriggerError('Trigger must be a JSON object');
          return;
        }
      } catch {
        setTriggerError('Invalid JSON');
        return;
      }
    }
    setTriggerError(null);
    run.mutate({ trigger }, { onSuccess: (created) => setRunId(created.id) });
  };

  const steps: WorkflowStepRunDto[] = current?.steps ?? [];

  return (
    <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
      <h2 className="mb-3 text-sm font-medium text-zinc-400">Run</h2>

      <label className="mb-1 block text-xs font-medium text-zinc-400">
        Trigger payload (JSON, optional)
      </label>
      <textarea
        rows={4}
        className="field-modern font-mono text-sm"
        value={triggerText}
        onChange={(e) => setTriggerText(e.target.value)}
      />
      {triggerError && (
        <p className="mt-1 text-xs text-red-400">{triggerError}</p>
      )}

      {!canRun && (
        <p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
          Add at least one step and click <strong>Save</strong> above before running.
        </p>
      )}

      <div className="mt-3 flex items-center gap-3">
        <Button variant="violet" onClick={onRun} disabled={run.isPending || !canRun}>
          {run.isPending ? 'Starting…' : 'Run workflow'}
        </Button>
        {current && (
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${RUN_STATUS_STYLES[current.status]}`}
          >
            {current.status}
          </span>
        )}
        {current?.source && (
          <span className="inline-block rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs font-medium text-zinc-400">
            {current.source}
          </span>
        )}
      </div>

      {current?.correlationId && (
        <p className="mt-2 font-mono text-xs text-zinc-500">
          corr: {current.correlationId}
          {current.triggerEventId ? ` · event: ${current.triggerEventId}` : ''}
        </p>
      )}

      {run.isError && (
        <p className="mt-2 text-sm text-red-400">
          {run.error?.message ?? 'Could not start run'}
        </p>
      )}
      {current?.error && (
        <p className="mt-2 text-sm text-red-400">{current.error}</p>
      )}

      {runId && (
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-medium text-zinc-400">Run log</h3>
          {steps.length === 0 ? (
            <p className="text-sm text-zinc-500">Waiting for steps…</p>
          ) : (
            <ol className="space-y-2">
              {steps.map((step) => {
                const Icon = NODE_ICONS[step.type as keyof typeof NODE_ICONS];
                const tone = NODE_TONES[step.type as keyof typeof NODE_TONES];
                return (
                  <li
                    key={step.id}
                    className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm font-medium text-white">
                        {Icon && (
                          <span
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${tone ?? 'bg-white/[0.06] text-zinc-400'}`}
                          >
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                        )}
                        {NODE_LABELS[step.type as keyof typeof NODE_LABELS] ??
                          step.type}
                      </span>
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STEP_STATUS_STYLES[step.status]}`}
                      >
                        {step.status}
                      </span>
                    </div>
                    {step.error ? (
                      <p className="mt-1 text-xs text-red-400">{step.error}</p>
                    ) : (
                      step.output != null && (
                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs text-zinc-400">
                          {preview(step.output)}
                        </pre>
                      )
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
