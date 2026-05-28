import type { Finding, LineCategory, RuleFn } from '../types';
import { linesByCategory, roundCents, sumCompletedToDate } from '../helpers';

const RULE3_CATEGORIES: ReadonlyArray<{
  category: LineCategory;
  profileField: 'insurancePassthroughAtCost' | 'bondPassthroughAtCost';
  label: string;
}> = [
  {
    category: 'insurance',
    profileField: 'insurancePassthroughAtCost',
    label: 'insurance',
  },
  {
    category: 'bond',
    profileField: 'bondPassthroughAtCost',
    label: 'bond',
  },
];

export const insuranceBondPassthrough: RuleFn = (profile, payApp) => {
  const findings: Finding[] = [];
  const feeLines = payApp.lineItems.filter((l) => l.category === 'fee');
  if (feeLines.length === 0) return findings;

  for (const { category, profileField, label } of RULE3_CATEGORIES) {
    if (!profile[profileField]) continue;

    const offendingFeeLines = feeLines.filter((l) =>
      (l.feeBasisCategories ?? []).includes(category),
    );
    if (offendingFeeLines.length === 0) continue;

    const categoryLines = linesByCategory(payApp.lineItems, category);
    const baseAmount = sumCompletedToDate(categoryLines);
    if (baseAmount <= 0) continue;

    const exposure = roundCents(profile.feePercent * baseAmount);
    findings.push({
      ruleId: 'INSURANCE_BOND_PASSTHROUGH',
      severity: 'high',
      title: `Contractor fee applied to ${label} passthrough`,
      affectedLineItems: [
        ...offendingFeeLines.map((l) => l.code),
        ...categoryLines.map((l) => l.code),
      ],
      dollarExposure: exposure,
      contractBasis: `${profileField} = true`,
      explanation:
        `The Project Profile treats ${label} as a passthrough at cost (${profileField} = true), ` +
        `which permits no fee or markup. Fee line(s) ${offendingFeeLines
          .map((l) => l.code)
          .join(', ')} tag ${label} as part of the fee base. Estimated improper fee = ` +
        `${profile.feePercent} x ${roundCents(baseAmount)} (completed-to-date of ${label} lines) = ${exposure}.`,
      recommendedAction:
        `Request the contractor's certificates of insurance or bond invoices and the fee calculation ` +
        `backup. Confirm the billed ${label} amounts are at cost only and that no fee was applied.`,
      reviewFlagOnly: true,
    });
  }

  return findings;
};
