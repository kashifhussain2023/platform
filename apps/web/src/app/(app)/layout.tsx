'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSessionStore } from '@/stores/session.store';

function FullScreen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">
      {children}
    </div>
  );
}

/**
 * Auth guard for all protected (app) routes.
 * - waits for session rehydration (`status === 'loading'`) before deciding
 * - guests → /login
 * - authenticated but onboarding incomplete → force the wizard (/onboarding)
 * - authenticated + onboarded but sitting on /onboarding → /dashboard
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const status = useSessionStore((s) => s.status);
  const company = useSessionStore((s) => s.company);
  const onboarded = Boolean(company?.onboardedAt);
  const onOnboarding = pathname === '/onboarding';

  useEffect(() => {
    if (status === 'guest') {
      router.replace('/login');
    } else if (status === 'authenticated') {
      if (!onboarded && !onOnboarding) router.replace('/onboarding');
      else if (onboarded && onOnboarding) router.replace('/dashboard');
    }
  }, [status, onboarded, onOnboarding, router]);

  if (status === 'loading') return <FullScreen>Loading your workspace…</FullScreen>;
  if (status === 'guest') return null;
  // A redirect is pending — render nothing to avoid a flash of the wrong page.
  if (!onboarded && !onOnboarding) return null;
  if (onboarded && onOnboarding) return null;
  return <>{children}</>;
}
