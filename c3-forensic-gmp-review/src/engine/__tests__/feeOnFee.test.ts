import { describe, expect, it } from 'vitest';
import { feeOnFee } from '../rules/feeOnFee';
import { cleanPayApp, cleanProfile } from './fixtures';

describe('feeOnFee (Rule 1)', () => {
  it('produces no findings on the clean fixture', () => {
    expect(feeOnFee(cleanProfile(), cleanPayApp())).toEqual([]);
  });

  it('fires when fee tags general_conditions and the profile disallows it', () => {
    const profile = cleanProfile();
    const payApp = cleanPayApp();
    const feeLine = payApp.lineItems.find((l) => l.code === 'FEE-01')!;
    feeLine.feeBasisCategories = ['cost_of_work', 'general_conditions'];

    const findings = feeOnFee(profile, payApp);
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.ruleId).toBe('FEE_ON_FEE');
    expect(f.severity).toBe('high');
    // Exposure = 0.05 * 120,000 (completed-to-date of GC) = 6,000
    expect(f.dollarExposure).toBe(6_000);
    expect(f.contractBasis).toContain('appliesToGeneralConditions');
    expect(f.affectedLineItems).toContain('FEE-01');
    expect(f.affectedLineItems).toContain('GC-01');
  });

  it('fires once per disallowed category when multiple are tagged', () => {
    const profile = cleanProfile();
    const payApp = cleanPayApp();
    payApp.lineItems.push({
      code: 'CONT-OWN-01',
      description: "Owner's contingency",
      scheduledValue: 100_000,
      workCompletedPrevious: 30_000,
      workCompletedThisPeriod: 10_000,
      materialsPresentlyStored: 0,
      category: 'contingency_owner',
    });
    const feeLine = payApp.lineItems.find((l) => l.code === 'FEE-01')!;
    feeLine.feeBasisCategories = [
      'cost_of_work',
      'general_conditions',
      'contingency_owner',
    ];

    const findings = feeOnFee(profile, payApp);
    expect(findings).toHaveLength(2);
    const ruleIds = findings.map((f) => f.ruleId);
    expect(ruleIds).toEqual(['FEE_ON_FEE', 'FEE_ON_FEE']);

    const gcFinding = findings.find((f) =>
      f.contractBasis.includes('appliesToGeneralConditions'),
    )!;
    expect(gcFinding.dollarExposure).toBe(6_000);

    const contingencyFinding = findings.find((f) =>
      f.contractBasis.includes('appliesToContingency'),
    )!;
    // 0.05 * 40,000 (30k + 10k) = 2,000
    expect(contingencyFinding.dollarExposure).toBe(2_000);
  });

  it('does not fire when the contract permits the base', () => {
    const profile = cleanProfile();
    profile.feeBase.appliesToGeneralConditions = true;
    const payApp = cleanPayApp();
    const feeLine = payApp.lineItems.find((l) => l.code === 'FEE-01')!;
    feeLine.feeBasisCategories = ['cost_of_work', 'general_conditions'];

    expect(feeOnFee(profile, payApp)).toEqual([]);
  });

  it('does not fire when there is no completed-to-date in the disallowed category', () => {
    const profile = cleanProfile();
    const payApp = cleanPayApp();
    const gc = payApp.lineItems.find((l) => l.code === 'GC-01')!;
    gc.workCompletedPrevious = 0;
    gc.workCompletedThisPeriod = 0;
    const feeLine = payApp.lineItems.find((l) => l.code === 'FEE-01')!;
    feeLine.feeBasisCategories = ['cost_of_work', 'general_conditions'];

    expect(feeOnFee(profile, payApp)).toEqual([]);
  });

  it('does not own insurance or bond (Rule 3 territory)', () => {
    const profile = cleanProfile();
    const payApp = cleanPayApp();
    const feeLine = payApp.lineItems.find((l) => l.code === 'FEE-01')!;
    feeLine.feeBasisCategories = ['cost_of_work', 'insurance', 'bond'];

    expect(feeOnFee(profile, payApp)).toEqual([]);
  });
});
