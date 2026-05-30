import type { PdfToken } from '../pdfExtract';

// Synthetic positioned tokens that mimic pdf.js getTextContent() output for a
// real AIA G702/G703-1992 pay application, calibrated against the CQCH monthly
// reports. The shapes that matter and are reproduced here:
//   - a two-column G702 cover ("FROM CONTRACTOR" left, "VIA ARCHITECT" right),
//     so column-aware label reads are exercised;
//   - a *multi-line* G703 header band ("WORK COMPLETED" umbrella above
//     "FROM PREVIOUS" / "THIS PERIOD"), which no single clustered row holds;
//   - the un-emitted G/H/Balance columns between Materials and Retainage, whose
//     values must be fenced out of the columns we keep.
// Tokens use width 0, so a token's center is exactly its x — column math stays
// deterministic and easy to read.

interface Cell {
  x: number;
  str: string;
  w?: number;
}

const row = (page: number, y: number, cells: Cell[]): PdfToken[] =>
  cells.map((c) => ({ page, y, x: c.x, w: c.w ?? 0, str: c.str }));

// Page 1 — G702 cover. Right-column labels share Y-bands with the left column,
// exactly as on a real cover, but the numeric summary values sit on the label
// row so single-row value extraction finds them.
const G702_TOKENS: PdfToken[] = [
  ...row(1, 540, [{ x: 60, str: 'Application and Certificate for Payment' }]),
  ...row(1, 500, [{ x: 60, str: 'FROM CONTRACTOR:' }, { x: 400, str: 'VIA ARCHITECT:' }]),
  ...row(1, 490, [{ x: 60, str: 'Acme Builders, LLC' }, { x: 400, str: '(architect)' }]),
  ...row(1, 470, [{ x: 60, str: 'PROJECT:' }]),
  ...row(1, 460, [{ x: 60, str: 'Acme Tower' }]),
  ...row(1, 440, [{ x: 60, str: 'APPLICATION NO:' }, { x: 200, str: '3' }]),
  ...row(1, 420, [{ x: 60, str: 'PERIOD TO:' }, { x: 200, str: '12/31/2025' }]),
  ...row(1, 400, [{ x: 60, str: 'ORIGINAL CONTRACT SUM' }, { x: 400, str: '3,490,000' }]),
  ...row(1, 380, [{ x: 60, str: 'CONTRACT SUM TO DATE' }, { x: 400, str: '3,490,000' }]),
  ...row(1, 360, [
    { x: 60, str: 'TOTAL COMPLETED AND STORED TO DATE' },
    { x: 400, str: '1,565,000' },
  ]),
  ...row(1, 340, [{ x: 60, str: 'Total Retainage' }, { x: 400, str: '78,250' }]),
  ...row(1, 320, [{ x: 60, str: 'TOTAL EARNED LESS RETAINAGE' }, { x: 400, str: '1,486,750' }]),
  ...row(1, 300, [{ x: 60, str: 'LESS PREVIOUS CERTIFICATES' }, { x: 400, str: '1,200,000' }]),
  ...row(1, 280, [{ x: 60, str: 'CURRENT PAYMENT DUE' }, { x: 400, str: '286,750' }]),
];

// Page 2 — G703 continuation sheet with a multi-line header band. The column
// letter row + wrapped labels span y 376–427; the seed row (description +
// scheduled) is at y 390. Body rows are below y 376.
const G703_HEADER: PdfToken[] = [
  ...row(2, 427, [
    { x: 59, str: 'A' },
    { x: 146, str: 'B' },
    { x: 245, str: 'C' },
    { x: 317, str: 'D' },
    { x: 389, str: 'E' },
    { x: 461, str: 'F' },
    { x: 554, str: 'G' },
    { x: 648, str: 'H' },
    { x: 720, str: 'I' },
  ]),
  ...row(2, 412, [{ x: 353, str: 'WORK COMPLETED' }]),
  ...row(2, 406, [{ x: 461, str: 'MATERIALS' }, { x: 533, str: 'TOTAL' }]),
  ...row(2, 398, [
    { x: 461, str: 'PRESENTLY' },
    { x: 590, str: '%' },
    { x: 648, str: 'BALANCE' },
    { x: 720, str: 'RETAINAGE' },
  ]),
  ...row(2, 390, [
    { x: 59, str: 'ITEM NO.' },
    { x: 146, str: 'DESCRIPTION OF WORK' },
    { x: 245, str: 'SCHEDULED VALUE' },
    { x: 461, str: 'STORED' },
    { x: 533, str: 'COMPLETED' },
  ]),
  ...row(2, 384, [{ x: 317, str: 'FROM PREVIOUS' }, { x: 389, str: 'THIS PERIOD' }]),
  ...row(2, 376, [{ x: 317, str: 'APPLICATION' }]),
];

// Body row: A code, B description, C scheduled, D prev, E this, F materials,
// G total, H %, Balance, I retainage. The G/H/Balance values must NOT leak into
// Materials or Retainage.
const bodyRow = (
  y: number,
  code: string,
  desc: string,
  sched: string,
  prev: string,
  thisPeriod: string,
  materials: string,
): PdfToken[] =>
  row(2, y, [
    { x: 54, str: code },
    { x: 130, str: desc },
    { x: 260, str: sched },
    { x: 330, str: prev },
    { x: 400, str: thisPeriod },
    { x: 470, str: materials },
    { x: 560, str: '999,999' }, // G total — must be fenced out
    { x: 600, str: '34%' }, // H percent — must be fenced out
    { x: 650, str: '888,888' }, // Balance — must be fenced out
    { x: 730, str: '0' }, // I retainage
  ]);

const G703_TOKENS: PdfToken[] = [
  ...G703_HEADER,
  ...bodyRow(354, 'COW-01', 'General construction', '3,000,000', '1,000,000', '200,000', '0'),
  ...bodyRow(334, 'GC-01', 'General conditions', '300,000', '100,000', '20,000', '0'),
  ...bodyRow(314, 'FEE-01', 'Contractor fee', '150,000', '50,000', '10,000', '0'),
  ...bodyRow(294, 'BOND-01', 'Payment & performance bond', '40,000', '40,000', '0', '0'),
  // Total row: no code, description matches a total pattern -> must be skipped.
  ...row(2, 274, [
    { x: 130, str: 'GRAND TOTAL' },
    { x: 260, str: '3,490,000' },
    { x: 330, str: '1,190,000' },
    { x: 400, str: '230,000' },
    { x: 470, str: '0' },
  ]),
];

export const SAMPLE_PDF_TOKENS: PdfToken[] = [...G702_TOKENS, ...G703_TOKENS];

// Page 2 G703 only (no G702 summary) — the table still reconstructs without a
// cover/summary block.
export const G703_ONLY_TOKENS: PdfToken[] = G703_TOKENS;

// A page with text but no recognizable G703 header.
export const NO_HEADER_TOKENS: PdfToken[] = [
  ...row(1, 700, [{ x: 50, str: 'Some unrelated invoice' }]),
  ...row(1, 680, [{ x: 50, str: 'Line one' }, { x: 300, str: '100' }]),
];

// Kitchell/Textura GMP schedule-of-values layout: a 13-column lettered grid
// (A B C C1 C2 C3 D E F H I J N) with no AIA cover. Encodes the real geometry:
// the letter row anchors the grid; body value columns are right-aligned and read
// by ordinal position (the "%" column is non-numeric and drops out). An ORDER
// SUMMARY "TOTAL" row carries project-level financials.
const gmpLetterRow = (page: number, y: number): PdfToken[] =>
  row(page, y, [
    { x: 35, str: 'A' },
    { x: 67, str: 'B' },
    { x: 139, str: 'C' },
    { x: 217, str: 'C1' },
    { x: 274, str: 'C2' },
    { x: 327, str: 'C3' },
    { x: 385, str: 'D' },
    { x: 436, str: 'E' },
    { x: 486, str: 'F' },
    { x: 552, str: 'H' },
    { x: 622, str: 'I' },
    { x: 675, str: 'J' },
    { x: 730, str: 'N' },
  ]);

// chg, item, desc, then C1 C2 C3 D(sched) E(prev) F(this) H % Balance J(ret) N(net).
const gmpBodyRow = (
  y: number,
  chg: string,
  item: string,
  desc: string,
  c1: string,
  d: string,
  e: string,
  f: string,
  h: string,
  bal: string,
  j: string,
  n: string,
): PdfToken[] =>
  row(2, y, [
    { x: 35, str: chg },
    { x: 67, str: item },
    { x: 139, str: desc },
    { x: 217, str: c1 },
    { x: 274, str: '0' },
    { x: 327, str: '0' },
    { x: 385, str: d },
    { x: 436, str: e },
    { x: 486, str: f },
    { x: 552, str: h },
    { x: 590, str: '50.0%' },
    { x: 629, str: bal },
    { x: 690, str: j },
    { x: 730, str: n },
  ]);

export const GMP_SOV_TOKENS: PdfToken[] = [
  ...row(2, 560, [{ x: 60, str: 'APPLICATION NO:' }, { x: 200, str: '2' }]),
  ...row(2, 545, [{ x: 60, str: 'PERIOD TO:' }, { x: 200, str: '2/28/2026' }]),
  ...gmpLetterRow(2, 500),
  ...gmpBodyRow(470, '001', '0010', 'Sitework', '100,000', '100,000', '40,000', '10,000', '50,000', '50,000', '5,000', '45,000'),
  ...gmpBodyRow(455, '002', '0020', 'General Conditions', '200,000', '200,000', '50,000', '20,000', '70,000', '130,000', '7,000', '63,000'),
  // ORDER SUMMARY grand total.
  ...row(2, 440, [
    { x: 100, str: 'TOTAL' },
    { x: 217, str: '300,000' },
    { x: 274, str: '0' },
    { x: 327, str: '0' },
    { x: 385, str: '300,000' },
    { x: 436, str: '90,000' },
    { x: 486, str: '30,000' },
    { x: 552, str: '120,000' },
    { x: 590, str: '40.0%' },
    { x: 629, str: '180,000' },
    { x: 690, str: '15,000' },
    { x: 730, str: '105,000' },
  ]),
];

// A bundle of two pay apps (cover on page 1, cover on page 4) used to exercise
// multi-app detection + column-aware contractor reads.
export const BUNDLE_PDF_TOKENS: PdfToken[] = [
  ...row(1, 540, [{ x: 60, str: 'Application and Certificate for Payment' }]),
  ...row(1, 500, [{ x: 60, str: 'FROM CONTRACTOR:' }, { x: 400, str: 'VIA ARCHITECT:' }]),
  ...row(1, 490, [{ x: 60, str: 'Acme Builders, LLC' }, { x: 400, str: '(architect)' }]),
  ...row(1, 470, [{ x: 60, str: 'APPLICATION NO:' }, { x: 200, str: '3' }]),
  ...row(1, 450, [{ x: 60, str: 'ORIGINAL CONTRACT SUM' }, { x: 400, str: '3,490,000' }]),
  ...row(2, 400, [{ x: 60, str: 'Continuation Sheet detail' }]),
  ...row(4, 540, [{ x: 60, str: 'Application and Certificate for Payment' }]),
  ...row(4, 500, [{ x: 60, str: 'FROM CONTRACTOR:' }, { x: 400, str: 'VIA ARCHITECT:' }]),
  ...row(4, 490, [{ x: 60, str: 'Beta Mechanical Inc.' }, { x: 400, str: '(architect)' }]),
  ...row(4, 470, [{ x: 60, str: 'APPLICATION NO:' }, { x: 200, str: '7' }]),
  ...row(4, 450, [{ x: 60, str: 'ORIGINAL CONTRACT SUM' }, { x: 400, str: '9,000,000' }]),
  ...row(5, 400, [{ x: 60, str: 'Continuation Sheet detail' }]),
];
