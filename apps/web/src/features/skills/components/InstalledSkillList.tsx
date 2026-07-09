'use client';

import { Button } from '@/components/ui/Button';
import {
  useInstalledSkills,
  useUninstallSkill,
  useUpdateInstalledSkill,
} from '../hooks';

/** Installed skills with enable/disable + uninstall (both optimistic). */
export function InstalledSkillList() {
  const { data: installed, isLoading } = useInstalledSkills();
  const update = useUpdateInstalledSkill();
  const uninstall = useUninstallSkill();

  if (isLoading) {
    return <p className="text-sm text-gray-500">Loading installed skills…</p>;
  }

  if (!installed || installed.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No skills installed yet. Install one from the catalog above.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
      {installed.map((skill) => {
        const isTemp = skill.id.startsWith('temp_');
        return (
          <li
            key={skill.id}
            className="flex items-center justify-between gap-4 px-4 py-3"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium">
                  {skill.displayName}
                </p>
                <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                  {skill.skillKey}
                </span>
              </div>
              <p className="text-xs text-gray-500">
                {skill.enabled ? 'Enabled' : 'Disabled'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="ghost"
                onClick={() =>
                  update.mutate({
                    id: skill.id,
                    data: { enabled: !skill.enabled },
                  })
                }
                disabled={isTemp || update.isPending}
              >
                {skill.enabled ? 'Disable' : 'Enable'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => uninstall.mutate(skill.id)}
                disabled={isTemp || uninstall.isPending}
              >
                Uninstall
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
