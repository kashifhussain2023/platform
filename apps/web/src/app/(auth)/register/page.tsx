import Link from 'next/link';
import { RegisterForm } from '@/features/auth/components/RegisterForm';

export default function RegisterPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-2xl font-semibold">Create your company</h1>
        <p className="mb-6 text-sm text-gray-500">
          You will be the owner of this workspace.
        </p>
        <RegisterForm />
        <p className="mt-6 text-center text-sm text-gray-500">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-brand-700">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
