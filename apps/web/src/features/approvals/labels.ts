import type { ApprovalStatus } from '@vaep/types';

/** Tailwind classes for the status badge, keyed by status. */
export const STATUS_STYLES: Record<ApprovalStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
};

/** "PENDING" → "Pending". */
export function formatStatus(status: ApprovalStatus): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}
