import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ProjectProfileForm } from '../ProjectProfileForm';
import { defaultProfile, profileToJson } from '../../state/profile';
import type { ProjectProfile } from '../../engine/types';

const Harness = ({ onProfile }: { onProfile?: (p: ProjectProfile) => void }) => {
  const [profile, setProfile] = useState(defaultProfile);
  return (
    <ProjectProfileForm
      profile={profile}
      onChange={(p) => {
        setProfile(p);
        onProfile?.(p);
      }}
    />
  );
};

describe('ProjectProfileForm', () => {
  it('renders the headline sections', () => {
    render(<Harness />);
    expect(screen.getByText('Project basics')).toBeInTheDocument();
    expect(screen.getByText('Fee')).toBeInTheDocument();
    expect(screen.getByText('Retainage')).toBeInTheDocument();
    expect(screen.getByText('Allowances')).toBeInTheDocument();
    expect(screen.getByText('Insurance and bonds')).toBeInTheDocument();
  });

  it('updates the profile state when the project name changes', async () => {
    const user = userEvent.setup();
    let latest: ProjectProfile | null = null;
    render(<Harness onProfile={(p) => (latest = p)} />);

    const input = screen.getByPlaceholderText(/example hospital/i);
    await user.type(input, 'Hello');
    expect(latest!.projectName).toBe('Hello');
  });

  it('toggles a fee base checkbox', async () => {
    const user = userEvent.setup();
    let latest: ProjectProfile | null = null;
    render(<Harness onProfile={(p) => (latest = p)} />);

    const cb = screen.getByLabelText('Fee applies to general conditions');
    expect((cb as HTMLInputElement).checked).toBe(false);
    await user.click(cb);
    expect(latest!.feeBase.appliesToGeneralConditions).toBe(true);
  });

  it('adds and removes allowances', async () => {
    const user = userEvent.setup();
    let latest: ProjectProfile | null = null;
    render(<Harness onProfile={(p) => (latest = p)} />);

    await user.click(screen.getByRole('button', { name: /add allowance/i }));
    expect(latest!.allowances).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: /remove allowance 1/i }));
    expect(latest!.allowances).toHaveLength(0);
  });

  it('imports a JSON file into the form state', async () => {
    const user = userEvent.setup();
    let latest: ProjectProfile | null = null;
    render(<Harness onProfile={(p) => (latest = p)} />);

    const payload = defaultProfile();
    payload.projectName = 'Imported Project';
    payload.gmpAmount = 9_000_000;
    const file = new File([profileToJson(payload)], 'profile.json', {
      type: 'application/json',
    });

    const fileInput = screen.getByLabelText(
      /import profile json file/i,
    ) as HTMLInputElement;
    await user.upload(fileInput, file);

    expect(latest!.projectName).toBe('Imported Project');
    expect(latest!.gmpAmount).toBe(9_000_000);
  });

  it('surfaces a friendly error when importing bad JSON', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const file = new File(['{not json'], 'bad.json', { type: 'application/json' });
    const fileInput = screen.getByLabelText(
      /import profile json file/i,
    ) as HTMLInputElement;
    await user.upload(fileInput, file);

    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid json/i);
  });
});
