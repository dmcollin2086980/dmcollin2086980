import type { PayAppLineItem, PayApplication } from '../engine/types';
import {
  emptyLineItem,
  feeBasisToText,
  LINE_CATEGORIES,
  parseFeeBasisText,
} from '../state/payApp';
import { CsvImport } from './CsvImport';
import { DateInput, Field, NumberInput, Section } from './Field';

interface Props {
  payApp: PayApplication;
  onChange: (next: PayApplication) => void;
}

const cellInput =
  'w-full rounded border border-slate-300 px-1.5 py-1 text-sm shadow-sm ' +
  'focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500';

export const PayAppEntry = ({ payApp, onChange }: Props) => {
  const update = <K extends keyof PayApplication>(field: K, value: PayApplication[K]) =>
    onChange({ ...payApp, [field]: value });

  const updateLine = (index: number, next: PayAppLineItem) => {
    const lineItems = payApp.lineItems.slice();
    lineItems[index] = next;
    onChange({ ...payApp, lineItems });
  };
  const addLine = () =>
    onChange({ ...payApp, lineItems: [...payApp.lineItems, emptyLineItem()] });
  const removeLine = (index: number) =>
    onChange({
      ...payApp,
      lineItems: payApp.lineItems.filter((_, i) => i !== index),
    });

  return (
    <div className="flex flex-col gap-4">
      <Section title="CSV / paste import">
        <CsvImport onLines={(lineItems) => onChange({ ...payApp, lineItems })} />
      </Section>

      <Section title="G702 summary">
        <Field label="Application number">
          <NumberInput
            value={payApp.applicationNumber}
            onChange={(v) => update('applicationNumber', v ?? 1)}
          />
        </Field>
        <Field label="Period to">
          <DateInput value={payApp.periodTo} onChange={(v) => update('periodTo', v)} />
        </Field>
        <Field label="Reported total completed and stored">
          <NumberInput
            value={payApp.reportedTotalCompletedAndStored}
            onChange={(v) => update('reportedTotalCompletedAndStored', v ?? 0)}
          />
        </Field>
        <Field label="Reported retainage">
          <NumberInput
            value={payApp.reportedRetainage}
            onChange={(v) => update('reportedRetainage', v ?? 0)}
          />
        </Field>
        <Field label="Reported total earned less retainage">
          <NumberInput
            value={payApp.reportedTotalEarnedLessRetainage}
            onChange={(v) => update('reportedTotalEarnedLessRetainage', v ?? 0)}
          />
        </Field>
        <Field label="Reported less previous certificates">
          <NumberInput
            value={payApp.reportedLessPreviousCertificates}
            onChange={(v) => update('reportedLessPreviousCertificates', v ?? 0)}
          />
        </Field>
        <Field label="Reported current payment due">
          <NumberInput
            value={payApp.reportedCurrentPaymentDue}
            onChange={(v) => update('reportedCurrentPaymentDue', v ?? 0)}
          />
        </Field>
      </Section>

      <Section title="G703 line items">
        <div className="md:col-span-2 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-2 py-1.5">Code</th>
                <th className="px-2 py-1.5">Description</th>
                <th className="px-2 py-1.5">Scheduled $</th>
                <th className="px-2 py-1.5">Prev $</th>
                <th className="px-2 py-1.5">This $</th>
                <th className="px-2 py-1.5">Stored $</th>
                <th className="px-2 py-1.5">Category</th>
                <th className="px-2 py-1.5">Retainage $</th>
                <th className="px-2 py-1.5">Fee basis</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {payApp.lineItems.length === 0 && (
                <tr>
                  <td
                    colSpan={10}
                    className="px-2 py-3 text-center text-xs italic text-slate-500"
                  >
                    No line items. Add one below or import a CSV above.
                  </td>
                </tr>
              )}
              {payApp.lineItems.map((line, i) => (
                <tr key={i} className="border-t border-slate-200 align-top">
                  <td className="px-1 py-1">
                    <input
                      aria-label={`Code, line ${i + 1}`}
                      value={line.code}
                      onChange={(e) => updateLine(i, { ...line, code: e.target.value })}
                      className={cellInput}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      aria-label={`Description, line ${i + 1}`}
                      value={line.description}
                      onChange={(e) =>
                        updateLine(i, { ...line, description: e.target.value })
                      }
                      className={cellInput}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      aria-label={`Scheduled value, line ${i + 1}`}
                      value={line.scheduledValue}
                      onChange={(e) =>
                        updateLine(i, { ...line, scheduledValue: Number(e.target.value) || 0 })
                      }
                      className={cellInput}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      aria-label={`Work completed previous, line ${i + 1}`}
                      value={line.workCompletedPrevious}
                      onChange={(e) =>
                        updateLine(i, {
                          ...line,
                          workCompletedPrevious: Number(e.target.value) || 0,
                        })
                      }
                      className={cellInput}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      aria-label={`Work completed this period, line ${i + 1}`}
                      value={line.workCompletedThisPeriod}
                      onChange={(e) =>
                        updateLine(i, {
                          ...line,
                          workCompletedThisPeriod: Number(e.target.value) || 0,
                        })
                      }
                      className={cellInput}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      aria-label={`Materials presently stored, line ${i + 1}`}
                      value={line.materialsPresentlyStored}
                      onChange={(e) =>
                        updateLine(i, {
                          ...line,
                          materialsPresentlyStored: Number(e.target.value) || 0,
                        })
                      }
                      className={cellInput}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <select
                      aria-label={`Category, line ${i + 1}`}
                      value={line.category}
                      onChange={(e) =>
                        updateLine(i, {
                          ...line,
                          category: e.target.value as PayAppLineItem['category'],
                        })
                      }
                      className={cellInput}
                    >
                      {LINE_CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      aria-label={`Retainage withheld, line ${i + 1}`}
                      value={line.retainageWithheld ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateLine(i, {
                          ...line,
                          retainageWithheld:
                            v === '' ? undefined : Number(v) || 0,
                        });
                      }}
                      className={cellInput}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      aria-label={`Fee basis categories, line ${i + 1}`}
                      value={feeBasisToText(line.feeBasisCategories)}
                      onChange={(e) => {
                        const cats = parseFeeBasisText(e.target.value);
                        updateLine(i, {
                          ...line,
                          feeBasisCategories: cats.length > 0 ? cats : undefined,
                        });
                      }}
                      placeholder="cost_of_work, general_conditions"
                      className={cellInput}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      aria-label={`Remove line ${i + 1}`}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3">
            <button
              type="button"
              onClick={addLine}
              className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"
            >
              Add line
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
};
