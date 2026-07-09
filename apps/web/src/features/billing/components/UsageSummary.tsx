'use client';

import Link from 'next/link';
import { useUsage } from '../hooks';
import { formatLimit, formatNumber } from '../labels';

/** Usage summary: employees vs limit (with soft over-limit hint), skills, tasks. */
export function UsageSummary() {
  const { data: usage, isLoading } = useUsage();

  if (isLoading || !usage) {
    return <p className="text-sm text-gray-500">Loading usage…</p>;
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-sm font-medium text-gray-500">AI employees</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900 tabular-nums">
            {formatNumber(usage.employees)}
            <span className="text-sm font-normal text-gray-400">
              {' '}
              / {formatLimit(usage.maxEmployees)}
            </span>
          </p>
        </div>
        <div>
          <p className="text-sm font-medium text-gray-500">Installed skills</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900 tabular-nums">
            {formatNumber(usage.installedSkills)}
          </p>
        </div>
        <div>
          <p className="text-sm font-medium text-gray-500">Tasks</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900 tabular-nums">
            {formatNumber(usage.tasks)}
          </p>
          <p className="mt-0.5 text-xs text-gray-400">
            tools + messages + workflows
          </p>
        </div>
      </div>

      {usage.overEmployeeLimit && (
        <div className="mt-4 flex items-center justify-between rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>
            You&rsquo;re over your plan&rsquo;s AI employee limit
            {usage.maxEmployees !== null
              ? ` (${formatNumber(usage.employees)} of ${formatNumber(usage.maxEmployees)})`
              : ''}
            . Upgrade for more capacity.
          </span>
          <Link
            href="#plans"
            className="font-semibold text-amber-900 underline underline-offset-2"
          >
            Upgrade
          </Link>
        </div>
      )}

      <p className="mt-4 text-xs text-gray-400">
        Token &amp; voice-minute metering is coming soon.
      </p>
    </div>
  );
}
