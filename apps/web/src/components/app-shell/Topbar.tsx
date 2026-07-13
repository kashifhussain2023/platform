'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bell, ChevronDown, LogOut } from 'lucide-react';
import type { UserDto } from '@vaep/types';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'U';
}

/** Top-right utility row: approvals bell + account menu (real logout, unchanged). */
export function Topbar({
  user,
  pendingApprovals,
  onLogout,
  loggingOut,
}: {
  user?: UserDto;
  pendingApprovals: number;
  onLogout: () => void;
  loggingOut: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center justify-end gap-3 px-6 py-5 sm:px-10">
      <Link
        href="/approvals"
        aria-label="Approvals"
        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03] text-zinc-400 transition-colors hover:border-white/20 hover:text-white"
      >
        <Bell className="h-[18px] w-[18px]" />
        {pendingApprovals > 0 && (
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500" />
        )}
      </Link>

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-white/[0.04]"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[linear-gradient(135deg,#6a30ec_0%,#5216dd_100%)] text-xs font-semibold text-white">
            {user?.name ? initials(user.name) : 'U'}
          </span>
          <span className="hidden text-left sm:block">
            <span className="block text-sm font-medium leading-tight text-white">
              {user?.name ?? 'Account'}
            </span>
            <span className="block text-xs capitalize leading-tight text-zinc-500">
              {user?.role?.toLowerCase() ?? ''}
            </span>
          </span>
          <ChevronDown className="h-4 w-4 text-zinc-500" />
        </button>

        {open && (
          <>
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 cursor-default"
            />
            <div className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0b0d18] py-1 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.9)]">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onLogout();
                }}
                disabled={loggingOut}
                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
              >
                <LogOut className="h-4 w-4" />
                {loggingOut ? 'Signing out…' : 'Log out'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
