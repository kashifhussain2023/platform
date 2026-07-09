'use client';

import type { AnalyticsRange } from '@vaep/types';
import { useActivityFeed } from '../hooks';
import { formatNumber } from '../labels';

/** "Today's AI Activity": per employee, grouped skill/tool + message counts. */
export function ActivityPanel({ range }: { range: AnalyticsRange }) {
  const { data: feed, isLoading } = useActivityFeed(range);

  if (isLoading) {
    return <p className="text-sm text-gray-500">Loading activity…</p>;
  }
  if (!feed || feed.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No AI activity in this window yet. Actions your employees take will show
        up here.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {feed.map((entry) => (
        <li
          key={entry.employeeId}
          className="rounded-lg border border-gray-200 bg-white p-4"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium text-gray-900">{entry.employee}</span>
            <span className="text-xs text-gray-400">{entry.role}</span>
          </div>
          <ul className="flex flex-wrap gap-2">
            {entry.items.map((item) => (
              <li
                key={item.label}
                className="inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-2.5 py-1 text-xs text-gray-600"
              >
                <span>{item.label}</span>
                <span className="font-semibold text-gray-900">
                  {formatNumber(item.count)}
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
