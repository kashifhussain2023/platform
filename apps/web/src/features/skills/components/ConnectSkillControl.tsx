'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import type { NormalizedApiError } from '@/lib/apiClient';
import { authorizeOAuth } from '../api';
import { useConnectSkill, useDisconnectSkill } from '../hooks';
import type { InstalledSkillDto, SkillDefinitionDto } from '../schemas';

/**
 * Connect / disconnect control for an installed skill.
 * - `api_key` skills prompt inline for a secret key (stored in credentials).
 * - `oauth` skills start the REAL authorization-code flow: fetch the provider
 *   URL from the API and redirect the browser there (the API callback stores the
 *   tokens and returns to /skills?connected=…). If OAuth is not configured the
 *   API returns 400 and we surface the message inline.
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
  const [authorizing, setAuthorizing] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  const startOAuth = async () => {
    setOauthError(null);
    setAuthorizing(true);
    try {
      const { url } = await authorizeOAuth(installed.id);
      // Full-page redirect to the provider's consent screen.
      window.location.href = url;
    } catch (err) {
      setOauthError((err as NormalizedApiError).message ?? 'OAuth failed');
      setAuthorizing(false);
    }
  };

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
          onClick={startOAuth}
          disabled={isTemp || authorizing}
        >
          {authorizing ? 'Redirecting…' : def.connection?.label ?? 'Connect'}
        </Button>
        {oauthError ? (
          <span className="text-[10px] text-red-500">{oauthError}</span>
        ) : (
          <span className="text-[10px] text-gray-400">OAuth</span>
        )}
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
