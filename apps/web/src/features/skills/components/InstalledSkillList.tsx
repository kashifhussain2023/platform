'use client';

import { useState, type ElementType } from 'react';
import {
  Activity,
  Calendar,
  CalendarClock,
  CreditCard,
  Globe,
  Kanban,
  Mail,
  Power,
  PowerOff,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  GitHubIcon,
  GmailIcon,
  GoogleDriveIcon,
  HubSpotIcon,
  SlackIcon,
} from '@/components/marketing-dark/brand-icons';
import { RecentConnectorEvents } from '@/features/events/components/RecentConnectorEvents';
import {
  useCatalog,
  useCheckConnectorHealth,
  useInstalledSkills,
  useUninstallSkill,
  useUpdateInstalledSkill,
} from '../hooks';
import { CONNECTION_STATUS_STYLES, formatConnectionStatus } from '../labels';
import type { InstalledSkillDto, SkillDefinitionDto } from '../schemas';
import { ConfigureSkillForm } from './ConfigureSkillForm';
import { ConnectSkillControl } from './ConnectSkillControl';

/** Real brand marks where we have one; a plain lucide glyph in a badge otherwise. */
const CONNECTOR_ICON: Record<string, ElementType<{ className?: string }>> = {
  slack: SlackIcon,
  gmail: GmailIcon,
  gdrive: GoogleDriveIcon,
  hubspot: HubSpotIcon,
  github: GitHubIcon,
  email: Mail,
  stripe: CreditCard,
  http: Globe,
  jira: Kanban,
  calendar: Calendar,
  scheduling: CalendarClock,
};
const BRAND_KEYS = new Set(['slack', 'gmail', 'gdrive', 'hubspot', 'github']);

function ConnectorMark({ skillKey }: { skillKey: string }) {
  const Icon = CONNECTOR_ICON[skillKey] ?? Sparkles;
  if (BRAND_KEYS.has(skillKey)) {
    return (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center">
        <Icon className="h-9 w-9" />
      </span>
    );
  }
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet/15 text-violet-secondary">
      <Icon className="h-5 w-5" />
    </span>
  );
}

function ActionIconButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  active,
  danger,
  spin,
}: {
  icon: ElementType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  spin?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'border-violet/50 bg-violet/15 text-violet-secondary'
          : danger
            ? 'border-white/[0.08] text-zinc-400 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400'
            : 'border-white/[0.08] text-zinc-400 hover:border-white/25 hover:text-white'
      }`}
    >
      <Icon className={spin ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
    </button>
  );
}

/** One installed-skill card: connect, configure, events, health, enable/disable, uninstall. */
function InstalledSkillRow({
  skill,
  def,
}: {
  skill: InstalledSkillDto;
  def?: SkillDefinitionDto;
}) {
  const update = useUpdateInstalledSkill();
  const uninstall = useUninstallSkill();
  const checkHealth = useCheckConnectorHealth();
  const [showConfig, setShowConfig] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const isTemp = skill.id.startsWith('temp_');
  const health = checkHealth.data;

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 transition-colors hover:border-white/[0.14]">
      <div className="flex items-center gap-3">
        <ConnectorMark skillKey={skill.skillKey} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-white">{skill.displayName}</p>
          <span
            className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${CONNECTION_STATUS_STYLES[skill.connectionStatus]}`}
          >
            {formatConnectionStatus(skill.connectionStatus)}
          </span>
        </div>
        {!skill.enabled && (
          <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-zinc-500">
            Disabled
          </span>
        )}
      </div>

      <p className="mt-3 truncate text-[11px] text-zinc-600">{skill.skillKey}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {def ? (
          <ConnectSkillControl installed={skill} def={def} />
        ) : (
          <span className="text-xs text-zinc-600">Unknown skill</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {def && (
            <ActionIconButton
              icon={Settings}
              label="Configure"
              active={showConfig}
              onClick={() => setShowConfig((v) => !v)}
              disabled={isTemp}
            />
          )}
          <ActionIconButton
            icon={Activity}
            label="Events"
            active={showEvents}
            onClick={() => setShowEvents((v) => !v)}
            disabled={isTemp}
          />
          <ActionIconButton
            icon={RefreshCw}
            label="Check health"
            spin={checkHealth.isPending}
            onClick={() => checkHealth.mutate(skill.id)}
            disabled={isTemp || checkHealth.isPending}
          />
          <ActionIconButton
            icon={skill.enabled ? PowerOff : Power}
            label={skill.enabled ? 'Disable' : 'Enable'}
            onClick={() =>
              update.mutate({ id: skill.id, data: { enabled: !skill.enabled } })
            }
            disabled={isTemp || update.isPending}
          />
          <ActionIconButton
            icon={Trash2}
            label="Uninstall"
            danger
            onClick={() => uninstall.mutate(skill.id)}
            disabled={isTemp || uninstall.isPending}
          />
        </div>
      </div>

      {showConfig && def && (
        <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <ConfigureSkillForm
            installed={skill}
            def={def}
            onDone={() => setShowConfig(false)}
          />
        </div>
      )}

      {showEvents && !isTemp && (
        <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="mb-2 text-xs font-medium text-zinc-500">Recent Events</p>
          <RecentConnectorEvents connectorId={skill.id} />
        </div>
      )}

      {(health || checkHealth.isError) && (
        <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs">
          {health ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-zinc-400">
              <span>
                Health:{' '}
                <span className="font-medium text-zinc-200">
                  {formatConnectionStatus(health.status)}
                </span>
              </span>
              <span>Consecutive errors: {health.consecutiveErrors}</span>
              {health.lastHealthError && (
                <span className="text-red-400">
                  Last error: {health.lastHealthError}
                </span>
              )}
              {health.lastHealthCheckAt && (
                <span className="text-zinc-600">
                  Checked {new Date(health.lastHealthCheckAt).toLocaleString()}
                </span>
              )}
            </div>
          ) : (
            <span className="text-red-400">
              {checkHealth.error?.message ?? 'Health check failed'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Installed skills as connection cards: connect/configure/enable/uninstall (all optimistic). */
export function InstalledSkillList() {
  const { data: installed, isLoading } = useInstalledSkills();
  const { data: catalog } = useCatalog();

  const defByKey = new Map((catalog ?? []).map((d) => [d.key, d]));

  if (isLoading) {
    return <p className="text-sm text-zinc-500">Loading installed skills…</p>;
  }

  if (!installed || installed.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        No skills installed yet. Install one from the catalog above.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {installed.map((skill) => (
        <InstalledSkillRow
          key={skill.id}
          skill={skill}
          def={defByKey.get(skill.skillKey)}
        />
      ))}
    </div>
  );
}
