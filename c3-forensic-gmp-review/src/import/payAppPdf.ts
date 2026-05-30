// Maps the reconstructed G702/G703 table into the app's model. Returns a
// Partial profile + Partial pay app plus bare line items (the consumer adds
// _uiKey, mirroring the CSV path). G703 has no `category` column, so each line
// is classified heuristically from its description and flagged
// LOW_CONFIDENCE_CATEGORY so the user verifies it in the editable grid.

import type {
  LineCategory,
  PayAppLineItem,
  PayApplication,
  ProjectProfile,
} from '../engine/types';
import type { PdfToken } from './pdfExtract';
import { detectCovers, reconstructTable } from './pdfTable';
import { normalizeNumber, type ImportIssue } from './shared';

export interface PdfImportResult {
  success: boolean;
  profile: Partial<ProjectProfile>;
  payApp: Partial<PayApplication>;
  /** Bare line items — no _uiKey; the consumer assigns it on apply. */
  lineItems: PayAppLineItem[];
  issues: ImportIssue[];
}

/** One G702/G703 pay app located inside a (possibly multi-app) PDF. */
export interface DetectedPayApp {
  index: number;
  /** 1-based page where this app's G702 cover sits. */
  coverPage: number;
  firstPage: number;
  lastPage: number;
  contractor?: string;
  applicationNumber?: number;
  originalContractSum?: number;
}

/** Page span to restrict parsing to a single app inside a bundle. */
export interface PageRange {
  firstPage: number;
  lastPage: number;
}

const numOpt = (s: string | undefined): number | undefined => {
  if (s === undefined) return undefined;
  const n = normalizeNumber(s);
  return n === null || Number.isNaN(n) ? undefined : n;
};

// Split a bundle into its constituent pay apps. Each detected cover delimits an
// app; the app runs until the page before the next cover (or the document end).
export const detectPayApps = (tokens: PdfToken[]): DetectedPayApp[] => {
  const covers = detectCovers(tokens);
  const maxPage = tokens.reduce((m, t) => Math.max(m, t.page), 0);
  return covers.map((c, i) => ({
    index: i,
    coverPage: c.coverPage,
    firstPage: c.coverPage,
    lastPage: i + 1 < covers.length ? covers[i + 1]!.coverPage - 1 : maxPage,
    contractor: c.contractor,
    applicationNumber: numOpt(c.applicationNumber),
    originalContractSum: numOpt(c.originalContractSum),
  }));
};

const CATEGORY_KEYWORDS: { category: LineCategory; keywords: string[] }[] = [
  { category: 'fee', keywords: ['fee'] },
  {
    category: 'general_conditions',
    keywords: ['general conditions', 'general condition', 'gen cond'],
  },
  { category: 'bond', keywords: ['bond'] },
  { category: 'insurance', keywords: ['insurance'] },
  { category: 'contingency_owner', keywords: ["owner's contingency", 'owner contingency'] },
  { category: 'contingency_gc', keywords: ['contingency'] },
  { category: 'allowance', keywords: ['allowance'] },
];

const guessCategory = (description: string): LineCategory => {
  const d = description.toLowerCase();
  for (const { category, keywords } of CATEGORY_KEYWORDS) {
    if (keywords.some((k) => d.includes(k))) return category;
  }
  return 'cost_of_work';
};

const num = (s: string | undefined): number | undefined => {
  if (s === undefined) return undefined;
  const n = normalizeNumber(s);
  return n === null || Number.isNaN(n) ? undefined : n;
};

const isTotalRow = (description: string): boolean =>
  /\b(grand\s+total|sub\s*total|total)\b/i.test(description);

export const parsePayAppPdf = (
  tokens: PdfToken[],
  range?: PageRange,
): PdfImportResult => {
  const issues: ImportIssue[] = [];
  const scoped = range
    ? tokens.filter((t) => t.page >= range.firstPage && t.page <= range.lastPage)
    : tokens;

  if (scoped.length === 0) {
    issues.push({
      severity: 'error',
      code: 'PDF_NO_TEXT_LAYER',
      message:
        'No text layer found in the PDF. It is likely a scan; use CSV import instead.',
    });
    return { success: false, profile: {}, payApp: {}, lineItems: [], issues };
  }

  const { headerFound, g703, g702 } = reconstructTable(scoped);
  if (!headerFound) {
    issues.push({
      severity: 'error',
      code: 'PDF_NO_TABLE_FOUND',
      message:
        'Could not locate the G703 continuation-sheet header. Confirm this is a ' +
        'standard G702/G703 PDF, or use CSV import.',
    });
    return { success: false, profile: {}, payApp: {}, lineItems: [], issues };
  }

  const lineItems: PayAppLineItem[] = [];
  let rowNumber = 0;
  for (const mapped of g703) {
    const code = (mapped.cells.code ?? '').trim();
    const description = (mapped.cells.description ?? '').trim();
    const scheduledValue = num(mapped.cells.scheduledValue);
    const workCompletedPrevious = num(mapped.cells.workCompletedPrevious);
    const workCompletedThisPeriod = num(mapped.cells.workCompletedThisPeriod);
    const materialsPresentlyStored = num(mapped.cells.materialsPresentlyStored);
    const retainageWithheld = num(mapped.cells.retainageWithheld);

    if (!code && !description) continue;
    const hasValue = [
      scheduledValue,
      workCompletedPrevious,
      workCompletedThisPeriod,
      materialsPresentlyStored,
    ].some((v) => v !== undefined);
    if (!hasValue) continue;
    if (!code && isTotalRow(description)) continue;

    rowNumber += 1;
    const category = guessCategory(description);
    issues.push({
      severity: 'warning',
      code: 'LOW_CONFIDENCE_CATEGORY',
      row: rowNumber,
      column: 'category',
      message: `Category for "${description || code}" was guessed as "${category}". Verify it in the grid.`,
    });

    const item: PayAppLineItem = {
      code: code || `LINE-${rowNumber}`,
      description,
      scheduledValue: scheduledValue ?? 0,
      workCompletedPrevious: workCompletedPrevious ?? 0,
      workCompletedThisPeriod: workCompletedThisPeriod ?? 0,
      materialsPresentlyStored: materialsPresentlyStored ?? 0,
      category,
    };
    if (retainageWithheld !== undefined) item.retainageWithheld = retainageWithheld;
    lineItems.push(item);
  }

  if (lineItems.length === 0) {
    issues.push({
      severity: 'error',
      code: 'PDF_NO_TABLE_FOUND',
      message: 'Located the table header but could not read any data rows.',
    });
    return { success: false, profile: {}, payApp: {}, lineItems: [], issues };
  }

  // --- G702 summary -> PayApplication ---
  const payApp: Partial<PayApplication> = {};
  const appNo = num(g702.applicationNumber);
  if (appNo !== undefined) payApp.applicationNumber = appNo;
  if (g702.periodTo) payApp.periodTo = g702.periodTo;

  const totalCompleted = num(g702.totalCompletedAndStored);
  const retainage = num(g702.retainage);
  if (totalCompleted !== undefined) payApp.reportedTotalCompletedAndStored = totalCompleted;
  if (retainage !== undefined) payApp.reportedRetainage = retainage;
  const earnedLess = num(g702.totalEarnedLessRetainage);
  if (earnedLess !== undefined) payApp.reportedTotalEarnedLessRetainage = earnedLess;
  const lessPrev = num(g702.lessPreviousCertificates);
  if (lessPrev !== undefined) payApp.reportedLessPreviousCertificates = lessPrev;
  const currentDue = num(g702.currentPaymentDue);
  if (currentDue !== undefined) payApp.reportedCurrentPaymentDue = currentDue;

  // --- Profile (only fields the PDF can supply; leave the rest untouched) ---
  const profile: Partial<ProjectProfile> = {};
  if (g702.projectName) profile.projectName = g702.projectName;
  const gmp = num(g702.originalContractSum) ?? num(g702.contractSumToDate);
  if (gmp !== undefined) profile.gmpAmount = gmp;

  // retainagePercent is stored as a fraction (0.05 = 5%). Reported retainage ÷
  // completed already yields a fraction; flag it as an estimate.
  if (retainage !== undefined && totalCompleted) {
    const fraction = retainage / totalCompleted;
    profile.retainagePercent = fraction;
    issues.push({
      severity: 'warning',
      code: 'LOW_CONFIDENCE_CATEGORY',
      column: 'retainagePercent',
      message: `Retainage percent estimated at ${(fraction * 100).toFixed(1)}% from reported retainage ÷ completed. Verify against the contract.`,
    });
  }

  return { success: true, profile, payApp, lineItems, issues };
};
