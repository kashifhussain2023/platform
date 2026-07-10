'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { InstalledSkillList } from '@/features/skills/components/InstalledSkillList';
import { SkillCatalog } from '@/features/skills/components/SkillCatalog';
import { skillKeys } from '@/features/skills/hooks';
import { useSessionStore } from '@/stores/session.store';

export default function SkillsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const accessToken = useSessionStore((s) => s.accessToken);
  const [banner, setBanner] = useState<
    { kind: 'ok' | 'error'; text: string } | null
  >(null);

  // Client-side route guard, same pattern as the knowledge page.
  useEffect(() => {
    if (!accessToken) {
      router.replace('/login');
    }
  }, [accessToken, router]);

  // Handle the OAuth callback return: /skills?connected=<skillKey> (success) or
  // /skills?error=<message>. Show a banner, refresh the installed list (the skill
  // is now CONNECTED), then strip the query params.
  const connected = searchParams.get('connected');
  const oauthError = searchParams.get('error');
  useEffect(() => {
    if (connected) {
      setBanner({ kind: 'ok', text: `Connected ${connected}.` });
      void qc.invalidateQueries({ queryKey: skillKeys.installed });
      router.replace('/skills');
    } else if (oauthError) {
      setBanner({ kind: 'error', text: `Connection failed: ${oauthError}` });
      router.replace('/skills');
    }
  }, [connected, oauthError, qc, router]);

  if (!accessToken) {
    return null;
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">Integrations</p>
          <h1 className="text-2xl font-semibold">Skills</h1>
        </div>
        <Link href="/dashboard" className="text-sm font-medium text-brand-700">
          ← Dashboard
        </Link>
      </header>

      {banner && (
        <div
          className={`mb-6 rounded-md border px-4 py-2 text-sm ${
            banner.kind === 'ok'
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {banner.text}
        </div>
      )}

      <div className="space-y-6">
        <SkillCatalog />
        <div>
          <h2 className="mb-3 text-sm font-medium text-gray-500">
            Installed skills
          </h2>
          <InstalledSkillList />
        </div>
      </div>
    </main>
  );
}
