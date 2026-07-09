'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import { useLogin } from '../hooks';
import { loginSchema, type LoginDto } from '../schemas';

export function LoginForm() {
  const router = useRouter();
  const login = useLogin();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginDto>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login.mutateAsync(values);
      router.push('/dashboard');
    } catch {
      // Error is surfaced below via `login.error`.
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          {...register('email')}
        />
        {errors.email && (
          <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          {...register('password')}
        />
        {errors.password && (
          <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
        )}
      </div>

      {login.isError && (
        <p className="text-sm text-red-600">
          {login.error?.message ?? 'Login failed'}
        </p>
      )}

      <Button
        type="submit"
        className="w-full"
        disabled={isSubmitting || login.isPending}
      >
        {login.isPending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
