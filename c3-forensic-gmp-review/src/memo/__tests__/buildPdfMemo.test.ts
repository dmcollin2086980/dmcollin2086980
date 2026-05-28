import { describe, expect, it } from 'vitest';
import { buildPdfMemo } from '../buildPdfMemo';
import type { AuditResult, PayApplication, ProjectProfile } from '../../engine/types';
import { runAudit } from '../../engine/runner';
import { defaultProfile } from '../../state/profile';
import { parsePayAppCsv } from '../../import/csv';
import { SAMPLE_CSV } from '../../import/__tests__/fixtures';

const fixedNow = new Date('2026-05-28T00:00:00Z');

const cleanProfile = (): ProjectProfile => {
  const p = defaultProfile();
  p.projectName = 'Example Hospital';
  p.gmpAmount = 5_000_000;
  p.allowances = [
    { code: 'ALLOW-01', description: 'Signage allowance', amount: 25_000 },
  ];
  return p;
};

const cleanPayApp = (): PayApplication => {
  const parsed = parsePayAppCsv(SAMPLE_CSV);
  if (!parsed.success) throw new Error('sample CSV should parse');
  const total = parsed.lineItems.reduce(
    (acc, l) =>
      acc + l.workCompletedPrevious + l.workCompletedThisPeriod + l.materialsPresentlyStored,
    0,
  );
  const retainage = +(0.05 * total).toFixed(2);
  return {
    applicationNumber: 7,
    periodTo: '2026-05-31',
    lineItems: parsed.lineItems,
    reportedTotalCompletedAndStored: total,
    reportedRetainage: retainage,
    reportedTotalEarnedLessRetainage: +(total - retainage).toFixed(2),
    reportedLessPreviousCertificates: 0,
    reportedCurrentPaymentDue: +(total - retainage).toFixed(2),
  };
};

const acceptanceScenario = () => {
  const profile = cleanProfile();
  profile.gcCapAmount = 100_000;
  const payApp = cleanPayApp();
  const feeIdx = payApp.lineItems.findIndex((l) => l.code === 'FEE-01');
  payApp.lineItems[feeIdx] = {
    ...payApp.lineItems[feeIdx]!,
    feeBasisCategories: ['cost_of_work', 'insurance'],
  };
  const allowIdx = payApp.lineItems.findIndex((l) => l.code === 'ALLOW-01');
  payApp.lineItems[allowIdx] = {
    ...payApp.lineItems[allowIdx]!,
    workCompletedPrevious: 30_000,
  };
  payApp.lineItems.push({
    code: 'CONT-OWN-01',
    description: "Owner's contingency draw",
    scheduledValue: 200_000,
    workCompletedPrevious: 0,
    workCompletedThisPeriod: 12_000,
    materialsPresentlyStored: 0,
    category: 'contingency_owner',
  });
  payApp.reportedTotalCompletedAndStored = 1_477_000;
  payApp.reportedRetainage = 100_000;
  payApp.reportedTotalEarnedLessRetainage = 1_377_000;
  payApp.reportedLessPreviousCertificates = 0;
  payApp.reportedCurrentPaymentDue = 1_377_000;
  return { profile, payApp, result: runAudit(profile, payApp) };
};

const decodeAscii = async (blob: Blob): Promise<string> => {
  const buf = await blob.arrayBuffer();
  return new TextDecoder('latin1').decode(buf);
};

describe('buildPdfMemo', () => {
  it('returns a Blob with the PDF mime type and non-zero size', () => {
    const profile = cleanProfile();
    const payApp = cleanPayApp();
    const blob = buildPdfMemo({
      profile,
      payApp,
      result: runAudit(profile, payApp),
      now: fixedNow,
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(500);
  });

  it('starts with the %PDF- magic header', async () => {
    const profile = cleanProfile();
    const payApp = cleanPayApp();
    const blob = buildPdfMemo({
      profile,
      payApp,
      result: runAudit(profile, payApp),
      now: fixedNow,
    });
    const text = await decodeAscii(blob);
    expect(text.startsWith('%PDF-')).toBe(true);
  });

  it('embeds the project name in the binary', async () => {
    const { profile, payApp, result } = acceptanceScenario();
    const blob = buildPdfMemo({ profile, payApp, result, preparedBy: 'J. Smith', now: fixedNow });
    const text = await decodeAscii(blob);
    expect(text).toContain('Example Hospital');
    expect(text).toContain('J. Smith');
  });

  it('omits the Findings heading entirely when there are no findings', async () => {
    const profile = cleanProfile();
    const payApp = cleanPayApp();
    const result: AuditResult = runAudit(profile, payApp);
    expect(result.findings).toHaveLength(0);

    const blob = buildPdfMemo({ profile, payApp, result, now: fixedNow });
    const text = await decodeAscii(blob);
    expect(text).toContain('Summary');
    expect(text).toContain('Disclaimer');
    expect(text).not.toContain('Detailed findings');
  });

  it('produces same-size output for identical inputs and a fixed now', async () => {
    // jspdf inserts a randomized /ID array in the trailer (one of two PDF
    // identifiers). Bit-for-bit equality across runs isn't achievable
    // without monkey-patching. Same input -> same byte length is the
    // strongest portable invariant.
    const { profile, payApp, result } = acceptanceScenario();
    const a = buildPdfMemo({ profile, payApp, result, preparedBy: 'J. Smith', now: fixedNow });
    const b = buildPdfMemo({ profile, payApp, result, preparedBy: 'J. Smith', now: fixedNow });
    expect(a.size).toBe(b.size);
  });
});
