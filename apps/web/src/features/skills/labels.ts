import type { SkillCategory, SkillConnectionStatus } from '@vaep/types';

/** Tailwind classes for the category badge, keyed by category. */
export const CATEGORY_STYLES: Record<SkillCategory, string> = {
  communication: 'bg-blue-100 text-blue-700',
  payments: 'bg-purple-100 text-purple-700',
  development: 'bg-gray-200 text-gray-700',
  utility: 'bg-teal-100 text-teal-700',
  crm: 'bg-amber-100 text-amber-700',
  productivity: 'bg-green-100 text-green-700',
};

/** "communication" → "Communication". */
export function formatCategory(category: SkillCategory): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/** Tailwind classes for the connection/health-status badge. */
export const CONNECTION_STATUS_STYLES: Record<SkillConnectionStatus, string> = {
  CONNECTED: 'bg-green-100 text-green-700',
  NOT_CONNECTED: 'bg-gray-100 text-gray-500',
  DEGRADED: 'bg-amber-100 text-amber-700',
  DISCONNECTED: 'bg-red-100 text-red-700',
};

/** Human label for a connection/health status, e.g. "NOT_CONNECTED" → "Not connected". */
const CONNECTION_STATUS_LABELS: Record<SkillConnectionStatus, string> = {
  CONNECTED: 'Connected',
  NOT_CONNECTED: 'Not connected',
  DEGRADED: 'Degraded',
  DISCONNECTED: 'Disconnected',
};

export function formatConnectionStatus(status: SkillConnectionStatus): string {
  return CONNECTION_STATUS_LABELS[status] ?? status;
}
