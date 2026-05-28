import type {
  Allowance,
  ContractType,
  FeeBaseDefinition,
  LineCategory,
  ProjectProfile,
} from '../engine/types';

const CONTRACT_TYPES: readonly ContractType[] = ['A102_A201', 'A133_A201', 'custom'];

const VALID_CATEGORIES: readonly LineCategory[] = [
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

export const defaultProfile = (): ProjectProfile => ({
  projectName: '',
  contractType: 'A102_A201',
  gmpAmount: 0,
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
  allowances: [],
  insurancePassthroughAtCost: true,
  bondPassthroughAtCost: true,
  excludedCostItems: [],
});

export const profileToJson = (profile: ProjectProfile): string =>
  JSON.stringify(profile, null, 2);

const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isFeeBase = (v: unknown): v is FeeBaseDefinition =>
  isObj(v) &&
  isBool(v.appliesToCostOfWork) &&
  isBool(v.appliesToGeneralConditions) &&
  isBool(v.appliesToContingency) &&
  isBool(v.appliesToInsurance) &&
  isBool(v.appliesToBond);

const isAllowance = (v: unknown): v is Allowance =>
  isObj(v) && isString(v.code) && isString(v.description) && isNumber(v.amount);

export class ProfileParseError extends Error {}

export const parseProfileJson = (text: string): ProjectProfile => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProfileParseError('File is not valid JSON.');
  }
  if (!isObj(raw)) throw new ProfileParseError('Top-level value must be an object.');

  const require = <T,>(field: string, ok: boolean, value: T): T => {
    if (!ok) throw new ProfileParseError(`Field "${field}" is missing or invalid.`);
    return value;
  };

  const profile: ProjectProfile = {
    projectName: require('projectName', isString(raw.projectName), raw.projectName as string),
    contractType: require(
      'contractType',
      isString(raw.contractType) &&
        CONTRACT_TYPES.includes(raw.contractType as ContractType),
      raw.contractType as ContractType,
    ),
    gmpAmount: require('gmpAmount', isNumber(raw.gmpAmount), raw.gmpAmount as number),
    feePercent: require('feePercent', isNumber(raw.feePercent), raw.feePercent as number),
    feeBase: require('feeBase', isFeeBase(raw.feeBase), raw.feeBase as FeeBaseDefinition),
    retainagePercent: require(
      'retainagePercent',
      isNumber(raw.retainagePercent),
      raw.retainagePercent as number,
    ),
    retainageOnStoredMaterials: require(
      'retainageOnStoredMaterials',
      isBool(raw.retainageOnStoredMaterials),
      raw.retainageOnStoredMaterials as boolean,
    ),
    contingencyRequiresAuthorization: require(
      'contingencyRequiresAuthorization',
      isBool(raw.contingencyRequiresAuthorization),
      raw.contingencyRequiresAuthorization as boolean,
    ),
    allowances: require(
      'allowances',
      Array.isArray(raw.allowances) && raw.allowances.every(isAllowance),
      raw.allowances as Allowance[],
    ),
    insurancePassthroughAtCost: require(
      'insurancePassthroughAtCost',
      isBool(raw.insurancePassthroughAtCost),
      raw.insurancePassthroughAtCost as boolean,
    ),
    bondPassthroughAtCost: require(
      'bondPassthroughAtCost',
      isBool(raw.bondPassthroughAtCost),
      raw.bondPassthroughAtCost as boolean,
    ),
    excludedCostItems: require(
      'excludedCostItems',
      Array.isArray(raw.excludedCostItems) && raw.excludedCostItems.every(isString),
      raw.excludedCostItems as string[],
    ),
  };

  if (raw.retainageReductionAtPercent !== undefined) {
    if (!isNumber(raw.retainageReductionAtPercent)) {
      throw new ProfileParseError('Field "retainageReductionAtPercent" must be a number.');
    }
    profile.retainageReductionAtPercent = raw.retainageReductionAtPercent;
  }
  if (raw.retainageReleasedLineItems !== undefined) {
    if (
      !Array.isArray(raw.retainageReleasedLineItems) ||
      !raw.retainageReleasedLineItems.every(isString)
    ) {
      throw new ProfileParseError('Field "retainageReleasedLineItems" must be a string array.');
    }
    profile.retainageReleasedLineItems = raw.retainageReleasedLineItems;
  }
  if (raw.gcCapAmount !== undefined) {
    if (!isNumber(raw.gcCapAmount))
      throw new ProfileParseError('Field "gcCapAmount" must be a number.');
    profile.gcCapAmount = raw.gcCapAmount;
  }
  if (raw.gcMonthlyRate !== undefined) {
    if (!isNumber(raw.gcMonthlyRate))
      throw new ProfileParseError('Field "gcMonthlyRate" must be a number.');
    profile.gcMonthlyRate = raw.gcMonthlyRate;
  }
  if (raw.ownerContingencyAmount !== undefined) {
    if (!isNumber(raw.ownerContingencyAmount))
      throw new ProfileParseError('Field "ownerContingencyAmount" must be a number.');
    profile.ownerContingencyAmount = raw.ownerContingencyAmount;
  }
  if (raw.gcContingencyAmount !== undefined) {
    if (!isNumber(raw.gcContingencyAmount))
      throw new ProfileParseError('Field "gcContingencyAmount" must be a number.');
    profile.gcContingencyAmount = raw.gcContingencyAmount;
  }
  if (raw.notes !== undefined) {
    if (!isString(raw.notes))
      throw new ProfileParseError('Field "notes" must be a string.');
    profile.notes = raw.notes;
  }

  return profile;
};

export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';

// Kept exported for future UI code that needs the canonical list (Profile form,
// PayApp form, etc.).
export { VALID_CATEGORIES };
