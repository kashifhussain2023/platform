import type { EmployeeRole } from '@vaep/types';

/** Tailwind classes for the employee-role badge, keyed by role. */
export const ROLE_STYLES: Record<EmployeeRole, string> = {
  SUPPORT: 'bg-blue-100 text-blue-700',
  SALES: 'bg-green-100 text-green-700',
  RECRUITER: 'bg-purple-100 text-purple-700',
  HR: 'bg-pink-100 text-pink-700',
  ACCOUNTANT: 'bg-amber-100 text-amber-700',
  PROJECT_MANAGER: 'bg-teal-100 text-teal-700',
  CUSTOM: 'bg-gray-200 text-gray-700',
};

/** "PROJECT_MANAGER" → "Project manager". */
export function formatRole(role: EmployeeRole): string {
  const lower = role.replace(/_/g, ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
