import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ADMIN_LOGOUT_PENDING_KEY,
  loginSession,
  logoutSession,
  refreshSession,
  SESSION_EXPIRED_EVENT,
  setAccessToken,
} from './api';
import type { AdminUser, UserRole } from './types';

interface AuthContextValue {
  user: AdminUser | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  login: (phone: string, password: string) => Promise<AdminUser>;
  logout: () => Promise<void>;
  can: (...roles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [status, setStatus] = useState<AuthContextValue['status']>('loading');

  useEffect(() => {
    let active = true;
    refreshSession()
      .then((session) => {
        if (!active) return;
        setUser(session.user);
        setStatus('authenticated');
      })
      .catch(() => {
        if (!active) return;
        setAccessToken(null);
        setUser(null);
        setStatus('anonymous');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const expire = () => {
      setAccessToken(null);
      queryClient.clear();
      setUser(null);
      setStatus('anonymous');
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expire);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expire);
  }, [queryClient]);

  useEffect(() => {
    const synchronizeLogout = (event: StorageEvent) => {
      if (
        event.key === ADMIN_LOGOUT_PENDING_KEY &&
        event.newValue === 'pending'
      ) {
        setAccessToken(null);
        queryClient.clear();
        setUser(null);
        setStatus('anonymous');
      }
    };
    window.addEventListener('storage', synchronizeLogout);
    return () => window.removeEventListener('storage', synchronizeLogout);
  }, [queryClient]);

  const login = useCallback(async (phone: string, password: string) => {
    const session = await loginSession(phone, password);
    setUser(session.user);
    setStatus('authenticated');
    return session.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutSession();
    } finally {
      queryClient.clear();
      setUser(null);
      setStatus('anonymous');
    }
  }, [queryClient]);

  const can = useCallback(
    (...roles: UserRole[]) => Boolean(user && roles.includes(user.role)),
    [user],
  );

  const value = useMemo(
    () => ({ user, status, login, logout, can }),
    [user, status, login, logout, can],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return value;
}
