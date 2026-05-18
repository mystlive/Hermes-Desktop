import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import { NavigationGuardContext, type NavigationGuard } from './NavigationGuardContext';

export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const activeGuardRef = useRef<NavigationGuard | null>(null);

  const registerGuard = useCallback((guard: NavigationGuard) => {
    activeGuardRef.current = guard;
    return () => {
      if (activeGuardRef.current === guard) {
        activeGuardRef.current = null;
      }
    };
  }, []);

  const requestCanNavigate = useCallback(async () => {
    if (!activeGuardRef.current) return true;
    return Boolean(await activeGuardRef.current());
  }, []);

  const value = useMemo(() => ({ registerGuard, requestCanNavigate }), [registerGuard, requestCanNavigate]);

  return (
    <NavigationGuardContext.Provider value={value}>
      {children}
    </NavigationGuardContext.Provider>
  );
}
