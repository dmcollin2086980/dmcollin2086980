import { describe, expect, it } from 'vitest';
import { runAudit } from '../runner';
import { cleanPayApp, cleanProfile, line } from './fixtures';

describe('runAudit', () => {
  it('zero false positives: clean fixture produces no high/medium findings', () => {
    const result = runAudit(cleanProfile(), cleanPayApp());
    expect(result.counts.high).toBe(0);
    expect(result.counts.medium).toBe(0);
    expect(result.totalExposure).toBe(0);
  });

  it('aggregates multiple rules and sorts by severity then exposure', () => {
    // Acceptance-criteria scenario: over-withheld retainage AND insurance
    // fee-on-fee, plus an allowance overrun, a GC cap breach, and a
    // contingency draw without authorization. G702 rollups are refreshed
    // so Rule 8 (arithmetic) is silent and only the targeted rules fire.
    const profile = cleanProfile();
    profile.gcCapAmount = 100_000; // cumulative GC 120,000 -> 20,000 overage
    const payApp = cleanPayApp();

    const feeLine = payApp.lineItems.find((l) => l.code === 'FEE-01')!;
    feeLine.feeBasisCategories = ['cost_of_work', 'insurance'];

    const allow = payApp.lineItems.find((l) => l.code === 'ALLOW-01')!;
    allow.workCompletedPrevious = 30_000; // overrun 5,000 vs allowance 25,000

    payApp.lineItems.push(
      line({
        code: 'CONT-OWN-01',
        category: 'contingency_owner',
        workCompletedThisPeriod: 12_000,
      }),
    );

    // Refresh G702 rollups: new total completed+stored = clean's 1,435,000
    // + allow's added 30,000 + contingency's added 12,000 = 1,477,000.
    payApp.reportedTotalCompletedAndStored = 1_477_000;
    payApp.reportedRetainage = 100_000; // expected 73,850 -> 26,150 over-withheld
    payApp.reportedTotalEarnedLessRetainage = 1_377_000;
    payApp.reportedCurrentPaymentDue = 237_000;

    const result = runAudit(profile, payApp);

    const ruleIds = result.findings.map((f) => f.ruleId);
    expect(ruleIds).toContain('RETAINAGE_MISCALC');
    expect(ruleIds).toContain('INSURANCE_BOND_PASSTHROUGH');
    expect(ruleIds).toContain('ALLOWANCE_OVERRUN');
    expect(ruleIds).toContain('GC_CAP_BREACH');
    expect(ruleIds).toContain('CONTINGENCY_MISUSE');
    expect(ruleIds).not.toContain('ARITHMETIC_INTEGRITY');

    // Highs precede mediums precede lows.
    let lastRank = -1;
    const rank = { high: 0, medium: 1, low: 2 } as const;
    for (const f of result.findings) {
      expect(rank[f.severity]).toBeGreaterThanOrEqual(lastRank);
      lastRank = rank[f.severity];
    }

    // Within severity, dollar exposure descends.
    const highs = result.findings.filter((f) => f.severity === 'high');
    for (let i = 1; i < highs.length; i++) {
      expect(highs[i - 1]!.dollarExposure).toBeGreaterThanOrEqual(
        highs[i]!.dollarExposure,
      );
    }

    expect(result.counts.high).toBe(2); // retainage + insurance
    expect(result.counts.medium).toBe(3); // allowance + gc cap + contingency
    // totalExposure = high + medium exposures
    // = 26,150 (retainage) + 750 (insurance) + 5,000 (allowance)
    //   + 20,000 (gc cap) + 12,000 (contingency)
    expect(result.totalExposure).toBe(63_900);
  });

  it('every finding carries the required advisory flag', () => {
    const profile = cleanProfile();
    const payApp = cleanPayApp();
    payApp.reportedRetainage = 100_000;
    const result = runAudit(profile, payApp);
    for (const f of result.findings) {
      expect(f.reviewFlagOnly).toBe(true);
      expect(f.contractBasis).toBeTruthy();
      expect(f.explanation).toBeTruthy();
      expect(f.recommendedAction).toBeTruthy();
    }
  });
});
