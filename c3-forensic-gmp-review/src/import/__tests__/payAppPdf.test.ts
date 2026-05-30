import { describe, expect, it } from 'vitest';
import { detectPayApps, parsePayAppPdf } from '../payAppPdf';
import {
  BUNDLE_PDF_TOKENS,
  GMP_SOV_TOKENS,
  NO_HEADER_TOKENS,
  SAMPLE_PDF_TOKENS,
} from './pdfFixtures';

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

describe('detectPayApps', () => {
  it('splits a bundle into its constituent pay apps with page ranges', () => {
    const apps = detectPayApps(BUNDLE_PDF_TOKENS);
    expect(apps).toHaveLength(2);
    expect(apps[0]).toMatchObject({
      index: 0,
      coverPage: 1,
      firstPage: 1,
      lastPage: 3,
      contractor: 'Acme Builders, LLC',
      applicationNumber: 3,
      originalContractSum: 3_490_000,
    });
    expect(apps[1]).toMatchObject({
      index: 1,
      coverPage: 4,
      firstPage: 4,
      contractor: 'Beta Mechanical Inc.',
      applicationNumber: 7,
      originalContractSum: 9_000_000,
    });
  });

  it('returns a single app for a non-bundled PDF', () => {
    expect(detectPayApps(SAMPLE_PDF_TOKENS)).toHaveLength(1);
  });

  it('parses only the selected app when a page range is given', () => {
    // Restricting to page 2+ excludes the G702 cover, so no summary is read but
    // the G703 grid on page 2 still parses.
    const result = parsePayAppPdf(SAMPLE_PDF_TOKENS, { firstPage: 2, lastPage: 2 });
    expect(result.success).toBe(true);
    expect(result.lineItems).toHaveLength(4);
    expect(result.payApp.reportedTotalCompletedAndStored).toBeUndefined();
  });
});

describe('parsePayAppPdf — GMP schedule-of-values template', () => {
  it('reads detail line items with group-prefixed codes and adjusted SOV values', () => {
    const result = parsePayAppPdf(GMP_SOV_TOKENS);
    expect(result.success).toBe(true);
    expect(result.lineItems).toHaveLength(2);
    const sitework = result.lineItems[0]!;
    expect(sitework.code).toBe('001-0010');
    expect(sitework.description).toBe('Sitework');
    expect(sitework.scheduledValue).toBe(100_000); // D, adjusted SOV
    expect(sitework.workCompletedPrevious).toBe(40_000); // E
    expect(sitework.workCompletedThisPeriod).toBe(10_000); // F
    expect(sitework.retainageWithheld).toBe(5_000); // J
  });

  it('classifies categories from the description', () => {
    const byCode = Object.fromEntries(
      parsePayAppPdf(GMP_SOV_TOKENS).lineItems.map((l) => [l.code, l.category]),
    );
    expect(byCode['001-0010']).toBe('cost_of_work');
    expect(byCode['002-0020']).toBe('general_conditions');
  });

  it('derives reported totals and profile from the ORDER SUMMARY total row', () => {
    const { payApp, profile } = parsePayAppPdf(GMP_SOV_TOKENS);
    expect(payApp.applicationNumber).toBe(2);
    expect(payApp.periodTo).toBe('2/28/2026');
    expect(payApp.reportedTotalCompletedAndStored).toBe(120_000); // H
    expect(payApp.reportedRetainage).toBe(15_000); // J
    expect(payApp.reportedTotalEarnedLessRetainage).toBe(105_000); // H - J
    expect(payApp.reportedCurrentPaymentDue).toBe(105_000); // N
    expect(payApp.reportedLessPreviousCertificates).toBe(0); // (H-J) - N
    expect(profile.gmpAmount).toBe(300_000); // D total
    expect(profile.retainagePercent).toBeCloseTo(0.125, 5); // 15,000 / 120,000
  });

  it('is not detected as a multi-app bundle (no AIA cover)', () => {
    expect(detectPayApps(GMP_SOV_TOKENS)).toHaveLength(0);
  });
});
