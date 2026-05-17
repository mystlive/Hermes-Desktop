import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react';

type NavigationGuard = () => boolean | Promise<boolean>;

type NavigationGuardContextValue = {
  registerGuard: (guard: NavigationGuard) => () => void;
  requestCanNavigate: () => Promise<boolean>;
};

const NavigationGuardContext = createContext<NavigationGuardContextValue | null>(null);

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

export function useNavigationGuard() {
  const context = useContext(NavigationGuardContext);
  if (!context) throw new Error('useNavigationGuard must be used within NavigationGuardProvider');
  return context;
}
