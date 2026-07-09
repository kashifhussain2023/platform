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

/** Permission flags surfaced as checkboxes in the employee Settings panel. */
export const PERMISSION_OPTIONS: readonly { key: string; label: string }[] = [
  { key: 'sendEmail', label: 'Send email' },
  { key: 'contactCustomers', label: 'Contact customers' },
  { key: 'makePayments', label: 'Make payments' },
  { key: 'accessKnowledge', label: 'Access knowledge base' },
];

/** Approval-rule flags surfaced as checkboxes in the employee Settings panel. */
export const APPROVAL_RULE_OPTIONS: readonly { key: string; label: string }[] = [
  { key: 'approveOverBudget', label: 'Require approval over budget' },
  { key: 'approveExternalMessages', label: 'Require approval for external messages' },
  { key: 'approveRefunds', label: 'Require approval for refunds' },
];
