import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLogin } from '../hooks';
import { useSessionStore } from '@/stores/session.store';

// Mock the network layer so the hook test is deterministic (no real API).
vi.mock('../api', () => ({
  loginRequest: vi.fn(async () => ({
    user: {
      id: 'u1',
      companyId: 'c1',
      email: 'owner@acme.test',
      name: 'Owner',
      role: 'OWNER',
      createdAt: new Date().toISOString(),
    },
    company: {
      id: 'c1',
      name: 'Acme',
      slug: 'acme',
      createdAt: new Date().toISOString(),
    },
    tokens: { accessToken: 'tok_123' },
  })),
  registerRequest: vi.fn(),
  meRequest: vi.fn(),
  logoutRequest: vi.fn(),
}));

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('useLogin', () => {
  beforeEach(() => {
    useSessionStore.getState().clear();
  });

  it('stores the session in the Zustand store on success', async () => {
    const { result } = renderHook(() => useLogin(), { wrapper: makeWrapper() });

    await result.current.mutateAsync({
      email: 'owner@acme.test',
      password: 'password123',
    });

    await waitFor(() => {
      expect(useSessionStore.getState().accessToken).toBe('tok_123');
    });
    expect(useSessionStore.getState().user?.email).toBe('owner@acme.test');
    expect(useSessionStore.getState().company?.slug).toBe('acme');
  });
});
