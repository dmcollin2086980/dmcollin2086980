import { useRef, useState } from 'react';
import type { PayApplication, ProjectProfile } from '../engine/types';
import type { PdfImportResult } from '../import/payAppPdf';
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

type Status = 'idle' | 'parsing' | 'done' | 'failed';

export const PdfImport = ({ profile, payApp, onProfile, onPayApp }: Props) => {
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<PdfImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setStatus('parsing');
    setResult(null);
    setError(null);
    try {
      // Lazy-load pdf.js + the parser so they ship in their own chunk and stay
      // out of the main bundle (mirrors MemoPreview's buildPdfMemo import).
      const [{ extractPdfTokens }, { parsePayAppPdf }] = await Promise.all([
        import('../import/pdfExtract'),
        import('../import/payAppPdf'),
      ]);
      const tokens = await extractPdfTokens(await file.arrayBuffer());
      const parsed = parsePayAppPdf(tokens);
      setResult(parsed);
      setStatus(parsed.success ? 'done' : 'failed');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to read the PDF.');
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
    setResult(null);
    setStatus('idle');
    if (fileInputRef.current) fileInputRef.current.value = '';
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
        the G702 summary, and the G703 grid. Scanned/image PDFs are not supported — use
        CSV import for those. Verify the guessed line categories in the grid after import.
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
        {status === 'parsing' && (
          <span className="text-sm text-slate-500">Parsing…</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleApply}
          disabled={!result || !result.success}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:bg-slate-400 disabled:cursor-not-allowed"
        >
          Apply to profile &amp; pay app
        </button>
      </div>

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
            <p className="mt-1 text-xs text-slate-600">
              Detected — {profileFields.join(' · ')}
            </p>
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
