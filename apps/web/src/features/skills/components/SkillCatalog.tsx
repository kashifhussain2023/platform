'use client';

import { Button } from '@/components/ui/Button';
import { useCatalog, useInstallSkill, useInstalledSkills } from '../hooks';
import { CATEGORY_STYLES, formatCategory } from '../labels';

/** The built-in catalog with an install button per skill (optimistic). */
export function SkillCatalog() {
  const { data: catalog, isLoading } = useCatalog();
  const { data: installed } = useInstalledSkills();
  const install = useInstallSkill();

  const installedKeys = new Set((installed ?? []).map((s) => s.skillKey));

  if (isLoading) {
    return <p className="text-sm text-gray-500">Loading catalog…</p>;
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-medium text-gray-500">Skill catalog</h2>
      <ul className="divide-y divide-gray-100">
        {(catalog ?? []).map((skill) => {
          const isInstalled = installedKeys.has(skill.key);
          return (
            <li
              key={skill.key}
              className="flex items-start justify-between gap-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{skill.name}</p>
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_STYLES[skill.category]}`}
                  >
                    {formatCategory(skill.category)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-gray-500">
                  {skill.description}
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  Tools: {skill.tools.map((t) => t.name).join(', ')}
                </p>
              </div>
              <Button
                variant="ghost"
                onClick={() =>
                  install.mutate({
                    skillKey: skill.key,
                    displayName: skill.name,
                  })
                }
                disabled={isInstalled || install.isPending}
              >
                {isInstalled ? 'Installed' : 'Install'}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
