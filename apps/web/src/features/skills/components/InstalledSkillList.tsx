'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import {
  useCatalog,
  useInstalledSkills,
  useUninstallSkill,
  useUpdateInstalledSkill,
} from '../hooks';
import { CONNECTION_STATUS_STYLES, formatConnectionStatus } from '../labels';
import type { InstalledSkillDto, SkillDefinitionDto } from '../schemas';
import { ConfigureSkillForm } from './ConfigureSkillForm';
import { ConnectSkillControl } from './ConnectSkillControl';

/** One installed-skill row with enable/disable, connect, configure, uninstall. */
function InstalledSkillRow({
  skill,
  def,
}: {
  skill: InstalledSkillDto;
  def?: SkillDefinitionDto;
}) {
  const update = useUpdateInstalledSkill();
  const uninstall = useUninstallSkill();
  const [showConfig, setShowConfig] = useState(false);
  const isTemp = skill.id.startsWith('temp_');

  return (
    <li className="px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium">{skill.displayName}</p>
            <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
              {skill.skillKey}
            </span>
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CONNECTION_STATUS_STYLES[skill.connectionStatus]}`}
            >
              {formatConnectionStatus(skill.connectionStatus)}
            </span>
          </div>
          <p className="text-xs text-gray-500">
            {skill.enabled ? 'Enabled' : 'Disabled'}
            {skill.credentialsSet && ' · credentials set'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {def && <ConnectSkillControl installed={skill} def={def} />}
          {def && (
            <Button
              variant="ghost"
              onClick={() => setShowConfig((v) => !v)}
              disabled={isTemp}
            >
              Configure
            </Button>
          )}
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
      </div>

      {showConfig && def && (
        <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-4">
          <ConfigureSkillForm
            installed={skill}
            def={def}
            onDone={() => setShowConfig(false)}
          />
        </div>
      )}
    </li>
  );
}

/** Installed skills with connect/configure/enable/uninstall (all optimistic). */
export function InstalledSkillList() {
  const { data: installed, isLoading } = useInstalledSkills();
  const { data: catalog } = useCatalog();

  const defByKey = new Map((catalog ?? []).map((d) => [d.key, d]));

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
      {installed.map((skill) => (
        <InstalledSkillRow
          key={skill.id}
          skill={skill}
          def={defByKey.get(skill.skillKey)}
        />
      ))}
    </ul>
  );
}
