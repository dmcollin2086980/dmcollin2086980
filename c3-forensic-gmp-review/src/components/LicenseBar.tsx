import { useState, type FormEvent } from 'react';
import { useLicense } from '../state/LicenseContext';

export const LicenseBar = () => {
  const { isUnlocked, activate, deactivate } = useLicense();
  const [keyText, setKeyText] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (isUnlocked) {
    return (
      <div
        aria-label="License status"
        className="flex items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
      >
        <span>
          <strong>License activated.</strong> Dollar values and memo export are unlocked.
        </span>
        <button
          type="button"
          onClick={() => {
            deactivate();
            setError(null);
          }}
          className="rounded-md border border-emerald-300 bg-white px-2 py-1 text-xs font-medium text-emerald-900 hover:bg-emerald-100"
        >
          Deactivate
        </button>
      </div>
    );
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const result = activate(keyText);
    if (!result.ok) {
      setError(result.error ?? 'Activation failed.');
    } else {
      setError(null);
      setKeyText('');
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Activate license"
      className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
    >
      <div>
        <strong>Free tier.</strong> Enter a license key to unlock dollar values and
        memo export. Findings, severities, rule ids, titles, and explanations stay
        visible in either mode.
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={keyText}
          onChange={(e) => setKeyText(e.target.value)}
          placeholder="C3-XXXX-XXXX"
          aria-label="License key"
          className="rounded-md border border-amber-300 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
        />
        <button
          type="submit"
          className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
        >
          Activate
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
    </form>
  );
};
