import type { SlotStatus } from '@vaep/types';

/** Tailwind classes for the status badge, keyed by status. */
export const STATUS_STYLES: Record<SlotStatus, string> = {
  OPEN: 'bg-blue-500/15 text-blue-400',
  BOOKED: 'bg-green-500/15 text-green-400',
  CANCELLED: 'bg-white/[0.06] text-zinc-500',
};

/** "OPEN" → "Open". */
export function formatStatus(status: SlotStatus): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}
