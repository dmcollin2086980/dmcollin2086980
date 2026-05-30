import { describe, expect, it } from 'vitest';
import {
  clusterRows,
  extractG702,
  findHeaderRow,
  mapBodyRows,
  reconstructTable,
} from '../pdfTable';
import { NO_HEADER_TOKENS, SAMPLE_PDF_TOKENS } from './pdfFixtures';

describe('clusterRows', () => {
  it('groups tokens with the same Y into one row, top of page first', () => {
    const rows = clusterRows(SAMPLE_PDF_TOKENS);
    // Page 1 rows precede page 2 rows.
    expect(rows[0]!.page).toBe(1);
    // Within a page, the first row is the highest (largest Y).
    const page1 = rows.filter((r) => r.page === 1);
    expect(page1[0]!.y).toBe(750);
    // Each clustered row keeps its tokens sorted left-to-right.
    const xs = page1[0]!.tokens.map((t) => t.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });
});

describe('findHeaderRow', () => {
  it('anchors the G703 columns off the header row', () => {
    const header = findHeaderRow(clusterRows(SAMPLE_PDF_TOKENS));
    expect(header).not.toBeNull();
    const fields = header!.anchors.map((a) => a.field);
    expect(fields).toContain('description');
    expect(fields).toContain('scheduledValue');
    expect(fields).toContain('workCompletedThisPeriod');
    // Anchors are sorted by X center.
    const centers = header!.anchors.map((a) => a.xCenter);
    expect(centers).toEqual([...centers].sort((a, b) => a - b));
  });

  it('returns null when no header can be anchored', () => {
    expect(findHeaderRow(clusterRows(NO_HEADER_TOKENS))).toBeNull();
  });
});

describe('mapBodyRows', () => {
  it('buckets body tokens into the correct columns', () => {
    const rows = clusterRows(SAMPLE_PDF_TOKENS);
    const header = findHeaderRow(rows)!;
    const mapped = mapBodyRows(rows, header);
    const cow = mapped.find((m) => m.cells.code === 'COW-01');
    expect(cow).toBeDefined();
    expect(cow!.cells.description).toBe('General construction');
    expect(cow!.cells.scheduledValue).toBe('3,000,000');
    expect(cow!.cells.workCompletedPrevious).toBe('1,000,000');
    expect(cow!.cells.workCompletedThisPeriod).toBe('200,000');
  });

  it('excludes rows on or above the header and on earlier pages', () => {
    const rows = clusterRows(SAMPLE_PDF_TOKENS);
    const header = findHeaderRow(rows)!;
    const mapped = mapBodyRows(rows, header);
    // No page-1 (G702) content leaks into the body rows.
    expect(mapped.every((m) => m.page === 2)).toBe(true);
  });
});

describe('extractG702', () => {
  it('reads summary labels and assigns generic labels after specific ones', () => {
    const g702 = extractG702(clusterRows(SAMPLE_PDF_TOKENS));
    expect(g702.originalContractSum).toBe('3,490,000');
    expect(g702.totalCompletedAndStored).toBe('1,565,000');
    // "retainage" must not steal the "total earned less retainage" row.
    expect(g702.retainage).toBe('78,250');
    expect(g702.totalEarnedLessRetainage).toBe('1,486,750');
    expect(g702.currentPaymentDue).toBe('286,750');
    expect(g702.applicationNumber).toBe('3');
    expect(g702.periodTo).toBe('12/31/2025');
    expect(g702.projectName).toBe('Acme Tower');
  });
});

describe('reconstructTable', () => {
  it('returns headerFound with both G703 rows and the G702 map', () => {
    const table = reconstructTable(SAMPLE_PDF_TOKENS);
    expect(table.headerFound).toBe(true);
    expect(table.g703.length).toBeGreaterThan(0);
    expect(table.g702.retainage).toBe('78,250');
  });
});
