export const PrivacyBanner = () => (
  <div
    role="note"
    aria-label="Privacy notice"
    className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-900"
  >
    <div className="mx-auto max-w-6xl">
      <strong>Your project data stays in this browser.</strong> No backend, no
      analytics, no accounts. Closing this tab clears your inputs; use{' '}
      <em>Export profile JSON</em> on the Project profile tab to save your work.
    </div>
  </div>
);
