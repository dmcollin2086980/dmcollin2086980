import { describe, expect, it } from 'vitest';
import { allowanceOverrun } from '../rules/allowanceOverrun';
import { cleanPayApp, cleanProfile } from './fixtures';

describe('allowanceOverrun (Rule 5)', () => {
  it('produces no findings when allowance lines are within budget', () => {
    expect(allowanceOverrun(cleanProfile(), cleanPayApp())).toEqual([]);
  });

  it('flags allowance lines billed above the profile amount', () => {
    const profile = cleanProfile();
    const payApp = cleanPayApp();
    const allow = payApp.lineItems.find((l) => l.code === 'ALLOW-01')!;
    allow.workCompletedPrevious = 20_000;
    allow.workCompletedThisPeriod = 10_000; // total 30,000 vs allowance 25,000

    const findings = allowanceOverrun(profile, payApp);
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.ruleId).toBe('ALLOWANCE_OVERRUN');
    expect(f.severity).toBe('medium');
    expect(f.dollarExposure).toBe(5_000);
    expect(f.affectedLineItems).toEqual(['ALLOW-01']);
  });

  it('includes stored materials in the billed total', () => {
    const profile = cleanProfile();
    const payApp = cleanPayApp();
    const allow = payApp.lineItems.find((l) => l.code === 'ALLOW-01')!;
    allow.materialsPresentlyStored = 30_000;

    const findings = allowanceOverrun(profile, payApp);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.dollarExposure).toBe(5_000);
  });

  it('does not fire for allowance line items not declared in the profile', () => {
    const profile = cleanProfile();
    const payApp = cleanPayApp();
    payApp.lineItems.push({
      code: 'ALLOW-99',
      description: 'Phantom allowance',
      scheduledValue: 0,
      workCompletedPrevious: 5_000,
      workCompletedThisPeriod: 0,
      materialsPresentlyStored: 0,
      category: 'allowance',
    });

    expect(allowanceOverrun(profile, payApp)).toEqual([]);
  });
});
