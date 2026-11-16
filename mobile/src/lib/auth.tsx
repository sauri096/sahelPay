import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api, loadToken, Me, saveToken } from './api';

interface AuthState {
  ready: boolean;
  me: Me | null;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>('/me'));
    } catch (e: any) {
      if (e.status === 401 || e.status === 403) {
        await saveToken(null);
        setMe(null);
      } else {
        throw e;
      }
    }
  }, []);

  useEffect(() => {
    (async () => {
      const t = await loadToken();
      if (t) await refresh().catch(() => undefined);
      setReady(true);
    })();
  }, [refresh]);

  const signIn = useCallback(async (token: string) => {
    await saveToken(token);
    await refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await saveToken(null);
    setMe(null);
  }, []);

  return <AuthContext.Provider value={{ ready, me, signIn, signOut, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth hors AuthProvider');
  return ctx;
}
