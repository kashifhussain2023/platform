'use client';

import { useRouter } from 'next/navigation';
import { useApprovals } from '@/features/approvals/hooks';
import { useCurrentUser, useLogout } from '@/features/auth/hooks';
import { useCurrentCompany } from '@/features/tenant/hooks';

/**
 * Shared session/approvals/logout wiring for every page that renders
 * `<AppShell>` — keeps that boilerplate out of each page component.
 */
export function useAppShellProps() {
  const router = useRouter();
  const { data: me } = useCurrentUser();
  const { data: company } = useCurrentCompany();
  const { data: pendingApprovals } = useApprovals('PENDING');
  const logout = useLogout();

  const user = me?.user;
  const activeCompany = company ?? me?.company;
  // Organization (departments/teams/security policy) is an OWNER/ADMIN area.
  const canManageOrg = user?.role === 'OWNER' || user?.role === 'ADMIN';

  const onLogout = async () => {
    await logout.mutateAsync();
    router.replace('/login');
  };

  return {
    companyName: activeCompany?.name,
    user,
    pendingApprovals: pendingApprovals?.length ?? 0,
    canManageOrg,
    onLogout,
    loggingOut: logout.isPending,
  };
}
