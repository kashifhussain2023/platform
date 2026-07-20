import type { SkillCategory, SkillConnectionStatus } from '@vaep/types';

/** Tailwind classes for the category badge, keyed by category (dark theme). */
export const CATEGORY_STYLES: Record<SkillCategory, string> = {
  communication: 'bg-blue-500/15 text-blue-400',
  payments: 'bg-purple-500/15 text-purple-400',
  development: 'bg-zinc-500/20 text-zinc-300',
  utility: 'bg-teal-500/15 text-teal-400',
  crm: 'bg-amber-500/15 text-amber-400',
  productivity: 'bg-green-500/15 text-green-400',
  marketing: 'bg-pink-500/15 text-pink-400',
  support: 'bg-cyan-500/15 text-cyan-400',
  project_management: 'bg-orange-500/15 text-orange-400',
};

/** "communication" → "Communication" ("crm" → "CRM", "project_management" → "Project Management"). */
export function formatCategory(category: SkillCategory): string {
  if (category === 'crm') return 'CRM';
  if (category === 'project_management') return 'Project Management';
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/** Tailwind classes for the connection/health-status badge (dark theme). */
export const CONNECTION_STATUS_STYLES: Record<SkillConnectionStatus, string> = {
  CONNECTED: 'bg-green-500/15 text-green-400',
  NOT_CONNECTED: 'bg-white/[0.06] text-zinc-400',
  DEGRADED: 'bg-amber-500/15 text-amber-400',
  DISCONNECTED: 'bg-red-500/15 text-red-400',
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
