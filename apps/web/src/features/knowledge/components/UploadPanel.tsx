'use client';

import type { ChangeEvent } from 'react';
import { useUploadDocument } from '../hooks';

/**
 * Upload control. A <label> wraps a visually-hidden <input type="file">, so the
 * styled button triggers the native picker declaratively — no useRef needed.
 */
export function UploadPanel() {
  const upload = useUploadDocument();

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      upload.mutate(file);
    }
    // Reset so selecting the same file again re-fires onChange.
    e.target.value = '';
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="mb-1 text-sm font-medium text-gray-500">Documents</h2>
      <p className="mb-4 text-sm text-gray-600">
        Upload .txt, .md, or .pdf files to add them to your knowledge base.
      </p>
      <label className="inline-flex cursor-pointer items-center justify-center rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700">
        {upload.isPending ? 'Uploading…' : 'Upload document'}
        <input
          type="file"
          className="sr-only"
          accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
          onChange={onChange}
          disabled={upload.isPending}
        />
      </label>
      {upload.isError && (
        <p className="mt-2 text-sm text-red-600">
          {upload.error?.message ?? 'Upload failed'}
        </p>
      )}
    </section>
  );
}
