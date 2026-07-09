'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { AiEmployeeDto, EmployeeTemplateDto } from '@vaep/types';
import { Button } from '@/components/ui/Button';
import { useInstallEmployeeTemplate, useMarketplace } from '../hooks';
import { ROLE_STYLES, formatRole } from '../labels';

/** One template card with an optional name field + Install (optimistic). */
function EmployeeTemplateCard({ template }: { template: EmployeeTemplateDto }) {
  const install = useInstallEmployeeTemplate();
  const [name, setName] = useState('');
  const [created, setCreated] = useState<AiEmployeeDto | null>(null);

  const onInstall = () => {
    install.mutate(
      { key: template.key, data: { name: name.trim() || undefined }, name: template.name },
      { onSuccess: (employee) => setCreated(employee) },
    );
  };

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium">{template.name}</p>
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_STYLES[template.role]}`}
        >
          {formatRole(template.role)}
        </span>
        <span className="text-xs text-gray-400">{template.category}</span>
      </div>
      <p className="mt-1 text-xs text-gray-500">{template.description}</p>
      {template.suggestedSkills.length > 0 && (
        <p className="mt-1 text-xs text-gray-400">
          Suggested skills: {template.suggestedSkills.join(', ')}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={template.name}
          className="w-40 rounded-md border border-gray-300 px-2 py-1 text-sm"
        />
        <Button variant="ghost" onClick={onInstall} disabled={install.isPending}>
          {install.isPending ? 'Hiring…' : 'Install'}
        </Button>
      </div>

      {created && !created.id.startsWith('temp_') && (
        <p className="mt-2 text-xs text-green-700">
          Hired {created.name}.{' '}
          <Link href={`/employees/${created.id}`} className="font-medium underline">
            Open employee →
          </Link>
        </p>
      )}
    </li>
  );
}

/** AI Employee templates section. */
export function EmployeeTemplateList() {
  const { data, isLoading } = useMarketplace();

  if (isLoading) {
    return <p className="text-sm text-gray-500">Loading templates…</p>;
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {(data?.employees ?? []).map((template) => (
        <EmployeeTemplateCard key={template.key} template={template} />
      ))}
    </ul>
  );
}
