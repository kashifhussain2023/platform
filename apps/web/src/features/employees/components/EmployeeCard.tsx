'use client';

import Link from 'next/link';
import type { AiEmployeeDto, EmployeeStatus } from '@vaep/types';
import { Button } from '@/components/ui/Button';
import { useDeleteEmployee, useUpdateEmployee } from '../hooks';
import { STATUS_STYLES, formatRole } from '../labels';

/** One employee row: identity, status badge, lifecycle toggles, open + delete. */
export function EmployeeCard({ employee }: { employee: AiEmployeeDto }) {
  const update = useUpdateEmployee();
  const del = useDeleteEmployee();
  const isTemp = employee.id.startsWith('temp_');

  const setStatus = (status: EmployeeStatus) =>
    update.mutate({ id: employee.id, data: { status } });

  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{employee.name}</p>
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[employee.status]}`}
          >
            {employee.status}
          </span>
        </div>
        <p className="text-xs text-gray-500">{formatRole(employee.role)}</p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {employee.status === 'ACTIVE' && (
          <Button
            variant="ghost"
            onClick={() => setStatus('PAUSED')}
            disabled={isTemp || update.isPending}
          >
            Pause
          </Button>
        )}
        {employee.status === 'PAUSED' && (
          <Button
            variant="ghost"
            onClick={() => setStatus('ACTIVE')}
            disabled={isTemp || update.isPending}
          >
            Resume
          </Button>
        )}
        {employee.status !== 'DISABLED' ? (
          <Button
            variant="ghost"
            onClick={() => setStatus('DISABLED')}
            disabled={isTemp || update.isPending}
          >
            Disable
          </Button>
        ) : (
          <Button
            variant="ghost"
            onClick={() => setStatus('ACTIVE')}
            disabled={isTemp || update.isPending}
          >
            Enable
          </Button>
        )}
        <Link
          href={`/employees/${employee.id}`}
          className="inline-flex items-center justify-center rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
          aria-disabled={isTemp}
        >
          Chat
        </Link>
        <Button
          variant="ghost"
          onClick={() => del.mutate(employee.id)}
          disabled={isTemp || del.isPending}
        >
          Delete
        </Button>
      </div>
    </li>
  );
}
