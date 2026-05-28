import { useRef, useState } from 'react';
import type { Allowance, ContractType, ProjectProfile } from '../engine/types';
import {
  parseProfileJson,
  ProfileParseError,
  profileToJson,
  slugify,
} from '../state/profile';
import {
  CheckboxField,
  Field,
  NumberInput,
  Section,
  SelectInput,
  TextareaInput,
  TextInput,
} from './Field';

interface Props {
  profile: ProjectProfile;
  onChange: (next: ProjectProfile) => void;
}

const CONTRACT_OPTIONS: ReadonlyArray<{ value: ContractType; label: string }> = [
  { value: 'A102_A201', label: 'AIA A102 / A201' },
  { value: 'A133_A201', label: 'AIA A133 / A201' },
  { value: 'custom', label: 'Custom contract' },
];

export const ProjectProfileForm = ({ profile, onChange }: Props) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const update = <K extends keyof ProjectProfile>(field: K, value: ProjectProfile[K]) =>
    onChange({ ...profile, [field]: value });

  const updateFeeBase = <K extends keyof ProjectProfile['feeBase']>(
    field: K,
    value: boolean,
  ) => onChange({ ...profile, feeBase: { ...profile.feeBase, [field]: value } });

  const updateAllowance = (index: number, next: Allowance) => {
    const allowances = profile.allowances.slice();
    allowances[index] = next;
    onChange({ ...profile, allowances });
  };
  const addAllowance = () =>
    onChange({
      ...profile,
      allowances: [...profile.allowances, { code: '', description: '', amount: 0 }],
    });
  const removeAllowance = (index: number) =>
    onChange({
      ...profile,
      allowances: profile.allowances.filter((_, i) => i !== index),
    });

  const releasedLineItemsText = (profile.retainageReleasedLineItems ?? []).join(', ');
  const updateReleasedLineItems = (text: string) => {
    const trimmed = text.trim();
    if (trimmed === '') {
      const { retainageReleasedLineItems, ...rest } = profile;
      void retainageReleasedLineItems;
      onChange(rest as ProjectProfile);
      return;
    }
    onChange({
      ...profile,
      retainageReleasedLineItems: trimmed
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    });
  };

  const excludedCostItemsText = profile.excludedCostItems.join(', ');
  const updateExcluded = (text: string) =>
    onChange({
      ...profile,
      excludedCostItems: text
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    });

  const handleExport = () => {
    const json = profileToJson(profile);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugify(profile.projectName)}-profile.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImport = async (file: File) => {
    setImportError(null);
    try {
      const text = await file.text();
      const next = parseProfileJson(text);
      onChange(next);
    } catch (err) {
      if (err instanceof ProfileParseError) setImportError(err.message);
      else setImportError('Could not read the selected file.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleExport}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          Export profile JSON
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
        >
          Import profile JSON
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          aria-label="Import profile JSON file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleImport(file);
          }}
        />
        {importError && (
          <span className="text-sm text-red-600" role="alert">
            {importError}
          </span>
        )}
      </div>

      <Section title="Project basics">
        <Field label="Project name">
          <TextInput
            value={profile.projectName}
            onChange={(v) => update('projectName', v)}
            placeholder="Example Hospital East Wing Renovation"
          />
        </Field>
        <Field label="Contract type">
          <SelectInput
            value={profile.contractType}
            onChange={(v) => update('contractType', v)}
            options={CONTRACT_OPTIONS}
          />
        </Field>
        <Field label="GMP amount" hint="Dollars. Total contract maximum.">
          <NumberInput value={profile.gmpAmount} onChange={(v) => update('gmpAmount', v ?? 0)} />
        </Field>
      </Section>

      <Section title="Fee">
        <Field label="Fee percent" hint="Decimal, e.g. 0.05 for 5%.">
          <NumberInput
            value={profile.feePercent}
            onChange={(v) => update('feePercent', v ?? 0)}
            step="0.0001"
          />
        </Field>
        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-2">
          <CheckboxField
            label="Fee applies to cost of work"
            checked={profile.feeBase.appliesToCostOfWork}
            onChange={(c) => updateFeeBase('appliesToCostOfWork', c)}
          />
          <CheckboxField
            label="Fee applies to general conditions"
            checked={profile.feeBase.appliesToGeneralConditions}
            onChange={(c) => updateFeeBase('appliesToGeneralConditions', c)}
          />
          <CheckboxField
            label="Fee applies to contingency"
            checked={profile.feeBase.appliesToContingency}
            onChange={(c) => updateFeeBase('appliesToContingency', c)}
          />
          <CheckboxField
            label="Fee applies to insurance"
            checked={profile.feeBase.appliesToInsurance}
            onChange={(c) => updateFeeBase('appliesToInsurance', c)}
          />
          <CheckboxField
            label="Fee applies to bond"
            checked={profile.feeBase.appliesToBond}
            onChange={(c) => updateFeeBase('appliesToBond', c)}
          />
        </div>
      </Section>

      <Section title="Retainage">
        <Field label="Retainage percent" hint="Decimal, e.g. 0.05 or 0.10.">
          <NumberInput
            value={profile.retainagePercent}
            onChange={(v) => update('retainagePercent', v ?? 0)}
            step="0.0001"
          />
        </Field>
        <CheckboxField
          label="Retainage applies to stored materials"
          checked={profile.retainageOnStoredMaterials}
          onChange={(c) => update('retainageOnStoredMaterials', c)}
        />
        <Field
          label="Retainage reduction threshold"
          hint="Optional. Completion fraction at which retainage steps to 0."
        >
          <NumberInput
            value={profile.retainageReductionAtPercent}
            onChange={(v) => update('retainageReductionAtPercent', v)}
            step="0.01"
          />
        </Field>
        <Field
          label="Released line item codes"
          hint="Optional. Comma-separated codes excluded from the retainage base."
        >
          <TextInput value={releasedLineItemsText} onChange={updateReleasedLineItems} />
        </Field>
      </Section>

      <Section title="General conditions">
        <Field label="GC cap amount" hint="Optional. Total general conditions cap.">
          <NumberInput
            value={profile.gcCapAmount}
            onChange={(v) => update('gcCapAmount', v)}
          />
        </Field>
        <Field label="GC monthly rate" hint="Optional. Allowed monthly GC billing.">
          <NumberInput
            value={profile.gcMonthlyRate}
            onChange={(v) => update('gcMonthlyRate', v)}
          />
        </Field>
      </Section>

      <Section title="Contingency">
        <Field label="Owner contingency amount" hint="Optional.">
          <NumberInput
            value={profile.ownerContingencyAmount}
            onChange={(v) => update('ownerContingencyAmount', v)}
          />
        </Field>
        <Field label="Contractor contingency amount" hint="Optional.">
          <NumberInput
            value={profile.gcContingencyAmount}
            onChange={(v) => update('gcContingencyAmount', v)}
          />
        </Field>
        <CheckboxField
          label="Contingency draws require written authorization"
          checked={profile.contingencyRequiresAuthorization}
          onChange={(c) => update('contingencyRequiresAuthorization', c)}
        />
      </Section>

      <Section title="Allowances">
        <div className="md:col-span-2 flex flex-col gap-2">
          {profile.allowances.map((a, i) => (
            <div
              key={i}
              className="grid grid-cols-1 md:grid-cols-[1fr_2fr_1fr_auto] gap-2 items-center"
            >
              <TextInput
                value={a.code}
                onChange={(v) => updateAllowance(i, { ...a, code: v })}
                placeholder="ALLOW-01"
              />
              <TextInput
                value={a.description}
                onChange={(v) => updateAllowance(i, { ...a, description: v })}
                placeholder="Description"
              />
              <NumberInput
                value={a.amount}
                onChange={(v) => updateAllowance(i, { ...a, amount: v ?? 0 })}
              />
              <button
                type="button"
                onClick={() => removeAllowance(i)}
                aria-label={`Remove allowance ${a.code || i + 1}`}
                className="text-sm text-red-600 hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addAllowance}
            className="self-start rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"
          >
            Add allowance
          </button>
        </div>
      </Section>

      <Section title="Insurance and bonds">
        <CheckboxField
          label="Insurance is passthrough at cost (no fee or markup)"
          checked={profile.insurancePassthroughAtCost}
          onChange={(c) => update('insurancePassthroughAtCost', c)}
        />
        <CheckboxField
          label="Bond is passthrough at cost (no fee or markup)"
          checked={profile.bondPassthroughAtCost}
          onChange={(c) => update('bondPassthroughAtCost', c)}
        />
      </Section>

      <Section title="Excluded cost items">
        <Field
          label="Excluded keywords"
          hint="Comma-separated. Used as flags for cost-of-work review."
        >
          <TextInput value={excludedCostItemsText} onChange={updateExcluded} />
        </Field>
      </Section>

      <Section title="Notes">
        <div className="md:col-span-2">
          <Field label="Notes">
            <TextareaInput
              value={profile.notes ?? ''}
              onChange={(v) => update('notes', v === '' ? undefined : v)}
              placeholder="Optional. Contract clauses, side letters, anything worth recording."
            />
          </Field>
        </div>
      </Section>
    </div>
  );
};
