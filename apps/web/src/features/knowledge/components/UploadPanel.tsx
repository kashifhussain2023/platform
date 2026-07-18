'use client';

import { useState, type ChangeEvent } from 'react';
import { formatRole } from '@/features/employees/labels';
import { EMPLOYEE_ROLES, type EmployeeRole } from '../schemas';
import { useUploadDocument } from '../hooks';

/**
 * Upload control. A <label> wraps a visually-hidden <input type="file">, so the
 * styled button triggers the native picker declaratively — no useRef needed.
 *
 * `defaultCategory` (an AI Employee's own role, when rendered from that
 * employee's "Knowledge" tab) is pre-selected so day-to-day uploads need no
 * manual tagging step; the global `/knowledge` page renders this with no
 * `defaultCategory`, defaulting new uploads to Shared, with a dropdown to
 * pick a specific role instead.
 */
export function UploadPanel({ defaultCategory }: { defaultCategory?: EmployeeRole } = {}) {
  const upload = useUploadDocument();
  const [category, setCategory] = useState<EmployeeRole | ''>(defaultCategory ?? '');

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      upload.mutate({ file, category: category === '' ? undefined : category });
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
      <label htmlFor="upload-category" className="mb-1 block text-xs font-medium text-zinc-500">
        Visible to
      </label>
      <select
        id="upload-category"
        className="field-modern mb-4 w-full"
        value={category}
        onChange={(e) => setCategory(e.target.value as EmployeeRole | '')}
      >
        <option value="">Shared (everyone)</option>
        {EMPLOYEE_ROLES.map((role) => (
          <option key={role} value={role}>
            {formatRole(role)}
          </option>
        ))}
      </select>
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
