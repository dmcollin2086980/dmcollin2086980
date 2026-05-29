import type {
  AuditResult,
  Finding,
  PayApplication,
  ProjectProfile,
  Severity,
} from '../engine/types';
import { formatUsd } from '../format';

export interface BuildMemoOptions {
  profile: ProjectProfile;
  payApp: PayApplication;
  result: AuditResult;
  preparedBy?: string;
  now?: Date;
}

const SEVERITY_LABEL: Record<Severity, string> = {
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
};

export { SEVERITY_LABEL };

export const DISCLAIMER = [
  'This analysis is an advisory review of flags identified by deterministic rules',
  'applied to the Project Profile and pay application data provided. It is not a',
  'legal determination. Contract interpretation should be confirmed with counsel',
  'and the project record. Findings reflect only the inputs provided to this tool',
  'and do not constitute a review of underlying source documents.',
].join('\n');

const escapeCell = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');

export const stripEmDash = (s: string): string => s.replace(/—/g, '-');

const buildHeader = (
  profile: ProjectProfile,
  payApp: PayApplication,
  preparedBy: string | undefined,
  now: Date,
): string => {
  const lines = [
    '# C3 Forensic GMP Review',
    '',
    `**Project:** ${profile.projectName.trim() || '(not specified)'}`,
    `**Pay Application:** #${payApp.applicationNumber}`,
    `**Period ending:** ${payApp.periodTo.trim() || '(not set)'}`,
    `**Prepared by:** ${(preparedBy ?? '').trim() || '(not specified)'}`,
    `**Prepared on:** ${now.toISOString().slice(0, 10)}`,
  ];
  return lines.join('\n');
};

const buildSummary = (payApp: PayApplication, result: AuditResult): string => {
  if (result.findings.length === 0) {
    return [
      '## Summary',
      '',
      `This forensic review of Pay Application #${payApp.applicationNumber} identifies no findings against the contract terms encoded in the Project Profile.`,
    ].join('\n');
  }
  const { counts, totalExposure, findings } = result;
  return [
    '## Summary',
    '',
    `This forensic review of Pay Application #${payApp.applicationNumber} identifies ${findings.length} finding(s) against the contract terms encoded in the Project Profile: ${counts.high} high, ${counts.medium} medium, ${counts.low} low. Estimated total exposure across high and medium findings is ${formatUsd(totalExposure)}.`,
  ].join('\n');
};

const buildFindingsTable = (result: AuditResult): string => {
  if (result.findings.length === 0) return '';
  const header =
    '| Severity | Rule | Title | Affected lines | Dollar exposure | Contract basis | Recommended action |';
  const separator = '| --- | --- | --- | --- | --- | --- | --- |';
  const rows = result.findings.map((f) => {
    const cells = [
      SEVERITY_LABEL[f.severity],
      f.ruleId,
      escapeCell(f.title),
      escapeCell(f.affectedLineItems.join(', ')),
      formatUsd(f.dollarExposure),
      escapeCell(f.contractBasis),
      escapeCell(f.recommendedAction),
    ];
    return `| ${cells.join(' | ')} |`;
  });
  return ['## Findings', '', header, separator, ...rows].join('\n');
};

const buildDetailedFindings = (result: AuditResult): string => {
  const detailed = result.findings.filter(
    (f) => f.severity === 'high' || f.severity === 'medium',
  );
  if (detailed.length === 0) return '';

  const sections = detailed.map((f, i) => buildDetailedFinding(f, i + 1));
  return ['## Detailed findings', '', sections.join('\n\n')].join('\n');
};

const buildDetailedFinding = (f: Finding, position: number): string => {
  const affected =
    f.affectedLineItems.length > 0 ? f.affectedLineItems.join(', ') : '(none)';
  return [
    `### ${position}. ${f.title} (${SEVERITY_LABEL[f.severity]}, ${formatUsd(f.dollarExposure)})`,
    '',
    `**Rule:** ${f.ruleId}`,
    `**Contract basis:** ${f.contractBasis}`,
    `**Affected lines:** ${affected}`,
    '',
    f.explanation,
    '',
    `**Recommended action:** ${f.recommendedAction}`,
  ].join('\n');
};

export const buildMarkdownMemo = ({
  profile,
  payApp,
  result,
  preparedBy,
  now = new Date(),
}: BuildMemoOptions): string => {
  const sections = [
    buildHeader(profile, payApp, preparedBy, now),
    buildSummary(payApp, result),
  ];
  const table = buildFindingsTable(result);
  if (table) sections.push(table);
  const detailed = buildDetailedFindings(result);
  if (detailed) sections.push(detailed);
  sections.push(['## Disclaimer', '', DISCLAIMER].join('\n'));

  const memo = sections.join('\n\n') + '\n';
  return stripEmDash(memo);
};
