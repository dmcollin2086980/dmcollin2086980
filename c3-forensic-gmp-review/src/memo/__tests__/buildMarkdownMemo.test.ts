import { describe, expect, it } from 'vitest';
import { buildMarkdownMemo } from '../buildMarkdownMemo';
import type { AuditResult, Finding } from '../../engine/types';
import { runAudit } from '../../engine/runner';
import {
  buildAcceptanceScenario,
  cleanMemoProfile as cleanProfile,
  tiedPayAppFromSample as cleanPayApp,
} from '../../__test_utils__/scenarios';

const fixedNow = new Date('2026-05-28T00:00:00Z');

describe('buildMarkdownMemo header', () => {
  it('lists project, application, period, prepared-by, and prepared-on', () => {
    const memo = buildMarkdownMemo({
      profile: cleanProfile(),
      payApp: cleanPayApp(),
      result: runAudit(cleanProfile(), cleanPayApp()),
      preparedBy: 'J. Smith',
      now: fixedNow,
    });
    expect(memo).toMatch(/^# C3 Forensic GMP Review/);
    expect(memo).toContain('**Project:** Example Hospital');
    expect(memo).toContain('**Pay Application:** #7');
    expect(memo).toContain('**Period ending:** 2026-05-31');
    expect(memo).toContain('**Prepared by:** J. Smith');
    expect(memo).toContain('**Prepared on:** 2026-05-28');
  });

  it('falls back to "(not specified)" when preparedBy is omitted', () => {
    const memo = buildMarkdownMemo({
      profile: cleanProfile(),
      payApp: cleanPayApp(),
      result: runAudit(cleanProfile(), cleanPayApp()),
      now: fixedNow,
    });
    expect(memo).toContain('**Prepared by:** (not specified)');
  });
});

describe('buildMarkdownMemo with no findings', () => {
  it('writes the empty-summary paragraph and omits Findings + Detailed', () => {
    const profile = cleanProfile();
    const payApp = cleanPayApp();
    const result = runAudit(profile, payApp);
    expect(result.findings).toHaveLength(0);

    const memo = buildMarkdownMemo({ profile, payApp, result, now: fixedNow });
    expect(memo).toMatch(/identifies no findings/);
    expect(memo).not.toContain('## Findings');
    expect(memo).not.toContain('## Detailed findings');
    expect(memo).toContain('## Disclaimer');
  });
});

describe('buildMarkdownMemo with the acceptance scenario', () => {
  const { profile, payApp, result } = buildAcceptanceScenario();
  const memo = buildMarkdownMemo({
    profile,
    payApp,
    result,
    preparedBy: 'J. Smith',
    now: fixedNow,
  });

  it('emits the summary counts and total exposure', () => {
    expect(memo).toMatch(/2 high, 3 medium, 0 low/);
    expect(memo).toContain('$63,900.00');
  });

  it('includes a Findings table row for every finding', () => {
    expect(memo).toContain('## Findings');
    const tableLines = memo.split('\n').filter((l) => l.startsWith('| '));
    // 1 header row + 1 separator row + N data rows
    expect(tableLines.length).toBe(2 + result.findings.length);
  });

  it('renders a detailed section for high+medium findings only', () => {
    expect(memo).toContain('## Detailed findings');
    const detailedHeadings = memo.match(/^### \d+\./gm) ?? [];
    const highMedium = result.findings.filter(
      (f) => f.severity === 'high' || f.severity === 'medium',
    ).length;
    expect(detailedHeadings.length).toBe(highMedium);
  });

  it('never contains an em dash in the rendered memo', () => {
    expect(memo).not.toMatch(/—/);
  });

  it('ends with the disclaimer block', () => {
    expect(memo).toContain('## Disclaimer');
    expect(memo).toContain('not a\nlegal determination');
  });
});

describe('buildMarkdownMemo escaping', () => {
  it('escapes pipe characters in table cells and replaces newlines with <br>', () => {
    const profile = cleanProfile();
    const payApp = cleanPayApp();
    const pipey: Finding = {
      ruleId: 'FAKE_RULE',
      severity: 'high',
      title: 'Title with | pipe',
      affectedLineItems: ['COW-01'],
      dollarExposure: 1234.5,
      contractBasis: 'basis\nwith newline',
      explanation: 'Explanation.',
      recommendedAction: 'Action.',
      reviewFlagOnly: true,
    };
    const result: AuditResult = {
      findings: [pipey],
      totalExposure: 1234.5,
      counts: { high: 1, medium: 0, low: 0 },
    };
    const memo = buildMarkdownMemo({ profile, payApp, result, now: fixedNow });
    expect(memo).toContain('Title with \\| pipe');
    expect(memo).toContain('basis<br>with newline');
  });

  it('strips em dashes if any slip through from upstream data', () => {
    const profile = cleanProfile();
    const payApp = cleanPayApp();
    const tainted: Finding = {
      ruleId: 'FAKE_RULE',
      severity: 'high',
      title: 'Title — with em dash',
      affectedLineItems: [],
      dollarExposure: 0,
      contractBasis: 'basis',
      explanation: 'Explanation — body.',
      recommendedAction: 'Action.',
      reviewFlagOnly: true,
    };
    const result: AuditResult = {
      findings: [tainted],
      totalExposure: 0,
      counts: { high: 1, medium: 0, low: 0 },
    };
    const memo = buildMarkdownMemo({ profile, payApp, result, now: fixedNow });
    expect(memo).not.toMatch(/—/);
    expect(memo).toContain('Title - with em dash');
  });
});
