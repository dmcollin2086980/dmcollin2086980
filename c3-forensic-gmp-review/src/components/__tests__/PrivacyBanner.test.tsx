import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PrivacyBanner } from '../PrivacyBanner';

describe('PrivacyBanner', () => {
  it('renders the headline phrase', () => {
    render(<PrivacyBanner />);
    expect(
      screen.getByText(/your project data stays in this browser/i),
    ).toBeInTheDocument();
  });

  it('mentions no backend and no analytics', () => {
    render(<PrivacyBanner />);
    const note = screen.getByRole('note', { name: /privacy notice/i });
    expect(note.textContent?.toLowerCase()).toContain('no backend');
    expect(note.textContent?.toLowerCase()).toContain('no analytics');
  });
});
