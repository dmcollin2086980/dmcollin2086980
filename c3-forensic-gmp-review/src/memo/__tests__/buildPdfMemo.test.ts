import { describe, expect, it } from 'vitest';
import { buildPdfMemo } from '../buildPdfMemo';
import type { AuditResult } from '../../engine/types';
import { runAudit } from '../../engine/runner';
import {
  buildAcceptanceScenario as acceptanceScenario,
  cleanMemoProfile as cleanProfile,
  tiedPayAppFromSample as cleanPayApp,
} from '../../__test_utils__/scenarios';

const fixedNow = new Date('2026-05-28T00:00:00Z');

const decodeAscii = async (blob: Blob): Promise<string> => {
  const buf = await blob.arrayBuffer();
  return new TextDecoder('latin1').decode(buf);
};

describe('buildPdfMemo', () => {
  it('returns a Blob with the PDF mime type and non-zero size', () => {
    const profile = cleanProfile();
    const payApp = cleanPayApp();
    const blob = buildPdfMemo({
      profile,
      payApp,
      result: runAudit(profile, payApp),
      now: fixedNow,
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(500);
  });

  it('starts with the %PDF- magic header', async () => {
    const profile = cleanProfile();
    const payApp = cleanPayApp();
    const blob = buildPdfMemo({
      profile,
      payApp,
      result: runAudit(profile, payApp),
      now: fixedNow,
    });
    const text = await decodeAscii(blob);
    expect(text.startsWith('%PDF-')).toBe(true);
  });

  it('embeds the project name in the binary', async () => {
    const { profile, payApp, result } = acceptanceScenario();
    const blob = buildPdfMemo({ profile, payApp, result, preparedBy: 'J. Smith', now: fixedNow });
    const text = await decodeAscii(blob);
    expect(text).toContain('Example Hospital');
    expect(text).toContain('J. Smith');
  });

  it('omits the Findings heading entirely when there are no findings', async () => {
    const profile = cleanProfile();
    const payApp = cleanPayApp();
    const result: AuditResult = runAudit(profile, payApp);
    expect(result.findings).toHaveLength(0);

    const blob = buildPdfMemo({ profile, payApp, result, now: fixedNow });
    const text = await decodeAscii(blob);
    expect(text).toContain('Summary');
    expect(text).toContain('Disclaimer');
    expect(text).not.toContain('Detailed findings');
  });

  it('produces same-size output for identical inputs and a fixed now', async () => {
    // jspdf inserts a randomized /ID array in the trailer (one of two PDF
    // identifiers). Bit-for-bit equality across runs isn't achievable
    // without monkey-patching. Same input -> same byte length is the
    // strongest portable invariant.
    const { profile, payApp, result } = acceptanceScenario();
    const a = buildPdfMemo({ profile, payApp, result, preparedBy: 'J. Smith', now: fixedNow });
    const b = buildPdfMemo({ profile, payApp, result, preparedBy: 'J. Smith', now: fixedNow });
    expect(a.size).toBe(b.size);
  });
});
