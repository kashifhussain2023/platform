'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { OnboardingWizard } from '@/features/onboarding/components/OnboardingWizard';
import { useOnboardingStatus } from '@/features/onboarding/hooks';
import { useSessionStore } from '@/stores/session.store';

export default function OnboardingPage() {
  const router = useRouter();
  const accessToken = useSessionStore((s) => s.accessToken);
  const { data: status } = useOnboardingStatus();

  // Client-side route guard (same pattern as the other app pages).
  useEffect(() => {
    if (!accessToken) {
      router.replace('/login');
    }
  }, [accessToken, router]);

  // Already onboarded → skip the wizard.
  useEffect(() => {
    if (status?.completed) {
      router.replace('/dashboard');
    }
  }, [status, router]);

  if (!accessToken || status?.completed) {
    return null;
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <OnboardingWizard />
    </main>
  );
}
