import type { EmployeeStatus, EmployeeRole } from '@vaep/types';

/** SUPPORT → "Support", PROJECT_MANAGER → "Project manager". */
export function formatRole(role: EmployeeRole): string {
  return role
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

/** Tailwind classes for the status badge, keyed by status. */
export const STATUS_STYLES: Record<EmployeeStatus, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  PAUSED: 'bg-amber-100 text-amber-700',
  DISABLED: 'bg-gray-200 text-gray-600',
};
