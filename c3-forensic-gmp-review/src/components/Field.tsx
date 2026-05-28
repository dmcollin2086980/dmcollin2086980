import type { ReactNode } from 'react';

interface FieldProps {
  label: string;
  hint?: string;
  children: ReactNode;
}

export const Field = ({ label, hint, children }: FieldProps) => (
  <label className="flex flex-col gap-1 text-sm">
    <span className="font-medium text-slate-700">{label}</span>
    {children}
    {hint && <span className="text-xs text-slate-500">{hint}</span>}
  </label>
);

export const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="border border-slate-200 rounded-md bg-white p-4 shadow-sm">
    <h2 className="text-base font-semibold text-slate-900 mb-3">{title}</h2>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>
  </section>
);

interface CheckboxFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export const CheckboxField = ({ label, checked, onChange }: CheckboxFieldProps) => (
  <label className="flex items-center gap-2 text-sm">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
    />
    <span className="text-slate-700">{label}</span>
  </label>
);

const baseInput =
  'rounded-md border border-slate-300 px-2 py-1.5 text-sm shadow-sm ' +
  'focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500';

interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export const TextInput = ({ value, onChange, placeholder }: TextInputProps) => (
  <input
    type="text"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    className={baseInput}
  />
);

interface NumberInputProps {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  step?: string;
  placeholder?: string;
}

export const NumberInput = ({ value, onChange, step, placeholder }: NumberInputProps) => (
  <input
    type="number"
    value={value === undefined ? '' : value}
    step={step}
    onChange={(e) => {
      const raw = e.target.value;
      if (raw === '') {
        onChange(undefined);
      } else {
        const n = Number(raw);
        onChange(Number.isNaN(n) ? undefined : n);
      }
    }}
    placeholder={placeholder}
    className={baseInput}
  />
);

export const TextareaInput = ({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) => (
  <textarea
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    rows={3}
    className={baseInput + ' min-h-[5rem]'}
  />
);

export const SelectInput = <T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
}) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value as T)}
    className={baseInput}
  >
    {options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
);
