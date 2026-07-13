'use client';

import { AuthShell } from '@/components/auth/AuthShell';
import { AuthButton, OtpInput, ResendCountdown } from '@/components/auth/fields';

export default function VerifyOtpPage() {
  return (
    <AuthShell
      heading="Enter verification code"
      subtitle={
        <>
          We&apos;ve sent a 6-digit code to{' '}
          <span className="font-semibold text-zinc-200">you@company.com</span>
        </>
      }
    >
      <form className="space-y-6" onSubmit={(e) => e.preventDefault()} noValidate>
        <OtpInput />
        <p className="text-center text-sm text-zinc-400">
          Didn&apos;t receive the code? <ResendCountdown seconds={45} />
        </p>
        <AuthButton type="submit">Verify</AuthButton>
      </form>
    </AuthShell>
  );
}
