import { useMemo } from 'react';
import type {
  AuditResult,
  Finding,
  PayApplication,
  ProjectProfile,
  Severity,
} from '../engine/types';
import { runAudit } from '../engine/runner';
import { useLicense } from '../state/LicenseContext';
import { LicenseBar } from './LicenseBar';
import { MemoPreview } from './MemoPreview';

interface Props {
  profile: ProjectProfile;
  payApp: PayApplication;
}

const severityClasses: Record<Severity, string> = {
  high: 'bg-red-100 text-red-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-slate-100 text-slate-700',
};

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

const formatUsd = (n: number) => usdFormatter.format(n);

const DollarValue = ({ value }: { value: number }) => {
  const { isUnlocked } = useLicense();
  return <>{isUnlocked ? formatUsd(value) : '$•••'}</>;
};

const SummaryHeader = ({ result }: { result: AuditResult }) => (
  <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
      <div>
        <div className="text-xs uppercase tracking-wide text-slate-500">
          Estimated exposure
        </div>
        <div className="text-2xl font-semibold text-slate-900">
          <DollarValue value={result.totalExposure} />
        </div>
        <div className="text-xs text-slate-500">High + medium findings only.</div>
      </div>
      <div className="flex gap-3 text-sm">
        <span className="rounded bg-red-100 px-2 py-1 font-medium text-red-800">
          {result.counts.high} high
        </span>
        <span className="rounded bg-amber-100 px-2 py-1 font-medium text-amber-800">
          {result.counts.medium} medium
        </span>
        <span className="rounded bg-slate-100 px-2 py-1 font-medium text-slate-700">
          {result.counts.low} low
        </span>
      </div>
    </div>
  </div>
);

const FindingCard = ({ finding }: { finding: Finding }) => (
  <article
    className="rounded-md border border-slate-200 bg-white p-4 shadow-sm"
    aria-label={`Finding ${finding.ruleId}`}
  >
    <header className="flex items-start justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={
            'inline-block rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ' +
            severityClasses[finding.severity]
          }
        >
          {finding.severity}
        </span>
        <h3 className="text-base font-semibold text-slate-900">{finding.title}</h3>
      </div>
      <span className="font-mono text-xs text-slate-500">{finding.ruleId}</span>
    </header>

    <div className="mt-2 text-xl font-semibold text-slate-900">
      <DollarValue value={finding.dollarExposure} />
    </div>

    <dl className="mt-3 grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-500">
          Contract basis
        </dt>
        <dd className="font-mono text-xs text-slate-700">{finding.contractBasis}</dd>
      </div>
      {finding.affectedLineItems.length > 0 && (
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">
            Affected lines
          </dt>
          <dd className="font-mono text-xs text-slate-700">
            {finding.affectedLineItems.join(', ')}
          </dd>
        </div>
      )}
    </dl>

    <p className="mt-3 text-sm text-slate-700">{finding.explanation}</p>
    <p className="mt-2 text-sm text-slate-700">
      <span className="font-medium text-slate-900">Recommended action: </span>
      {finding.recommendedAction}
    </p>

    <footer className="mt-3 text-xs italic text-slate-500">
      Review flag only. This is an advisory finding, not a legal conclusion.
    </footer>
  </article>
);

export const FindingsView = ({ profile, payApp }: Props) => {
  const result = useMemo(() => runAudit(profile, payApp), [profile, payApp]);

  if (payApp.lineItems.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <LicenseBar />
        <div className="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
          Add line items in the Pay application tab before running the audit.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <LicenseBar />
      <SummaryHeader result={result} />

      {result.findings.length === 0 && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          No findings. The audit cleared every rule.
        </div>
      )}

      {result.findings.length > 0 &&
        result.counts.high === 0 &&
        result.counts.medium === 0 && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            No high or medium findings. Low-severity items below are informational.
          </div>
        )}

      <div className="flex flex-col gap-3">
        {result.findings.map((f, i) => (
          <FindingCard key={`${f.ruleId}-${i}`} finding={f} />
        ))}
      </div>

      <MemoPreview profile={profile} payApp={payApp} result={result} />
    </div>
  );
};
