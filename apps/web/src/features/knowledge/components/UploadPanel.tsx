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
    <section className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5 transition-colors hover:border-white/[0.14]">
      <h2 className="mb-1 text-sm font-medium text-zinc-400">Upload documents</h2>
      <p className="mb-4 text-sm text-zinc-500">
        Upload .txt, .md, or .pdf files to add them to your knowledge base.
      </p>
      <label
        className={`inline-flex cursor-pointer items-center justify-center rounded-xl bg-[linear-gradient(135deg,#6a30ec_0%,#5216dd_100%)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_14px_34px_-12px_rgba(91,33,230,0.85)] transition-all hover:-translate-y-0.5 hover:brightness-110 ${
          upload.isPending ? 'cursor-not-allowed opacity-60' : ''
        }`}
      >
        {upload.isPending ? 'Uploading…' : '+ Upload'}
        <input
          type="file"
          className="sr-only"
          accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
          onChange={onChange}
          disabled={upload.isPending}
        />
      </label>
      {upload.isError && (
        <p className="mt-2 text-sm text-red-400">
          {upload.error?.message ?? 'Upload failed'}
        </p>
      )}
    </section>
  );
}
