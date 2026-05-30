// Reconstructs the G703 continuation-sheet table and the G702 summary block
// from positioned text tokens. Tokens are clustered into rows by their Y
// position. The G703 header is read as a *band* — its column labels wrap across
// several lines ("WORK COMPLETED" sits above "FROM PREVIOUS" / "THIS PERIOD"),
// so a single clustered row never holds every label. We gather the label band,
// anchor every column (including the G/H/Balance columns we don't emit, so
// their values don't bleed into the columns we do), then bucket each body row's
// tokens into those columns by X. The G702 summary is read from the cover page
// by matching label phrases and taking the row's value token.
//
// Calibrated against real AIA G702/G703-1992 continuation sheets (the CQCH
// monthly-report pay apps); see __tests__/pdfFixtures.ts for the captured token
// geometry that pins this behaviour.

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

// Columns we anchor purely to keep their values out of the emitted columns.
type AnchorField = G703Field | 'ignore';

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
  field: AnchorField;
  xCenter: number;
}

// Order matters: a token is matched by the first test that accepts it, and each
// field is claimed once. The three `ignore` anchors (total / percent / balance)
// exist only to fence off their X-range so their numbers don't land in the
// Materials or Retainage buckets.
const HEADER_MATCHERS: { field: AnchorField; test: (t: string) => boolean }[] = [
  { field: 'code', test: (t) => t.startsWith('item') || t === 'no.' || t === 'no' },
  { field: 'description', test: (t) => t.includes('description') },
  { field: 'scheduledValue', test: (t) => t.includes('scheduled') },
  { field: 'workCompletedPrevious', test: (t) => t.includes('previous') },
  { field: 'workCompletedThisPeriod', test: (t) => t.includes('this period') },
  { field: 'materialsPresentlyStored', test: (t) => t.startsWith('material') },
  { field: 'ignore', test: (t) => t.includes('total completed') && t.includes('stored') },
  { field: 'ignore', test: (t) => t === '%' || t.includes('(g / c)') || t.includes('g / c') },
  { field: 'ignore', test: (t) => t.startsWith('balance') },
  { field: 'retainageWithheld', test: (t) => t.includes('retainage') },
];

interface HeaderMatch {
  page: number;
  /** Y of the lowest header label; body rows are those below it. */
  bottomY: number;
  anchors: ColumnAnchor[]; // sorted by xCenter
}

// The header labels span a vertical band above the first data row. Once we find
// the seed row (the one carrying "description" + "scheduled"), collect every
// token in the band around it and resolve one anchor per column.
const HEADER_BAND_ABOVE = 45; // letter row / umbrella labels sit above the seed
const HEADER_BAND_BELOW = 20; // wrapped sub-labels sit just below the seed

export const findHeaderRow = (rows: TableRow[]): HeaderMatch | null => {
  for (const seed of rows) {
    const seedText = norm(seed.tokens.map((t) => t.str).join(' '));
    if (!(seedText.includes('description') && seedText.includes('scheduled'))) continue;

    const bandTokens: PdfToken[] = [];
    for (const row of rows) {
      if (row.page !== seed.page) continue;
      if (row.y <= seed.y + HEADER_BAND_ABOVE && row.y >= seed.y - HEADER_BAND_BELOW) {
        bandTokens.push(...row.tokens);
      }
    }

    const anchors: ColumnAnchor[] = [];
    const usedFields = new Set<AnchorField>();
    let ignoreSeq = 0;
    for (const tok of [...bandTokens].sort((a, b) => a.x - b.x)) {
      const n = norm(tok.str);
      for (const m of HEADER_MATCHERS) {
        // `ignore` columns can repeat (there are several); real fields claim once.
        if (m.field !== 'ignore' && usedFields.has(m.field)) continue;
        if (m.test(n)) {
          anchors.push({ field: m.field, xCenter: tokenCenter(tok) });
          if (m.field !== 'ignore') usedFields.add(m.field);
          else ignoreSeq += 1;
          break;
        }
      }
    }

    const hasCore = usedFields.has('description') && usedFields.has('scheduledValue');
    const valueCols = (
      [
        'workCompletedPrevious',
        'workCompletedThisPeriod',
        'materialsPresentlyStored',
      ] as G703Field[]
    ).filter((f) => usedFields.has(f)).length;
    if (hasCore && valueCols >= 2) {
      anchors.sort((a, b) => a.xCenter - b.xCenter);
      const bottomY = Math.min(...bandTokens.map((t) => t.y));
      void ignoreSeq;
      return { page: seed.page, bottomY, anchors };
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
    if (row.page < header.page) continue;
    if (row.page === header.page && row.y >= header.bottomY) continue;

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
      if (field === 'ignore') continue;
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
  { field: 'originalContractSum', test: (t) => t.includes('original contract sum') },
  { field: 'contractSumToDate', test: (t) => t.includes('contract sum to date') },
  {
    field: 'totalCompletedAndStored',
    test: (t) => t.includes('total completed') && t.includes('stored'),
  },
  { field: 'totalEarnedLessRetainage', test: (t) => t.includes('total earned less retainage') },
  { field: 'lessPreviousCertificates', test: (t) => t.includes('less previous certificate') },
  { field: 'currentPaymentDue', test: (t) => t.includes('current payment due') },
  // Prefer the "Total Retainage" summary line over the per-component 5a/5b rows.
  { field: 'retainage', test: (t) => t.includes('total retainage') },
  { field: 'applicationNumber', test: (t) => t.includes('application no') },
  { field: 'periodTo', test: (t) => t.includes('period to') },
];

const DATE_RE = /(\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4})/;

const extractValueForField = (field: G702Field, row: TableRow): string | undefined => {
  const tokens = [...row.tokens].sort((a, b) => a.x - b.x);

  if (field === 'periodTo') {
    for (let i = tokens.length - 1; i >= 0; i--) {
      const m = tokens[i]!.str.match(DATE_RE);
      if (m) return m[1];
    }
    return undefined;
  }

  if (field === 'applicationNumber') {
    // "APPLICATION NO: 5" — last integer token on the label row.
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (/^\d{1,4}$/.test(tokens[i]!.str.trim())) return tokens[i]!.str.trim();
    }
    return undefined;
  }

  // Numeric fields: rightmost token that parses as a number.
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (isNumericToken(tokens[i]!.str)) return tokens[i]!.str.trim();
  }
  return undefined;
};

// The cover page is the G702 "Application and Certificate"; restrict summary
// extraction to it so a stray "retainage" mention on a G703 page can't win.
export const findCoverPage = (rows: TableRow[]): number | null => {
  for (const row of rows) {
    if (norm(row.tokens.map((t) => t.str).join(' ')).includes('application and certificate')) {
      return row.page;
    }
  }
  return null;
};

// Project name on the G702 cover is a "PROJECT:" label with the name on the
// following line(s). Grab the next non-empty row below the label, on its page.
const extractProjectName = (rows: TableRow[], coverPage: number): string | undefined => {
  const onCover = rows
    .filter((r) => r.page === coverPage)
    .sort((a, b) => b.y - a.y); // top to bottom
  for (let i = 0; i < onCover.length; i++) {
    const text = norm(onCover[i]!.tokens.map((t) => t.str).join(' '));
    if (text === 'project:' || text.startsWith('project:')) {
      const inline = onCover[i]!.tokens
        .map((t) => t.str)
        .join(' ')
        .replace(/.*project:\s*/i, '')
        .trim();
      if (inline) return inline;
      const next = onCover[i + 1];
      if (next) {
        const name = next.tokens.map((t) => t.str).join(' ').trim();
        if (name) return name;
      }
    }
  }
  return undefined;
};

export const extractG702 = (
  rows: TableRow[],
  coverPage: number | null,
): Partial<Record<G702Field, string>> => {
  const scope = coverPage === null ? rows : rows.filter((r) => r.page === coverPage);
  const used = new Set<TableRow>();
  const out: Partial<Record<G702Field, string>> = {};

  if (coverPage !== null) {
    const name = extractProjectName(rows, coverPage);
    if (name) out.projectName = name;
  }

  for (const { field, test } of G702_LABELS) {
    for (const row of scope) {
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

// --- Multi-app cover detection --------------------------------------------

// A monthly report can bundle many trade pay apps back-to-back. Each starts
// with a G702 cover page; "original contract sum" appears only on the cover
// (the G703 continuation pages carry boilerplate that mentions G702 but never
// the contract-sum line), so it is a clean per-app delimiter.
export interface CoverInfo {
  coverPage: number;
  contractor?: string;
  applicationNumber?: string;
  originalContractSum?: string;
}

const rowText = (r: TableRow): string => norm(r.tokens.map((t) => t.str).join(' '));

// The value below a label, staying in the label's column. The G702 cover is
// two-column ("TO OWNER" / "FROM CONTRACTOR" on the left, "VIA ARCHITECT" /
// "APPLICATION NO" on the right), so a y-band merges both columns and the same
// row to the right is noise. We anchor on the label token's X and read the next
// row's tokens within that column band.
const labelFollowingText = (
  pageRowsTopDown: TableRow[],
  label: string,
): string | undefined => {
  for (let i = 0; i < pageRowsTopDown.length; i++) {
    const row = pageRowsTopDown[i]!;
    if (!rowText(row).includes(label)) continue;
    const xRef = Math.min(...row.tokens.map((t) => t.x));
    for (let k = i + 1; k < Math.min(pageRowsTopDown.length, i + 3); k++) {
      const colToks = pageRowsTopDown[k]!.tokens
        .filter((t) => t.x >= xRef - 15 && t.x <= xRef + 260)
        .sort((a, b) => a.x - b.x);
      const s = colToks.map((t) => t.str).join(' ').trim();
      if (s) return s;
    }
    return undefined;
  }
  return undefined;
};

// First numeric token at/after a label row (the value can sit a line or two
// below the label, e.g. "ORIGINAL CONTRACT SUM" / "$" / "81,829.00").
const numericNearLabel = (
  pageRowsTopDown: TableRow[],
  label: string,
  maxAhead = 4,
): string | undefined => {
  const start = pageRowsTopDown.findIndex((r) => rowText(r).includes(label));
  if (start < 0) return undefined;
  for (let i = start; i < Math.min(pageRowsTopDown.length, start + maxAhead); i++) {
    const toks = pageRowsTopDown[i]!.tokens;
    for (let j = toks.length - 1; j >= 0; j--) {
      if (isNumericToken(toks[j]!.str)) return toks[j]!.str.trim();
    }
  }
  return undefined;
};

const lastIntegerOnLabelRow = (
  pageRowsTopDown: TableRow[],
  label: string,
): string | undefined => {
  const row = pageRowsTopDown.find((r) => rowText(r).includes(label));
  if (!row) return undefined;
  for (let j = row.tokens.length - 1; j >= 0; j--) {
    if (/^\d{1,4}$/.test(row.tokens[j]!.str.trim())) return row.tokens[j]!.str.trim();
  }
  return undefined;
};

export const detectCovers = (tokens: PdfToken[]): CoverInfo[] => {
  const rows = clusterRows(tokens);
  const coverPages = [
    ...new Set(rows.filter((r) => rowText(r).includes('original contract sum')).map((r) => r.page)),
  ].sort((a, b) => a - b);

  return coverPages.map((page) => {
    const pageRows = rows.filter((r) => r.page === page).sort((a, b) => b.y - a.y);
    return {
      coverPage: page,
      contractor: labelFollowingText(pageRows, 'from contractor:'),
      applicationNumber: lastIntegerOnLabelRow(pageRows, 'application no'),
      originalContractSum: numericNearLabel(pageRows, 'original contract sum'),
    };
  });
};

// --- GMP schedule-of-values template (Kitchell/Textura) -------------------

// A second, denser pay-app layout (the GC's GMP schedule of values) used at the
// prime level: 13 lettered columns (A B C C1 C2 C3 D E F H I J N) with original
// SOV, change-order adjustments, an adjusted SOV, work-completed, retainage and
// net-this-month. There is no AIA G702 cover; the page header carries the
// application number / period, and an ORDER SUMMARY "TOTAL" row carries the
// project-level financials. Calibrated against the CQCH GMP pay apps.

// The letter row (A B C C1 C2 C3 D E F H I J N) is the anchor grid. We bucket
// tokens into those columns and read fields by letter. A=change order, B=item,
// C=description overflow (long descriptions push right of B), D=adjusted SOV,
// E=from previous, F=this period, H=total completed & stored, J=retainage, N=net.
interface GmpGrid {
  letters: string[]; // lowercased column letter, by index
  boundaries: number[];
}

const findGmpLetterRow = (rows: TableRow[]): TableRow | null => {
  for (const row of rows) {
    const letters = new Set(row.tokens.map((t) => norm(t.str)));
    if (letters.has('c1') && letters.has('c2') && letters.has('c3') && letters.has('d')) {
      return row;
    }
  }
  return null;
};

const buildGmpGrid = (letterRow: TableRow): GmpGrid => {
  const cols = [...letterRow.tokens].sort((a, b) => a.x - b.x);
  const centers = cols.map(tokenCenter);
  const boundaries: number[] = [];
  for (let i = 0; i < centers.length - 1; i++) boundaries.push((centers[i]! + centers[i + 1]!) / 2);
  boundaries.push(Number.POSITIVE_INFINITY);
  return { letters: cols.map((t) => norm(t.str)), boundaries };
};

const gmpCol = (grid: GmpGrid, letter: string): number => grid.letters.indexOf(letter);

const ITEM_NO_RE = /^\d{3,4}$/;

// Numeric value columns in fixed order, right of the description. The percent
// column ("0.00%") is not a pure number so it drops out of this list — which is
// exactly why fixed indices are stable: [C1, C2, C3, D, E, F, H, Balance, J, N].
const VAL_SCHEDULED = 3; // D — adjusted scheduled value
const VAL_PREVIOUS = 4; // E
const VAL_THIS_PERIOD = 5; // F
const VAL_TOTAL_COMPLETED = 6; // H
const VAL_RETAINAGE = 8; // J
const VAL_NET = 9; // N — net this month

// Right-aligned million-dollar figures make a token's *center* drift across
// column lines, so geometry-bucketing the value columns is unreliable here.
// Instead split each row at the C|C1 boundary and read the value tokens by
// ordinal position, which is fixed for this template.
const splitGmpRow = (
  row: TableRow,
  cutoff: number,
): { left: PdfToken[]; values: PdfToken[] } => {
  const left: PdfToken[] = [];
  const values: PdfToken[] = [];
  for (const t of [...row.tokens].sort((a, b) => a.x - b.x)) {
    if (tokenCenter(t) < cutoff) left.push(t);
    else if (isNumericToken(t.str)) values.push(t);
  }
  return { left, values };
};

const mapGmpBodyRows = (rows: TableRow[], grid: GmpGrid): MappedRow[] => {
  const cutoff = grid.boundaries[gmpCol(grid, 'c')]!; // C | C1 boundary
  const result: MappedRow[] = [];
  for (const row of rows) {
    const { left, values } = splitGmpRow(row, cutoff);
    const leftNums = left.filter((t) => isNumericToken(t.str)).map((t) => t.str.trim());
    const item = leftNums[leftNums.length - 1] ?? '';
    // Only real detail lines have a numeric item number; this drops headers,
    // group rows (FUTURE BUYOUT / SUBCONTRACTS) and the TOTAL summary row.
    if (!ITEM_NO_RE.test(item) || values.length < VAL_THIS_PERIOD + 1) continue;

    const chg = leftNums.length > 1 ? leftNums[0] : '';
    const description = left
      .filter((t) => !isNumericToken(t.str))
      .map((t) => t.str)
      .join(' ')
      .trim();
    const cells: Partial<Record<G703Field, string>> = {
      code: chg ? `${chg}-${item}` : item,
      description,
      scheduledValue: values[VAL_SCHEDULED]!.str.trim(),
      workCompletedPrevious: values[VAL_PREVIOUS]!.str.trim(),
      workCompletedThisPeriod: values[VAL_THIS_PERIOD]!.str.trim(),
    };
    if (values[VAL_RETAINAGE]) cells.retainageWithheld = values[VAL_RETAINAGE]!.str.trim();
    result.push({ page: row.page, y: row.y, cells });
  }
  return result;
};

// The ORDER SUMMARY grand-total row ("TOTAL" left of the figures) carries the
// project-level financials; derive the G702-equivalent fields from it.
const extractGmpSummary = (
  rows: TableRow[],
  grid: GmpGrid,
): Partial<Record<G702Field, string>> => {
  const out: Partial<Record<G702Field, string>> = {};

  // Page-header fields (present on every page).
  for (const row of rows) {
    const text = norm(row.tokens.map((t) => t.str).join(' '));
    if (out.applicationNumber === undefined && text.includes('application no')) {
      const v = extractValueForField('applicationNumber', row);
      if (v) out.applicationNumber = v;
    }
    if (out.periodTo === undefined && text.includes('period to')) {
      const v = extractValueForField('periodTo', row);
      if (v) out.periodTo = v;
    }
  }

  const cutoff = grid.boundaries[gmpCol(grid, 'c')]!;
  for (const row of rows) {
    const { left, values } = splitGmpRow(row, cutoff);
    const label = norm(left.filter((t) => /[a-z]/i.test(t.str)).map((t) => t.str).join(' '));
    if (label !== 'total' || values.length < VAL_NET + 1) continue;
    const d = normalizeNumber(values[VAL_SCHEDULED]!.str);
    const h = normalizeNumber(values[VAL_TOTAL_COMPLETED]!.str);
    const j = normalizeNumber(values[VAL_RETAINAGE]!.str);
    const n = normalizeNumber(values[VAL_NET]!.str);
    if (d !== null && !Number.isNaN(d)) out.contractSumToDate = String(d);
    if (h !== null && !Number.isNaN(h)) out.totalCompletedAndStored = String(h);
    if (j !== null && !Number.isNaN(j)) out.retainage = String(j);
    if (h !== null && j !== null && !Number.isNaN(h) && !Number.isNaN(j)) {
      out.totalEarnedLessRetainage = String(h - j);
      if (n !== null && !Number.isNaN(n)) {
        out.currentPaymentDue = String(n);
        out.lessPreviousCertificates = String(h - j - n);
      }
    }
    break;
  }
  return out;
};

const reconstructGmpTable = (rows: TableRow[], letterRow: TableRow): ReconstructedTable => {
  const grid = buildGmpGrid(letterRow);
  const g703 = mapGmpBodyRows(rows, grid);
  const g702 = extractGmpSummary(rows, grid);
  return { headerFound: g703.length > 0, g703, g702 };
};

// --- Top-level ------------------------------------------------------------

export const reconstructTable = (tokens: PdfToken[]): ReconstructedTable => {
  const rows = clusterRows(tokens);

  // Dispatch on template: the GMP schedule of values has a distinctive
  // C1/C2/C3 change-order letter row; everything else is treated as AIA
  // G702/G703.
  const gmpLetterRow = findGmpLetterRow(rows);
  if (gmpLetterRow) return reconstructGmpTable(rows, gmpLetterRow);

  const coverPage = findCoverPage(rows);
  const g702 = extractG702(rows, coverPage);
  const header = findHeaderRow(rows);
  if (!header) return { headerFound: false, g703: [], g702 };
  return { headerFound: true, g703: mapBodyRows(rows, header), g702 };
};
