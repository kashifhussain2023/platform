import type { AiEmployeeDto } from '@vaep/types';
import { formatRole } from '../labels';

function AboutRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-white">{value}</p>
    </div>
  );
}

/**
 * Read-only "About" summary for the employee detail Overview tab — built only
 * from real `AiEmployeeDto` fields (no invented data like cost/model pricing).
 */
export function EmployeeAbout({ employee }: { employee: AiEmployeeDto }) {
  const workingHours =
    employee.workingHoursStart && employee.workingHoursEnd
      ? `${employee.workingHoursStart} – ${employee.workingHoursEnd}`
      : '—';
  const knowledgeAccess =
    employee.knowledgeAccess === 'ALL' ? 'All company knowledge' : 'No knowledge access';
  const budget =
    employee.budgetLimit != null
      ? `$${(employee.monthToDateCostUsd ?? 0).toFixed(2)} spent of $${employee.budgetLimit.toLocaleString()} this month (estimated)`
      : '—';
  const created = new Date(employee.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
      <h2 className="mb-4 text-sm font-medium text-white">About</h2>
      <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        <AboutRow label="Role" value={formatRole(employee.role)} />
        <AboutRow label="Department" value={employee.department ?? '—'} />
        <AboutRow label="Manager" value={employee.managerName ?? '—'} />
        <AboutRow label="Working hours" value={workingHours} />
        <AboutRow label="Timezone" value={employee.timezone ?? '—'} />
        <AboutRow label="Language" value={employee.language ?? '—'} />
        <AboutRow label="Model" value={employee.model ?? '—'} />
        <AboutRow label="Knowledge access" value={knowledgeAccess} />
        <AboutRow label="Budget limit" value={budget} />
        <AboutRow label="Created" value={created} />
      </div>
      {employee.persona && (
        <div className="mt-5 border-t border-white/[0.06] pt-4">
          <p className="text-xs text-zinc-500">Persona</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-300">{employee.persona}</p>
        </div>
      )}
    </div>
  );
}
