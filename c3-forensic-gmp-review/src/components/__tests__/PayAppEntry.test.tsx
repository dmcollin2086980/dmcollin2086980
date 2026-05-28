import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PayAppEntry } from '../PayAppEntry';
import type { PayApplication } from '../../engine/types';
import { defaultPayApp } from '../../state/payApp';

const Harness = ({
  onApp,
}: {
  onApp?: (p: PayApplication) => void;
}) => {
  const [app, setApp] = useState(defaultPayApp);
  return (
    <PayAppEntry
      payApp={app}
      onChange={(next) => {
        setApp(next);
        onApp?.(next);
      }}
    />
  );
};

describe('PayAppEntry', () => {
  it('renders the three sections', () => {
    render(<Harness />);
    expect(screen.getByText('CSV / paste import')).toBeInTheDocument();
    expect(screen.getByText('G702 summary')).toBeInTheDocument();
    expect(screen.getByText('G703 line items')).toBeInTheDocument();
    expect(screen.getByText(/no line items/i)).toBeInTheDocument();
  });

  it('adds and removes G703 line rows', async () => {
    const user = userEvent.setup();
    let latest: PayApplication | null = null;
    render(<Harness onApp={(p) => (latest = p)} />);

    await user.click(screen.getByRole('button', { name: /^add line$/i }));
    expect(latest!.lineItems).toHaveLength(1);
    expect(latest!.lineItems[0]!.category).toBe('cost_of_work');

    await user.click(screen.getByRole('button', { name: /remove line 1/i }));
    expect(latest!.lineItems).toHaveLength(0);
  });

  it('updates a G702 summary field', async () => {
    const user = userEvent.setup();
    let latest: PayApplication | null = null;
    render(<Harness onApp={(p) => (latest = p)} />);

    const retainage = screen.getByLabelText('Reported retainage');
    await user.clear(retainage);
    await user.type(retainage, '12500');
    expect(latest!.reportedRetainage).toBe(12500);
  });

  it('changes a line category via the select', async () => {
    const user = userEvent.setup();
    let latest: PayApplication | null = null;
    render(<Harness onApp={(p) => (latest = p)} />);

    await user.click(screen.getByRole('button', { name: /^add line$/i }));
    const select = screen.getByLabelText(/category, line 1/i);
    await user.selectOptions(select, 'fee');
    expect(latest!.lineItems[0]!.category).toBe('fee');
  });

  it('preserves per-row identity when a middle row is removed', async () => {
    const user = userEvent.setup();
    let latest: PayApplication | null = null;
    render(<Harness onApp={(p) => (latest = p)} />);

    const addLine = screen.getByRole('button', { name: /^add line$/i });
    await user.click(addLine);
    await user.click(addLine);
    await user.click(addLine);

    // Tag each row's description to track identity after a removal.
    await user.type(screen.getByLabelText(/description, line 1/i), 'alpha');
    await user.type(screen.getByLabelText(/description, line 2/i), 'beta');
    await user.type(screen.getByLabelText(/description, line 3/i), 'gamma');

    const betaKey = latest!.lineItems[1]!._uiKey;
    const gammaKey = latest!.lineItems[2]!._uiKey;

    await user.click(screen.getByRole('button', { name: /remove line 1/i }));

    expect(latest!.lineItems).toHaveLength(2);
    expect(latest!.lineItems[0]!.description).toBe('beta');
    expect(latest!.lineItems[0]!._uiKey).toBe(betaKey);
    expect(latest!.lineItems[1]!.description).toBe('gamma');
    expect(latest!.lineItems[1]!._uiKey).toBe(gammaKey);
  });
});
