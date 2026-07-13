'use client';

import { Mail } from 'lucide-react';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthButton, AuthLink, IconInput } from '@/components/auth/fields';
import { PaperPlane } from '@/components/auth/illustrations';

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      heading="Forgot your password?"
      subtitle="No worries! Enter your email and we'll send you a link to reset your password."
    >
      <form className="space-y-5" onSubmit={(e) => e.preventDefault()} noValidate>
        <div>
          <label htmlFor="fp-email" className="mb-1.5 block text-sm font-medium text-zinc-300">
            Work email
          </label>
          <IconInput id="fp-email" icon={Mail} type="email" placeholder="you@company.com" />
        </div>
        <AuthButton type="submit">Send Reset Link</AuthButton>
      </form>

      <p className="mt-6 text-center text-sm text-zinc-400">
        Remember your password? <AuthLink href="/login">Sign in</AuthLink>
      </p>

      <div aria-hidden className="pointer-events-none mt-8">
        <PaperPlane />
      </div>
    </AuthShell>
  );
}
