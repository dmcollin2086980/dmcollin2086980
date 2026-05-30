import Papa from 'papaparse';
import { ALL_LINE_CATEGORIES, type LineCategory, type PayAppLineItem } from '../engine/types';
import {
  isRowEmpty,
  normalizeNumber,
  type ImportIssue,
  type ImportResult,
} from './shared';

// Re-exported so existing importers (CsvImport.tsx, csv.test.ts) that reference
// these from '../import/csv' keep working after the shared refactor.
export type { ImportIssue, ImportIssueCode, ImportResult } from './shared';

const EXPECTED_HEADERS = [
  'code',
  'description',
  'scheduled_value',
  'work_completed_previous',
  'work_completed_this_period',
  'materials_presently_stored',
  'category',
  'retainage_withheld',
  'fee_basis_categories',
] as const;

const VALID_CATEGORIES = ALL_LINE_CATEGORIES;

const failure = (issues: ImportIssue[]): ImportResult => ({
  success: false,
  lineItems: [],
  issues,
});

const validateHeader = (row: string[]): boolean => {
  if (row.length !== EXPECTED_HEADERS.length) return false;
  return EXPECTED_HEADERS.every(
    (expected, i) => (row[i] ?? '').trim().toLowerCase() === expected,
  );
};

export const parsePayAppCsv = (input: string): ImportResult => {
  if (input.trim() === '') {
    return failure([
      {
        severity: 'error',
        code: 'EMPTY_INPUT',
        message: 'Input is empty.',
      },
    ]);
  }

  const delimiter = input.includes('\t') ? '\t' : ',';
  const parsed = Papa.parse<string[]>(input, {
    header: false,
    skipEmptyLines: false,
    delimiter,
  });
  // Surface papaparse-level errors (unclosed quotes, ragged rows, etc.) so a
  // malformed import doesn't silently produce wrong cell alignments. The
  // parser still returns partial data, but we treat any structural error as
  // a hard failure.
  if (parsed.errors.length > 0) {
    return failure(
      parsed.errors.map((err) => ({
        severity: 'error' as const,
        code: 'PARSE_FAILURE' as const,
        row: typeof err.row === 'number' ? err.row + 1 : undefined,
        message: `CSV structural error: ${err.message}`,
      })),
    );
  }
  const rows = parsed.data;

  let headerIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    if (!isRowEmpty(rows[i] ?? [])) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex === -1) {
    return failure([
      {
        severity: 'error',
        code: 'EMPTY_INPUT',
        message: 'Input contains no non-empty rows.',
      },
    ]);
  }

  const headerRow = rows[headerIndex]!;
  if (!validateHeader(headerRow)) {
    return failure([
      {
        severity: 'error',
        code: 'HEADER_MISMATCH',
        row: headerIndex + 1,
        message:
          'Header row does not match the required schema. Expected, in order: ' +
          EXPECTED_HEADERS.join(', ') +
          '.',
      },
    ]);
  }

  const issues: ImportIssue[] = [];
  const lineItems: PayAppLineItem[] = [];
  const codeFirstRow = new Map<string, number>();

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const rawRow = rows[i] ?? [];
    if (isRowEmpty(rawRow)) continue;
    const rowNumber = i + 1;
    const cell = (idx: number): string => (rawRow[idx] ?? '').trim();

    const requireString = (idx: number, column: string): string | null => {
      const v = cell(idx);
      if (v === '') {
        issues.push({
          severity: 'error',
          code: 'MISSING_REQUIRED',
          row: rowNumber,
          column,
          message: `${column} is required and is empty.`,
        });
        return null;
      }
      return v;
    };

    const requireNumber = (idx: number, column: string): number | null => {
      const raw = cell(idx);
      if (raw === '') {
        issues.push({
          severity: 'error',
          code: 'MISSING_REQUIRED',
          row: rowNumber,
          column,
          message: `${column} is required and is empty.`,
        });
        return null;
      }
      const n = normalizeNumber(raw);
      if (n === null || Number.isNaN(n)) {
        issues.push({
          severity: 'error',
          code: 'NON_NUMERIC',
          row: rowNumber,
          column,
          message: `${column} is not a valid number: "${raw}".`,
        });
        return null;
      }
      return n;
    };

    const optionalNumber = (idx: number, column: string): number | undefined => {
      const raw = cell(idx);
      if (raw === '') return undefined;
      const n = normalizeNumber(raw);
      if (n === null || Number.isNaN(n)) {
        issues.push({
          severity: 'error',
          code: 'NON_NUMERIC',
          row: rowNumber,
          column,
          message: `${column} is not a valid number: "${raw}".`,
        });
        return undefined;
      }
      return n;
    };

    const code = requireString(0, 'code');
    const description = cell(1);
    const scheduledValue = requireNumber(2, 'scheduled_value');
    const workCompletedPrevious = requireNumber(3, 'work_completed_previous');
    const workCompletedThisPeriod = requireNumber(4, 'work_completed_this_period');
    const materialsPresentlyStored = requireNumber(5, 'materials_presently_stored');

    const categoryRaw = requireString(6, 'category');
    let category: LineCategory | null = null;
    if (categoryRaw !== null) {
      if (!VALID_CATEGORIES.includes(categoryRaw as LineCategory)) {
        issues.push({
          severity: 'error',
          code: 'UNKNOWN_CATEGORY',
          row: rowNumber,
          column: 'category',
          message:
            `Unknown category "${categoryRaw}". Allowed: ` +
            VALID_CATEGORIES.join(', ') +
            '.',
        });
      } else {
        category = categoryRaw as LineCategory;
      }
    }

    const retainageWithheld = optionalNumber(7, 'retainage_withheld');

    const feeBasisRaw = cell(8);
    let feeBasisCategories: LineCategory[] | undefined;
    if (feeBasisRaw !== '') {
      const tokens = feeBasisRaw
        .split('|')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      const validated: LineCategory[] = [];
      for (const token of tokens) {
        if (!VALID_CATEGORIES.includes(token as LineCategory)) {
          issues.push({
            severity: 'error',
            code: 'UNKNOWN_FEE_BASIS',
            row: rowNumber,
            column: 'fee_basis_categories',
            message: `Unknown category token "${token}" in fee_basis_categories.`,
          });
        } else {
          validated.push(token as LineCategory);
        }
      }
      if (category !== null && category !== 'fee') {
        issues.push({
          severity: 'warning',
          code: 'NON_FEE_HAS_BASIS',
          row: rowNumber,
          column: 'fee_basis_categories',
          message: 'fee_basis_categories ignored on non-fee line.',
        });
      } else if (validated.length > 0) {
        feeBasisCategories = validated;
      }
    }

    if (
      category === 'fee' &&
      (feeBasisCategories === undefined || feeBasisCategories.length === 0)
    ) {
      issues.push({
        severity: 'error',
        code: 'FEE_WITHOUT_BASIS',
        row: rowNumber,
        column: 'fee_basis_categories',
        message: 'fee_basis_categories is required on fee lines.',
      });
    }

    if (
      code !== null &&
      scheduledValue !== null &&
      workCompletedPrevious !== null &&
      workCompletedThisPeriod !== null &&
      materialsPresentlyStored !== null &&
      category !== null
    ) {
      const firstSeen = codeFirstRow.get(code);
      if (firstSeen !== undefined) {
        issues.push({
          severity: 'error',
          code: 'DUPLICATE_CODE',
          row: rowNumber,
          column: 'code',
          message: `Duplicate code "${code}" (first seen on row ${firstSeen}).`,
        });
      } else {
        codeFirstRow.set(code, rowNumber);
      }

      const item: PayAppLineItem = {
        code,
        description,
        scheduledValue,
        workCompletedPrevious,
        workCompletedThisPeriod,
        materialsPresentlyStored,
        category,
      };
      if (retainageWithheld !== undefined) item.retainageWithheld = retainageWithheld;
      if (feeBasisCategories !== undefined) item.feeBasisCategories = feeBasisCategories;

      const totalBilled =
        workCompletedPrevious + workCompletedThisPeriod + materialsPresentlyStored;
      if (totalBilled > scheduledValue) {
        issues.push({
          severity: 'warning',
          code: 'OVERBILLING',
          row: rowNumber,
          column: 'scheduled_value',
          message:
            `Sum of work completed and stored (${totalBilled}) exceeds scheduled_value (${scheduledValue}).`,
        });
      }

      lineItems.push(item);
    }
  }

  const hasErrors = issues.some((i) => i.severity === 'error');
  return {
    success: !hasErrors,
    lineItems: hasErrors ? [] : lineItems,
    issues,
  };
};
