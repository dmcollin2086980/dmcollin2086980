import type {
  PayAppLineItem,
  PayApplication,
  ProjectProfile,
} from '../types';

export const cleanProfile = (): ProjectProfile => ({
  projectName: 'Example Healthcare Renovation',
  contractType: 'A102_A201',
  gmpAmount: 5_000_000,
  feePercent: 0.05,
  feeBase: {
    appliesToCostOfWork: true,
    appliesToGeneralConditions: false,
    appliesToContingency: false,
    appliesToInsurance: false,
    appliesToBond: false,
  },
  retainagePercent: 0.05,
  retainageOnStoredMaterials: true,
  contingencyRequiresAuthorization: true,
  allowances: [
    { code: 'ALLOW-01', description: 'Signage allowance', amount: 25_000 },
  ],
  insurancePassthroughAtCost: true,
  bondPassthroughAtCost: true,
  excludedCostItems: ['home office overhead'],
});

export const line = (
  overrides: Partial<PayAppLineItem> &
    Pick<PayAppLineItem, 'code' | 'category'>,
): PayAppLineItem => ({
  description: '',
  scheduledValue: 0,
  workCompletedPrevious: 0,
  workCompletedThisPeriod: 0,
  materialsPresentlyStored: 0,
  ...overrides,
});

// Mirrors the addendum's "Sample valid CSV". A clean, internally consistent
// pay application that should produce zero high/medium findings.
export const cleanPayApp = (): PayApplication => {
  const lineItems: PayAppLineItem[] = [
    line({
      code: 'COW-01',
      description: 'General construction',
      scheduledValue: 3_000_000,
      workCompletedPrevious: 1_000_000,
      workCompletedThisPeriod: 200_000,
      category: 'cost_of_work',
    }),
    line({
      code: 'GC-01',
      description: 'General conditions',
      scheduledValue: 300_000,
      workCompletedPrevious: 100_000,
      workCompletedThisPeriod: 20_000,
      category: 'general_conditions',
    }),
    line({
      code: 'FEE-01',
      description: 'Contractor fee',
      scheduledValue: 150_000,
      workCompletedPrevious: 50_000,
      workCompletedThisPeriod: 10_000,
      category: 'fee',
      feeBasisCategories: ['cost_of_work'],
    }),
    line({
      code: 'ALLOW-01',
      description: 'Signage allowance',
      scheduledValue: 25_000,
      category: 'allowance',
    }),
    line({
      code: 'INS-01',
      description: 'Insurance',
      scheduledValue: 40_000,
      workCompletedPrevious: 10_000,
      workCompletedThisPeriod: 5_000,
      category: 'insurance',
    }),
    line({
      code: 'BOND-01',
      description: 'Payment & performance bond',
      scheduledValue: 40_000,
      workCompletedPrevious: 40_000,
      category: 'bond',
    }),
  ];

  // Pre-computed G702 rollups (tied to the line totals above):
  //   completed + stored = 1,200,000 + 120,000 + 60,000 + 0 + 15,000 + 40,000
  //                      = 1,435,000
  //   retainage @ 5%     = 71,750
  //   earned less ret    = 1,363,250
  //   less prev certs    = 1,140,000  (1,200,000 prev * 0.95)
  //   current due        = 223,250
  return {
    applicationNumber: 7,
    periodTo: '2026-05-31',
    lineItems,
    reportedTotalCompletedAndStored: 1_435_000,
    reportedRetainage: 71_750,
    reportedTotalEarnedLessRetainage: 1_363_250,
    reportedLessPreviousCertificates: 1_140_000,
    reportedCurrentPaymentDue: 223_250,
  };
};
