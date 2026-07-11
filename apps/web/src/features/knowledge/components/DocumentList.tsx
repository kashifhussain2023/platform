'use client';

import type { DocumentStatus } from '@vaep/types';
import { Button } from '@/components/ui/Button';
import { useDeleteDocument, useDocuments, useViewDocument } from '../hooks';

const STATUS_STYLES: Record<DocumentStatus, string> = {
  PENDING: 'bg-gray-100 text-gray-600',
  PROCESSING: 'bg-amber-100 text-amber-700',
  READY: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
};

function StatusBadge({ status }: { status: DocumentStatus }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

export function DocumentList() {
  const { data: docs, isLoading } = useDocuments();
  const del = useDeleteDocument();
  const view = useViewDocument();

  if (isLoading) {
    return <p className="text-sm text-gray-500">Loading documents…</p>;
  }

  if (!docs || docs.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No documents yet. Upload one to get started.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
      {docs.map((doc) => {
        const isTemp = doc.id.startsWith('temp_');
        return (
          <li
            key={doc.id}
            className="flex items-center justify-between gap-4 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{doc.filename}</p>
              <p className="text-xs text-gray-500">
                {doc.status === 'READY'
                  ? `${doc.chunkCount} chunk${doc.chunkCount === 1 ? '' : 's'}`
                  : doc.status === 'FAILED'
                    ? (doc.error ?? 'Ingestion failed')
                    : 'Processing…'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <StatusBadge status={doc.status} />
              <Button
                variant="ghost"
                onClick={() => view.mutate(doc.id)}
                disabled={isTemp || view.isPending}
              >
                View
              </Button>
              <Button
                variant="ghost"
                onClick={() => del.mutate(doc.id)}
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
