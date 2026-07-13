'use client';

import { AuthShell } from '@/components/auth/AuthShell';
import { AuthButton, AuthCheckbox, AuthLink, OtpInput } from '@/components/auth/fields';

export default function TwoFactorPage() {
  return (
    <AuthShell
      heading="Two-factor authentication"
      subtitle="Enter the 6-digit code from your authenticator app."
    >
      <form className="space-y-6" onSubmit={(e) => e.preventDefault()} noValidate>
        <OtpInput />
        <AuthCheckbox label="Remember this device for 30 days" />
        <AuthButton type="submit">Verify Code</AuthButton>
      </form>

      <p className="mt-6 text-center text-sm text-zinc-400">
        Can&apos;t access your authenticator? <AuthLink href="/verify-otp">Use backup code</AuthLink>
      </p>
    </AuthShell>
  );
}
