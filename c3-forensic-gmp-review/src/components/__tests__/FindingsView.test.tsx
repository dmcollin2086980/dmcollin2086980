import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FindingsView } from '../FindingsView';
import type { PayAppLineItem, PayApplication, ProjectProfile } from '../../engine/types';
import { defaultPayApp } from '../../state/payApp';
import { defaultProfile } from '../../state/profile';
import { parsePayAppCsv } from '../../import/csv';
import { SAMPLE_CSV } from '../../import/__tests__/fixtures';

const cleanProfile = (): ProjectProfile => {
  const p = defaultProfile();
  p.gmpAmount = 5_000_000;
  return p;
};

const tiedPayApp = (): PayApplication => {
  const parsed = parsePayAppCsv(SAMPLE_CSV);
  if (!parsed.success) throw new Error('sample CSV should parse');
  const total = parsed.lineItems.reduce(
    (acc, l) =>
      acc +
      l.workCompletedPrevious +
      l.workCompletedThisPeriod +
      l.materialsPresentlyStored,
    0,
  );
  const retainage = +(0.05 * total).toFixed(2);
  return {
    applicationNumber: 7,
    periodTo: '2026-05-31',
    lineItems: parsed.lineItems,
    reportedTotalCompletedAndStored: total,
    reportedRetainage: retainage,
    reportedTotalEarnedLessRetainage: +(total - retainage).toFixed(2),
    reportedLessPreviousCertificates: 0,
    reportedCurrentPaymentDue: +(total - retainage).toFixed(2),
  };
};

describe('FindingsView', () => {
  it('shows an "add line items" callout when the pay app is empty', () => {
    render(<FindingsView profile={cleanProfile()} payApp={defaultPayApp()} />);
    expect(screen.getByText(/add line items/i)).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('renders the clean-state callout when the sample CSV ties cleanly', () => {
    render(<FindingsView profile={cleanProfile()} payApp={tiedPayApp()} />);
    expect(screen.getByText(/no findings/i)).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('renders the acceptance scenario with formatted USD totals and severity counts', () => {
    const profile = cleanProfile();
    profile.gcCapAmount = 100_000;
    profile.allowances = [
      { code: 'ALLOW-01', description: 'Signage allowance', amount: 25_000 },
    ];
    const payApp = tiedPayApp();

    // Insurance fee-on-fee: tag FEE-01's basis with insurance.
    const feeIdx = payApp.lineItems.findIndex((l) => l.code === 'FEE-01');
    const feeLine = payApp.lineItems[feeIdx]!;
    payApp.lineItems[feeIdx] = {
      ...feeLine,
      feeBasisCategories: ['cost_of_work', 'insurance'],
    };

    // Allowance overrun: bump ALLOW-01 above its 25,000 budget.
    const allowIdx = payApp.lineItems.findIndex((l) => l.code === 'ALLOW-01');
    payApp.lineItems[allowIdx] = {
      ...payApp.lineItems[allowIdx]!,
      workCompletedPrevious: 30_000,
    };

    // Contingency draw without authorization.
    const contLine: PayAppLineItem = {
      code: 'CONT-OWN-01',
      description: "Owner's contingency draw",
      scheduledValue: 200_000,
      workCompletedPrevious: 0,
      workCompletedThisPeriod: 12_000,
      materialsPresentlyStored: 0,
      category: 'contingency_owner',
    };
    payApp.lineItems.push(contLine);

    // Retie G702 rollups so Rule 8 stays silent. Original clean total was 1,435,000;
    // ALLOW-01 added 30k, contingency added 12k. Bump reported retainage to fire
    // RETAINAGE_MISCALC.
    payApp.reportedTotalCompletedAndStored = 1_477_000;
    payApp.reportedRetainage = 100_000;
    payApp.reportedTotalEarnedLessRetainage = 1_377_000;
    payApp.reportedLessPreviousCertificates = 0;
    payApp.reportedCurrentPaymentDue = 1_377_000;

    render(<FindingsView profile={profile} payApp={payApp} />);

    // Rule titles
    expect(screen.getByText(/retainage over-withheld/i)).toBeInTheDocument();
    expect(screen.getByText(/fee applied to insurance passthrough/i)).toBeInTheDocument();
    expect(screen.getByText(/allowance ALLOW-01 exceeded/i)).toBeInTheDocument();
    expect(
      screen.getByText(/cumulative general conditions billings exceed/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/owner's contingency drawn this period/i)).toBeInTheDocument();

    // Severity counts: 2 high (retainage + insurance), 3 medium (allowance, gc cap, contingency)
    expect(screen.getByText(/2 high/)).toBeInTheDocument();
    expect(screen.getByText(/3 medium/)).toBeInTheDocument();

    // USD formatting
    expect(screen.getByText(/\$26,150/)).toBeInTheDocument(); // retainage delta
    expect(screen.getByText(/\$20,000/)).toBeInTheDocument(); // gc cap overage
  });

  it('recomputes when the profile changes (fee-on-fee disappears)', async () => {
    const Harness = () => {
      const [profile, setProfile] = useState(() => {
        const p = cleanProfile();
        return p;
      });
      const [payApp] = useState(() => {
        const a = tiedPayApp();
        const feeIdx = a.lineItems.findIndex((l) => l.code === 'FEE-01');
        a.lineItems[feeIdx] = {
          ...a.lineItems[feeIdx]!,
          feeBasisCategories: ['cost_of_work', 'general_conditions'],
        };
        return a;
      });
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setProfile({
                ...profile,
                feeBase: { ...profile.feeBase, appliesToGeneralConditions: true },
              });
            }}
          >
            allow gc
          </button>
          <FindingsView profile={profile} payApp={payApp} />
        </>
      );
    };
    const user = userEvent.setup();
    render(<Harness />);

    expect(
      screen.getByText(/contractor fee applied to general conditions/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /allow gc/i }));

    expect(
      screen.queryByText(/contractor fee applied to general conditions/i),
    ).not.toBeInTheDocument();
  });
});
