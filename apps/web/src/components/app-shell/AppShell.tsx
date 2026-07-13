import type { ReactNode } from 'react';
import type { UserDto } from '@vaep/types';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

/**
 * Shared dark app chrome (sidebar + topbar) for the authenticated product —
 * pixel-matched to the Orlixa dashboard mockup. Pages opt in one at a time;
 * wrap a page's content with this instead of hand-rolling a header.
 */
export function AppShell({
  companyName,
  user,
  pendingApprovals,
  canManageOrg,
  onLogout,
  loggingOut,
  children,
}: {
  companyName?: string;
  user?: UserDto;
  pendingApprovals: number;
  canManageOrg: boolean;
  onLogout: () => void;
  loggingOut: boolean;
  children: ReactNode;
}) {
  return (
    <div className="font-marketing flex min-h-screen bg-[#02030a]">
      <Sidebar companyName={companyName} pendingApprovals={pendingApprovals} canManageOrg={canManageOrg} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} pendingApprovals={pendingApprovals} onLogout={onLogout} loggingOut={loggingOut} />
        <main className="flex-1 px-6 pb-12 sm:px-10">{children}</main>
      </div>
    </div>
  );
}
