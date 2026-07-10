'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import {
  useCanManageOrg,
  useCreateTeam,
  useDeleteTeam,
  useDepartments,
  useTeams,
  useUpdateTeam,
} from '../hooks';
import {
  createTeamSchema,
  type CreateTeamDto,
  type DepartmentDto,
  type TeamDto,
} from '../schemas';

const inputClass = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm';

/** '' (no selection) → null so the nullable schema/API accept "no department". */
const toDeptId = (v: unknown): string | null =>
  v === '' || v === null || v === undefined ? null : (v as string);

/** One team row: display + (OWNER/ADMIN) inline edit / remove. */
function TeamRow({
  team,
  departments,
  canManage,
}: {
  team: TeamDto;
  departments: DepartmentDto[];
  canManage: boolean;
}) {
  const update = useUpdateTeam();
  const del = useDeleteTeam();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(team.name);
  const [departmentId, setDepartmentId] = useState(team.departmentId ?? '');

  const deptName =
    departments.find((d) => d.id === team.departmentId)?.name ?? null;

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    update.mutate(
      { id: team.id, data: { name: trimmed, departmentId: toDeptId(departmentId) } },
      { onSuccess: () => setEditing(false) },
    );
  };

  if (editing) {
    return (
      <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
        <input
          aria-label={`Name for ${team.name}`}
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          aria-label={`Department for ${team.name}`}
          className={inputClass}
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
        >
          <option value="">No department</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <div className="flex shrink-0 gap-2">
          <Button type="button" onClick={save} disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setName(team.name);
              setDepartmentId(team.departmentId ?? '');
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
        <div className="font-medium text-gray-900">{team.name}</div>
        <div className="text-xs text-gray-500">
          {deptName ? deptName : <span className="text-gray-400">No department</span>}
        </div>
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
                !window.confirm(`Remove team "${team.name}"?`)
              ) {
                return;
              }
              del.mutate(team.id);
            }}
          >
            Remove
          </Button>
        </div>
      )}
    </li>
  );
}

/** Teams CRUD section (P1 #7). Mutations OWNER/ADMIN; reads open to all. */
export function TeamSection() {
  const { data: teams, isLoading, isError, error } = useTeams();
  const { data: departments } = useDepartments();
  const canManage = useCanManageOrg();
  const create = useCreateTeam();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateTeamDto>({
    resolver: zodResolver(createTeamSchema),
    defaultValues: { name: '', departmentId: null },
  });

  const onSubmit = handleSubmit((values) => {
    create.mutate(
      { name: values.name.trim(), departmentId: values.departmentId ?? null },
      { onSuccess: () => reset() },
    );
  });

  const depts = departments ?? [];
  const rows = teams ?? [];

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="mb-4 text-sm font-medium text-gray-500">Teams</h2>

      {canManage && (
        <form onSubmit={onSubmit} className="mb-4 space-y-3" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="team-name" className="mb-1 block text-sm font-medium">
                Name
              </label>
              <input
                id="team-name"
                className={inputClass}
                placeholder="e.g. Platform"
                {...register('name')}
              />
              {errors.name && (
                <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
              )}
            </div>
            <div>
              <label htmlFor="team-dept" className="mb-1 block text-sm font-medium">
                Department <span className="text-gray-400">(optional)</span>
              </label>
              <select
                id="team-dept"
                className={inputClass}
                {...register('departmentId', { setValueAs: toDeptId })}
              >
                <option value="">No department</option>
                {depts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {create.isError && (
            <p className="text-sm text-red-600">
              {create.error?.message ?? 'Could not add team'}
            </p>
          )}
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Adding…' : 'Add team'}
          </Button>
        </form>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading teams…</p>
      ) : isError ? (
        <p className="text-sm text-red-600">
          {error?.message ?? 'Could not load teams'}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400">No teams yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
          {rows.map((t) => (
            <TeamRow key={t.id} team={t} departments={depts} canManage={canManage} />
          ))}
        </ul>
      )}
    </section>
  );
}
