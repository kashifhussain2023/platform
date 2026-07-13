'use client';

import { useRouter } from 'next/navigation';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthButton, AuthLink } from '@/components/auth/fields';
import { LockBadge } from '@/components/auth/illustrations';

export default function AccountLockedPage() {
  const router = useRouter();
  return (
    <AuthShell topSlot={<div className="mt-8 flex justify-center"><LockBadge /></div>}>
      <div className="text-center">
        <h1 className="text-[26px] font-bold leading-tight tracking-tight text-white">Account locked</h1>
        <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-zinc-400">
          For your security, your account has been locked due to multiple failed login attempts. Try
          again in 15 minutes or reset your password to regain access.
        </p>
        <div className="mt-7">
          <AuthButton type="button" onClick={() => router.push('/forgot-password')}>
            Reset Password
          </AuthButton>
        </div>
        <p className="mt-5 text-sm">
          <AuthLink href="/login">Back to sign in</AuthLink>
        </p>
      </div>
    </AuthShell>
  );
}
