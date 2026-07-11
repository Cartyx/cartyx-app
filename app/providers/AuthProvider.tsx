import { createContext, useContext, useCallback, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { captureException } from '~/utils/telemetry-client';
import { queryKeys } from '~/utils/queryKeys';

const getMeFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { getMe } = await import('~/server/functions/auth');
  return getMe();
});

export interface AuthUser {
  id: string;
  provider: string;
  name: string | null;
  email: string | null;
  avatar: string | null;
  role: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data: user = null, isLoading } = useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: async () => {
      try {
        const me = await getMeFn();
        return (me as AuthUser | null) ?? null;
      } catch (e) {
        captureException(e, { action: 'getMe', component: 'AuthProvider' });
        return null;
      }
    },
    staleTime: 5 * 60 * 1000,
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.auth.me });
  }, [queryClient]);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  return useContext(AuthContext);
}
