'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { COMPANY_SIZES } from '@/features/onboarding/labels';
import { Button } from '@/components/ui/Button';
import { useRegister } from '../hooks';
import { registerSchema, type RegisterDto } from '../schemas';

const inputClass = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm';

export function RegisterForm() {
  const router = useRouter();
  const registerMutation = useRegister();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterDto>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      companyName: '',
      name: '',
      email: '',
      password: '',
      industry: '',
      size: '',
      country: '',
      timezone: '',
      website: '',
      logoUrl: '',
      phone: '',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    // Strip empty optional strings so we don't persist "".
    const payload: RegisterDto = {
      companyName: values.companyName,
      name: values.name,
      email: values.email,
      password: values.password,
      industry: values.industry?.trim() || undefined,
      size: values.size || undefined,
      country: values.country?.trim() || undefined,
      timezone: values.timezone?.trim() || undefined,
      website: values.website?.trim() || undefined,
      logoUrl: values.logoUrl?.trim() || undefined,
      phone: values.phone?.trim() || undefined,
    };
    try {
      await registerMutation.mutateAsync(payload);
      // New company → always start the onboarding wizard.
      router.push('/onboarding');
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
        <input id="companyName" className={inputClass} {...register('companyName')} />
        {errors.companyName && (
          <p className="mt-1 text-sm text-red-600">{errors.companyName.message}</p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium">
            Your name
          </label>
          <input
            id="name"
            autoComplete="name"
            className={inputClass}
            {...register('name')}
          />
          {errors.name && (
            <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
          )}
        </div>
        <div>
          <label htmlFor="phone" className="mb-1 block text-sm font-medium">
            Phone <span className="text-gray-400">(optional)</span>
          </label>
          <input
            id="phone"
            autoComplete="tel"
            className={inputClass}
            {...register('phone')}
          />
        </div>
      </div>

      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          Work email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          className={inputClass}
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
          className={inputClass}
          {...register('password')}
        />
        {errors.password && (
          <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
        )}
      </div>

      <fieldset className="space-y-4 rounded-md border border-gray-200 p-4">
        <legend className="px-1 text-xs font-medium text-gray-500">
          Company profile (optional)
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="industry" className="mb-1 block text-sm font-medium">
              Industry
            </label>
            <input id="industry" className={inputClass} {...register('industry')} />
          </div>
          <div>
            <label htmlFor="size" className="mb-1 block text-sm font-medium">
              Company size
            </label>
            <select id="size" className={inputClass} {...register('size')}>
              <option value="">Select…</option>
              {COMPANY_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s} employees
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="country" className="mb-1 block text-sm font-medium">
              Country
            </label>
            <input id="country" className={inputClass} {...register('country')} />
          </div>
          <div>
            <label htmlFor="timezone" className="mb-1 block text-sm font-medium">
              Time zone
            </label>
            <input
              id="timezone"
              className={inputClass}
              placeholder="e.g. Europe/London"
              {...register('timezone')}
            />
          </div>
          <div>
            <label htmlFor="website" className="mb-1 block text-sm font-medium">
              Website
            </label>
            <input
              id="website"
              className={inputClass}
              placeholder="https://…"
              {...register('website')}
            />
          </div>
          <div>
            <label htmlFor="logoUrl" className="mb-1 block text-sm font-medium">
              Company logo URL
            </label>
            <input
              id="logoUrl"
              className={inputClass}
              placeholder="https://…/logo.png"
              {...register('logoUrl')}
            />
          </div>
        </div>
      </fieldset>

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
