'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import {
  useCanManageOrg,
  useCreateDepartment,
  useDeleteDepartment,
  useDepartments,
  useUpdateDepartment,
} from '../hooks';
import {
  createDepartmentSchema,
  type CreateDepartmentDto,
  type DepartmentDto,
} from '../schemas';

const inputClass = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm';

/** One department row: display + (OWNER/ADMIN) inline edit / remove. */
function DepartmentRow({
  dept,
  canManage,
}: {
  dept: DepartmentDto;
  canManage: boolean;
}) {
  const update = useUpdateDepartment();
  const del = useDeleteDepartment();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(dept.name);
  const [description, setDescription] = useState(dept.description ?? '');

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    update.mutate(
      {
        id: dept.id,
        data: { name: trimmed, description: description.trim() || null },
      },
      { onSuccess: () => setEditing(false) },
    );
  };

  if (editing) {
    return (
      <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
        <input
          aria-label={`Name for ${dept.name}`}
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          aria-label={`Description for ${dept.name}`}
          className={inputClass}
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="flex shrink-0 gap-2">
          <Button type="button" onClick={save} disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setName(dept.name);
              setDescription(dept.description ?? '');
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div>
        <div className="font-medium text-gray-900">{dept.name}</div>
        {dept.description && (
          <div className="text-xs text-gray-500">{dept.description}</div>
        )}
      </div>
      {canManage && (
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="text-red-600 hover:bg-red-50"
            disabled={del.isPending}
            onClick={() => {
              if (
                typeof window !== 'undefined' &&
                !window.confirm(`Remove department "${dept.name}"?`)
              ) {
                return;
              }
              del.mutate(dept.id);
            }}
          >
            Remove
          </Button>
        </div>
      )}
    </li>
  );
}

/** Departments CRUD section (P1 #7). Mutations OWNER/ADMIN; reads open to all. */
export function DepartmentSection() {
  const { data: departments, isLoading, isError, error } = useDepartments();
  const canManage = useCanManageOrg();
  const create = useCreateDepartment();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateDepartmentDto>({
    resolver: zodResolver(createDepartmentSchema),
    defaultValues: { name: '', description: '' },
  });

  const onSubmit = handleSubmit((values) => {
    create.mutate(
      {
        name: values.name.trim(),
        description: values.description?.trim() || undefined,
      },
      { onSuccess: () => reset() },
    );
  });

  const rows = departments ?? [];

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="mb-4 text-sm font-medium text-gray-500">Departments</h2>

      {canManage && (
        <form onSubmit={onSubmit} className="mb-4 space-y-3" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="dept-name" className="mb-1 block text-sm font-medium">
                Name
              </label>
              <input
                id="dept-name"
                className={inputClass}
                placeholder="e.g. Engineering"
                {...register('name')}
              />
              {errors.name && (
                <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
              )}
            </div>
            <div>
              <label htmlFor="dept-desc" className="mb-1 block text-sm font-medium">
                Description <span className="text-gray-400">(optional)</span>
              </label>
              <input
                id="dept-desc"
                className={inputClass}
                {...register('description')}
              />
            </div>
          </div>
          {create.isError && (
            <p className="text-sm text-red-600">
              {create.error?.message ?? 'Could not add department'}
            </p>
          )}
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Adding…' : 'Add department'}
          </Button>
        </form>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading departments…</p>
      ) : isError ? (
        <p className="text-sm text-red-600">
          {error?.message ?? 'Could not load departments'}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400">No departments yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
          {rows.map((d) => (
            <DepartmentRow key={d.id} dept={d} canManage={canManage} />
          ))}
        </ul>
      )}
    </section>
  );
}
