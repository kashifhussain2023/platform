import Link from 'next/link';
import { LoginForm } from '@/features/auth/components/LoginForm';

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-2xl font-semibold">Sign in</h1>
        <p className="mb-6 text-sm text-gray-500">
          Welcome back to V-AEP.
        </p>
        <LoginForm />
        <p className="mt-6 text-center text-sm text-gray-500">
          No account?{' '}
          <Link href="/register" className="font-medium text-brand-700">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
