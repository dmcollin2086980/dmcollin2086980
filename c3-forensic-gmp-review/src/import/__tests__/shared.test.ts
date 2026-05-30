import { describe, expect, it } from 'vitest';
import { normalizeNumber } from '../shared';
// The CSV module must keep working after the shared refactor: its public parser
// and the issue types it re-exports are what CsvImport.tsx and csv.test.ts rely
// on. A type-only import here proves the re-export still resolves.
import { parsePayAppCsv, type ImportResult } from '../csv';

describe('shared import primitives', () => {
  it('normalizeNumber handles $, commas, whitespace, and parentheses', () => {
    expect(normalizeNumber('$3,000,000')).toBe(3_000_000);
    expect(normalizeNumber('(500)')).toBe(-500);
    expect(normalizeNumber(' 42 ')).toBe(42);
    expect(normalizeNumber('')).toBeNull();
    expect(Number.isNaN(normalizeNumber('abc') as number)).toBe(true);
  });

  it('csv.ts still exposes parsePayAppCsv and the ImportResult shape', () => {
    const result: ImportResult = parsePayAppCsv('');
    expect(result.success).toBe(false);
    expect(result.issues[0]!.code).toBe('EMPTY_INPUT');
  });
});
