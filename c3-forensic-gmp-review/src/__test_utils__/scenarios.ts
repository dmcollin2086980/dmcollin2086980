import type { PayApplication, ProjectProfile } from '../engine/types';
import { runAudit } from '../engine/runner';
import { parsePayAppCsv } from '../import/csv';
import { SAMPLE_CSV } from '../import/__tests__/fixtures';
import { defaultProfile } from '../state/profile';

/**
 * Shared scenario builders for memo / findings UI tests. Three test files used
 * to redefine these locally; they live here so a profile field rename only
 * touches one file.
 */

export const cleanMemoProfile = (): ProjectProfile => {
  const p = defaultProfile();
  p.projectName = 'Example Hospital';
  p.gmpAmount = 5_000_000;
  p.allowances = [
    { code: 'ALLOW-01', description: 'Signage allowance', amount: 25_000 },
  ];
  return p;
};

export const tiedPayAppFromSample = (): PayApplication => {
  const parsed = parsePayAppCsv(SAMPLE_CSV);
  if (!parsed.success) throw new Error('sample CSV should parse');
  const total = parsed.lineItems.reduce(
    (acc, l) =>
      acc +
      l.workCompletedPrevious +
      l.workCompletedThisPeriod +
      l.materialsPresentlyStored,
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

/**
 * The same scenario covered by `runner.test.ts`'s "aggregates multiple rules"
 * test: insurance fee-on-fee + allowance overrun + GC cap breach + contingency
 * draw without authorization + over-withheld retainage. Returns the inputs and
 * the precomputed `result` so callers can pass it through.
 */
export const buildAcceptanceScenario = () => {
  const profile = cleanMemoProfile();
  profile.gcCapAmount = 100_000;

  const payApp = tiedPayAppFromSample();

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
