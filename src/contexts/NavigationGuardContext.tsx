import { createContext, useContext } from 'react';

export type NavigationGuard = () => boolean | Promise<boolean>;

export type NavigationGuardContextValue = {
  registerGuard: (guard: NavigationGuard) => () => void;
  requestCanNavigate: () => Promise<boolean>;
};

export const NavigationGuardContext = createContext<NavigationGuardContextValue | null>(null);

export function useNavigationGuard() {
  const context = useContext(NavigationGuardContext);
  if (!context) throw new Error('useNavigationGuard must be used within NavigationGuardProvider');
  return context;
}
