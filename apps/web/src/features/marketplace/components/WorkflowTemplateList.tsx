'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { WorkflowDto, WorkflowTemplateDto } from '@vaep/types';
import { Button } from '@/components/ui/Button';
import { useInstallWorkflowTemplate, useMarketplace } from '../hooks';

/** One workflow-template card → Install (optimistic). */
function WorkflowTemplateCard({ template }: { template: WorkflowTemplateDto }) {
  const install = useInstallWorkflowTemplate();
  const [created, setCreated] = useState<WorkflowDto | null>(null);

  const onInstall = () => {
    install.mutate(
      { key: template.key, name: template.name },
      { onSuccess: (workflow) => setCreated(workflow) },
    );
  };

  const stepCount = template.definition.nodes.length;

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium">{template.name}</p>
        <span className="text-xs text-gray-400">{template.category}</span>
      </div>
      <p className="mt-1 text-xs text-gray-500">{template.description}</p>
      <p className="mt-1 text-xs text-gray-400">
        {stepCount} steps: {template.definition.nodes.map((n) => n.type).join(' → ')}
      </p>

      <div className="mt-3">
        <Button variant="ghost" onClick={onInstall} disabled={install.isPending}>
          {install.isPending ? 'Installing…' : 'Install'}
        </Button>
      </div>

      {created && !created.id.startsWith('temp_') && (
        <p className="mt-2 text-xs text-green-700">
          Installed.{' '}
          <Link href={`/workflows/${created.id}`} className="font-medium underline">
            Open workflow →
          </Link>
        </p>
      )}
    </li>
  );
}

/** Workflow Templates section. */
export function WorkflowTemplateList() {
  const { data, isLoading } = useMarketplace();

  if (isLoading) {
    return <p className="text-sm text-gray-500">Loading templates…</p>;
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {(data?.workflows ?? []).map((template) => (
        <WorkflowTemplateCard key={template.key} template={template} />
      ))}
    </ul>
  );
}
