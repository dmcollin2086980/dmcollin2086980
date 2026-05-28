import {
  ALL_LINE_CATEGORIES,
  type LineCategory,
  type PayAppLineItem,
  type PayApplication,
} from '../engine/types';

export const defaultPayApp = (): PayApplication => ({
  applicationNumber: 1,
  periodTo: '',
  lineItems: [],
  reportedTotalCompletedAndStored: 0,
  reportedRetainage: 0,
  reportedTotalEarnedLessRetainage: 0,
  reportedLessPreviousCertificates: 0,
  reportedCurrentPaymentDue: 0,
});

// 9 base-36 chars are enough to disambiguate rows in a single form lifetime
// without pulling in crypto.randomUUID (which is browser-only at runtime).
export const makeUiKey = (): string =>
  Math.random().toString(36).slice(2, 11);

export const emptyLineItem = (): PayAppLineItem => ({
  code: '',
  description: '',
  scheduledValue: 0,
  workCompletedPrevious: 0,
  workCompletedThisPeriod: 0,
  materialsPresentlyStored: 0,
  category: 'cost_of_work',
  _uiKey: makeUiKey(),
});

export const LINE_CATEGORIES: ReadonlyArray<{ value: LineCategory; label: string }> = [
  { value: 'cost_of_work', label: 'Cost of work' },
  { value: 'general_conditions', label: 'General conditions' },
  { value: 'fee', label: 'Fee' },
  { value: 'contingency_owner', label: "Owner's contingency" },
  { value: 'contingency_gc', label: "Contractor's contingency" },
  { value: 'allowance', label: 'Allowance' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'bond', label: 'Bond' },
  { value: 'stored_materials', label: 'Stored materials' },
  { value: 'other', label: 'Other' },
];

const CATEGORY_VALUES = new Set<string>(ALL_LINE_CATEGORIES);

export const parseFeeBasisText = (text: string): LineCategory[] =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && CATEGORY_VALUES.has(s)) as LineCategory[];

export const feeBasisToText = (cats: LineCategory[] | undefined): string =>
  (cats ?? []).join(', ');
