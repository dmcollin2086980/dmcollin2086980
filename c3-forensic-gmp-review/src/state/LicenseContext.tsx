import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import {
  clearLicenseKey,
  isValidLicenseKey,
  loadLicenseKey,
  saveLicenseKey,
} from './license';

export interface ActivateResult {
  ok: boolean;
  error?: string;
}

export interface LicenseState {
  isUnlocked: boolean;
  activate: (key: string) => ActivateResult;
  deactivate: () => void;
}

const Context = createContext<LicenseState | null>(null);

export const LicenseProvider = ({ children }: { children: ReactNode }) => {
  const [isUnlocked, setIsUnlocked] = useState<boolean>(() => loadLicenseKey() !== null);

  const activate = useCallback((key: string): ActivateResult => {
    if (!isValidLicenseKey(key)) {
      return { ok: false, error: 'License key format not recognized.' };
    }
    saveLicenseKey(key);
    setIsUnlocked(true);
    return { ok: true };
  }, []);

  const deactivate = useCallback(() => {
    clearLicenseKey();
    setIsUnlocked(false);
  }, []);

  return (
    <Context.Provider value={{ isUnlocked, activate, deactivate }}>
      {children}
    </Context.Provider>
  );
};

export const useLicense = (): LicenseState => {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useLicense must be used inside <LicenseProvider>');
  return ctx;
};
