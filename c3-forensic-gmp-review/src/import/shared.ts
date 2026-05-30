import type { PayAppLineItem } from '../engine/types';

// Shared import primitives used by both the CSV/paste parser (csv.ts) and the
// PDF parser (payAppPdf.ts). csv.ts re-exports these so existing importers and
// tests that reference '../import/csv' keep working unchanged.

export type ImportIssueCode =
  // CSV/paste codes
  | 'EMPTY_INPUT'
  | 'HEADER_MISMATCH'
  | 'MISSING_REQUIRED'
  | 'NON_NUMERIC'
  | 'UNKNOWN_CATEGORY'
  | 'DUPLICATE_CODE'
  | 'FEE_WITHOUT_BASIS'
  | 'UNKNOWN_FEE_BASIS'
  | 'NON_FEE_HAS_BASIS'
  | 'OVERBILLING'
  | 'PARSE_FAILURE'
  // PDF codes
  | 'PDF_NO_TEXT_LAYER'
  | 'PDF_NO_TABLE_FOUND'
  | 'LOW_CONFIDENCE_CATEGORY'
  | 'COLUMN_MAP_AMBIGUOUS';

export interface ImportIssue {
  severity: 'error' | 'warning';
  code: ImportIssueCode;
  row?: number;
  column?: string;
  message: string;
}

export interface ImportResult {
  success: boolean;
  lineItems: PayAppLineItem[];
  issues: ImportIssue[];
}

export const isRowEmpty = (row: string[]): boolean =>
  row.every((cell) => (cell ?? '').trim() === '');

// Accepts the messy money formats found on AIA forms and spreadsheet pastes:
// "$3,000,000", "1,200.50", "(500)" (parentheses = negative), surrounding
// whitespace. Returns null for an empty string and NaN for anything that is
// non-empty but not a clean number.
export const normalizeNumber = (raw: string): number | null => {
  let s = raw.trim();
  if (s === '') return null;
  s = s.replace(/\$/g, '').replace(/,/g, '').replace(/\s+/g, '');
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s === '' || !/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  const n = Number(s);
  return negative ? -n : n;
};
