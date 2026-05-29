import { useMemo, useState } from 'react';
import type { AuditResult, PayApplication, ProjectProfile } from '../engine/types';
import { buildMarkdownMemo } from '../memo/buildMarkdownMemo';
import { useLicense } from '../state/LicenseContext';
import { maskDollars } from '../state/license';
import { slugify } from '../state/profile';
import { Field, TextInput } from './Field';

interface Props {
  profile: ProjectProfile;
  payApp: PayApplication;
  result: AuditResult;
}

export const MemoPreview = ({ profile, payApp, result }: Props) => {
  const { isUnlocked } = useLicense();
  const [preparedBy, setPreparedBy] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  const memo = useMemo(
    () => buildMarkdownMemo({ profile, payApp, result, preparedBy }),
    [profile, payApp, result, preparedBy],
  );
  const displayedMemo = isUnlocked ? memo : maskDollars(memo);

  const handleCopy = async () => {
    if (!isUnlocked) return;
    try {
      await navigator.clipboard.writeText(memo);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      setCopyState('error');
    }
  };

  const downloadBlob = (blob: Blob, extension: 'md' | 'pdf') => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugify(profile.projectName)}-payapp-${payApp.applicationNumber}-memo.${extension}`;
    document.body.appendChild(a);
    try {
      a.click();
    } finally {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const handleDownload = () => {
    if (!isUnlocked) return;
    downloadBlob(new Blob([memo], { type: 'text/markdown' }), 'md');
  };

  const handleDownloadPdf = async () => {
    if (!isUnlocked) return;
    // jspdf + jspdf-autotable add ~400KB to the bundle, so we keep them out
    // of the main chunk and pay the load cost only on first .pdf click.
    const { buildPdfMemo } = await import('../memo/buildPdfMemo');
    downloadBlob(buildPdfMemo({ profile, payApp, result, preparedBy }), 'pdf');
  };

  const lockedTitle = isUnlocked ? undefined : 'Activate a license to unlock memo export.';

  return (
    <section
      aria-label="Exposure memo"
      className="rounded-md border border-slate-200 bg-white p-4 shadow-sm"
    >
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">Exposure memo</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            disabled={!isUnlocked}
            title={lockedTitle}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {copyState === 'copied' ? 'Copied' : 'Copy memo'}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!isUnlocked}
            title={lockedTitle}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            Download .md
          </button>
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={!isUnlocked}
            title={lockedTitle}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            Download .pdf
          </button>
        </div>
      </header>

      <div className="mb-3">
        <Field label="Prepared by" hint="Shown in the memo header.">
          <TextInput
            value={preparedBy}
            onChange={setPreparedBy}
            placeholder="Owner's representative name"
          />
        </Field>
      </div>

      {copyState === 'error' && (
        <p role="alert" className="mb-2 text-sm text-red-600">
          Could not copy to clipboard. Use Download instead.
        </p>
      )}

      <pre
        aria-label="Memo preview"
        className="max-h-[28rem] overflow-auto whitespace-pre rounded border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800"
      >
        {displayedMemo}
      </pre>
    </section>
  );
};
