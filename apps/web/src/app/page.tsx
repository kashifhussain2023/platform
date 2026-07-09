import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-4xl font-bold tracking-tight">
        Vertical AI Employee Platform
      </h1>
      <p className="text-lg text-gray-600">
        Hire managed AI Employees for your business — onboard your company to get
        started.
      </p>
      <div className="flex gap-3">
        <Link
          href="/register"
          className="rounded-md bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          Create account
        </Link>
        <Link
          href="/login"
          className="rounded-md border border-gray-300 px-5 py-2.5 text-sm font-medium hover:bg-gray-100"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
