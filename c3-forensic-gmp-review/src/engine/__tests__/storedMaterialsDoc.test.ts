import { describe, expect, it } from 'vitest';
import { storedMaterialsDoc } from '../rules/storedMaterialsDoc';
import { cleanPayApp, cleanProfile } from './fixtures';

describe('storedMaterialsDoc (Rule 7)', () => {
  it('produces no findings when nothing is stored', () => {
    expect(storedMaterialsDoc(cleanProfile(), cleanPayApp())).toEqual([]);
  });

  it('emits one low-severity informational finding listing all stored lines', () => {
    const payApp = cleanPayApp();
    const cow = payApp.lineItems.find((l) => l.code === 'COW-01')!;
    const ins = payApp.lineItems.find((l) => l.code === 'INS-01')!;
    cow.materialsPresentlyStored = 25_000;
    ins.materialsPresentlyStored = 5_000;

    const findings = storedMaterialsDoc(cleanProfile(), payApp);
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.ruleId).toBe('STORED_MATERIALS_DOC');
    expect(f.severity).toBe('low');
    expect(f.dollarExposure).toBe(30_000);
    expect(f.affectedLineItems.sort()).toEqual(['COW-01', 'INS-01']);
  });
});
