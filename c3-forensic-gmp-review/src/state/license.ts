// v1 freemium gate. Per spec Section 8, this is intentionally honor-based:
// the format check runs entirely client-side, so a determined user can
// override it via devtools or by editing localStorage directly. v1.1 will
// replace the format check with a server-issued license / Stripe customer
// lookup; the public API surface (isValidLicenseKey, load/save/clear) is
// designed to stay stable so callers don't change.

const STORAGE_KEY = 'c3-license-key';

export const LICENSE_KEY_PATTERN = /^C3-[A-Z0-9]{4,}-[A-Z0-9]{4,}$/i;

export const isValidLicenseKey = (key: string): boolean =>
  LICENSE_KEY_PATTERN.test(key.trim());

const isBrowser = (): boolean =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

export const loadLicenseKey = (): string | null => {
  if (!isBrowser()) return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === null) return null;
    return isValidLicenseKey(stored) ? stored : null;
  } catch {
    return null;
  }
};

export const saveLicenseKey = (key: string): void => {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, key.trim());
  } catch {
    /* quota or disabled storage: ignore */
  }
};

export const clearLicenseKey = (): void => {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
};

const USD_REGEX = /\$\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?/g;

export const maskDollars = (s: string): string => s.replace(USD_REGEX, '$•••');
