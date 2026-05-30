import { describe, expect, it } from 'vitest';
import { parsePayAppPdf } from '../payAppPdf';
import { NO_HEADER_TOKENS, SAMPLE_PDF_TOKENS } from './pdfFixtures';

describe('parsePayAppPdf', () => {
  it('maps the sample tokens into four line items (skipping the total row)', () => {
    const result = parsePayAppPdf(SAMPLE_PDF_TOKENS);
    expect(result.success).toBe(true);
    expect(result.lineItems).toHaveLength(4);
    expect(result.lineItems.map((l) => l.code)).toEqual([
      'COW-01',
      'GC-01',
      'FEE-01',
      'BOND-01',
    ]);
  });

  it('normalizes money cells into numbers', () => {
    const result = parsePayAppPdf(SAMPLE_PDF_TOKENS);
    const cow = result.lineItems.find((l) => l.code === 'COW-01')!;
    expect(cow.scheduledValue).toBe(3_000_000);
    expect(cow.workCompletedPrevious).toBe(1_000_000);
    expect(cow.workCompletedThisPeriod).toBe(200_000);
    expect(cow.materialsPresentlyStored).toBe(0);
  });

  it('classifies categories heuristically from the description', () => {
    const byCode = Object.fromEntries(
      parsePayAppPdf(SAMPLE_PDF_TOKENS).lineItems.map((l) => [l.code, l.category]),
    );
    expect(byCode['COW-01']).toBe('cost_of_work');
    expect(byCode['GC-01']).toBe('general_conditions');
    expect(byCode['FEE-01']).toBe('fee');
    expect(byCode['BOND-01']).toBe('bond');
  });

  it('flags every line with a low-confidence category warning', () => {
    const result = parsePayAppPdf(SAMPLE_PDF_TOKENS);
    const catWarnings = result.issues.filter(
      (i) => i.code === 'LOW_CONFIDENCE_CATEGORY' && i.column === 'category',
    );
    expect(catWarnings).toHaveLength(4);
    expect(catWarnings.every((i) => i.severity === 'warning')).toBe(true);
  });

  it('returns bare line items with no _uiKey (the consumer assigns it)', () => {
    const result = parsePayAppPdf(SAMPLE_PDF_TOKENS);
    expect(result.lineItems.every((l) => l._uiKey === undefined)).toBe(true);
  });

  it('extracts the G702 summary into reported pay-app totals', () => {
    const { payApp } = parsePayAppPdf(SAMPLE_PDF_TOKENS);
    expect(payApp.applicationNumber).toBe(3);
    expect(payApp.periodTo).toBe('12/31/2025');
    expect(payApp.reportedTotalCompletedAndStored).toBe(1_565_000);
    expect(payApp.reportedRetainage).toBe(78_250);
    expect(payApp.reportedTotalEarnedLessRetainage).toBe(1_486_750);
    expect(payApp.reportedLessPreviousCertificates).toBe(1_200_000);
    expect(payApp.reportedCurrentPaymentDue).toBe(286_750);
  });

  it('derives profile gmpAmount, projectName, and retainagePercent as a fraction', () => {
    const { profile } = parsePayAppPdf(SAMPLE_PDF_TOKENS);
    expect(profile.gmpAmount).toBe(3_490_000);
    expect(profile.projectName).toBe('Acme Tower');
    // 78,250 / 1,565,000 = 0.05
    expect(profile.retainagePercent).toBeCloseTo(0.05, 5);
  });

  it('flags the estimated retainage percent as low-confidence', () => {
    const result = parsePayAppPdf(SAMPLE_PDF_TOKENS);
    const retWarning = result.issues.find((i) => i.column === 'retainagePercent');
    expect(retWarning).toBeDefined();
    expect(retWarning!.severity).toBe('warning');
  });

  it('errors with PDF_NO_TEXT_LAYER on empty token input', () => {
    const result = parsePayAppPdf([]);
    expect(result.success).toBe(false);
    expect(result.issues[0]!.code).toBe('PDF_NO_TEXT_LAYER');
  });

  it('errors with PDF_NO_TABLE_FOUND when no G703 header is present', () => {
    const result = parsePayAppPdf(NO_HEADER_TOKENS);
    expect(result.success).toBe(false);
    expect(result.issues.some((i) => i.code === 'PDF_NO_TABLE_FOUND')).toBe(true);
  });
});
