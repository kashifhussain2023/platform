'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import { useCreateEmployee } from '../hooks';
import { formatRole } from '../labels';
import {
  EMPLOYEE_ROLES,
  createEmployeeSchema,
  type CreateEmployeeDto,
} from '../schemas';

/** Create-employee form: name, role select, and an optional persona. */
export function EmployeeForm() {
  const create = useCreateEmployee();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateEmployeeDto>({
    resolver: zodResolver(createEmployeeSchema),
    defaultValues: { name: '', role: 'SUPPORT', persona: '' },
  });

  const onSubmit = handleSubmit((values) => {
    create.mutate(
      { ...values, persona: values.persona?.trim() || undefined },
      { onSuccess: () => reset() },
    );
  });

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-medium text-gray-500">Hire an AI employee</h2>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="name" className="mb-1 block text-sm font-medium">
              Name
            </label>
            <input
              id="name"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="e.g. Ada"
              {...register('name')}
            />
            {errors.name && (
              <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
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
              {EMPLOYEE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {formatRole(r)}
                </option>
              ))}
            </select>
            {errors.role && (
              <p className="mt-1 text-sm text-red-600">{errors.role.message}</p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="persona" className="mb-1 block text-sm font-medium">
            Persona <span className="text-gray-400">(optional)</span>
          </label>
          <textarea
            id="persona"
            rows={2}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="Tone, guardrails, and how this employee should behave…"
            {...register('persona')}
          />
          {errors.persona && (
            <p className="mt-1 text-sm text-red-600">{errors.persona.message}</p>
          )}
        </div>

        {create.isError && (
          <p className="text-sm text-red-600">
            {create.error?.message ?? 'Could not create employee'}
          </p>
        )}

        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Hiring…' : 'Hire employee'}
        </Button>
      </form>
    </section>
  );
}
