import { create } from 'zustand';
import type { CompanyDto, UserDto } from '@vaep/types';

/**
 * The ONE Zustand store for the app. Holds a `session` slice (auth identity used
 * by the axios interceptor and route guards) and a small `ui` slice. There is
 * intentionally a single store instance for the whole client.
 */
interface SessionState {
  user: UserDto | null;
  company: CompanyDto | null;
  accessToken: string | null;
}

interface UiState {
  /** Example of a global UI flag living alongside session state. */
  sidebarOpen: boolean;
}

interface Actions {
  setSession: (payload: {
    user: UserDto;
    company: CompanyDto;
    accessToken: string;
  }) => void;
  setAccessToken: (token: string | null) => void;
  setUi: (partial: Partial<UiState>) => void;
  clear: () => void;
}

export type SessionStore = SessionState & UiState & Actions;

const initialState: SessionState & UiState = {
  user: null,
  company: null,
  accessToken: null,
  sidebarOpen: true,
};

export const useSessionStore = create<SessionStore>((set) => ({
  ...initialState,
  setSession: ({ user, company, accessToken }) =>
    set({ user, company, accessToken }),
  setAccessToken: (accessToken) => set({ accessToken }),
  setUi: (partial) => set(partial),
  clear: () => set({ user: null, company: null, accessToken: null }),
}));
