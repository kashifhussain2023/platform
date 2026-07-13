import { RegisterForm } from '@/features/auth/components/RegisterForm';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthLink } from '@/components/auth/fields';

export default function RegisterPage() {
  return (
    <AuthShell heading="Create your account" subtitle="Start your journey with Orlixa">
      <RegisterForm />
      <p className="mt-6 text-center text-sm text-zinc-400">
        Already have an account? <AuthLink href="/login">Sign in</AuthLink>
      </p>
    </AuthShell>
  );
}
