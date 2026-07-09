'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import { useRegister } from '../hooks';
import { registerSchema, type RegisterDto } from '../schemas';

export function RegisterForm() {
  const router = useRouter();
  const registerMutation = useRegister();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterDto>({
    resolver: zodResolver(registerSchema),
    defaultValues: { companyName: '', name: '', email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await registerMutation.mutateAsync(values);
      router.push('/dashboard');
    } catch {
      // Error is surfaced below via `registerMutation.error`.
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="companyName" className="mb-1 block text-sm font-medium">
          Company name
        </label>
        <input
          id="companyName"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          {...register('companyName')}
        />
        {errors.companyName && (
          <p className="mt-1 text-sm text-red-600">
            {errors.companyName.message}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="name" className="mb-1 block text-sm font-medium">
          Your name
        </label>
        <input
          id="name"
          autoComplete="name"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          {...register('name')}
        />
        {errors.name && (
          <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          Work email
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
          autoComplete="new-password"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          {...register('password')}
        />
        {errors.password && (
          <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
        )}
      </div>

      {registerMutation.isError && (
        <p className="text-sm text-red-600">
          {registerMutation.error?.message ?? 'Registration failed'}
        </p>
      )}

      <Button
        type="submit"
        className="w-full"
        disabled={isSubmitting || registerMutation.isPending}
      >
        {registerMutation.isPending ? 'Creating…' : 'Create account'}
      </Button>
    </form>
  );
}
