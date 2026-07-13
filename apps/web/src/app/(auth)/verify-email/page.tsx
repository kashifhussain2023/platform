import { AuthShell } from '@/components/auth/AuthShell';
import { AuthLink } from '@/components/auth/fields';
import { EnvelopeCheck } from '@/components/auth/illustrations';

export default function VerifyEmailPage() {
  return (
    <AuthShell topSlot={<div className="mt-8 flex justify-center"><EnvelopeCheck /></div>}>
      <div className="text-center">
        <h1 className="text-[26px] font-bold leading-tight tracking-tight text-white">Verify your email</h1>
        <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-zinc-400">
          We&apos;ve sent a verification link to{' '}
          <span className="font-semibold text-zinc-200">&ldquo;you@company.com&rdquo;</span>. Please
          check your inbox and click the link to verify your email address.
        </p>
        <p className="mt-8 text-sm text-zinc-400">
          Didn&apos;t receive the email? <AuthLink href="/verify-email">Resend</AuthLink>
        </p>
      </div>
    </AuthShell>
  );
}
