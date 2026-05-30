// Reconstructs the G703 continuation-sheet table and the G702 summary block
// from positioned text tokens. Tokens are clustered into rows by their Y
// position, columns are anchored off the detected header row, and each body
// row's tokens are bucketed into those columns by X. The G702 summary is read
// by matching label phrases and taking the row's value token.
//
// The keyword/label matchers below are deliberately generic; they are the
// constants tuned against a real sample PDF during calibration.

import type { PdfToken } from './pdfExtract';
import { normalizeNumber } from './shared';

export interface TableRow {
  page: number;
  y: number;
  tokens: PdfToken[];
}

export type G703Field =
  | 'code'
  | 'description'
  | 'scheduledValue'
  | 'workCompletedPrevious'
  | 'workCompletedThisPeriod'
  | 'materialsPresentlyStored'
  | 'retainageWithheld';

export type G702Field =
  | 'projectName'
  | 'originalContractSum'
  | 'contractSumToDate'
  | 'totalCompletedAndStored'
  | 'totalEarnedLessRetainage'
  | 'lessPreviousCertificates'
  | 'currentPaymentDue'
  | 'retainage'
  | 'applicationNumber'
  | 'periodTo';

export interface MappedRow {
  page: number;
  y: number;
  cells: Partial<Record<G703Field, string>>;
}

export interface ReconstructedTable {
  headerFound: boolean;
  g703: MappedRow[];
  g702: Partial<Record<G702Field, string>>;
}

const Y_TOLERANCE = 3;

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
const tokenCenter = (t: PdfToken): number => t.x + t.w / 2;

const isNumericToken = (s: string): boolean => {
  const n = normalizeNumber(s);
  return n !== null && !Number.isNaN(n);
};

// --- Row clustering -------------------------------------------------------

export const clusterRows = (
  tokens: PdfToken[],
  yTolerance = Y_TOLERANCE,
): TableRow[] => {
  const byPage = new Map<number, PdfToken[]>();
  for (const t of tokens) {
    const arr = byPage.get(t.page);
    if (arr) arr.push(t);
    else byPage.set(t.page, [t]);
  }

  const rows: TableRow[] = [];
  for (const [page, pageTokens] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
    // Top of page first: larger y is higher on the page.
    const sorted = [...pageTokens].sort((a, b) => b.y - a.y);
    let band: PdfToken[] = [];
    let anchorY = Number.POSITIVE_INFINITY;
    for (const t of sorted) {
      if (band.length === 0) {
        band.push(t);
        anchorY = t.y;
      } else if (Math.abs(t.y - anchorY) <= yTolerance) {
        band.push(t);
      } else {
        rows.push({ page, y: anchorY, tokens: band.sort((a, b) => a.x - b.x) });
        band = [t];
        anchorY = t.y;
      }
    }
    if (band.length > 0) {
      rows.push({ page, y: anchorY, tokens: band.sort((a, b) => a.x - b.x) });
    }
  }
  return rows;
};

// --- G703 header detection + body mapping ---------------------------------

interface ColumnAnchor {
  field: G703Field;
  xCenter: number;
}

const HEADER_MATCHERS: { field: G703Field; test: (t: string) => boolean }[] = [
  { field: 'code', test: (t) => t.startsWith('item') || t === 'no.' || t === 'no' },
  { field: 'description', test: (t) => t.includes('description') },
  { field: 'scheduledValue', test: (t) => t.includes('scheduled') },
  { field: 'workCompletedPrevious', test: (t) => t.includes('previous') },
  { field: 'workCompletedThisPeriod', test: (t) => t.includes('this period') },
  { field: 'materialsPresentlyStored', test: (t) => t.includes('material') },
  { field: 'retainageWithheld', test: (t) => t.includes('retainage') },
];

interface HeaderMatch {
  row: TableRow;
  anchors: ColumnAnchor[]; // sorted by xCenter
}

export const findHeaderRow = (rows: TableRow[]): HeaderMatch | null => {
  for (const row of rows) {
    const anchors: ColumnAnchor[] = [];
    const used = new Set<G703Field>();
    for (const tok of row.tokens) {
      const n = norm(tok.str);
      for (const m of HEADER_MATCHERS) {
        if (used.has(m.field)) continue;
        if (m.test(n)) {
          anchors.push({ field: m.field, xCenter: tokenCenter(tok) });
          used.add(m.field);
          break;
        }
      }
    }
    const hasCore = used.has('description') && used.has('scheduledValue');
    const valueCols = (
      ['workCompletedPrevious', 'workCompletedThisPeriod', 'materialsPresentlyStored'] as G703Field[]
    ).filter((f) => used.has(f)).length;
    if (hasCore && valueCols >= 2) {
      anchors.sort((a, b) => a.xCenter - b.xCenter);
      return { row, anchors };
    }
  }
  return null;
};

const buildBoundaries = (anchors: ColumnAnchor[]): number[] => {
  const boundaries: number[] = [];
  for (let i = 0; i < anchors.length - 1; i++) {
    boundaries.push((anchors[i]!.xCenter + anchors[i + 1]!.xCenter) / 2);
  }
  boundaries.push(Number.POSITIVE_INFINITY);
  return boundaries;
};

const columnIndexFor = (xCenter: number, boundaries: number[]): number => {
  for (let i = 0; i < boundaries.length; i++) {
    if (xCenter <= boundaries[i]!) return i;
  }
  return boundaries.length - 1;
};

export const mapBodyRows = (rows: TableRow[], header: HeaderMatch): MappedRow[] => {
  const boundaries = buildBoundaries(header.anchors);
  const result: MappedRow[] = [];
  for (const row of rows) {
    if (row.page < header.row.page) continue;
    if (row.page === header.row.page && row.y >= header.row.y) continue;

    const byColumn = new Map<number, PdfToken[]>();
    for (const tok of row.tokens) {
      const ci = columnIndexFor(tokenCenter(tok), boundaries);
      const arr = byColumn.get(ci);
      if (arr) arr.push(tok);
      else byColumn.set(ci, [tok]);
    }

    const cells: Partial<Record<G703Field, string>> = {};
    for (const [ci, toks] of byColumn) {
      const field = header.anchors[ci]!.field;
      const text = toks
        .sort((a, b) => a.x - b.x)
        .map((t) => t.str)
        .join(' ')
        .trim();
      cells[field] = cells[field] ? `${cells[field]} ${text}` : text;
    }
    result.push({ page: row.page, y: row.y, cells });
  }
  return result;
};

// --- G702 summary extraction ----------------------------------------------

// Ordered most-specific first so a generic label (e.g. "retainage") does not
// claim a row that a specific label ("total earned less retainage") owns —
// matched rows are consumed.
const G702_LABELS: { field: G702Field; test: (t: string) => boolean }[] = [
  { field: 'projectName', test: (t) => t.includes('project') },
  { field: 'originalContractSum', test: (t) => t.includes('original contract sum') },
  { field: 'contractSumToDate', test: (t) => t.includes('contract sum to date') },
  {
    field: 'totalCompletedAndStored',
    test: (t) => t.includes('total completed') && t.includes('stored'),
  },
  { field: 'totalEarnedLessRetainage', test: (t) => t.includes('total earned less retainage') },
  { field: 'lessPreviousCertificates', test: (t) => t.includes('less previous certificate') },
  { field: 'currentPaymentDue', test: (t) => t.includes('current payment due') },
  { field: 'retainage', test: (t) => t.includes('retainage') },
  {
    field: 'applicationNumber',
    test: (t) => t.includes('application no') || t.includes('application number'),
  },
  { field: 'periodTo', test: (t) => t.includes('period to') },
];

const DATE_RE = /(\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4})/;

const extractValueForField = (field: G702Field, row: TableRow): string | undefined => {
  const tokens = [...row.tokens].sort((a, b) => a.x - b.x);

  if (field === 'projectName') {
    const idx = tokens.findIndex((t) => norm(t.str).includes('project'));
    if (idx < 0) return undefined;
    const head = tokens[idx]!.str.replace(/.*project[^a-z0-9]*/i, '').trim();
    const rest = tokens.slice(idx + 1).map((t) => t.str.trim());
    const name = [head, ...rest].filter((s) => s.length > 0).join(' ').trim();
    return name.length > 0 ? name : undefined;
  }

  if (field === 'periodTo') {
    for (let i = tokens.length - 1; i >= 0; i--) {
      const m = tokens[i]!.str.match(DATE_RE);
      if (m) return m[1];
    }
    return undefined;
  }

  // Numeric fields: rightmost token that parses as a number.
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (isNumericToken(tokens[i]!.str)) return tokens[i]!.str.trim();
  }
  return undefined;
};

export const extractG702 = (rows: TableRow[]): Partial<Record<G702Field, string>> => {
  const used = new Set<TableRow>();
  const out: Partial<Record<G702Field, string>> = {};
  for (const { field, test } of G702_LABELS) {
    for (const row of rows) {
      if (used.has(row)) continue;
      const text = norm(row.tokens.map((t) => t.str).join(' '));
      if (!test(text)) continue;
      const value = extractValueForField(field, row);
      if (value !== undefined) {
        out[field] = value;
        used.add(row);
        break;
      }
      // Label matched but no value parsed; keep scanning for a better row.
    }
  }
  return out;
};

// --- Top-level ------------------------------------------------------------

export const reconstructTable = (tokens: PdfToken[]): ReconstructedTable => {
  const rows = clusterRows(tokens);
  const g702 = extractG702(rows);
  const header = findHeaderRow(rows);
  if (!header) return { headerFound: false, g703: [], g702 };
  return { headerFound: true, g703: mapBodyRows(rows, header), g702 };
};
