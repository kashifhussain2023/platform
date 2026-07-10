'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import axios from 'axios';
import type { MeDto } from '@vaep/types';
import { apiClient } from '@/lib/apiClient';
import { useSessionStore } from '@/stores/session.store';

const baseURL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Rehydrates the session on app load. In-memory state (Zustand) is wiped on a
 * hard refresh, so we silently exchange the httpOnly refresh cookie for a new
 * access token (`POST /auth/refresh`) and reload identity (`GET /auth/me`).
 * Sets `status` to 'authenticated' or 'guest' so the route guards can decide
 * without prematurely bouncing to /login. Runs exactly once.
 */
export function AuthBootstrap({ children }: { children: ReactNode }) {
  useEffect(() => {
    const store = useSessionStore.getState();
    // Already authenticated in this SPA session (e.g. just logged in) → nothing to do.
    if (store.accessToken) {
      store.setStatus('authenticated');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.post<{ tokens?: { accessToken?: string } }>(
          `${baseURL}/auth/refresh`,
          {},
          { withCredentials: true },
        );
        const token = data?.tokens?.accessToken;
        if (!token) throw new Error('no refresh token');
        useSessionStore.getState().setAccessToken(token);

        const me = await apiClient.get<MeDto>('/auth/me');
        if (cancelled) return;
        useSessionStore.getState().setSession({
          user: me.data.user,
          company: me.data.company,
          accessToken: token,
        });
      } catch {
        if (!cancelled) useSessionStore.getState().clear(); // → status 'guest'
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return <>{children}</>;
}
