import { describe, expect, it } from 'vitest';
import { parsePayAppCsv } from '../csv';
import { SAMPLE_CSV, SAMPLE_TSV } from './fixtures';

const HEADER =
  'code,description,scheduled_value,work_completed_previous,work_completed_this_period,materials_presently_stored,category,retainage_withheld,fee_basis_categories';

describe('parsePayAppCsv', () => {
  it('parses the addendum sample CSV into six line items with no issues', () => {
    const result = parsePayAppCsv(SAMPLE_CSV);
    expect(result.success).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.lineItems).toHaveLength(6);

    const fee = result.lineItems.find((l) => l.code === 'FEE-01');
    expect(fee).toBeDefined();
    expect(fee!.category).toBe('fee');
    expect(fee!.feeBasisCategories).toEqual(['cost_of_work']);

    const bond = result.lineItems.find((l) => l.code === 'BOND-01');
    expect(bond!.workCompletedPrevious).toBe(40_000);
    expect(bond!.feeBasisCategories).toBeUndefined();
    expect(bond!.retainageWithheld).toBeUndefined();
  });

  it('parses a tab-delimited paste of the same content identically', () => {
    const csv = parsePayAppCsv(SAMPLE_CSV);
    const tsv = parsePayAppCsv(SAMPLE_TSV);
    expect(tsv.success).toBe(true);
    expect(tsv.issues).toEqual([]);
    expect(tsv.lineItems).toEqual(csv.lineItems);
  });

  it('normalizes numbers: $, commas, whitespace, parentheses as negative', () => {
    const input = [
      HEADER,
      'A-COMMAS,x,"$3,000,000",100,200,0,cost_of_work,,',
      'B-DECIMAL,x,1500,"$1,200.50",0,0,cost_of_work,,',
      'C-PARENS,x,2000,0,(500),0,cost_of_work,,',
      'D-WHITESPACE,x, 42 ,1,1,0,cost_of_work,,',
    ].join('\n');
    const result = parsePayAppCsv(input);
    expect(result.success).toBe(true);
    expect(result.lineItems[0]!.scheduledValue).toBe(3_000_000);
    expect(result.lineItems[1]!.workCompletedPrevious).toBe(1200.5);
    expect(result.lineItems[2]!.workCompletedThisPeriod).toBe(-500);
    expect(result.lineItems[3]!.scheduledValue).toBe(42);
  });

  it('flags a missing header row', () => {
    const result = parsePayAppCsv(
      'COW-01,General construction,3000000,1000000,200000,0,cost_of_work,,',
    );
    expect(result.success).toBe(false);
    expect(result.lineItems).toEqual([]);
    expect(result.issues[0]!.code).toBe('HEADER_MISMATCH');
  });

  it('flags a misordered header row', () => {
    const misordered = HEADER.replace(
      'scheduled_value,work_completed_previous',
      'work_completed_previous,scheduled_value',
    );
    const result = parsePayAppCsv(`${misordered}\nCOW-01,x,1,2,3,4,cost_of_work,,`);
    expect(result.success).toBe(false);
    expect(result.issues[0]!.code).toBe('HEADER_MISMATCH');
  });

  it('accepts a case-insensitive header row', () => {
    const upper = HEADER.toUpperCase();
    const result = parsePayAppCsv(`${upper}\nCOW-01,x,1,2,3,4,cost_of_work,,`);
    expect(result.success).toBe(true);
    expect(result.lineItems).toHaveLength(1);
  });

  it('flags an unknown category with the correct row number', () => {
    const result = parsePayAppCsv(
      [
        HEADER,
        'COW-01,x,1,2,3,4,cost_of_work,,',
        'BOGUS-01,x,1,2,3,4,not_a_category,,',
      ].join('\n'),
    );
    expect(result.success).toBe(false);
    const issue = result.issues.find((i) => i.code === 'UNKNOWN_CATEGORY')!;
    expect(issue.row).toBe(3);
    expect(issue.column).toBe('category');
  });

  it('flags a non-numeric value in a numeric column', () => {
    const result = parsePayAppCsv(
      [HEADER, 'COW-01,x,abc,2,3,4,cost_of_work,,'].join('\n'),
    );
    expect(result.success).toBe(false);
    const issue = result.issues.find((i) => i.code === 'NON_NUMERIC')!;
    expect(issue.column).toBe('scheduled_value');
    expect(issue.row).toBe(2);
  });

  it('flags an empty required numeric cell', () => {
    const result = parsePayAppCsv(
      [HEADER, 'COW-01,x,1000,,3,4,cost_of_work,,'].join('\n'),
    );
    expect(result.success).toBe(false);
    const issue = result.issues.find(
      (i) => i.code === 'MISSING_REQUIRED' && i.column === 'work_completed_previous',
    );
    expect(issue).toBeDefined();
  });

  it('flags duplicate codes', () => {
    const result = parsePayAppCsv(
      [
        HEADER,
        'COW-01,x,1,2,3,4,cost_of_work,,',
        'COW-01,y,5,6,7,8,cost_of_work,,',
      ].join('\n'),
    );
    expect(result.success).toBe(false);
    const issue = result.issues.find((i) => i.code === 'DUPLICATE_CODE')!;
    expect(issue.row).toBe(3);
    expect(issue.message).toContain('first seen on row 2');
  });

  it('flags a fee line with empty fee_basis_categories', () => {
    const result = parsePayAppCsv(
      [HEADER, 'FEE-01,x,100,0,0,0,fee,,'].join('\n'),
    );
    expect(result.success).toBe(false);
    expect(result.issues.some((i) => i.code === 'FEE_WITHOUT_BASIS')).toBe(true);
  });

  it('flags an unknown token in fee_basis_categories', () => {
    const result = parsePayAppCsv(
      [HEADER, 'FEE-01,x,100,0,0,0,fee,,cost_of_widgets'].join('\n'),
    );
    expect(result.success).toBe(false);
    const issue = result.issues.find((i) => i.code === 'UNKNOWN_FEE_BASIS')!;
    expect(issue.message).toContain('cost_of_widgets');
  });

  it('warns when a non-fee line carries fee_basis_categories and drops the value', () => {
    const result = parsePayAppCsv(
      [HEADER, 'COW-01,x,1,2,3,4,cost_of_work,,cost_of_work'].join('\n'),
    );
    expect(result.success).toBe(true);
    const warning = result.issues.find((i) => i.code === 'NON_FEE_HAS_BASIS')!;
    expect(warning.severity).toBe('warning');
    expect(result.lineItems[0]!.feeBasisCategories).toBeUndefined();
  });

  it('warns when a line overbills its scheduled value', () => {
    const result = parsePayAppCsv(
      [HEADER, 'COW-01,x,100,60,50,0,cost_of_work,,'].join('\n'),
    );
    expect(result.success).toBe(true);
    const warning = result.issues.find((i) => i.code === 'OVERBILLING')!;
    expect(warning.severity).toBe('warning');
    expect(result.lineItems).toHaveLength(1);
  });

  it('flags empty input', () => {
    expect(parsePayAppCsv('').issues[0]!.code).toBe('EMPTY_INPUT');
    expect(parsePayAppCsv('   \n\n  ').issues[0]!.code).toBe('EMPTY_INPUT');
  });

  it('accepts a header-only input as a successful empty parse', () => {
    const result = parsePayAppCsv(HEADER);
    expect(result.success).toBe(true);
    expect(result.lineItems).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it('produces output the audit runner consumes with zero high/medium findings', async () => {
    const { runAudit } = await import('../../engine/runner');
    const { cleanProfile } = await import('../../engine/__tests__/fixtures');
    const parsed = parsePayAppCsv(SAMPLE_CSV);
    expect(parsed.success).toBe(true);

    const totalCompletedAndStored = parsed.lineItems.reduce(
      (acc, l) =>
        acc + l.workCompletedPrevious + l.workCompletedThisPeriod + l.materialsPresentlyStored,
      0,
    );
    const retainage = +(0.05 * totalCompletedAndStored).toFixed(2);
    const earnedLessRetainage = +(totalCompletedAndStored - retainage).toFixed(2);
    const result = runAudit(cleanProfile(), {
      applicationNumber: 1,
      periodTo: '2026-05-31',
      lineItems: parsed.lineItems,
      reportedTotalCompletedAndStored: totalCompletedAndStored,
      reportedRetainage: retainage,
      reportedTotalEarnedLessRetainage: earnedLessRetainage,
      reportedLessPreviousCertificates: 0,
      reportedCurrentPaymentDue: earnedLessRetainage,
    });
    expect(result.counts.high).toBe(0);
    expect(result.counts.medium).toBe(0);
  });
});
