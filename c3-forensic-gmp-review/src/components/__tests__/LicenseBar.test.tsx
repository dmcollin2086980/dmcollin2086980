import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LicenseBar } from '../LicenseBar';
import { LicenseProvider } from '../../state/LicenseContext';

// localStorage is cleared globally in src/test-setup.ts after each test.

const renderWithProvider = () =>
  render(
    <LicenseProvider>
      <LicenseBar />
    </LicenseProvider>,
  );

describe('LicenseBar', () => {
  it('renders the activate form when no key is stored', () => {
    renderWithProvider();
    expect(screen.getByLabelText('License key')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /activate/i })).toBeInTheDocument();
    expect(screen.getByText(/free tier/i)).toBeInTheDocument();
  });

  it('activates with a valid key and persists it to localStorage', async () => {
    const user = userEvent.setup();
    renderWithProvider();

    await user.type(screen.getByLabelText('License key'), 'C3-DEMO-V100');
    await user.click(screen.getByRole('button', { name: /activate/i }));

    expect(screen.getByText(/license activated/i)).toBeInTheDocument();
    expect(window.localStorage.getItem('c3-license-key')).toBe('C3-DEMO-V100');
  });

  it('rejects a malformed key with an inline error and does not persist', async () => {
    const user = userEvent.setup();
    renderWithProvider();

    await user.type(screen.getByLabelText('License key'), 'not-a-key');
    await user.click(screen.getByRole('button', { name: /activate/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not recognized/i);
    expect(window.localStorage.getItem('c3-license-key')).toBeNull();
  });

  it('deactivates and clears localStorage', async () => {
    window.localStorage.setItem('c3-license-key', 'C3-DEMO-V100');
    const user = userEvent.setup();
    renderWithProvider();

    expect(screen.getByText(/license activated/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /deactivate/i }));

    expect(window.localStorage.getItem('c3-license-key')).toBeNull();
    expect(screen.getByLabelText('License key')).toBeInTheDocument();
  });
});
