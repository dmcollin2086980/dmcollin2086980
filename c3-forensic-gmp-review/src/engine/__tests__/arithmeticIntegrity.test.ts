import { describe, expect, it } from 'vitest';
import { arithmeticIntegrity } from '../rules/arithmeticIntegrity';
import { cleanPayApp, cleanProfile } from './fixtures';

describe('arithmeticIntegrity (Rule 8)', () => {
  it('produces no findings when all G702 rollups tie', () => {
    expect(arithmeticIntegrity(cleanProfile(), cleanPayApp())).toEqual([]);
  });

  it('flags total-completed-and-stored mismatches against G703 line sum', () => {
    const payApp = cleanPayApp();
    payApp.reportedTotalCompletedAndStored = 1_500_000; // computed is 1,435,000
    const findings = arithmeticIntegrity(cleanProfile(), payApp);
    const titles = findings.map((f) => f.title);
    expect(titles).toContain(
      'G702 total completed and stored does not tie to G703 line sum',
    );
    const f = findings.find((f) =>
      f.title.includes('does not tie to G703 line sum'),
    )!;
    expect(f.dollarExposure).toBe(65_000);
  });

  it('flags earned-less-retainage rollup inconsistency', () => {
    const payApp = cleanPayApp();
    payApp.reportedTotalEarnedLessRetainage = 1_400_000; // expected 1,363,250
    const findings = arithmeticIntegrity(cleanProfile(), payApp);
    const f = findings.find((f) =>
      f.title.includes('total earned less retainage'),
    )!;
    expect(f.dollarExposure).toBe(36_750);
  });

  it('flags current-payment-due rollup inconsistency', () => {
    const payApp = cleanPayApp();
    payApp.reportedCurrentPaymentDue = 250_000; // expected 223,250
    const findings = arithmeticIntegrity(cleanProfile(), payApp);
    const f = findings.find((f) =>
      f.title.includes('current payment due'),
    )!;
    expect(f.dollarExposure).toBe(26_750);
  });
});
