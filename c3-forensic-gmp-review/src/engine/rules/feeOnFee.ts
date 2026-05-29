import type { FeeBaseDefinition, Finding, LineCategory, RuleFn } from '../types';
import { linesByCategory, roundCents, sumCompletedToDate } from '../helpers';

// Per addendum Section B: Rule 1 owns general_conditions and contingency
// (owner + gc). Insurance and bond are Rule 3's responsibility.
const RULE1_CATEGORIES: ReadonlyArray<{
  category: LineCategory;
  profileField: keyof FeeBaseDefinition;
  label: string;
}> = [
  {
    category: 'general_conditions',
    profileField: 'appliesToGeneralConditions',
    label: 'general conditions',
  },
  {
    category: 'contingency_owner',
    profileField: 'appliesToContingency',
    label: "owner's contingency",
  },
  {
    category: 'contingency_gc',
    profileField: 'appliesToContingency',
    label: "contractor's contingency",
  },
];

export const feeOnFee: RuleFn = (profile, payApp) => {
  const findings: Finding[] = [];
  const feeLines = payApp.lineItems.filter((l) => l.category === 'fee');
  if (feeLines.length === 0) return findings;

  for (const { category, profileField, label } of RULE1_CATEGORIES) {
    if (profile.feeBase[profileField]) continue;

    const offendingFeeLines = feeLines.filter((l) =>
      (l.feeBasisCategories ?? []).includes(category),
    );
    if (offendingFeeLines.length === 0) continue;

    const categoryLines = linesByCategory(payApp.lineItems, category);
    const baseAmount = sumCompletedToDate(categoryLines);
    if (baseAmount <= 0) continue;

    const exposure = roundCents(profile.feePercent * baseAmount);
    const affected = [
      ...offendingFeeLines.map((l) => l.code),
      ...categoryLines.map((l) => l.code),
    ];

    findings.push({
      ruleId: 'FEE_ON_FEE',
      severity: 'high',
      title: `Contractor fee applied to ${label}`,
      affectedLineItems: affected,
      dollarExposure: exposure,
      contractBasis: `feeBase.${profileField} = false`,
      explanation:
        `Fee line(s) ${offendingFeeLines.map((l) => l.code).join(', ')} are tagged as billed ` +
        `on a base that includes ${label}. The Project Profile sets feeBase.${profileField} to false, ` +
        `so fee is not contractually permitted on that base. Estimated improper fee = ` +
        `${profile.feePercent} x ${roundCents(baseAmount)} (completed-to-date of ${label} lines) = ${exposure}.`,
      recommendedAction:
        `Request the contractor's fee calculation backup. Confirm whether the billed fee ` +
        `included the ${label} amounts. If so, request a credit for the improper portion.`,
      reviewFlagOnly: true,
    });
  }

  return findings;
};
