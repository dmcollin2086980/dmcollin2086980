import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoPreview } from '../MemoPreview';
import { defaultProfile } from '../../state/profile';
import { runAudit } from '../../engine/runner';
import { parsePayAppCsv } from '../../import/csv';
import { SAMPLE_CSV } from '../../import/__tests__/fixtures';
import type { PayApplication, ProjectProfile } from '../../engine/types';

const buildScenario = () => {
  const profile: ProjectProfile = {
    ...defaultProfile(),
    projectName: 'Example Hospital',
    gmpAmount: 5_000_000,
    allowances: [
      { code: 'ALLOW-01', description: 'Signage allowance', amount: 25_000 },
    ],
  };
  const parsed = parsePayAppCsv(SAMPLE_CSV);
  const total = parsed.lineItems.reduce(
    (acc, l) =>
      acc +
      l.workCompletedPrevious +
      l.workCompletedThisPeriod +
      l.materialsPresentlyStored,
    0,
  );
  const retainage = +(0.05 * total).toFixed(2);
  const payApp: PayApplication = {
    applicationNumber: 7,
    periodTo: '2026-05-31',
    lineItems: parsed.lineItems,
    reportedTotalCompletedAndStored: total,
    reportedRetainage: retainage,
    reportedTotalEarnedLessRetainage: +(total - retainage).toFixed(2),
    reportedLessPreviousCertificates: 0,
    reportedCurrentPaymentDue: +(total - retainage).toFixed(2),
  };
  const result = runAudit(profile, payApp);
  return { profile, payApp, result };
};

const installClipboard = (writeText: (text: string) => Promise<void>) => {
  // jsdom's navigator.clipboard is read-only via a getter; replace the whole
  // navigator via stubGlobal so the component sees our mock.
  vi.stubGlobal('navigator', new Proxy(navigator, {
    get(target, prop) {
      if (prop === 'clipboard') return { writeText };
      return Reflect.get(target, prop);
    },
  }));
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MemoPreview', () => {
  it('renders the memo containing the project name', () => {
    const { profile, payApp, result } = buildScenario();
    render(<MemoPreview profile={profile} payApp={payApp} result={result} />);
    const preview = screen.getByLabelText('Memo preview');
    expect(preview).toHaveTextContent('Example Hospital');
    expect(preview).toHaveTextContent('Pay Application:');
  });

  it('updates the memo when Prepared by changes', async () => {
    const user = userEvent.setup();
    const { profile, payApp, result } = buildScenario();
    render(<MemoPreview profile={profile} payApp={payApp} result={result} />);

    const preview = screen.getByLabelText('Memo preview');
    expect(preview).toHaveTextContent('(not specified)');

    await user.type(screen.getByPlaceholderText(/owner.s representative/i), 'J. Smith');
    expect(preview).toHaveTextContent('J. Smith');
    expect(preview).not.toHaveTextContent('(not specified)');
  });

  it('copies the memo to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    installClipboard(writeText);
    const user = userEvent.setup();
    const { profile, payApp, result } = buildScenario();
    render(<MemoPreview profile={profile} payApp={payApp} result={result} />);

    await user.click(screen.getByRole('button', { name: /copy memo/i }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]![0]).toContain('# C3 Forensic GMP Review');
  });

  it('surfaces an inline error when clipboard write fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    installClipboard(writeText);
    const user = userEvent.setup();
    const { profile, payApp, result } = buildScenario();
    render(<MemoPreview profile={profile} payApp={payApp} result={result} />);

    await user.click(screen.getByRole('button', { name: /copy memo/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not copy/i);
  });

  it('creates a Blob URL when Download is clicked', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:fake');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const user = userEvent.setup();
    const { profile, payApp, result } = buildScenario();
    render(<MemoPreview profile={profile} payApp={payApp} result={result} />);

    await user.click(screen.getByRole('button', { name: /download \.md/i }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const [blob] = createObjectURL.mock.calls[0]!;
    expect(blob).toBeInstanceOf(Blob);
    expect((blob as Blob).type).toBe('text/markdown');
  });
});
