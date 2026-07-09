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
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-medium text-gray-500">Skills</h2>

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading skills…</p>
      ) : !installed || installed.length === 0 ? (
        <p className="text-sm text-gray-500">
          No skills installed.{' '}
          <Link href="/skills" className="font-medium text-brand-700">
            Install skills
          </Link>{' '}
          to assign them here.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {installed.map((skill) => {
            const isAssigned = assignedIds.has(skill.id);
            return (
              <li
                key={skill.id}
                className="flex items-center justify-between gap-4 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {skill.displayName}
                  </p>
                  <p className="text-xs text-gray-500">
                    {skill.skillKey}
                    {!skill.enabled && ' · disabled'}
                  </p>
                </div>
                {isAssigned ? (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      unassign.mutate({ installedSkillId: skill.id })
                    }
                    disabled={busy}
                  >
                    Unassign
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      assign.mutate({ installedSkillId: skill.id })
                    }
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
