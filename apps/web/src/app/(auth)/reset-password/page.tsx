'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthButton, AuthLink, PasswordInput } from '@/components/auth/fields';

const RULES: { label: string; test: (p: string) => boolean }[] = [
  { label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { label: 'One uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'One number', test: (p) => /\d/.test(p) },
  { label: 'One special character', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

export default function ResetPasswordPage() {
  const [pwd, setPwd] = useState('');

  return (
    <AuthShell heading="Set a new password" subtitle="Enter and confirm your new password.">
      <form className="space-y-5" onSubmit={(e) => e.preventDefault()} noValidate>
        <div>
          <label htmlFor="new-pass" className="mb-1.5 block text-sm font-medium text-zinc-300">
            New password
          </label>
          <PasswordInput
            id="new-pass"
            placeholder="Enter new password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="confirm-pass" className="mb-1.5 block text-sm font-medium text-zinc-300">
            Confirm new password
          </label>
          <PasswordInput id="confirm-pass" placeholder="Confirm new password" />
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
          <p className="text-xs font-medium text-zinc-400">Password must contain:</p>
          <ul className="mt-3 space-y-2">
            {RULES.map((r) => {
              const ok = r.test(pwd);
              return (
                <li key={r.label} className="flex items-center gap-2.5 text-sm">
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full ${
                      ok ? 'bg-emerald-500/90' : 'bg-white/[0.08]'
                    }`}
                  >
                    <Check className={`h-3 w-3 ${ok ? 'text-white' : 'text-zinc-600'}`} strokeWidth={3} />
                  </span>
                  <span className={ok ? 'text-zinc-200' : 'text-zinc-500'}>{r.label}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <AuthButton type="submit">Reset Password</AuthButton>
      </form>

      <p className="mt-6 text-center text-sm text-zinc-400">
        Remember your password? <AuthLink href="/login">Sign in</AuthLink>
      </p>
    </AuthShell>
  );
}
