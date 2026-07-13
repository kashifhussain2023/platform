'use client';

import { ChevronRight, File, FileCode, FileText, type LucideIcon } from 'lucide-react';
import type { DocumentStatus } from '@vaep/types';
import { useDeleteDocument, useDocuments, useViewDocument } from '../hooks';

const STATUS_STYLES: Record<DocumentStatus, string> = {
  PENDING: 'bg-white/[0.06] text-zinc-400',
  PROCESSING: 'bg-amber-500/15 text-amber-400',
  READY: 'bg-green-500/15 text-green-400',
  FAILED: 'bg-red-500/15 text-red-400',
};

function StatusBadge({ status }: { status: DocumentStatus }) {
  return (
    <span
      className={`inline-block shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

/** Icon + accent chip + short label derived from the document's real mimeType. */
function fileTypeMeta(mimeType: string): { label: string; Icon: LucideIcon; chip: string } {
  if (mimeType === 'application/pdf') {
    return { label: 'PDF', Icon: FileText, chip: 'bg-red-500/15 text-red-400' };
  }
  if (mimeType === 'text/markdown') {
    return { label: 'Markdown', Icon: FileCode, chip: 'bg-sky-500/15 text-sky-400' };
  }
  if (mimeType === 'text/plain') {
    return { label: 'Text', Icon: File, chip: 'bg-green-500/15 text-green-400' };
  }
  return { label: mimeType, Icon: File, chip: 'bg-white/[0.06] text-zinc-400' };
}

export function DocumentList() {
  const { data: docs, isLoading } = useDocuments();
  const del = useDeleteDocument();
  const view = useViewDocument();

  if (isLoading) {
    return <p className="text-sm text-zinc-500">Loading documents…</p>;
  }

  if (!docs || docs.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        No documents yet. Upload one to get started.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02]">
      {docs.map((doc) => {
        const isTemp = doc.id.startsWith('temp_');
        const { label, Icon, chip } = fileTypeMeta(doc.mimeType);
        const detail =
          doc.status === 'READY'
            ? `${doc.chunkCount} chunk${doc.chunkCount === 1 ? '' : 's'}`
            : doc.status === 'FAILED'
              ? (doc.error ?? 'Ingestion failed')
              : 'Processing…';

        return (
          <li
            key={doc.id}
            className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-white/[0.02]"
          >
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${chip}`}
            >
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">
                {doc.filename}
              </p>
              <p className="mt-0.5 truncate text-xs text-zinc-500">
                {label} · {detail}
              </p>
            </div>
            <StatusBadge status={doc.status} />
            <div className="flex shrink-0 items-center gap-3">
              <button
                type="button"
                onClick={() => view.mutate(doc.id)}
                disabled={isTemp || view.isPending}
                className="text-xs font-medium text-zinc-400 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                View
              </button>
              <button
                type="button"
                onClick={() => del.mutate(doc.id)}
                disabled={isTemp || del.isPending}
                className="text-xs font-medium text-zinc-500 transition-colors hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Delete
              </button>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600" aria-hidden />
          </li>
        );
      })}
    </ul>
  );
}
