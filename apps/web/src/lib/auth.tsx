import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, tokens } from './api';

export type Role = 'ADMIN' | 'MANAGER' | 'OPERATOR' | 'VIEWER';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  status?: string;
  phone?: string | null;
  job_title?: string | null;
  must_change_password?: boolean;
  last_login_at?: string | null;
  organization_id?: string;
  organization_name?: string;
  settings?: Record<string, unknown>;
}

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  can: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    if (!tokens.access) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const data = await api<{ user: SessionUser }>('/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const signIn = useCallback(async (email: string, password: string) => {
    const data = await api<{ accessToken: string; refreshToken: string; user: SessionUser }>('/auth/login', {
      method: 'POST',
      body: { email, password },
      skipAuth: true,
    });
    tokens.set(data.accessToken, data.refreshToken);
    await refreshUserInternal(setUser);
  }, []);

  const signOut = useCallback(async () => {
    const refreshToken = tokens.refresh;
    if (refreshToken) {
      await api('/auth/logout', { method: 'POST', body: { refreshToken } }).catch(() => undefined);
    }
    tokens.clear();
    setUser(null);
  }, []);

  const can = useCallback(
    (...roles: Role[]) => (user ? roles.includes(user.role) : false),
    [user],
  );

  const value = useMemo(
    () => ({ user, loading, signIn, signOut, refreshUser, can }),
    [user, loading, signIn, signOut, refreshUser, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

async function refreshUserInternal(setUser: (u: SessionUser | null) => void) {
  const data = await api<{ user: SessionUser }>('/auth/me');
  setUser(data.user);
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  return context;
}
