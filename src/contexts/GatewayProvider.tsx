import { useMemo, type ReactNode } from 'react';
import { useGateway as useGatewayHook } from '../hooks/useGateway';
import { useSessions } from '../features/sessions/SessionsContext';
import { GatewayContext } from './GatewayContext';

export function GatewayProvider({ children }: { children: ReactNode }) {
  const gateway = useGatewayHook();
  const sessionStore = useSessions();
  const value = useMemo(() => ({
    ...gateway,
    sessions: sessionStore.sessions,
  }), [gateway, sessionStore.sessions]);

  return (
    <GatewayContext.Provider value={value}>
      {children}
    </GatewayContext.Provider>
  );
}
