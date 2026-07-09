'use client';

import { useState } from 'react';
import type { TriggerType, WorkflowDto } from '@vaep/types';
import { Button } from '@/components/ui/Button';
import {
  useActivateWorkflow,
  useDeactivateWorkflow,
  useUpdateWorkflow,
} from '../hooks';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const TRIGGER_OPTIONS: { value: TriggerType; label: string; hint: string }[] = [
  { value: 'MANUAL', label: 'Manual', hint: 'Run on demand from the Run panel.' },
  {
    value: 'SCHEDULE',
    label: 'Schedule',
    hint: 'Run automatically on a fixed interval.',
  },
  {
    value: 'WEBHOOK',
    label: 'Webhook',
    hint: 'Run when an external system POSTs to a secret URL.',
  },
  {
    value: 'EVENT',
    label: 'Event',
    hint: 'Run when a matching internal platform event fires.',
  },
];

/** Minutes from a stored everyMs (default 5). */
function initialMinutes(workflow: WorkflowDto): number {
  const everyMs = workflow.triggerConfig?.everyMs;
  return typeof everyMs === 'number' && everyMs > 0
    ? Math.max(1, Math.round(everyMs / 60_000))
    : 5;
}

/**
 * Trigger + activation controls for the workflow editor. Choose a trigger type,
 * configure it (interval / eventType / webhook URL), Save it (optimistic
 * update), then Activate / Deactivate. Activate is disabled until the workflow
 * has a runnable step (reuses the same guard as the Run panel).
 */
export function TriggerPanel({
  workflow,
  canActivate,
}: {
  workflow: WorkflowDto;
  /** False when the saved workflow has only a TRIGGER (no runnable steps). */
  canActivate: boolean;
}) {
  const [triggerType, setTriggerType] = useState<TriggerType>(
    workflow.triggerType,
  );
  const [minutes, setMinutes] = useState<number>(() =>
    initialMinutes(workflow),
  );
  const [eventType, setEventType] = useState<string>(
    workflow.triggerConfig?.eventType ?? '',
  );
  const [copied, setCopied] = useState(false);

  const update = useUpdateWorkflow();
  const activate = useActivateWorkflow();
  const deactivate = useDeactivateWorkflow();

  const isActive = workflow.status === 'ACTIVE';
  const webhookUrl = workflow.webhookToken
    ? `${API_URL}/workflows/webhooks/${workflow.webhookToken}`
    : null;

  const onSaveTrigger = () => {
    const triggerConfig =
      triggerType === 'SCHEDULE'
        ? { everyMs: Math.max(1, minutes) * 60_000 }
        : triggerType === 'EVENT'
          ? { eventType: eventType.trim() }
          : undefined;
    update.mutate({ id: workflow.id, data: { triggerType, triggerConfig } });
  };

  const onCopy = async () => {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — the URL is still shown.
    }
  };

  const saveDisabled =
    update.isPending ||
    (triggerType === 'EVENT' && eventType.trim().length === 0);

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-gray-500">Trigger</h2>
        <span
          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
            isActive ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'
          }`}
        >
          {workflow.status}
        </span>
      </div>

      <label className="mb-1 block text-xs font-medium text-gray-600">
        How should this workflow start?
      </label>
      <select
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        value={triggerType}
        onChange={(e) => setTriggerType(e.target.value as TriggerType)}
      >
        {TRIGGER_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-gray-500">
        {TRIGGER_OPTIONS.find((o) => o.value === triggerType)?.hint}
      </p>

      {triggerType === 'SCHEDULE' && (
        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Run every (minutes)
          </label>
          <input
            type="number"
            min={1}
            className="w-32 rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
          />
        </div>
      )}

      {triggerType === 'EVENT' && (
        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Event type
          </label>
          <input
            type="text"
            placeholder="e.g. new_resume"
            className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
          />
        </div>
      )}

      {triggerType === 'WEBHOOK' && (
        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Webhook URL
          </label>
          {webhookUrl ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-700">
                {webhookUrl}
              </code>
              <Button variant="ghost" onClick={onCopy}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          ) : (
            <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500">
              Save the webhook trigger and Activate to generate a secret URL.
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={onSaveTrigger} disabled={saveDisabled}>
          {update.isPending ? 'Saving…' : 'Save trigger'}
        </Button>
        {isActive ? (
          <Button
            onClick={() => deactivate.mutate(workflow.id)}
            disabled={deactivate.isPending}
          >
            {deactivate.isPending ? 'Deactivating…' : 'Deactivate'}
          </Button>
        ) : (
          <Button
            onClick={() => activate.mutate(workflow.id)}
            disabled={!canActivate || activate.isPending}
          >
            {activate.isPending ? 'Activating…' : 'Activate'}
          </Button>
        )}
      </div>

      {!canActivate && !isActive && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Add at least one step and <strong>Save</strong> it before activating.
        </p>
      )}
      {activate.isError && (
        <p className="mt-2 text-sm text-red-600">
          {activate.error?.message ?? 'Could not activate'}
        </p>
      )}
      {update.isError && (
        <p className="mt-2 text-sm text-red-600">
          {update.error?.message ?? 'Could not save trigger'}
        </p>
      )}
    </section>
  );
}
