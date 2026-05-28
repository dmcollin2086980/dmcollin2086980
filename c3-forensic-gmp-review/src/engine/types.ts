export type LineCategory =
  | 'cost_of_work'
  | 'general_conditions'
  | 'fee'
  | 'contingency_owner'
  | 'contingency_gc'
  | 'allowance'
  | 'insurance'
  | 'bond'
  | 'stored_materials'
  | 'other';

// Single source of truth for the LineCategory value list. Import this in any
// module that needs to validate or iterate categories (csv parser, profile
// validator, payApp select options).
export const ALL_LINE_CATEGORIES: readonly LineCategory[] = [
  'cost_of_work',
  'general_conditions',
  'fee',
  'contingency_owner',
  'contingency_gc',
  'allowance',
  'insurance',
  'bond',
  'stored_materials',
  'other',
];

export type ContractType = 'A102_A201' | 'A133_A201' | 'custom';

export type Severity = 'high' | 'medium' | 'low';

export interface FeeBaseDefinition {
  appliesToCostOfWork: boolean;
  appliesToGeneralConditions: boolean;
  appliesToContingency: boolean;
  appliesToInsurance: boolean;
  appliesToBond: boolean;
}

export interface Allowance {
  code: string;
  description: string;
  amount: number;
}

export interface ProjectProfile {
  projectName: string;
  contractType: ContractType;
  gmpAmount: number;

  feePercent: number;
  feeBase: FeeBaseDefinition;

  retainagePercent: number;
  retainageOnStoredMaterials: boolean;
  retainageReductionAtPercent?: number;
  retainageReleasedLineItems?: string[];

  gcCapAmount?: number;
  gcMonthlyRate?: number;

  ownerContingencyAmount?: number;
  gcContingencyAmount?: number;
  contingencyRequiresAuthorization: boolean;

  allowances: Allowance[];

  insurancePassthroughAtCost: boolean;
  bondPassthroughAtCost: boolean;

  excludedCostItems: string[];

  notes?: string;
}

export interface PayAppLineItem {
  code: string;
  description: string;
  scheduledValue: number;
  workCompletedPrevious: number;
  workCompletedThisPeriod: number;
  materialsPresentlyStored: number;
  category: LineCategory;
  retainageWithheld?: number;
  feeBasisCategories?: LineCategory[];
  feeBilledThisPeriod?: number;
}

export interface PayApplication {
  applicationNumber: number;
  periodTo: string;
  lineItems: PayAppLineItem[];
  reportedTotalCompletedAndStored: number;
  reportedRetainage: number;
  reportedTotalEarnedLessRetainage: number;
  reportedLessPreviousCertificates: number;
  reportedCurrentPaymentDue: number;
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  title: string;
  affectedLineItems: string[];
  dollarExposure: number;
  contractBasis: string;
  explanation: string;
  recommendedAction: string;
  reviewFlagOnly: true;
}

export interface AuditResult {
  findings: Finding[];
  totalExposure: number;
  counts: { high: number; medium: number; low: number };
}

export type RuleFn = (
  profile: ProjectProfile,
  payApp: PayApplication,
) => Finding[];
