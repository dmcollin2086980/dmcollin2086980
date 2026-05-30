import { useRef, useState } from 'react';
import type { PayApplication, ProjectProfile } from '../engine/types';
import type { DetectedPayApp, PdfImportResult } from '../import/payAppPdf';
import type { PdfToken } from '../import/pdfExtract';
import type { ImportIssue } from '../import/shared';
import { makeUiKey } from '../state/payApp';

interface Props {
  profile: ProjectProfile;
  payApp: PayApplication;
  onProfile: (next: ProjectProfile) => void;
  onPayApp: (next: PayApplication) => void;
}

const severityClasses: Record<ImportIssue['severity'], string> = {
  error: 'bg-red-100 text-red-800',
  warning: 'bg-amber-100 text-amber-800',
};

type Status = 'idle' | 'parsing' | 'choose' | 'done' | 'failed';

export const PdfImport = ({ profile, payApp, onProfile, onPayApp }: Props) => {
  const [status, setStatus] = useState<Status>('idle');
  const [tokens, setTokens] = useState<PdfToken[] | null>(null);
  const [apps, setApps] = useState<DetectedPayApp[]>([]);
  const [result, setResult] = useState<PdfImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = (keepFile = false) => {
    setStatus('idle');
    setTokens(null);
    setApps([]);
    setResult(null);
    setError(null);
    if (!keepFile && fileInputRef.current) fileInputRef.current.value = '';
  };

  const runParse = async (toks: PdfToken[], app?: DetectedPayApp) => {
    const { parsePayAppPdf } = await import('../import/payAppPdf');
    const parsed = parsePayAppPdf(toks, app && { firstPage: app.firstPage, lastPage: app.lastPage });
    setResult(parsed);
    setStatus(parsed.success ? 'done' : 'failed');
  };

  const handleFile = async (file: File) => {
    setStatus('parsing');
    setResult(null);
    setError(null);
    setApps([]);
    try {
      // Lazy-load pdf.js + the parser so they ship in their own chunk and stay
      // out of the main bundle (mirrors MemoPreview's buildPdfMemo import).
      const [{ extractPdfTokens }, { detectPayApps }] = await Promise.all([
        import('../import/pdfExtract'),
        import('../import/payAppPdf'),
      ]);
      const toks = await extractPdfTokens(await file.arrayBuffer());
      setTokens(toks);
      const detected = detectPayApps(toks);
      if (detected.length > 1) {
        // A bundled monthly report — let the user pick which app to import.
        setApps(detected);
        setStatus('choose');
        return;
      }
      await runParse(toks, detected[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to read the PDF.');
      setStatus('failed');
    }
  };

  const handlePick = async (app: DetectedPayApp) => {
    if (!tokens) return;
    setStatus('parsing');
    setError(null);
    try {
      await runParse(tokens, app);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse the selected pay app.');
      setStatus('failed');
    }
  };

  const handleApply = () => {
    if (!result || !result.success) return;
    onProfile({ ...profile, ...result.profile });
    onPayApp({
      ...payApp,
      ...result.payApp,
      lineItems: result.lineItems.map((l) => ({ ...l, _uiKey: makeUiKey() })),
    });
    reset();
  };

  const sortedIssues = result
    ? [
        ...result.issues.filter((i) => i.severity === 'error'),
        ...result.issues.filter((i) => i.severity === 'warning'),
      ]
    : [];

  const profileFields = result
    ? [
        result.profile.projectName !== undefined && `Project: ${result.profile.projectName}`,
        result.profile.gmpAmount !== undefined &&
          `GMP: ${result.profile.gmpAmount.toLocaleString()}`,
        result.profile.retainagePercent !== undefined &&
          `Retainage: ${(result.profile.retainagePercent * 100).toFixed(1)}%`,
      ].filter((s): s is string => Boolean(s))
    : [];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-500">
        Upload a digital (text-layer) G702/G703 PDF. This fills the Project profile,
        the G702 summary, and the G703 grid. A bundled monthly report with several
        pay apps will prompt you to choose one. Scanned/image PDFs are not supported —
        use CSV import for those. Verify the guessed line categories in the grid after
        import.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          aria-label="Upload pay application PDF"
          className="text-sm"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        {status === 'parsing' && <span className="text-sm text-slate-500">Parsing…</span>}
      </div>

      {status === 'choose' && (
        <div className="rounded-md border border-slate-200 bg-white p-3 text-sm">
          <p className="mb-2 font-medium text-slate-800">
            This PDF bundles {apps.length} pay applications. Choose one to import:
          </p>
          <ul className="flex flex-col gap-1" role="list">
            {apps.map((app) => (
              <li key={app.index}>
                <button
                  type="button"
                  onClick={() => void handlePick(app)}
                  className="flex w-full items-baseline justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 text-left hover:bg-slate-50"
                >
                  <span className="font-medium text-slate-800">
                    {app.contractor ?? `Pay app ${app.index + 1}`}
                  </span>
                  <span className="text-xs text-slate-500">
                    {app.applicationNumber !== undefined && `App #${app.applicationNumber} · `}
                    {app.originalContractSum !== undefined &&
                      `OCS ${app.originalContractSum.toLocaleString()} · `}
                    pp. {app.firstPage}–{app.lastPage}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(status === 'done' || status === 'failed') && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleApply}
            disabled={!result || !result.success}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:bg-slate-400 disabled:cursor-not-allowed"
          >
            Apply to profile &amp; pay app
          </button>
          {apps.length > 1 && (
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setStatus('choose');
              }}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              Pick a different app
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {result && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="font-medium text-slate-800">
            {result.success
              ? `Will import ${result.lineItems.length} line(s).`
              : `Cannot import. ${result.issues.filter((i) => i.severity === 'error').length} error(s) found.`}
          </p>

          {profileFields.length > 0 && (
            <p className="mt-1 text-xs text-slate-600">Detected — {profileFields.join(' · ')}</p>
          )}
          {result.payApp.reportedTotalCompletedAndStored !== undefined && (
            <p className="mt-1 text-xs text-slate-600">
              G702 total completed &amp; stored:{' '}
              {result.payApp.reportedTotalCompletedAndStored.toLocaleString()}
            </p>
          )}

          {sortedIssues.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1" role="list">
              {sortedIssues.map((issue, idx) => (
                <li key={idx} className="flex items-start gap-2 text-xs">
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide ${severityClasses[issue.severity]}`}
                  >
                    {issue.severity}
                  </span>
                  <span className="text-slate-700">
                    {issue.row !== undefined && (
                      <span className="font-mono text-slate-500">row {issue.row}</span>
                    )}
                    {issue.row !== undefined && issue.column !== undefined && ' · '}
                    {issue.column !== undefined && (
                      <span className="font-mono text-slate-500">{issue.column}</span>
                    )}
                    {(issue.row !== undefined || issue.column !== undefined) && ' — '}
                    {issue.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
