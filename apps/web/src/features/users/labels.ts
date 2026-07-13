import type { Role, UserStatus } from '@vaep/types';

/** Human label for a membership role. */
export const ROLE_LABEL: Record<Role, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MEMBER: 'Member',
};

/** Tailwind badge classes per role (dark theme, soft-fill pill). */
export const ROLE_BADGE: Record<Role, string> = {
  OWNER: 'bg-violet/15 text-violet-secondary',
  ADMIN: 'bg-blue-500/15 text-blue-400',
  MEMBER: 'bg-white/[0.06] text-zinc-400',
};

/** Human label for an account status. */
export const STATUS_LABEL: Record<UserStatus, string> = {
  ACTIVE: 'Active',
  DISABLED: 'Disabled',
};

/** Tailwind badge classes per status (dark theme, outlined pill). */
export const STATUS_BADGE: Record<UserStatus, string> = {
  ACTIVE: 'border border-green-500/40 text-green-400',
  DISABLED: 'border border-white/20 text-zinc-500',
};
