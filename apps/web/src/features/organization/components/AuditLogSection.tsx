'use client';

import type { AuditLogDto } from '@vaep/types';
import { useAuditLog } from '../hooks';

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function AuditLogRow({ entry }: { entry: AuditLogDto }) {
  return (
    <li className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-white">
          {entry.actorName ?? 'Unknown user'}{' '}
          <span className="font-normal text-zinc-400">{entry.action}</span>
        </p>
        <p className="truncate text-xs text-zinc-500">
          {entry.entityType}
          {entry.entityId ? ` · ${entry.entityId}` : ''}
        </p>
      </div>
      <span className="shrink-0 text-xs text-zinc-500">
        {formatWhen(entry.createdAt)}
      </span>
    </li>
  );
}

/**
 * Read-only who-did-what feed (founder-audit edge-case recheck, 2026-07-19):
 * the backend (`GET /audit-log`, OWNER/ADMIN only) existed since Phase 2 but
 * had no screen -- only reachable via a direct API call. This is the
 * minimal viewer: a plain list, newest first (server order), no filtering
 * yet.
 */
export function AuditLogSection() {
  const { data, isLoading, isError } = useAuditLog();

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6">
        <p className="text-sm text-zinc-500">Loading audit log…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6">
        <p className="text-sm text-red-400">Could not load the audit log.</p>
      </div>
    );
  }

  const entries = data ?? [];

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02]">
      <div className="border-b border-white/[0.06] px-5 py-4">
        <h2 className="text-sm font-medium text-white">Audit Log</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Who changed what — role changes, workflow edits, skill installs, and
          security policy updates.
        </p>
      </div>
      {entries.length === 0 ? (
        <p className="px-5 py-6 text-sm text-zinc-500">
          No activity recorded yet.
        </p>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {entries.map((entry) => (
            <AuditLogRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </div>
  );
}
