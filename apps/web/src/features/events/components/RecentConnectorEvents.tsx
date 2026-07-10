'use client';

import { useConnectorEvents } from '../hooks';
import { formatEventType } from '../labels';

/**
 * Read-only "Recent Events" panel for one connector: lists the normalized
 * canonical events (type + time), newest first. Lightly polls via the hook so a
 * freshly-ingested webhook appears without a manual refresh.
 */
export function RecentConnectorEvents({ connectorId }: { connectorId: string }) {
  const { data: events, isLoading, isError } = useConnectorEvents(connectorId);

  if (isLoading) {
    return <p className="text-xs text-gray-500">Loading events…</p>;
  }
  if (isError) {
    return <p className="text-xs text-red-600">Could not load events.</p>;
  }
  if (!events || events.length === 0) {
    return (
      <p className="text-xs text-gray-500">
        No events yet. Incoming provider webhooks will appear here once received.
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {events.map((e) => (
        <li
          key={e.id}
          className="flex items-center justify-between gap-2 rounded border border-gray-100 bg-white px-2 py-1 text-xs"
        >
          <span className="inline-block rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-700">
            {formatEventType(e.type)}
          </span>
          <span className="text-gray-400">
            {new Date(e.receivedAt).toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  );
}
