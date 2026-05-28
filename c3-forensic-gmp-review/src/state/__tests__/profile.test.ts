import { describe, expect, it } from 'vitest';
import {
  defaultProfile,
  parseProfileJson,
  ProfileParseError,
  profileToJson,
  slugify,
} from '../profile';
import { runAudit } from '../../engine/runner';
import { parsePayAppCsv } from '../../import/csv';
import { SAMPLE_CSV } from '../../import/__tests__/fixtures';

describe('defaultProfile', () => {
  it('matches the engine contract: zero high/medium findings against the addendum sample CSV', () => {
    const profile = defaultProfile();
    profile.gmpAmount = 5_000_000;
    const parsed = parsePayAppCsv(SAMPLE_CSV);
    expect(parsed.success).toBe(true);

    const totalCompletedAndStored = parsed.lineItems.reduce(
      (acc, l) =>
        acc +
        l.workCompletedPrevious +
        l.workCompletedThisPeriod +
        l.materialsPresentlyStored,
      0,
    );
    const retainage = +(0.05 * totalCompletedAndStored).toFixed(2);
    const result = runAudit(profile, {
      applicationNumber: 1,
      periodTo: '2026-05-31',
      lineItems: parsed.lineItems,
      reportedTotalCompletedAndStored: totalCompletedAndStored,
      reportedRetainage: retainage,
      reportedTotalEarnedLessRetainage: +(totalCompletedAndStored - retainage).toFixed(2),
      reportedLessPreviousCertificates: 0,
      reportedCurrentPaymentDue: +(totalCompletedAndStored - retainage).toFixed(2),
    });
    expect(result.counts.high).toBe(0);
    expect(result.counts.medium).toBe(0);
  });
});

describe('JSON round-trip', () => {
  it('profileToJson -> parseProfileJson restores the default profile', () => {
    const profile = defaultProfile();
    profile.projectName = 'Example Hospital';
    profile.gmpAmount = 12_500_000;
    profile.allowances = [
      { code: 'ALLOW-01', description: 'Signage', amount: 25_000 },
    ];
    profile.retainageReductionAtPercent = 0.5;
    profile.retainageReleasedLineItems = ['BOND-01'];
    profile.gcCapAmount = 400_000;
    profile.notes = 'Renovation of east wing.';
    const json = profileToJson(profile);
    expect(parseProfileJson(json)).toEqual(profile);
  });

  it('preserves the absence of optional fields', () => {
    const profile = defaultProfile();
    const restored = parseProfileJson(profileToJson(profile));
    expect(restored).toEqual(profile);
    expect('retainageReductionAtPercent' in restored).toBe(false);
    expect('gcCapAmount' in restored).toBe(false);
  });
});

describe('parseProfileJson validation', () => {
  it('rejects non-JSON', () => {
    expect(() => parseProfileJson('not json')).toThrow(ProfileParseError);
  });

  it('rejects a non-object top-level value', () => {
    expect(() => parseProfileJson('[1, 2, 3]')).toThrow(ProfileParseError);
  });

  it('rejects a missing required field', () => {
    const profile = defaultProfile();
    const json = JSON.parse(profileToJson(profile));
    delete json.feePercent;
    expect(() => parseProfileJson(JSON.stringify(json))).toThrow(/feePercent/);
  });

  it('rejects an invalid contract type', () => {
    const profile = defaultProfile();
    const json = JSON.parse(profileToJson(profile));
    json.contractType = 'WHATEVER';
    expect(() => parseProfileJson(JSON.stringify(json))).toThrow(/contractType/);
  });

  it('rejects malformed allowance entries', () => {
    const profile = defaultProfile();
    const json = JSON.parse(profileToJson(profile));
    json.allowances = [{ code: 'ALLOW-01' }];
    expect(() => parseProfileJson(JSON.stringify(json))).toThrow(/allowances/);
  });
});

describe('slugify', () => {
  it('lowercases and replaces non-alphanumerics with single dashes', () => {
    expect(slugify('Example Hospital  Renovation!')).toBe('example-hospital-renovation');
  });

  it('falls back to "project" when input slugs to empty', () => {
    expect(slugify('   ')).toBe('project');
  });
});
