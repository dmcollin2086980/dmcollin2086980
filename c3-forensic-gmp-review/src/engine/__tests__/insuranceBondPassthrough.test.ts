import { describe, expect, it } from 'vitest';
import { insuranceBondPassthrough } from '../rules/insuranceBondPassthrough';
import { cleanPayApp, cleanProfile } from './fixtures';

describe('insuranceBondPassthrough (Rule 3)', () => {
  it('produces no findings on the clean fixture', () => {
    expect(insuranceBondPassthrough(cleanProfile(), cleanPayApp())).toEqual([]);
  });

  it('fires when fee tags insurance and profile marks it passthrough-at-cost', () => {
    const profile = cleanProfile();
    const payApp = cleanPayApp();
    const feeLine = payApp.lineItems.find((l) => l.code === 'FEE-01')!;
    feeLine.feeBasisCategories = ['cost_of_work', 'insurance'];

    const findings = insuranceBondPassthrough(profile, payApp);
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.ruleId).toBe('INSURANCE_BOND_PASSTHROUGH');
    expect(f.severity).toBe('high');
    // 0.05 * 15,000 (10k prev + 5k this) insurance c2d = 750
    expect(f.dollarExposure).toBe(750);
    expect(f.contractBasis).toBe('insurancePassthroughAtCost = true');
  });

  it('fires for bond independently of insurance', () => {
    const profile = cleanProfile();
    const payApp = cleanPayApp();
    const feeLine = payApp.lineItems.find((l) => l.code === 'FEE-01')!;
    feeLine.feeBasisCategories = ['cost_of_work', 'bond'];

    const findings = insuranceBondPassthrough(profile, payApp);
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    // 0.05 * 40,000 bond c2d = 2,000
    expect(f.dollarExposure).toBe(2_000);
    expect(f.contractBasis).toBe('bondPassthroughAtCost = true');
  });

  it('does not fire when profile does not treat them as passthrough', () => {
    const profile = cleanProfile();
    profile.insurancePassthroughAtCost = false;
    profile.bondPassthroughAtCost = false;
    const payApp = cleanPayApp();
    const feeLine = payApp.lineItems.find((l) => l.code === 'FEE-01')!;
    feeLine.feeBasisCategories = ['cost_of_work', 'insurance', 'bond'];

    expect(insuranceBondPassthrough(profile, payApp)).toEqual([]);
  });

  it('does not own general_conditions or contingency (Rule 1 territory)', () => {
    const profile = cleanProfile();
    const payApp = cleanPayApp();
    const feeLine = payApp.lineItems.find((l) => l.code === 'FEE-01')!;
    feeLine.feeBasisCategories = ['cost_of_work', 'general_conditions'];

    expect(insuranceBondPassthrough(profile, payApp)).toEqual([]);
  });
});
