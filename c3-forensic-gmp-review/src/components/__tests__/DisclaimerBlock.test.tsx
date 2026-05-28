import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DisclaimerBlock } from '../DisclaimerBlock';

describe('DisclaimerBlock', () => {
  it('renders the advisory headline phrase', () => {
    render(<DisclaimerBlock />);
    expect(screen.getByText(/advisory review only/i)).toBeInTheDocument();
  });

  it('states that findings are not legal determinations', () => {
    render(<DisclaimerBlock />);
    expect(
      screen.getByRole('note', { name: /advisory disclaimer/i }),
    ).toHaveTextContent(/not legal determinations/i);
  });

  it('has the note ARIA role for assistive tech', () => {
    render(<DisclaimerBlock />);
    expect(
      screen.getByRole('note', { name: /advisory disclaimer/i }),
    ).toBeInTheDocument();
  });
});
