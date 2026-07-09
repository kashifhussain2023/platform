'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useConnectSkill, useDisconnectSkill } from '../hooks';
import type { InstalledSkillDto, SkillDefinitionDto } from '../schemas';

/**
 * Connect / disconnect control for an installed skill.
 * - `api_key` skills prompt inline for a secret key (stored in credentials).
 * - `oauth` skills use a STUBBED "Connect" button (real OAuth flow is a TODO)
 *   that just marks the skill connected with a placeholder token.
 * - `none` skills need no connection.
 */
export function ConnectSkillControl({
  installed,
  def,
}: {
  installed: InstalledSkillDto;
  def: SkillDefinitionDto;
}) {
  const connect = useConnectSkill();
  const disconnect = useDisconnectSkill();
  const [apiKey, setApiKey] = useState('');
  const [open, setOpen] = useState(false);

  const type = def.connection?.type ?? 'none';
  const isConnected = installed.connectionStatus === 'CONNECTED';
  const isTemp = installed.id.startsWith('temp_');

  if (type === 'none') {
    return <span className="text-xs text-gray-400">No connection required</span>;
  }

  if (isConnected) {
    return (
      <Button
        variant="ghost"
        onClick={() => disconnect.mutate(installed.id)}
        disabled={isTemp || disconnect.isPending}
      >
        Disconnect
      </Button>
    );
  }

  if (type === 'oauth') {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          variant="ghost"
          onClick={() =>
            connect.mutate({
              id: installed.id,
              // STUB: real OAuth authorization-code flow is a TODO.
              data: { credentials: { token: 'stub-oauth-token' } },
            })
          }
          disabled={isTemp || connect.isPending}
        >
          {def.connection?.label ?? 'Connect'}
        </Button>
        <span className="text-[10px] text-gray-400">OAuth (stubbed)</span>
      </div>
    );
  }

  // api_key
  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)} disabled={isTemp}>
        {def.connection?.label ?? 'Connect'}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder="API key"
        className="w-40 rounded-md border border-gray-300 px-2 py-1 text-sm"
      />
      <Button
        onClick={() =>
          connect.mutate(
            { id: installed.id, data: { credentials: { apiKey } } },
            {
              onSuccess: () => {
                setApiKey('');
                setOpen(false);
              },
            },
          )
        }
        disabled={!apiKey || connect.isPending}
      >
        Save
      </Button>
    </div>
  );
}
