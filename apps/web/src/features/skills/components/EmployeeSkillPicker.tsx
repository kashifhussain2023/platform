'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import {
  useAssignSkill,
  useEmployeeSkills,
  useInstalledSkills,
  useUnassignSkill,
} from '../hooks';

/** Assign / unassign installed skills to a specific employee (optimistic). */
export function EmployeeSkillPicker({ employeeId }: { employeeId: string }) {
  const { data: installed, isLoading } = useInstalledSkills();
  const { data: assigned } = useEmployeeSkills(employeeId);
  const assign = useAssignSkill(employeeId);
  const unassign = useUnassignSkill(employeeId);

  const assignedIds = new Set((assigned ?? []).map((a) => a.installedSkillId));
  const busy = assign.isPending || unassign.isPending;

  return (
    <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
      <h2 className="mb-3 text-sm font-medium text-zinc-400">Skills</h2>

      {isLoading ? (
        <p className="text-sm text-zinc-500">Loading skills…</p>
      ) : !installed || installed.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No skills installed.{' '}
          <Link href="/skills" className="font-medium text-violet-secondary hover:text-white">
            Install skills
          </Link>{' '}
          to assign them here.
        </p>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {installed.map((skill) => {
            const isAssigned = assignedIds.has(skill.id);
            return (
              <li
                key={skill.id}
                className="flex items-center justify-between gap-4 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">
                    {skill.displayName}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {skill.skillKey}
                    {!skill.enabled && ' · disabled'}
                  </p>
                </div>
                {isAssigned ? (
                  <button
                    type="button"
                    onClick={() => unassign.mutate({ installedSkillId: skill.id })}
                    disabled={busy}
                    className="rounded-xl border border-white/[0.12] bg-white/[0.03] px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-white/25 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Unassign
                  </button>
                ) : (
                  <Button
                    variant="violet"
                    onClick={() => assign.mutate({ installedSkillId: skill.id })}
                    disabled={busy}
                  >
                    Assign
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
