import { describe, expect, it } from 'vitest';
import { contingencyMisuse } from '../rules/contingencyMisuse';
import { cleanPayApp, cleanProfile, line } from './fixtures';

describe('contingencyMisuse (Rule 4)', () => {
  it('produces no findings when there are no contingency draws this period', () => {
    expect(contingencyMisuse(cleanProfile(), cleanPayApp())).toEqual([]);
  });

  it('flags owner contingency draws this period when authorization is required', () => {
    const profile = cleanProfile();
    profile.ownerContingencyAmount = 200_000;
    const payApp = cleanPayApp();
    payApp.lineItems.push(
      line({
        code: 'CONT-OWN-01',
        description: "Owner's contingency draw",
        category: 'contingency_owner',
        workCompletedThisPeriod: 15_000,
      }),
    );

    const findings = contingencyMisuse(profile, payApp);
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.ruleId).toBe('CONTINGENCY_MISUSE');
    expect(f.severity).toBe('medium');
    expect(f.dollarExposure).toBe(15_000);
    expect(f.affectedLineItems).toEqual(['CONT-OWN-01']);
  });

  it('emits separate findings for owner and contractor contingency draws', () => {
    const profile = cleanProfile();
    const payApp = cleanPayApp();
    payApp.lineItems.push(
      line({
        code: 'CONT-OWN-01',
        category: 'contingency_owner',
        workCompletedThisPeriod: 10_000,
      }),
      line({
        code: 'CONT-GC-01',
        category: 'contingency_gc',
        workCompletedThisPeriod: 7_500,
      }),
    );

    const findings = contingencyMisuse(profile, payApp);
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.affectedLineItems[0]).sort()).toEqual([
      'CONT-GC-01',
      'CONT-OWN-01',
    ]);
  });

  it('does not fire when contingency does not require authorization', () => {
    const profile = cleanProfile();
    profile.contingencyRequiresAuthorization = false;
    const payApp = cleanPayApp();
    payApp.lineItems.push(
      line({
        code: 'CONT-OWN-01',
        category: 'contingency_owner',
        workCompletedThisPeriod: 50_000,
      }),
    );

    expect(contingencyMisuse(profile, payApp)).toEqual([]);
  });

  it('ignores prior-period contingency draws (this period only)', () => {
    const profile = cleanProfile();
    const payApp = cleanPayApp();
    payApp.lineItems.push(
      line({
        code: 'CONT-OWN-01',
        category: 'contingency_owner',
        workCompletedPrevious: 50_000,
        workCompletedThisPeriod: 0,
      }),
    );

    expect(contingencyMisuse(profile, payApp)).toEqual([]);
  });
});
