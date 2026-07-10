'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import { useCreateUser, useCurrentRole } from '../hooks';
import { ROLE_LABEL } from '../labels';
import { createUserSchema, type CreateUserDto, type Role } from '../schemas';

// An ADMIN may only create MEMBER/ADMIN; only an OWNER may create an OWNER.
const ADMIN_ASSIGNABLE: Role[] = ['MEMBER', 'ADMIN'];
const OWNER_ASSIGNABLE: Role[] = ['MEMBER', 'ADMIN', 'OWNER'];

/** Invite/add-user form: email, name, role select, and a temporary password. */
export function UserForm() {
  const create = useCreateUser();
  const callerRole = useCurrentRole();
  const roleOptions = callerRole === 'OWNER' ? OWNER_ASSIGNABLE : ADMIN_ASSIGNABLE;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateUserDto>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: '', email: '', role: 'MEMBER', password: '' },
  });

  const onSubmit = handleSubmit((values) => {
    create.mutate(values, { onSuccess: () => reset() });
  });

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-medium text-gray-500">Invite a team member</h2>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="name" className="mb-1 block text-sm font-medium">
              Name
            </label>
            <input
              id="name"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="e.g. Grace Hopper"
              {...register('name')}
            />
            {errors.name && (
              <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="teammate@company.com"
              {...register('email')}
            />
            {errors.email && (
              <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="role" className="mb-1 block text-sm font-medium">
              Role
            </label>
            <select
              id="role"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              {...register('role')}
            >
              {roleOptions.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            {errors.role && (
              <p className="mt-1 text-sm text-red-600">{errors.role.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium">
              Temporary password
            </label>
            <input
              id="password"
              type="password"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="At least 8 characters"
              {...register('password')}
            />
            {errors.password && (
              <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
            )}
          </div>
        </div>

        {create.isError && (
          <p className="text-sm text-red-600">
            {create.error?.message ?? 'Could not add user'}
          </p>
        )}

        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Adding…' : 'Add user'}
        </Button>
      </form>
    </section>
  );
}
