import type { Role, UserStatus } from '@vaep/types';

/** Human label for a membership role. */
export const ROLE_LABEL: Record<Role, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MEMBER: 'Member',
};

/** Tailwind badge classes per role. */
export const ROLE_BADGE: Record<Role, string> = {
  OWNER: 'bg-brand-100 text-brand-700',
  ADMIN: 'bg-blue-100 text-blue-700',
  MEMBER: 'bg-gray-100 text-gray-600',
};

/** Human label for an account status. */
export const STATUS_LABEL: Record<UserStatus, string> = {
  ACTIVE: 'Active',
  DISABLED: 'Disabled',
};

/** Tailwind badge classes per status. */
export const STATUS_BADGE: Record<UserStatus, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  DISABLED: 'bg-gray-200 text-gray-500',
};
