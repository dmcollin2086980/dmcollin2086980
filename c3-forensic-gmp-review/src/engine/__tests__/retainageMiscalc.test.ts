import { describe, expect, it } from 'vitest';
import { retainageMiscalc } from '../rules/retainageMiscalc';
import { cleanPayApp, cleanProfile } from './fixtures';

describe('retainageMiscalc (Rule 2)', () => {
  it('produces no findings when reported retainage matches expected', () => {
    expect(retainageMiscalc(cleanProfile(), cleanPayApp())).toEqual([]);
  });

  it('flags over-withheld retainage with delta exposure', () => {
    const payApp = cleanPayApp();
    payApp.reportedRetainage = 100_000; // expected 71,750
    const findings = retainageMiscalc(cleanProfile(), payApp);
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.ruleId).toBe('RETAINAGE_MISCALC');
    expect(f.severity).toBe('high');
    expect(f.title).toBe('Retainage over-withheld by contractor');
    expect(f.dollarExposure).toBe(28_250);
  });

  it('flags under-withheld retainage', () => {
    const payApp = cleanPayApp();
    payApp.reportedRetainage = 50_000; // expected 71,750
    const findings = retainageMiscalc(cleanProfile(), payApp);
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.title).toBe('Retainage under-withheld by contractor');
    expect(f.dollarExposure).toBe(21_750);
  });

  it('excludes stored materials when profile disallows it', () => {
    const profile = cleanProfile();
    profile.retainageOnStoredMaterials = false;
    const payApp = cleanPayApp();
    // Add a stored-materials amount of 100,000 to an existing line.
    const cow = payApp.lineItems.find((l) => l.code === 'COW-01')!;
    cow.materialsPresentlyStored = 100_000;
    // Refresh the G702 rollup so arithmetic stays internally consistent
    // (this rule does not check arithmetic, but keep fixture honest).
    payApp.reportedTotalCompletedAndStored = 1_535_000;
    // Expected retainage = 0.05 * (1,435,000 completed) = 71,750 (stored excluded)
    payApp.reportedRetainage = 71_750;
    expect(retainageMiscalc(profile, payApp)).toEqual([]);
  });

  it('steps retainage to zero once the reduction threshold is reached', () => {
    const profile = cleanProfile();
    profile.retainageReductionAtPercent = 0.25; // 25% complete
    const payApp = cleanPayApp();
    // Completion = 1,435,000 / 5,000,000 = 28.7%, threshold triggered.
    payApp.reportedRetainage = 0;
    expect(retainageMiscalc(profile, payApp)).toEqual([]);
  });

  it('respects released line items by removing them from the base', () => {
    const profile = cleanProfile();
    profile.retainageReleasedLineItems = ['BOND-01']; // 40,000 of completed
    const payApp = cleanPayApp();
    // New base = 1,435,000 - 40,000 = 1,395,000; expected = 69,750
    payApp.reportedRetainage = 69_750;
    expect(retainageMiscalc(profile, payApp)).toEqual([]);
  });
});
