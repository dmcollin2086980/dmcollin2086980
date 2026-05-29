import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CsvImport } from '../CsvImport';
import type { PayAppLineItem } from '../../engine/types';
import { SAMPLE_CSV } from '../../import/__tests__/fixtures';

const HEADER =
  'code,description,scheduled_value,work_completed_previous,work_completed_this_period,materials_presently_stored,category,retainage_withheld,fee_basis_categories';

const Harness = ({
  onLines,
}: {
  onLines?: (lines: PayAppLineItem[]) => void;
}) => {
  const [lines, setLines] = useState<PayAppLineItem[] | null>(null);
  return (
    <>
      <CsvImport
        onLines={(received) => {
          setLines(received);
          onLines?.(received);
        }}
      />
      <div data-testid="line-count">
        {lines === null ? 'no-import' : `count:${lines.length}`}
      </div>
    </>
  );
};

describe('CsvImport', () => {
  it('parses pasted CSV, shows a 6-line preview, and replaces lines on apply', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const textarea = screen.getByLabelText(/paste csv or tsv/i);
    await user.click(textarea);
    await user.paste(SAMPLE_CSV);
    await user.click(screen.getByRole('button', { name: /^parse$/i }));

    expect(screen.getByText(/will import 6 line/i)).toBeInTheDocument();

    const apply = screen.getByRole('button', { name: /replace g703 lines/i });
    expect(apply).not.toBeDisabled();
    await user.click(apply);

    expect(screen.getByTestId('line-count')).toHaveTextContent('count:6');
  });

  it('disables apply and surfaces row numbers when the CSV has errors', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const bad = [HEADER, 'COW-01,x,1,2,3,4,not_a_category,,'].join('\n');
    const textarea = screen.getByLabelText(/paste csv or tsv/i);
    await user.click(textarea);
    await user.paste(bad);
    await user.click(screen.getByRole('button', { name: /^parse$/i }));

    expect(screen.getByText(/cannot import/i)).toBeInTheDocument();
    expect(screen.getByText(/row 2/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /replace g703 lines/i }),
    ).toBeDisabled();
  });

  it('parses an uploaded file', async () => {
    const user = userEvent.setup();
    let received: PayAppLineItem[] | null = null;
    render(<Harness onLines={(lines) => (received = lines)} />);

    const file = new File([SAMPLE_CSV], 'app.csv', { type: 'text/csv' });
    const fileInput = screen.getByLabelText(
      /upload pay application csv/i,
    ) as HTMLInputElement;
    await user.upload(fileInput, file);

    expect(await screen.findByText(/will import 6 line/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /replace g703 lines/i }));
    expect(received!).toHaveLength(6);
  });
});
