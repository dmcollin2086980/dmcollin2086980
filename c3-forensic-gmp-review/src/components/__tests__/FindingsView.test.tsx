import { useState, type ReactElement } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FindingsView } from '../FindingsView';
import { LicenseProvider } from '../../state/LicenseContext';
import type { PayAppLineItem, PayApplication, ProjectProfile } from '../../engine/types';
import { defaultPayApp } from '../../state/payApp';
import { defaultProfile } from '../../state/profile';
import { parsePayAppCsv } from '../../import/csv';
import { SAMPLE_CSV } from '../../import/__tests__/fixtures';

const seedUnlocked = () => {
  window.localStorage.setItem('c3-license-key', 'C3-DEMO-V100');
};

const renderUnlocked = (ui: ReactElement) => {
  seedUnlocked();
  return render(<LicenseProvider>{ui}</LicenseProvider>);
};

const renderLocked = (ui: ReactElement) => {
  window.localStorage.removeItem('c3-license-key');
  return render(<LicenseProvider>{ui}</LicenseProvider>);
};

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
    renderUnlocked(<FindingsView profile={cleanProfile()} payApp={defaultPayApp()} />);
    expect(screen.getByText(/add line items/i)).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('renders the clean-state callout when the sample CSV ties cleanly', () => {
    renderUnlocked(<FindingsView profile={cleanProfile()} payApp={tiedPayApp()} />);
    expect(screen.getByText(/cleared every rule/i)).toBeInTheDocument();
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

    renderUnlocked(<FindingsView profile={profile} payApp={payApp} />);

    // Rule titles: each appears in both the card h3 and the memo table cell.
    expect(screen.getAllByText(/retainage over-withheld/i).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/fee applied to insurance passthrough/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/allowance ALLOW-01 exceeded/i).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/cumulative general conditions billings exceed/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/owner's contingency drawn this period/i).length,
    ).toBeGreaterThan(0);

    // Severity counts: 2 high (retainage + insurance), 3 medium (allowance, gc cap, contingency).
    // Appear in both the summary badges and the memo summary paragraph.
    expect(screen.getAllByText(/2 high/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/3 medium/).length).toBeGreaterThan(0);

    // USD formatting: present in both the cards and the memo, but at least one is enough.
    expect(screen.getAllByText(/\$26,150/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\$20,000/).length).toBeGreaterThan(0);
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
    renderUnlocked(<Harness />);

    expect(
      screen.getAllByText(/contractor fee applied to general conditions/i).length,
    ).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /allow gc/i }));

    expect(
      screen.queryAllByText(/contractor fee applied to general conditions/i),
    ).toHaveLength(0);
  });

  it('masks dollar values when locked', () => {
    const profile = cleanProfile();
    profile.gcCapAmount = 100_000;
    const payApp = tiedPayApp();
    payApp.lineItems.push({
      code: 'CONT-OWN-01',
      description: '',
      scheduledValue: 200_000,
      workCompletedPrevious: 0,
      workCompletedThisPeriod: 12_000,
      materialsPresentlyStored: 0,
      category: 'contingency_owner',
    });
    payApp.reportedTotalCompletedAndStored = 1_447_000;
    payApp.reportedRetainage = 100_000;
    payApp.reportedTotalEarnedLessRetainage = 1_347_000;
    payApp.reportedCurrentPaymentDue = 1_347_000;

    renderLocked(<FindingsView profile={profile} payApp={payApp} />);

    // Severity badges still readable in card and memo
    expect(
      screen.getAllByText(/cumulative general conditions billings exceed/i).length,
    ).toBeGreaterThan(0);

    // Find the card and check that no real dollar amount is rendered.
    const card = screen.getByRole('article', { name: /Finding GC_CAP_BREACH/ });
    expect(within(card).queryByText(/\$20,000/)).not.toBeInTheDocument();
    expect(within(card).getAllByText(/\$•••/).length).toBeGreaterThan(0);
  });

  it('shows the LicenseBar with the activate form when locked', () => {
    renderLocked(<FindingsView profile={cleanProfile()} payApp={defaultPayApp()} />);
    expect(screen.getByLabelText('License key')).toBeInTheDocument();
  });
});
