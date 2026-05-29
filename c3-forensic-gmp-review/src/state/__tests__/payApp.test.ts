import { describe, expect, it } from 'vitest';
import {
  defaultPayApp,
  emptyLineItem,
  feeBasisToText,
  parseFeeBasisText,
} from '../payApp';
import { defaultProfile } from '../profile';
import { runAudit } from '../../engine/runner';
import { parsePayAppCsv } from '../../import/csv';
import { SAMPLE_CSV } from '../../import/__tests__/fixtures';

describe('defaultPayApp', () => {
  it('returns a zeroed pay application with no lines', () => {
    const p = defaultPayApp();
    expect(p.applicationNumber).toBe(1);
    expect(p.lineItems).toEqual([]);
    expect(p.reportedTotalCompletedAndStored).toBe(0);
    expect(p.reportedCurrentPaymentDue).toBe(0);
  });
});

describe('emptyLineItem', () => {
  it('starts as cost_of_work with zero amounts', () => {
    const line = emptyLineItem();
    expect(line.category).toBe('cost_of_work');
    expect(line.scheduledValue).toBe(0);
    expect(line.workCompletedThisPeriod).toBe(0);
  });

  it('assigns a non-empty _uiKey for React reconciliation', () => {
    const a = emptyLineItem();
    const b = emptyLineItem();
    expect(typeof a._uiKey).toBe('string');
    expect(a._uiKey!.length).toBeGreaterThan(0);
    expect(a._uiKey).not.toBe(b._uiKey);
  });
});

describe('fee basis text round-trip', () => {
  it('parses comma-separated categories, ignoring whitespace and unknown tokens', () => {
    expect(
      parseFeeBasisText('cost_of_work, general_conditions , made_up_thing'),
    ).toEqual(['cost_of_work', 'general_conditions']);
  });

  it('feeBasisToText is the inverse for valid input', () => {
    expect(feeBasisToText(['cost_of_work', 'general_conditions'])).toBe(
      'cost_of_work, general_conditions',
    );
    expect(feeBasisToText(undefined)).toBe('');
  });
});

describe('engine contract: defaults + sample CSV import → zero high/medium findings', () => {
  it('runAudit returns zero high/medium when fed parsed sample CSV and tied G702 rollups', () => {
    const profile = defaultProfile();
    profile.gmpAmount = 5_000_000;

    const parsed = parsePayAppCsv(SAMPLE_CSV);
    expect(parsed.success).toBe(true);

    const payApp = defaultPayApp();
    payApp.lineItems = parsed.lineItems;
    const totalCompletedAndStored = parsed.lineItems.reduce(
      (acc, l) =>
        acc +
        l.workCompletedPrevious +
        l.workCompletedThisPeriod +
        l.materialsPresentlyStored,
      0,
    );
    const retainage = +(0.05 * totalCompletedAndStored).toFixed(2);
    payApp.reportedTotalCompletedAndStored = totalCompletedAndStored;
    payApp.reportedRetainage = retainage;
    payApp.reportedTotalEarnedLessRetainage = +(
      totalCompletedAndStored - retainage
    ).toFixed(2);
    payApp.reportedLessPreviousCertificates = 0;
    payApp.reportedCurrentPaymentDue = payApp.reportedTotalEarnedLessRetainage;

    const result = runAudit(profile, payApp);
    expect(result.counts.high).toBe(0);
    expect(result.counts.medium).toBe(0);
  });
});
