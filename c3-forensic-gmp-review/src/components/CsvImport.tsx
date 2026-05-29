import { useRef, useState } from 'react';
import type { PayAppLineItem } from '../engine/types';
import { parsePayAppCsv, type ImportIssue, type ImportResult } from '../import/csv';

interface Props {
  onLines: (lines: PayAppLineItem[]) => void;
}

const severityClasses: Record<ImportIssue['severity'], string> = {
  error: 'bg-red-100 text-red-800',
  warning: 'bg-amber-100 text-amber-800',
};

export const CsvImport = ({ onLines }: Props) => {
  const [pastedText, setPastedText] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const runParse = (input: string) => {
    if (input.trim() === '') {
      setResult(null);
      return;
    }
    setResult(parsePayAppCsv(input));
  };

  const handleFile = async (file: File) => {
    const text = await file.text();
    setPastedText(text);
    runParse(text);
  };

  const handleApply = () => {
    if (!result || !result.success) return;
    onLines(result.lineItems);
    setResult(null);
    setPastedText('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const sortedIssues = result
    ? [
        ...result.issues.filter((i) => i.severity === 'error'),
        ...result.issues.filter((i) => i.severity === 'warning'),
      ]
    : [];

  return (
    <div className="md:col-span-2 flex flex-col gap-3">
      <p className="text-xs text-slate-500">
        Importing replaces every line in the G703 grid below. The G702 summary fields
        are entered separately.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv"
          aria-label="Upload pay application CSV"
          className="text-sm"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Or paste CSV / TSV</span>
        <textarea
          value={pastedText}
          onChange={(e) => setPastedText(e.target.value)}
          rows={6}
          placeholder="code,description,scheduled_value,..."
          aria-label="Paste CSV or TSV"
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs font-mono shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        />
      </label>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => runParse(pastedText)}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
        >
          Parse
        </button>
        <button
          type="button"
          onClick={handleApply}
          disabled={!result || !result.success}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:bg-slate-400 disabled:cursor-not-allowed"
        >
          Replace G703 lines
        </button>
      </div>

      {result && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="font-medium text-slate-800">
            {result.success
              ? `Will import ${result.lineItems.length} line(s).`
              : `Cannot import. ${result.issues.filter((i) => i.severity === 'error').length} error(s) found.`}
          </p>
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
