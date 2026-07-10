'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionStore } from '@/stores/session.store';

/**
 * Guest guard for the (auth) routes (/login, /register).
 * If the visitor is already authenticated, send them into the app:
 * onboarded → /dashboard, otherwise → /onboarding. Waits for rehydration.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const status = useSessionStore((s) => s.status);
  const company = useSessionStore((s) => s.company);

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace(company?.onboardedAt ? '/dashboard' : '/onboarding');
    }
  }, [status, company, router]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">
        Loading…
      </div>
    );
  }
  if (status === 'authenticated') return null;
  return <>{children}</>;
}
