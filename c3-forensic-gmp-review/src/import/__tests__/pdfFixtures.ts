import type { PdfToken } from '../pdfExtract';

// Synthetic positioned tokens that mimic pdf.js getTextContent() output for a
// standard two-page AIA pay application: G702 summary on page 1, G703
// continuation sheet on page 2. No real PDF needed to exercise the table
// reconstruction + mapping pipeline. Token widths default to str.length * 5,
// which keeps column centers well-separated for the X positions chosen here.

interface Cell {
  x: number;
  str: string;
  w?: number;
}

const row = (page: number, y: number, cells: Cell[]): PdfToken[] =>
  cells.map((c) => ({ page, y, x: c.x, w: c.w ?? c.str.length * 5, str: c.str }));

// Page 1 — G702 summary block.
const G702_TOKENS: PdfToken[] = [
  ...row(1, 750, [{ x: 50, str: 'PROJECT:' }, { x: 120, str: 'Acme Tower' }]),
  ...row(1, 700, [{ x: 50, str: 'ORIGINAL CONTRACT SUM' }, { x: 400, str: '3,490,000' }]),
  ...row(1, 680, [{ x: 50, str: 'CONTRACT SUM TO DATE' }, { x: 400, str: '3,490,000' }]),
  ...row(1, 660, [
    { x: 50, str: 'TOTAL COMPLETED & STORED TO DATE' },
    { x: 400, str: '1,565,000' },
  ]),
  ...row(1, 640, [{ x: 50, str: 'RETAINAGE' }, { x: 400, str: '78,250' }]),
  ...row(1, 620, [
    { x: 50, str: 'TOTAL EARNED LESS RETAINAGE' },
    { x: 400, str: '1,486,750' },
  ]),
  ...row(1, 600, [{ x: 50, str: 'LESS PREVIOUS CERTIFICATES' }, { x: 400, str: '1,200,000' }]),
  ...row(1, 580, [{ x: 50, str: 'CURRENT PAYMENT DUE' }, { x: 400, str: '286,750' }]),
  ...row(1, 560, [{ x: 50, str: 'APPLICATION NO:' }, { x: 400, str: '3' }]),
  ...row(1, 540, [{ x: 50, str: 'PERIOD TO:' }, { x: 400, str: '12/31/2025' }]),
];

// Page 2 — G703 continuation sheet. Header anchors the columns.
const G703_TOKENS: PdfToken[] = [
  ...row(2, 700, [
    { x: 50, str: 'Item' },
    { x: 100, str: 'Description of Work' },
    { x: 300, str: 'Scheduled Value' },
    { x: 400, str: 'From Previous Application' },
    { x: 500, str: 'This Period' },
    { x: 600, str: 'Materials Presently Stored' },
    { x: 720, str: 'Retainage' },
  ]),
  ...row(2, 680, [
    { x: 50, str: 'COW-01' },
    { x: 100, str: 'General construction' },
    { x: 300, str: '3,000,000' },
    { x: 400, str: '1,000,000' },
    { x: 500, str: '200,000' },
    { x: 600, str: '0' },
  ]),
  ...row(2, 660, [
    { x: 50, str: 'GC-01' },
    { x: 100, str: 'General conditions' },
    { x: 300, str: '300,000' },
    { x: 400, str: '100,000' },
    { x: 500, str: '20,000' },
    { x: 600, str: '0' },
  ]),
  ...row(2, 640, [
    { x: 50, str: 'FEE-01' },
    { x: 100, str: 'Contractor fee' },
    { x: 300, str: '150,000' },
    { x: 400, str: '50,000' },
    { x: 500, str: '10,000' },
    { x: 600, str: '0' },
  ]),
  ...row(2, 620, [
    { x: 50, str: 'BOND-01' },
    { x: 100, str: 'Payment & performance bond' },
    { x: 300, str: '40,000' },
    { x: 400, str: '40,000' },
    { x: 500, str: '0' },
    { x: 600, str: '0' },
  ]),
  // Total row: no code, description matches a total pattern -> must be skipped.
  ...row(2, 600, [
    { x: 100, str: 'GRAND TOTAL' },
    { x: 300, str: '3,490,000' },
    { x: 400, str: '1,190,000' },
    { x: 500, str: '230,000' },
    { x: 600, str: '0' },
  ]),
];

export const SAMPLE_PDF_TOKENS: PdfToken[] = [...G702_TOKENS, ...G703_TOKENS];

// Page 2 G703 only (no G702 summary) — used to assert the table still
// reconstructs without a summary block.
export const G703_ONLY_TOKENS: PdfToken[] = G703_TOKENS;

// A page with text but no recognizable G703 header.
export const NO_HEADER_TOKENS: PdfToken[] = [
  ...row(1, 700, [{ x: 50, str: 'Some unrelated invoice' }]),
  ...row(1, 680, [{ x: 50, str: 'Line one' }, { x: 300, str: '100' }]),
];
