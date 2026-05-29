import { describe, expect, it } from 'vitest';
import { gcCapBreach } from '../rules/gcCapBreach';
import { cleanPayApp, cleanProfile } from './fixtures';

describe('gcCapBreach (Rule 6)', () => {
  it('produces no findings when neither cap nor monthly rate is set', () => {
    expect(gcCapBreach(cleanProfile(), cleanPayApp())).toEqual([]);
  });

  it('flags cumulative GC billings above the cap', () => {
    const profile = cleanProfile();
    profile.gcCapAmount = 100_000; // cumulative GC is 120,000
    const findings = gcCapBreach(profile, cleanPayApp());
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.ruleId).toBe('GC_CAP_BREACH');
    expect(f.title).toBe(
      'Cumulative general conditions billings exceed the GC cap',
    );
    expect(f.dollarExposure).toBe(20_000);
  });

  it('flags monthly GC billings above the contractual rate', () => {
    const profile = cleanProfile();
    profile.gcMonthlyRate = 15_000; // this period GC is 20,000
    const findings = gcCapBreach(profile, cleanPayApp());
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.title).toBe(
      'General conditions billed above the contractual monthly rate',
    );
    expect(f.dollarExposure).toBe(5_000);
  });

  it('can emit both findings when cap and monthly rate are both breached', () => {
    const profile = cleanProfile();
    profile.gcCapAmount = 100_000;
    profile.gcMonthlyRate = 15_000;
    const findings = gcCapBreach(profile, cleanPayApp());
    expect(findings).toHaveLength(2);
  });

  it('does not fire when GC is within cap and rate', () => {
    const profile = cleanProfile();
    profile.gcCapAmount = 500_000;
    profile.gcMonthlyRate = 25_000;
    expect(gcCapBreach(profile, cleanPayApp())).toEqual([]);
  });
});
